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

/** A PR line as seen by a GIR (A/C): its PR, HĐ, category and approved PO coverage. */
export interface PrLineForIssue {
  id: number; purchaseRequisitionId: number; prNumber: string; salesContractId: number; category: LineCategory;
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

const PR_PO_DONE = `pr.approval_status = 'DONE' AND NOT EXISTS (
  SELECT 1 FROM purchase_requisition_lines x
   WHERE x.purchase_requisition_id = pr.id AND x.product_id IS NOT NULL
     AND x.quantity <> COALESCE((
       SELECT SUM(pol.quantity) FROM purchase_order_lines pol JOIN purchase_orders po ON po.id = pol.purchase_order_id
        WHERE pol.purchase_requisition_line_id = x.id AND po.approval_status = 'APPROVED'
     ), 0))`;

/**
 * Facade for Inbound (ADR-0003): Inbound calls Procurement, never the reverse. Runs inside the caller's transaction.
 */
export class ProcurementFacade {
  /**
   * PR lines for a GIR (A/C), locked FOR UPDATE in id order (lock order HĐ lines → PR lines → GIR, CT8).
   * `poDone`: every main PR line is fully covered by approved POs (03 section 3, CT1).
   */
  static async lockLinesForIssue(m: EntityManager, ids: number[]): Promise<Map<number, PrLineForIssue>> {
    const sorted = [...new Set(ids)].sort((a, b) => a - b);
    await m.query(`SELECT id FROM purchase_requisition_lines WHERE id = ANY($1) ORDER BY id FOR UPDATE`, [sorted]);
    const rows: PrLineForIssue[] = await m.query(
      `SELECT l.id, l.purchase_requisition_id AS "purchaseRequisitionId", pr.document_number AS "prNumber", pr.sales_contract_id AS "salesContractId",
              pr.category, l.sales_contract_line_id AS "salesContractLineId", l.product_id AS "productId", l.quantity::float AS quantity,
              ${PR_PO_DONE} AS "poDone"
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
  static poDoneLines(m: EntityManager, salesContractId: number) {
    return m.query(
      `SELECT l.id, pr.id AS "purchaseRequisitionId", pr.document_number AS "prNumber", pr.category, l.sales_contract_line_id AS "salesContractLineId",
              l.product_id AS "productId", p.part_number AS "partNumber", p.name AS "productName", u.code AS uom, l.quantity,
              COALESCE((SELECT SUM(pol.received_quantity) FROM purchase_order_lines pol WHERE pol.purchase_requisition_line_id = l.id), 0) AS "receivedQuantity"
         FROM purchase_requisitions pr
         JOIN purchase_requisition_lines l ON l.purchase_requisition_id = pr.id
         JOIN products p ON p.id = l.product_id
         JOIN units_of_measure u ON u.id = l.unit_of_measure_id
        WHERE pr.sales_contract_id = $1 AND ${PR_PO_DONE}
        ORDER BY pr.id, l.id`,
      [salesContractId],
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
  createPurchaseRequisition(user: CurrentUser, salesContractId: number, lines: PrLineInput[], category: LineCategory = 'SALES_GOODS', purpose?: string, route?: prWorkflow.PrRoute, selection: prWorkflow.PrSelection & PrCommercialHeader = {}) {
    return this.ds.transaction(m => this.createPr(m, user, salesContractId, lines, category, purpose, route, selection));
  }

  private async createPr(m: EntityManager, user: CurrentUser, salesContractId: number, lines: PrLineInput[], category: LineCategory,
    purpose: string | undefined, route: prWorkflow.PrRoute | undefined, selection: prWorkflow.PrSelection & PrCommercialHeader,
    dossier?: NewDossierUpdate & { requestKey: string }) {
    if (!Number.isInteger(salesContractId) || salesContractId <= 0) {
      throw new BusinessError('PR_SALES_CONTRACT_REQUIRED', 'Select a sales contract before saving a purchase requisition');
    }
    const creatorRoute = await prWorkflow.creatorRoute(m, user, salesContractId, route);
    assertPrLines(lines);
    await SalesContractFacade.lockActiveLines(m, salesContractId, scLineIds(lines));
    await prWorkflow.validateSelection(m, creatorRoute, user.id, selection);
    const number = await wf.nextDocumentNumber(m, 'PR');
    const [pr] = await m.query(
      `INSERT INTO purchase_requisitions (document_number, sales_contract_id, category, purpose, created_by, creator_route, draft_approver_id, draft_receiver_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [number, salesContractId, category, purpose?.trim() || null, user.id, creatorRoute, selection.approverId ?? null, selection.receiverId ?? null],
    );
    await savePrCommercialHeader(m, pr.id, selection);
    await this.writePrLines(m, pr.id, lines);
    const template = await dossierTemplate(m, 'PR');
    if (dossier && dossier.revision !== template.revision) {
      throw new BusinessError('PR_DOSSIER_TEMPLATE_CHANGED', 'Cấu hình hồ sơ đã thay đổi. Dữ liệu đang nhập được giữ lại.', HttpStatus.CONFLICT);
    }
    await snapshotDocumentDossier(m, 'PR', pr.id, user.id, template.rows);
    if (dossier?.rows.length) {
      this.assertDossierManage(user);
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
    const [head] = await m.query(`SELECT created_by, sales_contract_id, creator_route FROM purchase_requisitions WHERE id = $1`, [id]);
    if (!head) throw new NotFoundException();
    wf.assertCreator(head, user);
    await prWorkflow.creatorRoute(m, user, head.sales_contract_id, head.creator_route);
    // The request is the full line set (omitted lines are deleted), so checking it covers the saved result. Category is fixed.
    assertPrLines(lines);
    // Lock order: HĐ lines → document (ARCHITECTURE §2.1a); the HĐ must still be ACTIVE.
    await SalesContractFacade.lockActiveLines(m, head.sales_contract_id, scLineIds(lines));
    const doc = await prWorkflow.lock(m, id);
    if (context) assertActionContext(doc, doc.approval_round, prWorkflow.currentStep(doc.approval_status), context);
    wf.assertEditable(doc, user, version);
    await prWorkflow.validateSelection(m, doc.creator_route, user.id, selection);
    await wf.deleteOmittedLines(m, 'purchase_requisition_lines', 'purchase_requisition_id', id, lines.flatMap((l) => (l.id ? [l.id] : [])));
    await savePrCommercialHeader(m, id, selection);
    await this.writePrLines(m, id, lines);
    if (selection.dossier?.rows.length) {
      this.assertDossierManage(user);
      await this.readablePr(m, user, id);
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

  saveNewPr(user: CurrentUser, dto: prWorkflow.PrSelection & PrCommercialHeader & { salesContractId: number; lines: PrLineInput[];
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
      ...(dto.dossier ? [[dto.dossier.revision, dto.dossier.sessionKey, dto.dossier.rows.map(row => [row.dossierTypeId, row.version, row.hasPaper,
        row.issuedOn ?? null, row.issuer ?? null, row.note ?? null, row.fileId ?? null])]] : []),
    ])).digest('hex');
    return this.ds.transaction(async m => {
      await m.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [user.id, 'PR:create:' + requestKey]);
      const [existing] = await m.query(`SELECT id, document_number AS "documentNumber", create_request_fingerprint AS fingerprint
        FROM purchase_requisitions WHERE created_by = $1 AND create_request_key = $2`, [user.id, requestKey]);
      if (existing) {
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
    if (!selection.approverId || !selection.receiverId) throw new BusinessError('PR_CANDIDATE_NOT_ELIGIBLE', 'Select both workflow assignees');
    const doc = await prWorkflow.lock(m, id);
    await prWorkflow.submit(m, id, user, { version: doc.version, round: doc.approval_round, step: 'CREATE',
      approverId: selection.approverId, receiverId: selection.receiverId });
  }

  /** PO from lines of DONE PRs, one supplier; each PO line inherits the PR line UoM (T7). */
  createPurchaseOrder(user: CurrentUser, supplierId: number, lines: SourceLineInput[]) {
    wf.assertUniqueSourceLines(lines.map((l) => l.sourceLineId));
    return this.ds.transaction(async (m) => {
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
  updatePurchaseOrder(user: CurrentUser, id: number, version: number, supplierId: number, lines: SourceLineInput[]) {
    wf.assertUniqueSourceLines(lines.map((l) => l.sourceLineId));
    return this.ds.transaction(async (m) => {
      const doc = await wf.lockDocument(m, 'PO', id);
      wf.assertEditable(doc, user, version);
      const [current] = await m.query('SELECT supplier_id FROM purchase_orders WHERE id = $1', [id]);
      if (current.supplier_id !== supplierId) await CatalogFacade.assertActive(m, 'supplier', supplierId);
      await wf.deleteOmittedLines(m, 'purchase_order_lines', 'purchase_order_id', id, lines.flatMap((l) => (l.id ? [l.id] : [])));
      for (const l of lines) await this.writePoLine(m, id, l);
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
    if (over) throw new BusinessError('QUANTITY_LIMIT_EXCEEDED', `PO quantity exceeds PR line ${over.id} (${over.used} > ${over.quantity})`);
  }

  approvers(type: wf.DocType, id: number) {
    return this.ds.transaction(async (m) => {
      const [doc] = await m.query(`SELECT created_by FROM ${wf.DOC_TYPES[type].table} WHERE id = $1`, [id]);
      if (!doc) throw new NotFoundException();
      return wf.eligibleApprovers(m, type, doc.created_by);
    });
  }

  /** PO source re-check (03 §7): every referenced PR must still be DONE (PR headers locked for share). */
  private async checkPoSources(m: EntityManager, poId: number) {
    const prs: { document_number: string; approval_status: string }[] = await m.query(
      `SELECT document_number, approval_status FROM purchase_requisitions
        WHERE id IN (SELECT prl.purchase_requisition_id FROM purchase_order_lines pol
                       JOIN purchase_requisition_lines prl ON prl.id = pol.purchase_requisition_line_id WHERE pol.purchase_order_id = $1)
        ORDER BY id FOR SHARE`,
      [poId],
    );
    const bad = prs.find((p) => p.approval_status !== 'DONE');
    if (bad) throw new BusinessError('PR_SOURCE_NOT_DONE', `PR ${bad.document_number} is no longer DONE`);
  }

  submitPr(id: number, user: CurrentUser, dto: prWorkflow.PrSubmission) {
    return this.ds.transaction(m => prWorkflow.submit(m, id, user, dto));
  }

  actOnPr(id: number, user: CurrentUser, action: prWorkflow.PrAction, context: ActionContext, reason?: string) {
    return this.ds.transaction(async m => {
      const doc = await prWorkflow.lock(m, id);
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
      await this.readablePr(m, user, id);
      const doc = await prWorkflow.lock(m, id);
      await this.readablePr(m, user, id);
      await prWorkflow.reassign(m, doc, user, dto);
    });
  }

  prReassignmentCandidates(id: number, user: CurrentUser) {
    return this.ds.transaction(async m => {
      await this.readablePr(m, user, id);
      const doc = await prWorkflow.lock(m, id);
      await this.readablePr(m, user, id);
      return prWorkflow.reassignmentCandidates(m, doc, user);
    });
  }

  submit(type: 'PO', id: number, user: CurrentUser, approverId: number) {
    return this.ds.transaction(async (m) => {
      const doc = await wf.lockDocument(m, type, id);
      if (type === 'PO') { await this.checkPoSources(m, id); await this.checkPoLimits(m, id, true); }
      await wf.submit(m, type, doc, user, approverId!);
    });
  }

  approve(type: 'PO', id: number, user: CurrentUser) {
    return this.ds.transaction(async (m) => {
      const doc = await wf.lockDocument(m, type, id);
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
   * Read scope for PRs (PR #17, ADR-0014): PR.VIEW sees every PR as before. Without it, a user with SALES_CONTRACT.VIEW
   * may read (never write) the PRs of a contract where they are the responsible sales. Anything else is 403, whether or
   * not the contract exists, so ids cannot be probed.
   */
  private async assertPrReadScope(user: CurrentUser, salesContractId: number | undefined): Promise<'all' | 'contract'> {
    if (user.permissions.includes('PR.VIEW')) return 'all';
    if (user.permissions.includes('SALES_CONTRACT.VIEW') && salesContractId !== undefined
      && (await SalesContractFacade.responsibleSalesOf(this.ds.manager, salesContractId)) === user.id) return 'contract';
    throw new ForbiddenException('Missing permission: PR.VIEW');
  }

  /** `assignedToMe` = "Chờ tôi duyệt" (04 §4). PR/PO are not warehouse-scoped: the VIEW permission sees all. */
  async listPrs(user: CurrentUser, assignedToMe: boolean, salesContractId?: number, filters: {
    q?: string; category?: string; status?: string; from?: string; to?: string; sort?: keyof typeof PR_SORT;
    direction?: 'asc' | 'desc'; page?: number; size?: number;
  } = {}) {
    const fullView = user.permissions.includes('PR.VIEW');
    const canViewContract = user.permissions.includes('SALES_CONTRACT.VIEW');
    const canCreate = user.permissions.includes('PR.CREATE');
    const scopedList = user.permissions.some(permission => ['PR.CREATE', 'PR.APPROVE', 'PR.RECEIVE'].includes(permission));
    if (!fullView && !scopedList) await this.assertPrReadScope(user, salesContractId);
    if (!fullView && salesContractId !== undefined) {
      const contract = await SalesContractFacade.sourceContract(this.ds.manager, salesContractId);
      if (!canCreate || contract?.responsiblePmUserId !== user.id) await this.assertPrReadScope(user, salesContractId);
    }
    if (filters.from && filters.to && filters.from > filters.to) {
      throw new BusinessError('PR_INVALID_DATE_RANGE', 'The start date must not be later than the end date');
    }
    const values = [user.id, assignedToMe, salesContractId ?? null, fullView, canViewContract, canCreate,
      filters.q?.trim() ?? '', filters.category ?? null, filters.status ?? null, filters.from ?? null, filters.to ?? null];
    const source = `FROM purchase_requisitions d
      JOIN sales_contracts s ON s.id = d.sales_contract_id JOIN customers c ON c.id = s.customer_id
      JOIN users requester ON requester.id = d.created_by`;
    const where = `WHERE (NOT $2 OR (d.approval_status IN ('WAITING_FOR_APPROVE', 'WAITING_FOR_RECEIPT') AND d.assigned_approver_id = $1))
      AND ($3::int IS NULL OR d.sales_contract_id = $3)
      AND ($4 OR ($5 AND s.responsible_sales_user_id = $1) OR ($6 AND s.responsible_pm_user_id = $1) OR d.created_by = $1
        OR EXISTS (SELECT 1 FROM pr_workflow_nodes n WHERE n.pr_id = d.id AND n.assignee_id = $1))
      AND ($7 = '' OR strpos(lower(d.document_number), lower($7)) > 0 OR strpos(lower(d.name), lower($7)) > 0
        OR strpos(lower(s.document_number), lower($7)) > 0 OR strpos(lower(c.name), lower($7)) > 0)
      AND ($8::text IS NULL OR d.category = $8) AND ($9::text IS NULL OR d.approval_status = $9)
      AND ($10::date IS NULL OR d.requisition_date >= $10) AND ($11::date IS NULL OR d.requisition_date <= $11)`;
    const sort = filters.sort && Object.hasOwn(PR_SORT, filters.sort) ? PR_SORT[filters.sort] : PR_SORT.createdAt;
    const size = filters.size ?? 25;
    const sql = `SELECT ${wf.DOC_COLUMNS}, d.category, d.sales_contract_id AS "salesContractId", ${PR_DETAILS},
      s.document_number AS "salesContractNumber", c.name AS "customerName"
      ${source} ${PR_TOTALS} ${where} ORDER BY ${sort} ${filters.direction === 'asc' ? 'ASC' : 'DESC'} NULLS LAST, d.id DESC`;
    if (filters.page === undefined) return this.ds.query(sql, values);
    return this.ds.transaction('REPEATABLE READ', async m => {
      const [{ total }] = await m.query(`SELECT count(*)::int AS total ${source} ${where}`, values);
      const items = await m.query(sql + ' LIMIT $12 OFFSET $13', [...values, size, (filters.page! - 1) * size]);
      return { items, total };
    });
  }

  listPrContracts(user: CurrentUser, q: string, page: number) {
    return readSnapshot(this.ds, m => SalesContractFacade.prOptions(m, user.id, q, page));
  }

  productPicker(source: 'main' | 'temporary', query: Parameters<typeof CatalogFacade.productPicker>[2]) {
    return CatalogFacade.productPicker(this.ds, source, query);
  }

  private async readablePr(m: EntityManager, user: CurrentUser, id: number, lock: boolean | 'update' = false) {
    const [pr] = await m.query(
      `SELECT ${wf.DOC_COLUMNS}, d.approval_round AS "approvalRound", d.sales_contract_id AS "salesContractId", s.responsible_pm_user_id AS "responsiblePmUserId",
        d.creator_route AS "creatorRoute", d.draft_approver_id AS "draftApproverId", d.draft_receiver_id AS "draftReceiverId",
        s.responsible_sales_user_id AS "responsibleSalesUserId", s.status AS "contractStatus", d.category, ${PR_DETAILS},
        s.document_number AS "salesContractNumber", c.name AS "customerName",
        EXISTS (SELECT 1 FROM pr_workflow_nodes n WHERE n.pr_id = d.id AND n.assignee_id = $2) AS "wasAssigned"
         FROM purchase_requisitions d JOIN sales_contracts s ON s.id = d.sales_contract_id JOIN customers c ON c.id = s.customer_id
         JOIN users requester ON requester.id = d.created_by
         ${PR_TOTALS}
        WHERE d.id = $1 ${lock === 'update' ? 'FOR UPDATE OF d' : lock ? 'FOR SHARE OF d, s' : ''}`,
      [id, user.id],
    );
    const fullView = user.permissions.includes('PR.VIEW');
    const scoped = pr && (pr.createdBy === user.id || pr.wasAssigned
      || (user.permissions.includes('PR.CREATE') && pr.responsiblePmUserId === user.id)
      || (user.permissions.includes('SALES_CONTRACT.VIEW') && pr.responsibleSalesUserId === user.id));
    if (!fullView && !scoped) throw new ForbiddenException('Missing permission: PR.VIEW');
    if (!pr) throw new NotFoundException();
    const { responsibleSalesUserId, contractStatus, wasAssigned, ...header } = pr;
    const routeOwner = header.creatorRoute === 'SALES' ? responsibleSalesUserId : header.responsiblePmUserId;
    const canEdit = header.createdBy === user.id && user.permissions.includes('PR.CREATE')
      && contractStatus === 'ACTIVE' && routeOwner === user.id && ['DRAFT', 'REJECTED'].includes(header.approvalStatus);
    return { header, fullView, canEdit };
  }

  prDossierTemplate() { return dossierTemplate(this.ds.manager, 'PR'); }

  private newDossierContext(key: string) { return 'PR:new:' + key.toLowerCase(); }
  private existingDossierContext(id: number, session?: string) { return 'PR:' + id + ':' + (session?.toLowerCase() ?? ''); }

  private assertDossierManage(user: CurrentUser, status?: string) {
    if (!user.permissions.includes('PR.DOSSIER_MANAGE')) throw new ForbiddenException('Missing permission: PR.DOSSIER_MANAGE');
    if (status === 'CANCELED') throw new BusinessError('PR_DOSSIER_CANCELED', 'Không thể cập nhật hồ sơ của PR đã hủy.', HttpStatus.CONFLICT);
  }

  async prDossier(user: CurrentUser, id: number) {
    return this.ds.transaction(async m => {
      const { header } = await this.readablePr(m, user, id);
      return { rows: await this.dossiers.list(m, 'PR', id),
        canManage: user.permissions.includes('PR.DOSSIER_MANAGE') && header.approvalStatus !== 'CANCELED' };
    });
  }

  savePrDossier(user: CurrentUser, id: number, body: DossierUpdate) {
    return this.ds.transaction(async m => {
      const { header } = await this.readablePr(m, user, id, 'update');
      this.assertDossierManage(user, header.approvalStatus);
      await this.dossiers.save(m, 'PR', id, user.id, this.existingDossierContext(id, body.sessionKey), body.rows);
      return { rows: await this.dossiers.list(m, 'PR', id), canManage: true };
    });
  }

  async stagePrDossier(user: CurrentUser, key: string | number, typeId: number, file: IncomingDossierFile, session?: string) {
    this.assertDossierManage(user);
    if (typeof key === 'string') {
      const template = await this.prDossierTemplate();
      if (!template.rows.some(row => row.dossierTypeId === typeId)) throw new NotFoundException('Dossier type not in current configuration');
      return this.dossiers.stage(user.id, this.newDossierContext(key), typeId, file);
    }
    const { rows, canManage } = await this.prDossier(user, key);
    if (!canManage) this.assertDossierManage(user, 'CANCELED');
    if (!rows.some(row => row.dossierTypeId === typeId)) throw new NotFoundException('Dossier type not in snapshot');
    return this.dossiers.stage(user.id, this.existingDossierContext(key, session), typeId, file);
  }

  downloadPrDossier(user: CurrentUser, key: string | number, fileId: number, session?: string) {
    return this.ds.transaction(async m => {
      if (typeof key === 'string') {
        this.assertDossierManage(user);
        return this.dossiers.download(m, 'PR', null, fileId, { actor: user.id, context: this.newDossierContext(key) });
      }
      const { header } = await this.readablePr(m, user, key);
      const temporary = session && user.permissions.includes('PR.DOSSIER_MANAGE') && header.approvalStatus !== 'CANCELED'
        ? { actor: user.id, context: this.existingDossierContext(key, session) } : undefined;
      return this.dossiers.download(m, 'PR', key, fileId, temporary);
    });
  }

  async getPr(user: CurrentUser, id: number) {
    const { header, fullView, canEdit } = await this.readablePr(this.ds.manager, user, id);
    const lines = await this.ds.query(
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
    const children = await this.ds.query(
      `SELECT DISTINCT po.id, po.document_number AS "documentNumber", po.approval_status AS "approvalStatus"
         FROM purchase_orders po JOIN purchase_order_lines pol ON pol.purchase_order_id = po.id
         JOIN purchase_requisition_lines prl ON prl.id = pol.purchase_requisition_line_id
        WHERE prl.purchase_requisition_id = $1 ORDER BY po.id`,
      [id],
    );
    // The contract-scoped reader gets no PO numbers: PO.VIEW is not widened (PR #17).
    const [notes, history] = await Promise.all([
      documentPage(this.ds.manager, 'PR', id, 'notes'),
      documentPage(this.ds.manager, 'PR', id, 'history'),
    ]);
    const canReassign = await prWorkflow.canReassign(this.ds.manager, {
      approval_status: header.approvalStatus, assigned_approver_id: header.assignedApproverId, created_by: header.createdBy,
    }, user, false);
    const creatorRole = await grantRole(this.ds.manager, header.createdBy, 'PR.CREATE');
    const rejection = header.approvalStatus === 'REJECTED'
      ? await latestRoundActivity(this.ds.manager, 'PR', id, header.approvalRound, 'REJECT') : null;
    const canCancel = header.createdBy === user.id && user.permissions.includes('PR.CREATE')
      && (['DRAFT', 'REJECTED'].includes(header.approvalStatus)
        || (header.approvalStatus === 'DONE' && children.every((po: { approvalStatus: string }) => po.approvalStatus === 'CANCELED')));
    return { ...header, canCancel, canEdit, creatorRole: creatorRole?.role ?? null, rejection, canReassign, lines, children: fullView ? children : [], history: history.items, historyCursor: history.nextCursor,
      nodes: await this.ds.query(`SELECT n.step, n.round, n.department, n.result, n.assignee_id AS "assigneeId",
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
    const [doc] = await this.ds.query('SELECT * FROM purchase_requisitions WHERE id = $1 AND created_by = $2', [id, user.id]);
    if (!doc) throw new ForbiddenException('The PR is outside your creation scope');
    wf.assertStatus(doc, ['DRAFT', 'REJECTED']);
    return this.listCreatorCandidates(user, doc.sales_contract_id, doc.creator_route);
  }

  async listPrSuppliers(user: CurrentUser, contractId: number, brandId: number, requestedRoute?: prWorkflow.PrRoute) {
    return this.ds.transaction(async m => {
      await prWorkflow.creatorRoute(m, user, contractId, requestedRoute);
      return CatalogFacade.activeBrandSuppliers(m, brandId);
    });
  }

  async listCreatorCandidates(user: CurrentUser, contractId: number, requestedRoute?: prWorkflow.PrRoute) {
    const route = await prWorkflow.creatorRoute(this.ds.manager, user, contractId, requestedRoute);
    const [approvers, receivers] = await Promise.all([
      listCandidates(this.ds.manager, route, user.id),
      listCandidates(this.ds.manager, 'RECEIPT', user.id),
    ]);
    return { approvers, receivers };
  }

  assignResponsiblePm(id: number, userId: number) {
    return this.ds.transaction(m => SalesContractFacade.assignResponsiblePm(m, id, userId));
  }

  async addPrNote(user: CurrentUser, id: number, body: string) {
    if (!body.trim()) throw new BusinessError('PR_NOTE_REQUIRED', 'Enter a note');
    await this.ds.transaction(async m => {
      await this.readablePr(m, user, id, true);
      await insertNote(m, 'PR', id, user.id, body.trim());
    });
  }

  async readPrRecords(user: CurrentUser, id: number, kind: 'notes' | 'history', before?: number) {
    await this.readablePr(this.ds.manager, user, id);
    return documentPage(this.ds.manager, 'PR', id, kind, before);
  }

  listPrNotifications(recipientId: number) {
    return this.ds.query(`SELECT n.id, n.pr_id AS "prId", pr.document_number AS "documentNumber",
      n.action, n.round, n.reason, n.created_at AS "createdAt", n.read_at AS "readAt",
      n.task_step AS "taskStep", n.resolved_at AS "resolvedAt"
      FROM pr_notifications n JOIN purchase_requisitions pr ON pr.id = n.pr_id
      WHERE n.recipient_id = $1 ORDER BY n.id DESC`, [recipientId]);
  }

  async readPrNotification(recipientId: number, id: number) {
    await this.ds.query('UPDATE pr_notifications SET read_at = COALESCE(read_at, now()) WHERE id = $1 AND recipient_id = $2', [id, recipientId]);
  }

  /** Lines of DONE PRs with quantity not yet covered by WAITING/APPROVED POs, for the PO form. */
  prLinesAvailableForPo() {
    return this.ds.query(
      `SELECT * FROM (
         SELECT l.id, pr.document_number AS "prNumber", s.document_number AS "salesContractNumber", l.snapshot_code AS "partNumber",
                l.snapshot_name AS "productName", u.code AS uom, l.quantity,
                l.quantity - COALESCE((SELECT SUM(pol.quantity) FROM purchase_order_lines pol JOIN purchase_orders po ON po.id = pol.purchase_order_id
                                        WHERE pol.purchase_requisition_line_id = l.id AND po.approval_status IN ('WAITING_FOR_APPROVE', 'APPROVED')), 0) AS remaining
           FROM purchase_requisition_lines l
           JOIN purchase_requisitions pr ON pr.id = l.purchase_requisition_id
           JOIN sales_contracts s ON s.id = pr.sales_contract_id
           JOIN units_of_measure u ON u.id = l.unit_of_measure_id
          WHERE pr.approval_status = 'DONE' AND l.product_id IS NOT NULL) x
        WHERE remaining > 0 ORDER BY id`,
    );
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

  async getPo(id: number) {
    const [po] = await this.ds.query(
      `SELECT ${wf.DOC_COLUMNS}, d.supplier_id AS "supplierId", sp.name AS "supplierName", ${RECEIPT_STATUS_SQL} AS "receiptStatus" FROM purchase_orders d JOIN suppliers sp ON sp.id = d.supplier_id WHERE d.id = $1`,
      [id],
    );
    if (!po) throw new NotFoundException();
    const lines = await this.ds.query(
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
    return { ...po, lines, children: [], history: await wf.history(this.ds.manager, 'PO', id) };
  }
}
