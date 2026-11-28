import { createHash } from 'node:crypto';
import { ForbiddenException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { DOCUMENT_MONEY_PRECISION, nonNegativeDecimal } from '../../common/document-money';
import type { CurrentUser } from '../identity/auth';
import { CatalogFacade } from '../master-data/catalog.facade';
import { ProductUsage } from '../master-data/product-usage';
import { SalesContractFacade, readSnapshot } from "../sales-contracts/sales-contracts.service";
import { assertDecimal, PR_AMOUNTS, PR_TOTALS, PrCommercialHeader, PrLineError, savePrCommercialHeader } from './pr-commercial';
import * as prWorkflow from './pr-workflow';
import { configurePool, listCandidates, PR_POOLS, PrPool } from './pr-eligibility';
import { ActionContext, assertActionContext } from '../workflow/action-context';
import { documentPage, insertNote, latestRoundActivity } from '../document-records/document-records';
import * as wf from '../workflow/workflow';
import { BusinessError } from '../workflow/workflow';
import { DossierDocuments } from '../document-dossier/dossier-documents';
import { dossierTemplate, snapshotDocumentDossier } from '../document-dossier/dossier-snapshot';
import type { IncomingDossierFile } from '../document-dossier/dossier-storage';
import { DossierUpdate, NewDossierUpdate } from '../document-dossier/dossier-update.dto';
import { grantRole } from '../identity/authorization';
import { DataScope, ScopeSource, assertCanAct, assertCanRead, canAccessDraft, hasPermission, inScope, loadDataScope, matchesDraft,
  ownerOrgUnit, scopeFilter } from '../identity/data-scope';

// PO currently has no document-level read predicate. Both direct and nested reads use its VIEW grant.
const canReadPo = (scope: DataScope) => hasPermission(scope, 'PO.VIEW');
const VIEW = 'PR.VIEW';
const CREATE = 'PR.CREATE';
const DOSSIER = 'PR.DOSSIER_MANAGE';
/**
 * PR scope columns (§5.3): creator, responsible Sales/PM of the source HĐ, owner unit, and ASSIGNED = assignee of any
 * workflow node, current or past (invalidated rounds included), or reassigned away (REASSIGN overwrites the node
 * assignee; the append-only history keeps `from`), BA-OA3-04. Acting still needs the current assignment (Business Rule).
 */
export const PR_SOURCE: ScopeSource = {
  from: 'purchase_requisitions d JOIN sales_contracts s ON s.id = d.sales_contract_id', id: 'd.id',
  cols: {
    creator: 'd.created_by', responsible: ['s.responsible_sales_user_id', 's.responsible_pm_user_id'], orgUnit: 'd.owner_org_unit_id',
    assigned: `EXISTS (SELECT 1 FROM pr_workflow_nodes n WHERE n.pr_id = d.id AND n.assignee_id = :uid)
      OR EXISTS (SELECT 1 FROM approval_histories h WHERE h.document_type = 'PR' AND h.document_id = d.id
        AND h.action = 'REASSIGN' AND (h.metadata->'from'->>'id')::int = :uid)`,
  },
};
/** Scoped PR permissions that a detail or a reassignment may use, checked against one PR (`scopedOn`). */
const PR_ACTIONS = [CREATE, 'PR.APPROVE', 'PR.RECEIVE', 'PR.REASSIGN', DOSSIER];

export interface PrLineInput {
  id?: number;
  salesContractLineId?: number | null;
  productId?: number | null;
  temporaryProductId?: number | null;
  quantity: number | string;
  requirementDescription?: string | null;
  brandId?: number | null;
  supplierId?: number | null;
  unitOfMeasureId?: number | null;
  unitPrice?: string;
  taxRateId?: number | null;
}
export type LineCategory = 'SALES_GOODS' | 'MATERIAL';
/** Create-only header: `ownerOrgUnitId` is fixed at creation (BA-OA3-06), so edits never accept it. */
export type PrCreateSelection = prWorkflow.PrSelection & PrCommercialHeader & { ownerOrgUnitId?: number | null };

/** A PR line as seen by a GIR (A/C): its PR, HĐ, category and approved PO coverage. */
export interface PrLineForIssue {
  id: number; category: LineCategory;
  salesContractLineId: number | null; productId: number; quantity: number; poDone: boolean;
}

function assertPrLines(lines: PrLineInput[]) {
  if (!lines.length) throw new BusinessError('PR_LINES_REQUIRED', 'Add at least one valid line');
  wf.assertUniqueSourceLines(lines.flatMap(line => line.id == null ? [] : [line.id]));
  for (const line of lines) {
    const sources = [line.productId, line.temporaryProductId].filter(id => id != null);
    const quantity = String(line.quantity);
    if (sources.length !== 1 || !Number.isInteger(sources[0]) || (sources[0] ?? 0) <= 0
      || !nonNegativeDecimal(quantity, DOCUMENT_MONEY_PRECISION.quantity) || !/[1-9]/.test(quantity)
      || quantity.split('.')[0].replace(/^0+/, '').length > 15) {
      throw new BusinessError('PR_INVALID_LINE', 'Choose exactly one catalog item and enter a positive quantity with up to three decimal places');
    }
    if (line.unitPrice !== undefined) assertDecimal(line.unitPrice, DOCUMENT_MONEY_PRECISION.unitPrice, 'PR_INVALID_UNIT_PRICE');
  }
}
const scLineIds = (lines: PrLineInput[]) => lines.flatMap((l) => (l.salesContractLineId ? [l.salesContractLineId] : []));
export interface SourceLineInput { id?: number; sourceLineId: number; quantity: number }

export const PR_SORT = {
  documentNumber: 'd.document_number', name: 'd.name', category: 'd.category',
  salesContractNumber: 's.document_number', customerName: 'c.name', requesterName: 'requester.full_name',
  requisitionDate: 'd.requisition_date', requiredDate: 'd.required_date', currencyCode: 'd.currency_code',
  approvalStatus: 'd.approval_status', assignedApproverName: '(SELECT full_name FROM users WHERE id = d.assigned_approver_id)',
  createdAt: 'd.created_at',
} as const;

const PR_DETAILS = `d.name, d.purpose, d.description, d.created_by AS "requesterId", requester.full_name AS "requesterName",
  d.requisition_date::text AS "requisitionDate", d.required_date::text AS "requiredDate",
  d.currency_id AS "currencyId", d.currency_code AS "currencyCode",
  d.currency_decimal_places AS "currencyDecimalPlaces", trim_scale(d.exchange_rate) AS "exchangeRate",
  d.exchange_rate_source AS "exchangeRateSource", totals.net AS "subtotal",
  totals.tax AS "taxTotal", totals.net + totals.tax AS "total"`;

/** PO receipt status from line aggregates (03 §1, CT12); a PO with nothing received (or no lines) is NOT_RECEIVED. */
const RECEIPT_STATUS_SQL = `CASE
    WHEN NOT EXISTS (SELECT 1 FROM purchase_order_lines x WHERE x.purchase_order_id = d.id AND x.received_quantity > 0) THEN 'NOT_RECEIVED'
    WHEN NOT EXISTS (SELECT 1 FROM purchase_order_lines x WHERE x.purchase_order_id = d.id AND x.received_quantity < x.quantity) THEN 'RECEIVED'
    ELSE 'PARTIALLY_RECEIVED' END`;

const prPoDone = (alias: string) => `${alias}.approval_status = 'DONE' AND NOT EXISTS (
  SELECT 1 FROM purchase_requisition_lines x
   WHERE x.purchase_requisition_id = ${alias}.id AND x.product_id IS NOT NULL
     AND x.quantity <> COALESCE((
       SELECT SUM(pol.quantity) FROM purchase_order_lines pol JOIN purchase_orders po ON po.id = pol.purchase_order_id
        WHERE pol.purchase_requisition_line_id = x.id AND po.approval_status = 'APPROVED'
     ), 0))`;

/**
 * Facade for Inbound (ADR-0003): Inbound calls Procurement, never the reverse. Runs inside the caller's transaction.
 */
export class ProcurementFacade {
  static async readableLines(m: EntityManager, scope: DataScope, ids: number[]): Promise<Set<number>> {
    const filter = scopeFilter(scope, VIEW, PR_SOURCE.cols, 2);
    if (!ids.length || !filter) return new Set();
    const rows: { id: number }[] = await m.query(
      `SELECT l.id FROM ${PR_SOURCE.from} JOIN purchase_requisition_lines l ON l.purchase_requisition_id = d.id
        WHERE l.id = ANY($1) AND ${filter.sql}`, [ids, ...filter.params],
    );
    return new Set(rows.map(row => row.id));
  }

  static async lockReadableLines(m: EntityManager, scope: DataScope, ids: number[]) {
    const distinct = [...new Set(ids)];
    if ((await this.readableLines(m, scope, distinct)).size !== distinct.length) throw new NotFoundException();
    await m.query(
      `SELECT s.id FROM sales_contracts s WHERE EXISTS (
         SELECT 1 FROM purchase_requisitions d JOIN purchase_requisition_lines l ON l.purchase_requisition_id = d.id
          WHERE d.sales_contract_id = s.id AND l.id = ANY($1)) ORDER BY s.id FOR SHARE`, [distinct],
    );
    await m.query(
      `SELECT d.id FROM purchase_requisitions d WHERE EXISTS (
         SELECT 1 FROM purchase_requisition_lines l WHERE l.purchase_requisition_id = d.id AND l.id = ANY($1))
        ORDER BY d.id FOR SHARE`, [distinct],
    );
    if ((await this.readableLines(m, scope, distinct)).size !== distinct.length) throw new NotFoundException();
  }

  /**
   * PR lines for a GIR (A/C), locked FOR UPDATE in id order (lock order HĐ lines → PR lines → GIR, CT8).
   * `poDone`: every main PR line is fully covered by approved POs (03 section 3, CT1).
   */
  static async lockLinesForIssue(m: EntityManager, ids: number[]): Promise<Map<number, PrLineForIssue>> {
    const sorted = [...new Set(ids)].sort((a, b) => a - b);
    await m.query(`SELECT id FROM purchase_requisition_lines WHERE id = ANY($1) ORDER BY id FOR UPDATE`, [sorted]);
    const rows: PrLineForIssue[] = await m.query(
      `SELECT l.id, pr.category, l.sales_contract_line_id AS "salesContractLineId", l.product_id AS "productId", l.quantity::float AS quantity,
              ${prPoDone('pr')} AS "poDone"
         FROM purchase_requisition_lines l JOIN purchase_requisitions pr ON pr.id = l.purchase_requisition_id WHERE l.id = ANY($1) AND l.product_id IS NOT NULL`,
      [sorted],
    );
    return new Map(rows.map((r) => [r.id, r]));
  }

  /**
   * Received quantity per PR line: Σ received_quantity of its PO lines — the PO receipt progress maintained by Inbound
   * (APPROVED GRs only, reversed on recall), so several POs and GRs add up once each.
   */
  static async receivedByPrLine(m: EntityManager, purchaseRequisitionLineIds: number[]): Promise<Map<number, number>> {
    const rows: { id: number; received: string }[] = await m.query(
      `SELECT purchase_requisition_line_id AS id, SUM(received_quantity) AS received FROM purchase_order_lines
        WHERE purchase_requisition_line_id = ANY($1) GROUP BY purchase_requisition_line_id`,
      [purchaseRequisitionLineIds],
    );
    return new Map(rows.map((r) => [r.id, Number(r.received)]));
  }

  /** Distinct purposes of the PRs of these PR lines (C inherits them as a reference, CT9). */
  static async purposesOf(m: EntityManager, prLineIds: number[]): Promise<string[]> {
    if (!prLineIds.length) return [];
    const rows: { purpose: string }[] = await m.query(
      `SELECT DISTINCT pr.purpose FROM purchase_requisition_lines l JOIN purchase_requisitions pr ON pr.id = l.purchase_requisition_id
        WHERE l.id = ANY($1) AND pr.purpose IS NOT NULL AND btrim(pr.purpose) <> '' ORDER BY pr.purpose`,
      [prLineIds],
    );
    return rows.map((r) => r.purpose);
  }

  /** Unlocked read of PR lines (HĐ and HĐ line), so a GIR can validate and lock HĐ lines before PR lines (CT8). */
  static peekLines(m: EntityManager, prLineIds: number[]): Promise<{ id: number; salesContractId: number; salesContractLineId: number | null }[]> {
    return m.query(
      `SELECT l.id, pr.sales_contract_id AS "salesContractId", l.sales_contract_line_id AS "salesContractLineId"
         FROM purchase_requisition_lines l JOIN purchase_requisitions pr ON pr.id = l.purchase_requisition_id WHERE l.id = ANY($1) AND l.product_id IS NOT NULL`,
      [prLineIds],
    );
  }

  /** Lines of the HĐ's `PO done` PRs, with the received quantity for reference (PO line aggregates; not a limit, 03 §3). */
  static async poDoneLines(m: EntityManager, scope: DataScope, salesContractId: number) {
    const filter = scopeFilter(scope, VIEW, PR_SOURCE.cols, 2);
    if (!filter) return [];
    return m.query(
      `SELECT l.id, d.id AS "purchaseRequisitionId", d.document_number AS "prNumber", d.category, l.sales_contract_line_id AS "salesContractLineId",
              l.product_id AS "productId", p.part_number AS "partNumber", p.name AS "productName", u.code AS uom, l.quantity,
              COALESCE((SELECT SUM(pol.received_quantity) FROM purchase_order_lines pol WHERE pol.purchase_requisition_line_id = l.id), 0) AS "receivedQuantity"
         FROM ${PR_SOURCE.from}
         JOIN purchase_requisition_lines l ON l.purchase_requisition_id = d.id
         JOIN products p ON p.id = l.product_id
         JOIN units_of_measure u ON u.id = l.unit_of_measure_id
        WHERE d.sales_contract_id = $1 AND ${prPoDone('d')} AND ${filter.sql}
        ORDER BY d.id, l.id`,
      [salesContractId, ...filter.params],
    ) as Promise<{ id: number; purchaseRequisitionId: number; prNumber: string; category: LineCategory; salesContractLineId: number | null;
      productId: number; partNumber: string; productName: string; uom: string; quantity: string; receivedQuantity: string }[]>;
  }

  /** Source HĐ of each PO line (PO line → PR line → PR), for inventory lots (ADR-0013). */
  static async sourceContracts(m: EntityManager, purchaseOrderLineIds: number[]): Promise<Map<number, number>> {
    const rows: { id: number; sales_contract_id: number }[] = await m.query(
      `SELECT pol.id, pr.sales_contract_id FROM purchase_order_lines pol
         JOIN purchase_requisition_lines prl ON prl.id = pol.purchase_requisition_line_id
         JOIN purchase_requisitions pr ON pr.id = prl.purchase_requisition_id WHERE pol.id = ANY($1)`,
      [purchaseOrderLineIds],
    );
    return new Map(rows.map((r) => [r.id, r.sales_contract_id]));
  }

  /** Applies GR approval or recall to received quantities, locking the PO lines in ID order. */
  static async applyReceipt(m: EntityManager, lines: { purchaseOrderLineId: number; quantity: string }[], sign: 1 | -1) {
    const ids = [...new Set(lines.map((l) => l.purchaseOrderLineId))].sort((a, b) => a - b);
    await m.query(`SELECT id FROM purchase_order_lines WHERE id = ANY($1) ORDER BY id FOR UPDATE`, [ids]);
    for (const l of lines) {
      await m.query(`UPDATE purchase_order_lines SET received_quantity = received_quantity + $2::numeric * $3 WHERE id = $1`, [
        l.purchaseOrderLineId, l.quantity, sign,
      ]);
    }
  }
}

/** Owns PR snapshots and validates PO source lines and quantity limits. */
@Injectable()
export class ProcurementService {
  constructor(private readonly ds: DataSource, private readonly dossiers: DossierDocuments) {}

  /** `category`: sales goods (from the HĐ screen, every line keeps its HĐ line) or material (HĐ line optional); never mixed (CM3). */
  createPurchaseRequisition(user: CurrentUser, salesContractId: number, lines: PrLineInput[], category: LineCategory = 'SALES_GOODS', purpose?: string, route?: prWorkflow.PrRoute, selection: PrCreateSelection = {}) {
    return this.ds.transaction(m => this.createPr(m, user, salesContractId, lines, category, purpose, route, selection));
  }

  private async createPr(m: EntityManager, user: CurrentUser, salesContractId: number, lines: PrLineInput[], category: LineCategory,
    purpose: string | undefined, route: prWorkflow.PrRoute | undefined, selection: PrCreateSelection,
    dossier?: NewDossierUpdate & { requestKey: string }) {
    if (!Number.isInteger(salesContractId) || salesContractId <= 0) {
      throw new BusinessError('PR_SALES_CONTRACT_REQUIRED', 'Select a sales contract before saving a purchase requisition');
    }
    // Gate shared before any row lock (OA3.2 boundary, step 4): scope and memberships are fixed until commit.
    const s = await loadDataScope(m, user.id, true);
    const owner = await ownerOrgUnit(m, user.id, selection.ownerOrgUnitId);
    await SalesContractFacade.lockReadable(m, s, [salesContractId]);
    const contract = await SalesContractFacade.sourceContract(m, salesContractId);
    // F-OA0-03: CREATE and VIEW scope on the projected PR (creator, responsible of the HĐ, owner; no assignee yet).
    const draft = { creatorId: user.id, responsibleIds: [contract?.responsibleSalesUserId ?? null, contract?.responsiblePmUserId ?? null], orgUnitId: owner };
    if (!canAccessDraft(s, VIEW, CREATE, draft)) throw new ForbiddenException(`Missing permission: ${CREATE}`);
    if (dossier?.rows.length && !matchesDraft(s, DOSSIER, draft)) throw new ForbiddenException(`Missing permission: ${DOSSIER}`);
    const creatorRoute = await prWorkflow.creatorRoute(m, user, salesContractId, route);
    assertPrLines(lines);
    await SalesContractFacade.lockActiveLines(m, salesContractId, scLineIds(lines));
    await prWorkflow.validateSelection(m, creatorRoute, user.id, selection);
    const number = await wf.nextDocumentNumber(m, 'PR');
    const [pr] = await m.query(
      `INSERT INTO purchase_requisitions (document_number, sales_contract_id, category, purpose, created_by, creator_route, draft_approver_id, draft_receiver_id, owner_org_unit_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [number, salesContractId, category, purpose?.trim() || null, user.id, creatorRoute, selection.approverId ?? null, selection.receiverId ?? null, owner],
    );
    await savePrCommercialHeader(m, pr.id, selection);
    await this.writePrLines(m, pr.id, lines);
    const template = await dossierTemplate(m, 'PR');
    if (dossier && dossier.revision !== template.revision) {
      throw new BusinessError('PR_DOSSIER_TEMPLATE_CHANGED', 'Cấu hình hồ sơ đã thay đổi. Dữ liệu đang nhập được giữ lại.', HttpStatus.CONFLICT);
    }
    await snapshotDocumentDossier(m, 'PR', pr.id, user.id, template.rows);
    if (dossier?.rows.length) {
      await this.dossiers.save(m, 'PR', pr.id, user.id,
        this.newDossierContext(dossier.sessionKey ?? dossier.requestKey), dossier.rows, true);
    }
    return { id: pr.id as number, documentNumber: number };
  }

  /**
   * Inserts a PR line, or updates line `l.id` in place. Snapshot and UoM are captured when selecting a main product (03 §1a).
   * A line referenced by a (canceled) PO line keeps its product: that PO still shows it.
   */
  private async writePrLines(m: EntityManager, id: number, lines: PrLineInput[]) {
    const field: Record<string, string> = {
      PR_SUPPLIER_NOT_LINKED: 'supplierId', SUPPLIER_NOT_FOUND: 'supplierId', BRAND_NOT_FOUND: 'brandId',
      UOM_NOT_FOUND: 'unitOfMeasureId', TAX_RATE_NOT_FOUND: 'taxRateId', PR_INVALID_TAX_RATE: 'taxRateId',
    };
    for (const [index, line] of lines.entries()) {
      try {
        await this.writePrLine(m, id, line);
      } catch (error) {
        if (error instanceof BusinessError && field[error.code]) throw new PrLineError(error, { index, field: field[error.code] });
        throw error;
      }
    }
  }

  private async writePrLine(m: EntityManager, prId: number, l: PrLineInput) {
    const [existing] = l.id ? await m.query(
      'SELECT * FROM purchase_requisition_lines WHERE id = $1 AND purchase_requisition_id = $2', [l.id, prId],
    ) : [];
    if (l.id && !existing) throw new BusinessError('PR_LINE_NOT_FOUND', 'The line does not belong to this PR');
    const productId = l.productId ?? null;
    const temporaryProductId = l.temporaryProductId ?? null;
    const sameSource = existing && existing.product_id === productId && existing.temporary_product_id === temporaryProductId;
    let item: { code: string; name: string; description: string | null; brand_id: number | null; unit_of_measure_id: number | null } | undefined = sameSource ? {
      code: existing.snapshot_code, name: existing.snapshot_name, description: existing.snapshot_description,
      brand_id: existing.brand_id, unit_of_measure_id: existing.unit_of_measure_id,
    } : undefined;
    if (productId !== null) {
      await ProductUsage.markUsed(m, productId, { stock: false, existingReference: !!sameSource });
      const [product]: NonNullable<typeof item>[] = await m.query(`SELECT part_number AS code, name, description, brand_id, unit_of_measure_id
        FROM products WHERE id = $1`, [productId]);
      item ??= product;
      item.brand_id ??= product.brand_id;
      if ((l.brandId != null && l.brandId !== item.brand_id)
        || (l.unitOfMeasureId != null && l.unitOfMeasureId !== item.unit_of_measure_id)) {
        throw new BusinessError('PR_PRODUCT_DETAILS_MISMATCH', 'Brand and unit must match the main product');
      }
    } else if (!sameSource) {
      const temporary = await CatalogFacade.contractItem(m, null, temporaryProductId);
      if (!temporary) throw new BusinessError('PR_TEMPORARY_PRODUCT_NOT_FOUND', 'Temporary product not found or inactive');
      item = { ...temporary, brand_id: null, unit_of_measure_id: null };
    }
    if (!item) throw new BusinessError('PR_INVALID_LINE', 'Catalog item not found');

    const brandId = productId !== null ? item.brand_id : l.brandId === undefined ? item.brand_id ?? null : l.brandId;
    const uomId = productId !== null ? item.unit_of_measure_id : l.unitOfMeasureId === undefined ? item.unit_of_measure_id ?? null : l.unitOfMeasureId;
    const supplierId = l.supplierId === undefined ? (sameSource && brandId === existing.brand_id ? existing.supplier_id : null) : l.supplierId;
    const taxId = l.taxRateId === undefined ? existing?.tax_rate_id ?? null : l.taxRateId;
    const sameBrand = sameSource && brandId === existing.brand_id;
    const sameSupplier = sameBrand && supplierId === existing.supplier_id;

    if (productId === null && brandId !== null && !sameBrand) await CatalogFacade.assertActive(m, 'brand', brandId);
    if (supplierId !== null && !sameSupplier) await CatalogFacade.assertBrandSupplier(m, brandId, supplierId);
    if (productId === null && uomId !== null && !(sameSource && uomId === existing.unit_of_measure_id)) {
      await CatalogFacade.assertActive(m, 'uom', uomId);
    }
    if (taxId !== null && taxId !== existing?.tax_rate_id) await CatalogFacade.assertDocumentTaxRate(m, taxId);

    const values = [prId, l.salesContractLineId ?? null, productId, temporaryProductId, item.code, item.name, item.description,
      l.requirementDescription === undefined ? (existing ? existing.requirement_description : item.description) : l.requirementDescription,
      brandId, supplierId, uomId, l.quantity, l.unitPrice ?? existing?.unit_price ?? '0', taxId,
      sameBrand ? existing.brand_name : null, sameSupplier ? existing.supplier_name : null,
      sameSource && uomId === existing.unit_of_measure_id ? existing.uom_code : null,
      taxId !== null && taxId === existing?.tax_rate_id ? existing.tax_rate : null];
    const snapshots = `COALESCE($15, (SELECT name FROM brands WHERE id = $9)),
      COALESCE($16, (SELECT name FROM suppliers WHERE id = $10)), COALESCE($17, (SELECT code FROM units_of_measure WHERE id = $11)),
      COALESCE($18, (SELECT rate FROM tax_rates WHERE id = $14))`;
    if (!l.id) {
      await m.query(`INSERT INTO purchase_requisition_lines (purchase_requisition_id, sales_contract_line_id, product_id,
        temporary_product_id, snapshot_code, snapshot_name, snapshot_description, requirement_description, brand_id,
        supplier_id, unit_of_measure_id, quantity, unit_price, tax_rate_id, brand_name, supplier_name, uom_code, tax_rate)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, ${snapshots})`, values);
      return;
    }
    wf.assertLineUpdated(await m.query(`
      UPDATE purchase_requisition_lines l SET (sales_contract_line_id, product_id, temporary_product_id, snapshot_code,
        snapshot_name, snapshot_description, requirement_description, brand_id, supplier_id, unit_of_measure_id, quantity,
        unit_price, tax_rate_id, brand_name, supplier_name, uom_code, tax_rate) =
        ($2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, ${snapshots})
      WHERE l.id = $19 AND l.purchase_requisition_id = $1 AND
        ((l.product_id IS NOT DISTINCT FROM $3 AND l.temporary_product_id IS NOT DISTINCT FROM $4
          AND l.sales_contract_line_id IS NOT DISTINCT FROM $2)
          OR NOT EXISTS (SELECT 1 FROM purchase_order_lines pol WHERE pol.purchase_requisition_line_id = l.id))`,
      [...values, l.id]), l.id);
  }

  /** Edit a DRAFT/REJECTED PR by its creator: lines (HĐ line, product → UoM, quantity); the HĐ stays the same. */
  updatePurchaseRequisition(user: CurrentUser, id: number, version: number, lines: PrLineInput[], selection: prWorkflow.PrSelection & PrCommercialHeader & { purpose?: string; dossier?: DossierUpdate } = {}) {
    return this.ds.transaction(m => this.updatePr(m, user, id, version, lines, selection));
  }

  private async updatePr(m: EntityManager, user: CurrentUser, id: number, version: number, lines: PrLineInput[], selection: prWorkflow.PrSelection & PrCommercialHeader & { purpose?: string; dossier?: DossierUpdate }, context?: ActionContext) {
    // Gate, then VIEW + CREATE scope (403/404) before any rule; re-checked on the locked row below (lock order HĐ lines → PR).
    const s = await loadDataScope(m, user.id, true);
    await assertCanAct(m, s, VIEW, CREATE, PR_SOURCE, id);
    const [head] = await m.query(`SELECT sales_contract_id, version FROM purchase_requisitions WHERE id = $1`, [id]);
    if (!head) throw new NotFoundException();
    wf.assertVersion(head, version);
    const saved: { id: number; source: number | null }[] = await m.query(
      'SELECT id, sales_contract_line_id AS source FROM purchase_requisition_lines WHERE purchase_requisition_id = $1', [id],
    );
    const sources = new Map(saved.map(line => [line.id, line.source]));
    lines = lines.map(line => ({
      ...line, salesContractLineId: line.salesContractLineId === undefined && line.id ? sources.get(line.id) : line.salesContractLineId,
    }));
    if (lines.some(line => line.salesContractLineId != null && sources.get(line.id ?? 0) !== line.salesContractLineId)) {
      await SalesContractFacade.lockReadable(m, s, [head.sales_contract_id]);
    }
    // Lock order: HĐ lines → document (ARCHITECTURE §2.1a); the HĐ must still be ACTIVE.
    await SalesContractFacade.lockActiveLines(m, head.sales_contract_id, scLineIds(lines));
    const doc = await prWorkflow.lock(m, id);
    await assertCanAct(m, s, VIEW, CREATE, PR_SOURCE, id);
    if (selection.dossier?.rows.length) await this.assertScoped(m, s, DOSSIER, id);
    if (context) assertActionContext(doc, doc.approval_round, prWorkflow.currentStep(doc.approval_status), context);
    wf.assertEditable(doc, user, version);
    await prWorkflow.creatorRoute(m, user, doc.sales_contract_id, doc.creator_route);
    assertPrLines(lines);
    await prWorkflow.validateSelection(m, doc.creator_route, user.id, selection);
    await wf.deleteOmittedLines(m, 'purchase_requisition_lines', 'purchase_requisition_id', id, lines.flatMap((l) => (l.id ? [l.id] : [])));
    await savePrCommercialHeader(m, id, selection);
    await this.writePrLines(m, id, lines);
    if (selection.dossier?.rows.length) {
      await this.dossiers.save(m, 'PR', id, user.id, this.existingDossierContext(id, selection.dossier.sessionKey), selection.dossier.rows);
    }
    await wf.setStatus(m, 'PR', doc, doc.approval_status,
      ', draft_approver_id = CASE WHEN $3 THEN $4 ELSE draft_approver_id END, draft_receiver_id = CASE WHEN $5 THEN $6 ELSE draft_receiver_id END, purpose = CASE WHEN $7 THEN $8 ELSE purpose END',
      [selection.approverId !== undefined, selection.approverId ?? null, selection.receiverId !== undefined, selection.receiverId ?? null,
        selection.purpose !== undefined, selection.purpose?.trim() || null]);
    await wf.record(m, 'PR', id, 'EDIT', user.id, undefined, {
      previousStatus: doc.approval_status, nextStatus: doc.approval_status, round: doc.approval_round,
    });
  }

  saveNewPr(user: CurrentUser, dto: PrCreateSelection & { salesContractId: number; lines: PrLineInput[];
    category?: LineCategory; purpose?: string; route?: prWorkflow.PrRoute; requestKey: string; submit: boolean; dossier?: NewDossierUpdate }) {
    // PostgreSQL UUID equality ignores case. Use the same representation for the advisory lock and the row.
    const requestKey = dto.requestKey.toLowerCase();
    const commercialHeader = [dto.name, dto.description, dto.requisitionDate, dto.requiredDate, dto.currencyId, dto.exchangeRateSource, dto.exchangeRate];
    if (dto.refreshCatalogExchangeRate !== undefined) commercialHeader.push(String(dto.refreshCatalogExchangeRate));
    const commercialLines = dto.lines.map(line => [line.temporaryProductId, line.brandId, line.supplierId, line.unitOfMeasureId,
      line.requirementDescription, line.unitPrice, line.taxRateId]);
    const hasCommercialFields = [...commercialHeader, ...commercialLines.flat()].some(value => value !== undefined);
    const fingerprint = createHash('sha256').update(JSON.stringify([
      dto.salesContractId, dto.category, dto.purpose, dto.route, dto.approverId, dto.receiverId, dto.submit,
      dto.lines.map(line => [line.id, line.productId, line.salesContractLineId, line.quantity]),
      ...(hasCommercialFields ? [[commercialHeader, commercialLines]] : []),
      ...(dto.ownerOrgUnitId !== undefined ? [['owner', dto.ownerOrgUnitId]] : []),
      ...(dto.dossier ? [[dto.dossier.revision, dto.dossier.sessionKey, dto.dossier.rows.map(row => [row.dossierTypeId, row.version, row.hasPaper,
        row.issuedOn ?? null, row.issuer ?? null, row.note ?? null, row.fileId ?? null])]] : []),
    ])).digest('hex');
    return this.ds.transaction(async m => {
      await m.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [user.id, 'PR:create:' + requestKey]);
      const [existing] = await m.query(`SELECT id, document_number AS "documentNumber", create_request_fingerprint AS fingerprint
        FROM purchase_requisitions WHERE created_by = $1 AND create_request_key = $2`, [user.id, requestKey]);
      if (existing) {
        await this.lockPr(m, user, existing.id, CREATE);
        if (existing.fingerprint !== fingerprint) throw new BusinessError('PR_REQUEST_REUSED', 'The request key was already used for different data', HttpStatus.CONFLICT);
        return { id: existing.id as number, documentNumber: existing.documentNumber as string };
      }
      const pr = await this.createPr(m, user, dto.salesContractId, dto.lines, dto.category ?? 'SALES_GOODS', dto.purpose, dto.route, dto,
        dto.dossier ? { ...dto.dossier, requestKey } : undefined);
      if (dto.submit) await this.submitSavedPr(m, user, pr.id, dto);
      await m.query('UPDATE purchase_requisitions SET create_request_key = $2, create_request_fingerprint = $3 WHERE id = $1',
        [pr.id, requestKey, fingerprint]);
      return pr;
    });
  }

  submitEditedPr(user: CurrentUser, id: number, dto: ActionContext & prWorkflow.PrSelection & PrCommercialHeader & { lines: PrLineInput[]; purpose?: string; dossier?: DossierUpdate }) {
    return this.ds.transaction(async m => {
      await this.updatePr(m, user, id, dto.version, dto.lines, dto, dto);
      await this.submitSavedPr(m, user, id, dto);
    });
  }

  private async submitSavedPr(m: EntityManager, user: CurrentUser, id: number, selection: prWorkflow.PrSelection) {
    const { doc } = await this.lockPr(m, user, id, CREATE);
    if (!selection.approverId || !selection.receiverId) throw new BusinessError('PR_CANDIDATE_NOT_ELIGIBLE', 'Select both workflow assignees');
    await prWorkflow.submit(m, id, user, { version: doc.version, round: doc.approval_round, step: 'CREATE',
      approverId: selection.approverId, receiverId: selection.receiverId });
  }

  /** PO from lines of DONE PRs, one supplier; each PO line inherits the PR line UoM (T7). */
  createPurchaseOrder(user: CurrentUser, supplierId: number, lines: SourceLineInput[]) {
    wf.assertUniqueSourceLines(lines.map((l) => l.sourceLineId));
    return this.ds.transaction(async (m) => {
      const scope = await loadDataScope(m, user.id, true);
      if (!hasPermission(scope, 'PO.CREATE')) throw new ForbiddenException();
      await ProcurementFacade.lockReadableLines(m, scope, lines.map(line => line.sourceLineId));
      await CatalogFacade.assertActive(m, 'supplier', supplierId);
      const number = await wf.nextDocumentNumber(m, 'PO');
      const [po] = await m.query(`INSERT INTO purchase_orders (document_number, supplier_id, created_by) VALUES ($1, $2, $3) RETURNING id`, [
        number, supplierId, user.id,
      ]);
      for (const l of lines) await this.writePoLine(m, po.id, l);
      await this.checkPoLimits(m, po.id, true);
      return { id: po.id as number, documentNumber: number };
    });
  }

  /** New line: the PR line must be on a DONE PR; UoM inherited. Existing line: only the quantity changes. */
  private async writePoLine(m: EntityManager, poId: number, l: SourceLineInput) {
    if (l.id) {
      wf.assertLineUpdated(await m.query(
        `UPDATE purchase_order_lines SET quantity = $4 WHERE id = $1 AND purchase_order_id = $2 AND purchase_requisition_line_id = $3`,
        [l.id, poId, l.sourceLineId, l.quantity],
      ), l.id);
      return;
    }
    const [prl] = await m.query(
      `SELECT prl.unit_of_measure_id, prl.product_id FROM purchase_requisition_lines prl
         JOIN purchase_requisitions pr ON pr.id = prl.purchase_requisition_id
        WHERE prl.id = $1 AND pr.approval_status = 'DONE' FOR SHARE OF pr`,
      [l.sourceLineId],
    );
    if (!prl) throw new BusinessError('PR_SOURCE_NOT_DONE', `PR line ${l.sourceLineId} is not on a DONE PR`);
    if (prl.product_id === null) throw new BusinessError('PR_TEMPORARY_PRODUCT_PO_UNSUPPORTED', 'Temporary PR items cannot source a purchase order');
    await m.query(`INSERT INTO purchase_order_lines (purchase_order_id, purchase_requisition_line_id, unit_of_measure_id, quantity) VALUES ($1, $2, $3, $4)`, [
      poId, l.sourceLineId, prl.unit_of_measure_id, l.quantity,
    ]);
  }

  /** Edit a DRAFT/REJECTED PO by its creator: supplier and line quantities; Σ PO ≤ PR re-checked under lock (03 §1). */
  updatePurchaseOrder(user: CurrentUser, id: number, version: number, supplierId: number, lines: { id?: number; sourceLineId?: number; quantity: number }[]) {
    return this.ds.transaction(async (m) => {
      const scope = await loadDataScope(m, user.id, true);
      if (!hasPermission(scope, 'PO.CREATE')) throw new ForbiddenException();
      const doc = await wf.lockDocument(m, 'PO', id);
      wf.assertEditable(doc, user, version);
      const existing: { id: number; sourceLineId: number }[] = await m.query(
        'SELECT id, purchase_requisition_line_id AS "sourceLineId" FROM purchase_order_lines WHERE purchase_order_id = $1', [id],
      );
      const sources = new Map(existing.map(line => [line.id, line.sourceLineId]));
      const resolved = lines.map(line => {
        const sourceLineId = line.id ? sources.get(line.id) : line.sourceLineId;
        if (sourceLineId == null || (line.sourceLineId != null && sourceLineId !== line.sourceLineId)) {
          throw new BusinessError('LINE_NOT_EDITABLE', 'The source of an existing PO line cannot be changed', HttpStatus.CONFLICT);
        }
        return { ...line, sourceLineId };
      });
      wf.assertUniqueSourceLines(resolved.map(line => line.sourceLineId));
      await ProcurementFacade.lockReadableLines(m, scope, resolved.filter(line => !line.id).map(line => line.sourceLineId));
      const [current] = await m.query('SELECT supplier_id FROM purchase_orders WHERE id = $1', [id]);
      if (current.supplier_id !== supplierId) await CatalogFacade.assertActive(m, 'supplier', supplierId);
      await wf.deleteOmittedLines(m, 'purchase_order_lines', 'purchase_order_id', id, lines.flatMap((l) => (l.id ? [l.id] : [])));
      for (const l of resolved) await this.writePoLine(m, id, l);
      await m.query(`UPDATE purchase_orders SET supplier_id = $2 WHERE id = $1`, [id, supplierId]);
      await this.checkPoSources(m, id);
      await this.checkPoLimits(m, id, true);
      await wf.markEdited(m, 'PO', id, user.id);
    });
  }

  /** Σ PO (WAITING + APPROVED, plus this PO) per PR line ≤ PR line quantity; PR lines locked in id order (03 §1). */
  private async checkPoLimits(m: EntityManager, poId: number, includeThis: boolean) {
    const rows: { id: number; quantity: string; used: string }[] = await m.query(
      `WITH locked AS (
         SELECT prl.id, prl.quantity FROM purchase_requisition_lines prl
          WHERE prl.id IN (SELECT purchase_requisition_line_id FROM purchase_order_lines WHERE purchase_order_id = $1)
          ORDER BY prl.id FOR UPDATE)
       SELECT l.id, l.quantity, COALESCE(SUM(pol.quantity) FILTER (
                WHERE po.approval_status IN ('WAITING_FOR_APPROVE', 'APPROVED') OR ($2 AND po.id = $1)), 0) AS used
         FROM locked l
         LEFT JOIN purchase_order_lines pol ON pol.purchase_requisition_line_id = l.id
         LEFT JOIN purchase_orders po ON po.id = pol.purchase_order_id
        GROUP BY l.id, l.quantity`,
      [poId, includeThis],
    );
    const over = rows.find((r) => Number(r.used) > Number(r.quantity));
    if (over) throw new BusinessError('QUANTITY_LIMIT_EXCEEDED', `PO quantity exceeds the source PR line limit`);
  }

  poApprovers(user: CurrentUser, id: number) {
    return readSnapshot(this.ds, async m => {
      const scope = await loadDataScope(m, user.id);
      if (!canReadPo(scope) || !hasPermission(scope, 'PO.CREATE')) throw new ForbiddenException();
      const [doc] = await m.query(`SELECT created_by FROM purchase_orders WHERE id = $1 AND created_by = $2`, [id, user.id]);
      if (!doc) throw new NotFoundException();
      return wf.eligibleApprovers(m, 'PO', doc.created_by);
    });
  }

  /** PO source re-check (03 §7): every referenced PR must still be DONE (PR headers locked for share). */
  private async checkPoSources(m: EntityManager, poId: number) {
    const prs: { approval_status: string }[] = await m.query(
      `SELECT approval_status FROM purchase_requisitions
        WHERE id IN (SELECT prl.purchase_requisition_id FROM purchase_order_lines pol
                       JOIN purchase_requisition_lines prl ON prl.id = pol.purchase_requisition_line_id WHERE pol.purchase_order_id = $1)
        ORDER BY id FOR SHARE`,
      [poId],
    );
    const bad = prs.find((p) => p.approval_status !== 'DONE');
    if (bad) throw new BusinessError('PR_SOURCE_NOT_DONE', 'A source PR is no longer DONE');
  }

  submitPr(id: number, user: CurrentUser, dto: prWorkflow.PrSubmission) {
    return this.ds.transaction(async m => {
      await this.lockPr(m, user, id, CREATE);
      await prWorkflow.submit(m, id, user, dto);
    });
  }

  actOnPr(id: number, user: CurrentUser, action: prWorkflow.PrAction, context: ActionContext, reason?: string) {
    return this.ds.transaction(async m => {
      // Action permission by step: approval → PR.APPROVE, receipt → PR.RECEIVE, creator actions → PR.CREATE (§7).
      const { doc } = await this.lockPr(m, user, id, d => action === 'recall' || action === 'cancel' ? CREATE
        : action === 'receive' || (action === 'reject' && d.approval_status === 'WAITING_FOR_RECEIPT') ? 'PR.RECEIVE' : 'PR.APPROVE');
      const hasChildren = async () => (await m.query(
        `SELECT 1 FROM purchase_order_lines pol JOIN purchase_orders po ON po.id = pol.purchase_order_id
           JOIN purchase_requisition_lines prl ON prl.id = pol.purchase_requisition_line_id
          WHERE prl.purchase_requisition_id = $1 AND po.approval_status <> 'CANCELED' LIMIT 1`, [id],
      )).length > 0;
      await prWorkflow.decide(m, doc, user, action, reason, hasChildren, context);
    });
  }

  reassignPr(id: number, user: CurrentUser, dto: ActionContext & { assigneeId: number; reason: string }) {
    return this.ds.transaction(async m => {
      const { doc, scoped } = await this.lockPr(m, user, id);
      await prWorkflow.reassign(m, doc, user, dto, scoped);
    });
  }

  prReassignmentCandidates(id: number, user: CurrentUser) {
    return readSnapshot(this.ds, async m => {
      const s = await loadDataScope(m, user.id);
      await assertCanRead(m, s, VIEW, PR_SOURCE, id);
      const [doc] = await m.query('SELECT * FROM purchase_requisitions WHERE id = $1', [id]);
      const scoped = await this.scopedOn(m, s, id);
      return prWorkflow.reassignmentCandidates(m, doc, user, scoped);
    });
  }

  submit(type: 'PO', id: number, user: CurrentUser, approverId: number) {
    return this.ds.transaction(async (m) => {
      const doc = await wf.lockDocument(m, type, id);
      wf.assertCreator(doc, user);
      wf.assertStatus(doc, ['DRAFT', 'REJECTED']);
      if (type === 'PO') { await this.checkPoSources(m, id); await this.checkPoLimits(m, id, true); }
      await wf.submit(m, type, doc, user, approverId!);
    });
  }

  approve(type: 'PO', id: number, user: CurrentUser) {
    return this.ds.transaction(async (m) => {
      const doc = await wf.lockDocument(m, type, id);
      wf.assertAssignedApprover(doc, user);
      if (type === 'PO') { await this.checkPoSources(m, id); await this.checkPoLimits(m, id, false); }
      await wf.approve(m, type, doc, user);
    });
  }

  /** Reject / recall / cancel; an APPROVED PR (PO) needs no non-canceled PO (GRR) referencing it (03 §6). */
  decide(type: 'PO', action: 'reject' | 'recall' | 'cancel', id: number, user: CurrentUser, reason?: string) {
    return this.ds.transaction(async (m) => {
      const doc = await wf.lockDocument(m, type, id);
      const childSql = `SELECT 1 FROM goods_receipt_requests WHERE purchase_order_id = $1 AND approval_status <> 'CANCELED' LIMIT 1`;
      const hasChildren = async () => (await m.query(childSql, [id])).length > 0;
      await wf.decide(m, type, doc, user, action, reason, hasChildren);
    });
  }

  /**
   * `assignedToMe` = "Chờ tôi duyệt" (04 §4). PR.VIEW scope only (BA-SCP-17, ADR-0014 superseded): no implicit read via
   * creator, responsible or assignee; `salesContractId` (PR tab of a HĐ) only narrows the list. Items and total share one
   * scope load, one filter and one snapshot (OA3.2 F02).
   */
  listPrs(user: CurrentUser, assignedToMe: boolean, salesContractId?: number, filters: {
    q?: string; category?: string; status?: string; from?: string; to?: string; sort?: keyof typeof PR_SORT;
    direction?: 'asc' | 'desc'; page?: number; size?: number;
  } = {}) {
    if (filters.from && filters.to && filters.from > filters.to) {
      throw new BusinessError('PR_INVALID_DATE_RANGE', 'The start date must not be later than the end date');
    }
    return readSnapshot(this.ds, async m => {
      const s = await loadDataScope(m, user.id);
      if (!hasPermission(s, VIEW)) throw new ForbiddenException(`Missing permission: ${VIEW}`);
      if (salesContractId !== undefined && !(await SalesContractFacade.canRead(m, s, salesContractId))) {
        return filters.page === undefined ? [] : { items: [], total: 0 };
      }
      const values: unknown[] = [user.id, assignedToMe, salesContractId ?? null, filters.q?.trim() ?? '', filters.category ?? null,
        filters.status ?? null, filters.from ?? null, filters.to ?? null];
      const scope = scopeFilter(s, VIEW, PR_SOURCE.cols, values.length + 1);
      if (!scope) return filters.page === undefined ? [] : { items: [], total: 0 };
      values.push(...scope.params);
      const sourceFilter = SalesContractFacade.readFilter(s, values.length + 1);
      if (sourceFilter) values.push(...sourceFilter.params);
      const visible = sourceFilter?.sql ?? 'FALSE';
      const contractNumber = `CASE WHEN ${visible} THEN s.document_number END`;
      const customerName = `CASE WHEN ${visible} THEN c.name END`;
      const source = `FROM purchase_requisitions d
        JOIN sales_contracts s ON s.id = d.sales_contract_id JOIN customers c ON c.id = s.customer_id
        JOIN users requester ON requester.id = d.created_by`;
      const where = `WHERE (NOT $2 OR (d.approval_status IN ('WAITING_FOR_APPROVE', 'WAITING_FOR_RECEIPT') AND d.assigned_approver_id = $1))
        AND ($3::int IS NULL OR d.sales_contract_id = $3) AND ${scope.sql}
        AND ($4 = '' OR strpos(lower(d.document_number), lower($4)) > 0 OR strpos(lower(d.name), lower($4)) > 0
          OR strpos(lower(${contractNumber}), lower($4)) > 0 OR strpos(lower(${customerName}), lower($4)) > 0)
        AND ($5::text IS NULL OR d.category = $5) AND ($6::text IS NULL OR d.approval_status = $6)
        AND ($7::date IS NULL OR d.requisition_date >= $7) AND ($8::date IS NULL OR d.requisition_date <= $8)`;
      const sort = filters.sort === 'salesContractNumber' ? contractNumber : filters.sort === 'customerName' ? customerName
        : filters.sort && Object.hasOwn(PR_SORT, filters.sort) ? PR_SORT[filters.sort] : PR_SORT.createdAt;
      const size = filters.size ?? 25;
      const sql = `SELECT ${wf.DOC_COLUMNS}, d.category, CASE WHEN ${visible} THEN d.sales_contract_id END AS "salesContractId", ${PR_DETAILS},
        ${contractNumber} AS "salesContractNumber", ${customerName} AS "customerName"
        ${source} ${PR_TOTALS} ${where} ORDER BY ${sort} ${filters.direction === 'asc' ? 'ASC' : 'DESC'} NULLS LAST, d.id DESC`;
      if (filters.page === undefined) return m.query(sql, values);
      const [{ total }] = await m.query(`SELECT count(*)::int AS total ${source} ${where}`, values);
      const n = values.length;
      const items = await m.query(`${sql} LIMIT $${n + 1} OFFSET $${n + 2}`, [...values, size, (filters.page - 1) * size]);
      return { items, total };
    });
  }

  listPrContracts(user: CurrentUser, q: string, page: number) {
    return readSnapshot(this.ds, m => SalesContractFacade.prOptions(m, user.id, q, page));
  }

  productPicker(source: 'main' | 'temporary', query: Parameters<typeof CatalogFacade.productPicker>[2]) {
    return CatalogFacade.productPicker(this.ds, source, query);
  }

  /** Scoped PR permissions (`PR_ACTIONS`) whose own scope matches PR `id` (detail flags, reassignment paths). */
  private async scopedOn(m: EntityManager, s: DataScope, id: number) {
    const hits = await Promise.all(PR_ACTIONS.map(async p => hasPermission(s, p) && inScope(m, s, p, PR_SOURCE, id)));
    return PR_ACTIONS.filter((_, i) => hits[i]);
  }

  /** Action permission + its scope on an already readable PR (403), e.g. dossier rows saved with an edit. */
  private async assertScoped(m: EntityManager, s: DataScope, permission: string, id: number) {
    if (!hasPermission(s, permission) || !(await inScope(m, s, permission, PR_SOURCE, id))) {
      throw new ForbiddenException(`Missing permission: ${permission}`);
    }
  }

  /**
   * Write boundary (OA3.2 step 3, like `SalesContractsService.lockForAction`): gate shared + scope → PR FOR UPDATE →
   * VIEW (403/404) and, with `action` (fixed or chosen from the locked row), its scope (403) → Business Rules in the caller.
   * Without `action` only VIEW is required (notes; reassignment checks its path's scope through `scoped`).
   */
  private async lockPr(m: EntityManager, user: CurrentUser, id: number, action?: string | ((doc: prWorkflow.PrHeader) => string)) {
    const s = await loadDataScope(m, user.id, true);
    if (!hasPermission(s, VIEW)) throw new ForbiddenException(`Missing permission: ${VIEW}`);
    const [source] = await m.query('SELECT sales_contract_id FROM purchase_requisitions WHERE id = $1', [id]);
    if (source) await SalesContractFacade.sourceContract(m, source.sales_contract_id);
    const doc = await prWorkflow.lock(m, id); // 404 when missing
    const permission = typeof action === 'function' ? action(doc) : action;
    if (permission) await assertCanAct(m, s, VIEW, permission, PR_SOURCE, id);
    else await assertCanRead(m, s, VIEW, PR_SOURCE, id);
    return { s, doc, scoped: await this.scopedOn(m, s, id) };
  }

  /** Readable PR header (VIEW + scope, 403/404) and the scoped permissions on it. Call inside `readSnapshot`. */
  private async readPr(m: EntityManager, user: CurrentUser, id: number) {
    const s = await loadDataScope(m, user.id);
    await assertCanRead(m, s, VIEW, PR_SOURCE, id);
    const [pr] = await m.query(
      `SELECT ${wf.DOC_COLUMNS}, d.approval_round AS "approvalRound", d.sales_contract_id AS "salesContractId", s.responsible_pm_user_id AS "responsiblePmUserId",
        d.creator_route AS "creatorRoute", d.draft_approver_id AS "draftApproverId", d.draft_receiver_id AS "draftReceiverId",
        s.responsible_sales_user_id AS "responsibleSalesUserId", s.status AS "contractStatus", d.category, ${PR_DETAILS},
        s.document_number AS "salesContractNumber", c.name AS "customerName", d.owner_org_unit_id AS "ownerOrgUnitId", (SELECT code || ' · ' || name FROM org_units WHERE id = d.owner_org_unit_id) AS "ownerOrgUnitName"
         FROM purchase_requisitions d JOIN sales_contracts s ON s.id = d.sales_contract_id JOIN customers c ON c.id = s.customer_id
         JOIN users requester ON requester.id = d.created_by
         ${PR_TOTALS}
        WHERE d.id = $1`,
      [id],
    );
    const scoped = await this.scopedOn(m, s, id);
    const { responsibleSalesUserId, contractStatus, ...header } = pr;
    const routeOwner = header.creatorRoute === 'SALES' ? responsibleSalesUserId : header.responsiblePmUserId;
    const canEdit = header.createdBy === user.id && scoped.includes(CREATE)
      && contractStatus === 'ACTIVE' && routeOwner === user.id && ['DRAFT', 'REJECTED'].includes(header.approvalStatus);
    const canViewContract = await SalesContractFacade.canRead(m, s, header.salesContractId);
    if (!canViewContract) {
      header.salesContractId = null;
      header.salesContractNumber = null;
      header.customerName = null;
      header.responsiblePmUserId = null;
    }
    return { header, scoped, canEdit, canViewContract, canViewPo: canReadPo(s) };
  }

  prDossierTemplate() { return dossierTemplate(this.ds.manager, 'PR'); }

  private newDossierContext(key: string) { return 'PR:new:' + key.toLowerCase(); }
  private existingDossierContext(id: number, session?: string) { return 'PR:' + id + ':' + (session?.toLowerCase() ?? ''); }

  private assertDossierManage(user: CurrentUser, status?: string) {
    if (!user.permissions.includes(DOSSIER)) throw new ForbiddenException(`Missing permission: ${DOSSIER}`);
    if (status === 'CANCELED') throw new BusinessError('PR_DOSSIER_CANCELED', 'Không thể cập nhật hồ sơ của PR đã hủy.', HttpStatus.CONFLICT);
  }

  prDossier(user: CurrentUser, id: number) {
    return readSnapshot(this.ds, async m => {
      const { header, scoped } = await this.readPr(m, user, id);
      return { rows: await this.dossiers.list(m, 'PR', id), canManage: scoped.includes(DOSSIER) && header.approvalStatus !== 'CANCELED' };
    });
  }

  savePrDossier(user: CurrentUser, id: number, body: DossierUpdate) {
    return this.ds.transaction(async m => {
      const { doc } = await this.lockPr(m, user, id, DOSSIER);
      this.assertDossierManage(user, doc.approval_status);
      await this.dossiers.save(m, 'PR', id, user.id, this.existingDossierContext(id, body.sessionKey), body.rows);
      return { rows: await this.dossiers.list(m, 'PR', id), canManage: true };
    });
  }

  /** Staging writes a file outside any transaction: scope is checked here (snapshot) and again when rows are saved. */
  async stagePrDossier(user: CurrentUser, key: string | number, typeId: number, file: IncomingDossierFile, session?: string) {
    this.assertDossierManage(user);
    if (typeof key === 'string') {
      const template = await this.prDossierTemplate();
      if (!template.rows.some(row => row.dossierTypeId === typeId)) throw new NotFoundException('Dossier type not in current configuration');
      return this.dossiers.stage(user.id, this.newDossierContext(key), typeId, file);
    }
    const rows = await readSnapshot(this.ds, async m => {
      const { header, scoped } = await this.readPr(m, user, key);
      if (!scoped.includes(DOSSIER)) throw new ForbiddenException(`Missing permission: ${DOSSIER}`);
      this.assertDossierManage(user, header.approvalStatus);
      return this.dossiers.list(m, 'PR', key);
    });
    if (!rows.some(row => row.dossierTypeId === typeId)) throw new NotFoundException('Dossier type not in snapshot');
    return this.dossiers.stage(user.id, this.existingDossierContext(key, session), typeId, file);
  }

  /**
   * Scope check and file lookup in one transaction (OA3.2 boundary, step 2: same `em`); not read-only because the
   * lookup locks the file row FOR SHARE. The stream is read after commit, without the gate.
   */
  downloadPrDossier(user: CurrentUser, key: string | number, fileId: number, session?: string) {
    return this.ds.transaction('REPEATABLE READ', async m => {
      if (typeof key === 'string') {
        this.assertDossierManage(user);
        return this.dossiers.download(m, 'PR', null, fileId, { actor: user.id, context: this.newDossierContext(key) });
      }
      const { header, scoped } = await this.readPr(m, user, key);
      const temporary = session && scoped.includes(DOSSIER) && header.approvalStatus !== 'CANCELED'
        ? { actor: user.id, context: this.existingDossierContext(key, session) } : undefined;
      return this.dossiers.download(m, 'PR', key, fileId, temporary);
    });
  }

  /** Detail in one snapshot (OA3.2 F02). Action flags need the action's own scope on this PR, then the Business Rules. */
  getPr(user: CurrentUser, id: number) {
    return readSnapshot(this.ds, m => this.readPrDetail(m, user, id));
  }

  private async readPrDetail(m: EntityManager, user: CurrentUser, id: number) {
    const { header, scoped, canEdit, canViewContract, canViewPo } = await this.readPr(m, user, id);
    const lines = await m.query(
      `SELECT l.id, l.sales_contract_line_id AS "sourceLineId", l.product_id AS "productId", sl.item_name AS "ref", l.snapshot_code AS "partNumber", l.snapshot_name AS "productName",
              COALESCE(l.uom_code, u.code) AS uom, l.quantity,
              CASE WHEN l.product_id IS NULL THEN 'TEMPORARY' ELSE 'MAIN' END AS "sourceType",
              l.temporary_product_id AS "temporaryProductId", l.sales_contract_line_id AS "salesContractLineId",
              l.snapshot_description AS "itemDescription", l.requirement_description AS "requirementDescription",
              l.brand_id AS "brandId", l.brand_name AS "brandName", l.supplier_id AS "supplierId", l.supplier_name AS "supplierName",
              l.unit_of_measure_id AS "unitOfMeasureId", trim_scale(l.unit_price) AS "unitPrice", l.tax_rate_id AS "taxRateId", l.tax_rate AS "taxRate",
              money.net AS "subtotal", money.tax AS "taxAmount", money.net + money.tax AS "total",
              COALESCE((SELECT SUM(pol.quantity) FROM purchase_order_lines pol JOIN purchase_orders po ON po.id = pol.purchase_order_id
                         WHERE pol.purchase_requisition_line_id = l.id AND po.approval_status IN ('WAITING_FOR_APPROVE', 'APPROVED')), 0) AS "usedQuantity"
         FROM purchase_requisition_lines l
         LEFT JOIN sales_contract_lines sl ON sl.id = l.sales_contract_line_id
         LEFT JOIN units_of_measure u ON u.id = l.unit_of_measure_id
         JOIN purchase_requisitions d ON d.id = l.purchase_requisition_id
         ${PR_AMOUNTS}
        WHERE l.purchase_requisition_id = $1 ORDER BY l.id`,
      [id],
    );
    if (!canViewContract) {
      for (const line of lines) {
        line.sourceLineId = null;
        line.salesContractLineId = null;
        line.ref = null;
      }
    }
    const children = await m.query(
      `SELECT DISTINCT po.id, po.document_number AS "documentNumber", po.approval_status AS "approvalStatus"
         FROM purchase_orders po JOIN purchase_order_lines pol ON pol.purchase_order_id = po.id
         JOIN purchase_requisition_lines prl ON prl.id = pol.purchase_requisition_line_id
        WHERE prl.purchase_requisition_id = $1 ORDER BY po.id`,
      [id],
    );
    const [notes, history] = await Promise.all([
      documentPage(m, 'PR', id, 'notes'),
      documentPage(m, 'PR', id, 'history'),
    ]);
    const canReassign = await prWorkflow.canReassign(m, {
      approval_status: header.approvalStatus, assigned_approver_id: header.assignedApproverId, created_by: header.createdBy,
    }, user, false, scoped);
    const creatorRole = await grantRole(m, header.createdBy, 'PR.CREATE');
    const rejection = header.approvalStatus === 'REJECTED'
      ? await latestRoundActivity(m, 'PR', id, header.approvalRound, 'REJECT') : null;
    const canCancel = header.createdBy === user.id && scoped.includes(CREATE)
      && (['DRAFT', 'REJECTED'].includes(header.approvalStatus)
        || (header.approvalStatus === 'DONE' && children.every((po: { approvalStatus: string }) => po.approvalStatus === 'CANCELED')));
    return { ...header, actionPermissions: scoped, canCancel, canEdit, creatorRole: creatorRole?.role ?? null, rejection: !canViewContract && rejection ? this.prHistoryEntry(rejection) : rejection, canReassign,
      lines: canViewPo ? lines : lines.map(({ usedQuantity, ...line }: { usedQuantity: string }) => line),
      children: canViewPo ? children : [], history: canViewContract ? history.items : history.items.map(entry => this.prHistoryEntry(entry)), historyCursor: history.nextCursor,
      nodes: await m.query(`SELECT n.step, n.round, n.department, n.result, n.assignee_id AS "assigneeId",
        a.full_name AS "assigneeName", u.full_name AS "actorName", n.acted_at AS "actedAt", n.invalidated_at AS "invalidatedAt"
        FROM pr_workflow_nodes n JOIN users a ON a.id = n.assignee_id LEFT JOIN users u ON u.id = n.actor_id
        WHERE n.pr_id = $1 ORDER BY n.round DESC, n.step`, [id]),
      notes: notes.items, notesCursor: notes.nextCursor };
  }

  configurePrRoute(pool: PrPool, userIds: number[]) {
    return this.ds.transaction(m => configurePool(m, pool, userIds));
  }

  listPrRoutes() {
    return this.ds.query('SELECT pool, user_id AS "userId" FROM pr_candidate_pool_members ORDER BY pool, user_id');
  }

  listPrAssignmentCandidates() {
    return Promise.all(PR_POOLS.map(async pool => ({ pool, users: await listCandidates(this.ds.manager, pool, null, false) })));
  }

  async listPrCandidates(id: number, user: CurrentUser) {
    return readSnapshot(this.ds, async m => {
      await assertCanAct(m, await loadDataScope(m, user.id), VIEW, CREATE, PR_SOURCE, id);
      const [doc] = await m.query('SELECT * FROM purchase_requisitions WHERE id = $1', [id]);
      if (doc.created_by !== user.id) throw new ForbiddenException('The PR is outside your creation scope');
      wf.assertStatus(doc, ['DRAFT', 'REJECTED']);
      return this.creatorCandidatesIn(m, user, doc.sales_contract_id, doc.creator_route);
    });
  }

  listPrEditSuppliers(user: CurrentUser, id: number, brandId: number) {
    return readSnapshot(this.ds, async m => {
      if (!(await this.readPr(m, user, id)).canEdit) throw new ForbiddenException();
      return CatalogFacade.activeBrandSuppliers(m, brandId);
    });
  }

  async listPrSuppliers(user: CurrentUser, contractId: number, brandId: number, requestedRoute?: prWorkflow.PrRoute) {
    return readSnapshot(this.ds, async m => {
      await SalesContractFacade.assertReadable(m, await loadDataScope(m, user.id), contractId);
      await prWorkflow.creatorRoute(m, user, contractId, requestedRoute, false);
      return CatalogFacade.activeBrandSuppliers(m, brandId);
    });
  }

  listCreatorCandidates(user: CurrentUser, contractId: number, requestedRoute?: prWorkflow.PrRoute) {
    return readSnapshot(this.ds, async m => {
      await SalesContractFacade.assertReadable(m, await loadDataScope(m, user.id), contractId);
      return this.creatorCandidatesIn(m, user, contractId, requestedRoute);
    });
  }

  private async creatorCandidatesIn(m: EntityManager, user: CurrentUser, contractId: number, requestedRoute?: prWorkflow.PrRoute) {
    const route = await prWorkflow.creatorRoute(m, user, contractId, requestedRoute, false);
    const [approvers, receivers] = await Promise.all([
      listCandidates(m, route, user.id),
      listCandidates(m, 'RECEIPT', user.id),
    ]);
    return { approvers, receivers };
  }

  assignResponsiblePm(user: CurrentUser, id: number, userId: number) {
    return this.ds.transaction(async m => SalesContractFacade.assignResponsiblePm(m, await loadDataScope(m, user.id, true), id, userId));
  }

  async addPrNote(user: CurrentUser, id: number, body: string) {
    await this.ds.transaction(async m => {
      await this.lockPr(m, user, id);
      if (!body.trim()) throw new BusinessError('PR_NOTE_REQUIRED', 'Enter a note');
      await insertNote(m, 'PR', id, user.id, body.trim());
    });
  }

  private prHistoryEntry(entry: { id: number; action?: string; metadata?: Record<string, unknown> | null }) {
    const metadata = entry.metadata;
    if (!metadata || entry.action !== 'REASSIGN') return { ...entry, metadata: null };
    const assignee = (value: unknown) => {
      const person = value as { id?: unknown; fullName?: unknown } | null;
      return typeof person?.id === 'number' && typeof person.fullName === 'string' ? { id: person.id, fullName: person.fullName } : null;
    };
    const step = metadata.step === 'APPROVAL' || metadata.step === 'RECEIPT' ? metadata.step : null;
    return { ...entry, metadata: { step, from: assignee(metadata.from), to: assignee(metadata.to) } };
  }

  readPrRecords(user: CurrentUser, id: number, kind: 'notes' | 'history', before?: number) {
    return readSnapshot(this.ds, async m => {
      const scope = await loadDataScope(m, user.id);
      await assertCanRead(m, scope, VIEW, PR_SOURCE, id);
      const page = await documentPage(m, 'PR', id, kind, before);
      if (kind === 'notes') return page;
      const [pr] = await m.query('SELECT sales_contract_id FROM purchase_requisitions WHERE id = $1', [id]);
      if (!(await SalesContractFacade.canRead(m, scope, pr.sales_contract_id))) {
        return { ...page, items: page.items.map(entry => this.prHistoryEntry(entry)) };
      }
      return page;
    });
  }

  /** Lines of one PR (PO form), same read check as the detail. */
  prLines(user: CurrentUser, id: number) {
    return readSnapshot(this.ds, async m => {
      await assertCanRead(m, await loadDataScope(m, user.id), VIEW, PR_SOURCE, id);
      return m.query(`SELECT id, product_id AS "productId", temporary_product_id AS "temporaryProductId", quantity
        FROM purchase_requisition_lines WHERE purchase_requisition_id = $1 ORDER BY id`, [id]);
    });
  }

  /**
   * The user's PR notifications, only for PRs within their PR.VIEW scope: a notification carries PR data (number, reason),
   * so it is not an implicit read either. Delivery itself is unchanged.
   */
  listPrNotifications(recipientId: number) {
    return readSnapshot(this.ds, async m => {
      const scope = scopeFilter(await loadDataScope(m, recipientId), VIEW, PR_SOURCE.cols, 2);
      if (!scope) return [];
      return m.query(`SELECT n.id, n.pr_id AS "prId", d.document_number AS "documentNumber",
        n.action, n.round, n.reason, n.created_at AS "createdAt", n.read_at AS "readAt",
        n.task_step AS "taskStep", n.resolved_at AS "resolvedAt"
        FROM pr_notifications n JOIN purchase_requisitions d ON d.id = n.pr_id JOIN sales_contracts s ON s.id = d.sales_contract_id
        WHERE n.recipient_id = $1 AND ${scope.sql} ORDER BY n.id DESC`, [recipientId, ...scope.params]);
    });
  }

  async readPrNotification(recipientId: number, id: number) {
    await this.ds.query('UPDATE pr_notifications SET read_at = COALESCE(read_at, now()) WHERE id = $1 AND recipient_id = $2', [id, recipientId]);
  }

  /** Lines of DONE PRs with quantity not yet covered by WAITING/APPROVED POs, for the PO form. */
  prLinesAvailableForPo(user: CurrentUser) {
    return readSnapshot(this.ds, async m => {
      const scope = await loadDataScope(m, user.id);
      const filter = scopeFilter(scope, VIEW, PR_SOURCE.cols);
      if (!filter) return [];
      const rows = await m.query(
        `SELECT * FROM (
           SELECT l.id, d.document_number AS "prNumber", s.id AS "contractId", s.document_number AS "salesContractNumber", l.snapshot_code AS "partNumber",
                  l.snapshot_name AS "productName", u.code AS uom, l.quantity,
                  l.quantity - COALESCE((SELECT SUM(pol.quantity) FROM purchase_order_lines pol JOIN purchase_orders po ON po.id = pol.purchase_order_id
                                          WHERE pol.purchase_requisition_line_id = l.id AND po.approval_status IN ('WAITING_FOR_APPROVE', 'APPROVED')), 0) AS remaining
             FROM purchase_requisition_lines l
             JOIN (${PR_SOURCE.from}) ON d.id = l.purchase_requisition_id
             JOIN units_of_measure u ON u.id = l.unit_of_measure_id
            WHERE d.approval_status = 'DONE' AND l.product_id IS NOT NULL AND ${filter.sql}) x
          WHERE remaining > 0 ORDER BY id`,
        filter.params,
      );
      const contracts = await SalesContractFacade.summaries(m, scope, rows.map((row: { contractId: number }) => row.contractId));
      return rows.map(({ contractId, salesContractNumber, ...row }: { contractId: number; salesContractNumber: string }) => ({
        ...row, salesContractNumber: contracts.has(contractId) ? salesContractNumber : null,
      }));
    });
  }

  listPos(user: CurrentUser, assignedToMe: boolean) {
    return this.ds.query(
      `SELECT ${wf.DOC_COLUMNS}, sp.name AS "supplierName", ${RECEIPT_STATUS_SQL} AS "receiptStatus"
         FROM purchase_orders d JOIN suppliers sp ON sp.id = d.supplier_id
        WHERE NOT $2 OR (d.approval_status = 'WAITING_FOR_APPROVE' AND d.assigned_approver_id = $1)
        ORDER BY d.id DESC`,
      [user.id, assignedToMe],
    );
  }

  poLines(user: CurrentUser, id: number) {
    return readSnapshot(this.ds, async m => {
      const scope = await loadDataScope(m, user.id);
      if (!canReadPo(scope)) throw new ForbiddenException();
      const rows: { id: number; purchaseRequisitionLineId: number; quantity: string }[] = await m.query(
        `SELECT id, purchase_requisition_line_id AS "purchaseRequisitionLineId", quantity
           FROM purchase_order_lines WHERE purchase_order_id = $1 ORDER BY id`, [id],
      );
      const readable = await ProcurementFacade.readableLines(m, scope, rows.map(row => row.purchaseRequisitionLineId));
      return rows.map(row => ({
        ...row, purchaseRequisitionLineId: readable.has(row.purchaseRequisitionLineId) ? row.purchaseRequisitionLineId : null,
      }));
    });
  }

  getPo(user: CurrentUser, id: number) {
    return readSnapshot(this.ds, async m => {
      const scope = await loadDataScope(m, user.id);
      if (!canReadPo(scope)) throw new ForbiddenException();
      const [po] = await m.query(
        `SELECT ${wf.DOC_COLUMNS}, d.supplier_id AS "supplierId", sp.name AS "supplierName", ${RECEIPT_STATUS_SQL} AS "receiptStatus" FROM purchase_orders d JOIN suppliers sp ON sp.id = d.supplier_id WHERE d.id = $1`,
        [id],
      );
      if (!po) throw new NotFoundException();
      const lines = await m.query(
        `SELECT l.id, l.purchase_requisition_line_id AS "sourceLineId", pr.document_number AS "ref", p.part_number AS "partNumber",
                p.name AS "productName", u.code AS uom, l.quantity, l.received_quantity AS "receivedQuantity"
           FROM purchase_order_lines l
           JOIN purchase_requisition_lines prl ON prl.id = l.purchase_requisition_line_id
           JOIN purchase_requisitions pr ON pr.id = prl.purchase_requisition_id
           JOIN products p ON p.id = prl.product_id
           JOIN units_of_measure u ON u.id = l.unit_of_measure_id
          WHERE l.purchase_order_id = $1 ORDER BY l.id`,
        [id],
      );
      const readable = await ProcurementFacade.readableLines(m, scope, lines.map((line: { sourceLineId: number }) => line.sourceLineId));
      for (const line of lines) {
        if (!readable.has(line.sourceLineId)) {
          line.sourceLineId = null;
          line.ref = null;
        }
      }
      return { ...po, lines, children: [], history: await wf.history(m, 'PO', id) };
    });
  }
}
