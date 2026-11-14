import { ForbiddenException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import type { CurrentUser } from '../identity/auth';
import { InventoryFacade } from '../inventory/inventory.service';
import { sourceScope } from './gi.service';
import { ProductUsage } from '../master-data/product-usage';
import { InboundFacade } from '../inbound/inbound.service';
import { LineCategory, PrLineForIssue, ProcurementFacade } from '../procurement/procurement.service';
import { SalesContractFacade } from '../sales-contracts/sales-contracts.service';
import * as wf from '../workflow/workflow';
import { BusinessError } from '../workflow/workflow';

/** PURCHASE_REQUISITION = A/C ("mua HĐ nào xuất HĐ đó", lines from PO-done PR lines); AVAILABLE_STOCK = B/D. */
export type IssueType = 'PURCHASE_REQUISITION' | 'AVAILABLE_STOCK';
/** A/C: `purchaseRequisitionLineId` (product and HĐ line come from it). AVAILABLE_STOCK: HĐ line + product. */
export interface GirLineInput { purchaseRequisitionLineId?: number; salesContractLineId?: number; productId?: number; quantity: number }
interface ResolvedLine { purchaseRequisitionLineId: number | null; salesContractLineId: number | null; productId: number; quantity: number }
/** B/D input: where the stock comes from (one source HĐ + its Sales, CT16), and D's mandatory purpose. */
export interface GirSourceInput { category?: LineCategory; sourceSalesContractId?: number; sourceOwnerUserId?: number; purpose?: string }
interface GirHeader extends wf.DocHeader {
  issue_type: IssueType;
  category: LineCategory;
  source_sales_contract_id: number | null;
  source_owner_user_id: number | null;
  purpose: string | null;
  sales_contract_id: number;
  warehouse_id: number;
  approval_step: number | null;
  warehouse_approver_id: number | null;
  execution_status: string;
}

/**
 * GIR (03 §3, §10, ADR-0010). Quota per HĐ line id; GIR never reserves inventory.
 * Lock order: HĐ lines → GIR row → (GI) → inventories → serials.
 */
@Injectable()
export class GirService {
  constructor(private readonly ds: DataSource) {}

  create(user: CurrentUser, input: { issueType: IssueType; salesContractId: number; warehouseId: number; lines: GirLineInput[] } & GirSourceInput) {
    wf.assertWarehouse(user, input.warehouseId);
    return this.ds.transaction(async (m) => {
      await this.assertWarehouseAllowed(m, input.issueType, input.warehouseId);
      const source = input.issueType === 'AVAILABLE_STOCK' ? await this.resolveSource(m, input.salesContractId, input) : null;
      const { lines, category } = await this.resolveLines(m, input.issueType, input.salesContractId, input.lines, input.category);
      const purpose = await this.resolvePurpose(m, input.issueType, category, input.purpose, lines);
      const number = await wf.nextDocumentNumber(m, 'GIR');
      const [gir] = await m.query(
        `INSERT INTO goods_issue_requests (document_number, issue_type, category, sales_contract_id, warehouse_id, source_sales_contract_id,
           source_owner_user_id, purpose, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [number, input.issueType, category, input.salesContractId, input.warehouseId, source?.sourceSalesContractId ?? null,
          source?.sourceOwnerUserId ?? null, purpose, user.id],
      );
      // A DRAFT holds no quota (CT2) and may lack stock (CT13): both are checked at submit and every approval step.
      await this.insertLines(m, gir.id, lines);
      return { id: gir.id as number, documentNumber: number };
    });
  }

  /** Replace lines of a DRAFT/REJECTED GIR (submitted GIRs are never edited directly, 03 §3). */
  /** Source HĐ/Sales and category stay as created (pick another source → new GIR); purpose may change while DRAFT/REJECTED. */
  update(user: CurrentUser, id: number, version: number, lines: GirLineInput[], purpose?: string) {
    return this.ds.transaction(async (m) => {
      const head = await this.peek(m, id);
      const resolved = await this.resolveLines(m, head.issue_type, head.sales_contract_id, lines, head.category);
      const doc = (await wf.lockDocument(m, 'GIR', id)) as GirHeader;
      wf.assertWarehouse(user, doc.warehouse_id);
      wf.assertCreator(doc, user);
      wf.assertStatus(doc, ['DRAFT', 'REJECTED']);
      wf.assertVersion(doc, version);
      await m.query(`DELETE FROM goods_issue_request_lines WHERE goods_issue_request_id = $1`, [id]);
      await this.insertLines(m, id, resolved.lines);
      const newPurpose = await this.resolvePurpose(m, doc.issue_type, resolved.category, purpose ?? doc.purpose ?? undefined, resolved.lines);
      await m.query(`UPDATE goods_issue_requests SET category = $2, purpose = $3, version = version + 1, updated_at = now() WHERE id = $1`, [
        id, resolved.category, newPurpose,
      ]);
    });
  }

  /**
   * PURCHASE_REQUISITION: one approver (GIR.APPROVE + warehouse). AVAILABLE_STOCK: step 1 is always the source Sales of the GIR
   * (CT17; `approverId` must be them), then the chosen warehouse manager.
   */
  submit(user: CurrentUser, id: number, approverId: number, warehouseApproverId?: number) {
    return this.ds.transaction(async (m) => {
      const doc = await this.lockForDecision(m, id);
      wf.assertWarehouse(user, doc.warehouse_id);
      await this.checkBeforeApproval(m, doc, 'submit');
      if (doc.issue_type !== 'AVAILABLE_STOCK') return wf.submit(m, 'GIR', doc, user, approverId);

      wf.assertCreator(doc, user);
      wf.assertStatus(doc, ['DRAFT', 'REJECTED']);
      const sales = await this.sourceConfirmers(m, doc);
      const managers = await wf.eligibleApprovers(m, 'GIR', doc.created_by, doc.warehouse_id);
      if (!sales.some((u) => u.id === approverId)) {
        throw new BusinessError('APPROVER_NOT_SOURCE_SALES', 'Step 1 goes to the source Sales of this request (with GIR.SALES_CONFIRM), never someone else');
      }
      if (!managers.some((u) => u.id === warehouseApproverId)) {
        throw new BusinessError('APPROVER_NOT_ELIGIBLE', 'Pick a warehouse manager with the required permission and warehouse');
      }
      await wf.setStatus(m, 'GIR', doc, 'WAITING_FOR_APPROVE', ', assigned_approver_id = $3, approval_step = 1, warehouse_approver_id = $4', [
        approverId, warehouseApproverId,
      ]);
      await wf.record(m, 'GIR', id, 'SUBMIT', user.id);
    });
  }

  /** Step 1 (Sales) moves to step 2; the final step re-checks quota/stock and approves. */
  approve(user: CurrentUser, id: number) {
    return this.ds.transaction(async (m) => {
      const doc = await this.lockForDecision(m, id);
      wf.assertAssignedApprover(doc, user);
      if (doc.issue_type === 'AVAILABLE_STOCK' && doc.approval_step === 1) {
        if (!user.permissions.includes('GIR.SALES_CONFIRM')) throw new ForbiddenException('Missing permission: GIR.SALES_CONFIRM');
        await this.checkBeforeApproval(m, doc, 'approve');
        await wf.setStatus(m, 'GIR', doc, 'WAITING_FOR_APPROVE', ', approval_step = 2, assigned_approver_id = warehouse_approver_id');
        await wf.record(m, 'GIR', id, 'CONFIRM', user.id);
        return;
      }
      if (!user.permissions.includes('GIR.APPROVE')) throw new ForbiddenException('Missing permission: GIR.APPROVE');
      wf.assertWarehouse(user, doc.warehouse_id);
      await this.checkBeforeApproval(m, doc, 'approve');
      await wf.approve(m, 'GIR', doc, user);
    });
  }

  /** Rejection at any step → REJECTED; a new round starts from Sales again (G3). */
  reject(user: CurrentUser, id: number, reason: string) {
    return this.ds.transaction(async (m) => {
      const doc = (await wf.lockDocument(m, 'GIR', id)) as GirHeader;
      await wf.reject(m, 'GIR', doc, user, reason);
      await m.query(`UPDATE goods_issue_requests SET approval_step = NULL WHERE id = $1`, [id]);
    });
  }

  /** Back to DRAFT: pending any time; APPROVED only while every GI is CANCELED (03 §10.4). Old confirmations are void. */
  recall(user: CurrentUser, id: number, reason: string) {
    return this.ds.transaction(async (m) => {
      const doc = (await wf.lockDocument(m, 'GIR', id)) as GirHeader;
      if (doc.approval_status === 'APPROVED') {
        const [open] = await m.query(`SELECT 1 FROM goods_issues WHERE goods_issue_request_id = $1 AND approval_status <> 'CANCELED'`, [id]);
        if (open || doc.execution_status !== 'NOT_STARTED') {
          throw new BusinessError('GIR_HAS_GOODS_ISSUES', 'Cancel all goods issues of this request before recalling it', HttpStatus.CONFLICT);
        }
      }
      await wf.recallPending(m, 'GIR', doc, user, reason, ['WAITING_FOR_APPROVE', 'APPROVED']);
      await m.query(`UPDATE goods_issue_requests SET approval_step = NULL, assigned_approver_id = NULL WHERE id = $1`, [id]);
    });
  }

  cancel(user: CurrentUser, id: number) {
    return this.ds.transaction(async (m) => wf.cancel(m, 'GIR', await wf.lockDocument(m, 'GIR', id), user));
  }

  /**
   * "Xác nhận hoàn thành xuất" (03 §10.3): no GI may be DRAFT/WAITING/REJECTED; shortfall needs a reason; the
   * unissued part leaves the HĐ quota (quota counts issued quantity for COMPLETED GIRs). GI creation locks the
   * same GIR row, so no new GI can appear concurrently.
   */
  complete(user: CurrentUser, id: number, reason?: string) {
    return this.ds.transaction(async (m) => {
      const doc = (await wf.lockDocument(m, 'GIR', id)) as GirHeader;
      wf.assertWarehouse(user, doc.warehouse_id);
      wf.assertStatus(doc, ['APPROVED']);
      if (doc.execution_status === 'COMPLETED') throw new BusinessError('GIR_COMPLETED', 'This request is already completed', HttpStatus.CONFLICT);
      const [open] = await m.query(
        `SELECT document_number FROM goods_issues WHERE goods_issue_request_id = $1 AND approval_status IN ('DRAFT', 'WAITING_FOR_APPROVE', 'REJECTED') LIMIT 1`,
        [id],
      );
      if (open) throw new BusinessError('GIR_HAS_OPEN_GOODS_ISSUES', `Approve or cancel ${open.document_number} first`, HttpStatus.CONFLICT);
      const [{ short }] = await m.query(
        `SELECT bool_or(l.quantity > COALESCE(i.issued, 0)) AS short FROM goods_issue_request_lines l
           LEFT JOIN (SELECT gl.goods_issue_request_line_id, SUM(gl.quantity) AS issued FROM goods_issue_lines gl
                        JOIN goods_issues g ON g.id = gl.goods_issue_id AND g.approval_status = 'APPROVED'
                       GROUP BY gl.goods_issue_request_line_id) i ON i.goods_issue_request_line_id = l.id
          WHERE l.goods_issue_request_id = $1`,
        [id],
      );
      if (short && !reason?.trim()) throw new BusinessError('REASON_REQUIRED', 'Issued quantity is below the request; a reason is required');
      await m.query(
        `UPDATE goods_issue_requests SET execution_status = 'COMPLETED', completion_reason = $2, completed_by = $3, completed_at = now(),
           version = version + 1, updated_at = now() WHERE id = $1`,
        [id, reason?.trim() || null, user.id],
      );
      await wf.record(m, 'GIR', id, 'COMPLETE', user.id, reason?.trim() || undefined);
    });
  }

  async approvers(user: CurrentUser, id: number) {
    const doc = await this.peek(this.ds.manager, id);
    wf.assertWarehouse(user, doc.warehouse_id);
    return {
      approvers: doc.issue_type === 'AVAILABLE_STOCK'
        ? await this.sourceConfirmers(this.ds.manager, doc)
        : await wf.eligibleApprovers(this.ds.manager, 'GIR', doc.created_by, doc.warehouse_id),
      warehouseApprovers: doc.issue_type === 'AVAILABLE_STOCK' ? await wf.eligibleApprovers(this.ds.manager, 'GIR', doc.created_by, doc.warehouse_id) : [],
    };
  }

  list(user: CurrentUser, assignedToMe: boolean) {
    return this.ds.query(
      `SELECT g.id, g.document_number AS "documentNumber", g.issue_type AS "issueType", g.category, g.approval_status AS "approvalStatus",
              g.approval_step AS "approvalStep", g.execution_status AS "executionStatus", s.document_number AS "salesContractNumber",
              w.code AS "warehouseCode", c.full_name AS "createdByName", a.full_name AS "assignedApproverName", g.created_at AS "createdAt"
         FROM goods_issue_requests g
         JOIN sales_contracts s ON s.id = g.sales_contract_id
         JOIN warehouses w ON w.id = g.warehouse_id
         JOIN users c ON c.id = g.created_by
         LEFT JOIN users a ON a.id = g.assigned_approver_id
        WHERE (g.warehouse_id = ANY($1) OR g.created_by = $2 OR g.assigned_approver_id = $2)
          AND (NOT $3 OR (g.approval_status = 'WAITING_FOR_APPROVE' AND g.assigned_approver_id = $2))
        ORDER BY g.id DESC`,
      [user.warehouseIds, user.id, assignedToMe],
    );
  }

  async get(user: CurrentUser, id: number) {
    const [gir] = await this.ds.query(
      `SELECT g.id, g.document_number AS "documentNumber", g.issue_type AS "issueType", g.approval_status AS "approvalStatus",
              g.approval_step AS "approvalStep", g.execution_status AS "executionStatus", g.version, g.warehouse_id AS "warehouseId",
              g.category, g.sales_contract_id AS "salesContractId", s.document_number AS "salesContractNumber", w.code AS "warehouseCode",
              g.source_sales_contract_id AS "sourceSalesContractId", ss.document_number AS "sourceSalesContractNumber",
              g.source_owner_user_id AS "sourceOwnerUserId", so.full_name AS "sourceOwnerName", g.purpose,
              g.created_by AS "createdBy", c.full_name AS "createdByName", g.assigned_approver_id AS "assignedApproverId",
              a.full_name AS "assignedApproverName", wa.full_name AS "warehouseApproverName", g.completion_reason AS "completionReason",
              g.created_at AS "createdAt"
         FROM goods_issue_requests g
         JOIN sales_contracts s ON s.id = g.sales_contract_id
         JOIN warehouses w ON w.id = g.warehouse_id
         JOIN users c ON c.id = g.created_by
         LEFT JOIN users a ON a.id = g.assigned_approver_id
         LEFT JOIN users wa ON wa.id = g.warehouse_approver_id
         LEFT JOIN sales_contracts ss ON ss.id = g.source_sales_contract_id
         LEFT JOIN users so ON so.id = g.source_owner_user_id
        WHERE g.id = $1`,
      [id],
    );
    if (!gir) throw new NotFoundException();
    if (!user.warehouseIds.includes(gir.warehouseId) && ![gir.createdBy, gir.assignedApproverId].includes(user.id)) {
      throw new ForbiddenException('Warehouse is outside your scope');
    }
    const lines = await this.ds.query(
      `SELECT l.id, l.purchase_requisition_line_id AS "purchaseRequisitionLineId", pr.document_number AS "prNumber",
              l.sales_contract_line_id AS "salesContractLineId", scl.item_name AS "contractItem", scl.quantity AS "contractQuantity",
              l.product_id AS "productId", p.part_number AS "partNumber", p.name AS "productName", p.is_serial_tracked AS "isSerialTracked",
              u.code AS uom, l.quantity,
              EXISTS (SELECT 1 FROM sales_contract_line_products x WHERE x.sales_contract_line_id = l.sales_contract_line_id
                         AND x.product_id = l.product_id AND x.status = 'APPROVED') AS "productConfirmed",
              COALESCE((SELECT SUM(gl.quantity) FROM goods_issue_lines gl JOIN goods_issues gi ON gi.id = gl.goods_issue_id
                         WHERE gl.goods_issue_request_line_id = l.id AND gi.approval_status = 'APPROVED'), 0) AS "issuedQuantity",
              COALESCE((SELECT SUM(gl.quantity) FROM goods_issue_lines gl JOIN goods_issues gi ON gi.id = gl.goods_issue_id
                         WHERE gl.goods_issue_request_line_id = l.id AND gi.approval_status IN ('WAITING_FOR_APPROVE', 'APPROVED')), 0) AS "committedQuantity"
         FROM goods_issue_request_lines l
         LEFT JOIN sales_contract_lines scl ON scl.id = l.sales_contract_line_id
         LEFT JOIN purchase_requisition_lines prl ON prl.id = l.purchase_requisition_line_id
         LEFT JOIN purchase_requisitions pr ON pr.id = prl.purchase_requisition_id
         JOIN products p ON p.id = l.product_id
         JOIN units_of_measure u ON u.id = p.unit_of_measure_id
        WHERE l.goods_issue_request_id = $1 ORDER BY l.id`,
      [id],
    );
    // A/C lines: first approved GR and received quantity of the PR line, for reference only (03 §3a; never a condition).
    const prLineIds: number[] = lines.flatMap((l: { purchaseRequisitionLineId: number | null }) => (l.purchaseRequisitionLineId ? [l.purchaseRequisitionLineId] : []));
    const first = await InboundFacade.firstReceipts(this.ds.manager, prLineIds);
    const received = prLineIds.length ? await ProcurementFacade.receivedByPrLine(this.ds.manager, prLineIds) : new Map<number, number>();
    for (const l of lines as { purchaseRequisitionLineId: number | null; firstGoodsReceipt?: unknown; receivedQuantity?: number | null }[]) {
      l.firstGoodsReceipt = l.purchaseRequisitionLineId ? first.get(l.purchaseRequisitionLineId) ?? null : null;
      l.receivedQuantity = l.purchaseRequisitionLineId ? received.get(l.purchaseRequisitionLineId) ?? 0 : null;
    }
    const issues = await this.ds.query(
      `SELECT id, document_number AS "documentNumber", approval_status AS "approvalStatus" FROM goods_issues WHERE goods_issue_request_id = $1 ORDER BY id`,
      [id],
    );
    return { ...gir, lines, goodsIssues: issues, history: await wf.history(this.ds.manager, 'GIR', id) };
  }

  /**
   * Remaining quota per HĐ line of a contract (UI: contract qty, held by other GIRs, remaining). Only GIRs that hold the
   * quota count (CT2: WAITING/REJECTED/APPROVED, COMPLETED → issued); DRAFTs and material lines never do.
   */
  quota(salesContractId: number, excludeGirId?: number) {
    return this.ds.query(
      `SELECT scl.id AS "salesContractLineId", scl.quantity AS "contractQuantity",
              COALESCE(SUM(${USED_EXPR}) FILTER (WHERE g.id <> COALESCE($2, -1)), 0) AS "usedQuantity"
         FROM sales_contract_lines scl
         LEFT JOIN goods_issue_request_lines l ON l.sales_contract_line_id = scl.id
         LEFT JOIN goods_issue_requests g ON g.id = l.goods_issue_request_id AND g.category = 'SALES_GOODS'
                                          AND g.approval_status IN (${HOLDING})
        WHERE scl.sales_contract_id = $1
        GROUP BY scl.id, scl.quantity ORDER BY scl.id`,
      [salesContractId, excludeGirId ?? null],
    );
  }

  /**
   * A/C picker (02 §B.1): lines of the HĐ's `PO done` PRs with PR-line quota left (requested by other GIRs that hold it)
   * and the received quantity for reference only. `excludeGirId` keeps an edited GIR's own lines out of "used".
   */
  async prLineOptions(salesContractId: number, excludeGirId?: number) {
    const lines = await ProcurementFacade.poDoneLines(this.ds.manager, salesContractId);
    if (!lines.length) return [];
    const used = await this.prLineUsage(this.ds.manager, lines.map((l) => l.id), excludeGirId ?? null);
    return lines.map((l) => ({ ...l, usedQuantity: used.get(l.id) ?? 0, remainingQuantity: Number(l.quantity) - (used.get(l.id) ?? 0) }));
  }

  /** B/D picker: per source HĐ + Sales + product, what is available in this warehouse (excluding the target HĐ). */
  async availableSources(user: CurrentUser, warehouseId: number, targetSalesContractId?: number) {
    wf.assertWarehouse(user, warehouseId);
    const rows = await InventoryFacade.availableSources(this.ds.manager, warehouseId);
    const contracts = await SalesContractFacade.summaries(this.ds.manager, [...new Set(rows.map((r) => r.sourceSalesContractId))]);
    return rows
      .filter((r) => r.sourceSalesContractId !== targetSalesContractId && contracts.get(r.sourceSalesContractId)?.status !== 'CANCELED')
      .map((r) => ({ ...r, available: Number(r.available), sourceSalesContractNumber: contracts.get(r.sourceSalesContractId)?.documentNumber,
        sourceSalesContractStatus: contracts.get(r.sourceSalesContractId)?.status }));
  }

  // ---------- internals ----------

  /**
   * Turns input lines into stored lines and the GIR category, locking HĐ lines then PR lines (CT8).
   * A/C: every PR line belongs to a PR of this HĐ, all PRs share one category (CM3); product and HĐ line are inherited
   * (material lines keep no HĐ line: no HĐ quota, no Sales confirmation). AVAILABLE_STOCK: sales goods on HĐ lines.
   */
  private async resolveLines(m: EntityManager, issueType: IssueType, salesContractId: number, input: GirLineInput[], category?: LineCategory)
    : Promise<{ lines: ResolvedLine[]; category: LineCategory }> {
    if (issueType === 'AVAILABLE_STOCK') {
      // B (sales goods): HĐ line of the target + product; D (materials): product only, no HĐ line, no HĐ quota.
      const cat = category ?? 'SALES_GOODS';
      const bad = cat === 'SALES_GOODS'
        ? input.some((l) => !l.salesContractLineId || !l.productId || l.purchaseRequisitionLineId)
        : input.some((l) => l.salesContractLineId || !l.productId || l.purchaseRequisitionLineId);
      if (bad) {
        throw new BusinessError('GIR_LINE_SOURCE_INVALID', cat === 'SALES_GOODS'
          ? 'Available-stock sales lines need an HĐ line and a product, no PR line'
          : 'Available-stock material lines need a product only (no HĐ line, no PR line)');
      }
      if (cat === 'MATERIAL') wf.assertUniqueSourceLines(input.map((l) => l.productId!));
      await SalesContractFacade.lockActiveLines(m, salesContractId, input.flatMap((l) => (l.salesContractLineId ? [l.salesContractLineId] : [])));
      return {
        category: cat,
        lines: input.map((l) => ({ purchaseRequisitionLineId: null, salesContractLineId: l.salesContractLineId ?? null, productId: l.productId!, quantity: l.quantity })),
      };
    }
    if (input.some((l) => !l.purchaseRequisitionLineId || l.salesContractLineId || l.productId)) {
      throw new BusinessError('GIR_LINE_SOURCE_INVALID', 'PR-based lines reference exactly one PR line; product and HĐ line come from it');
    }
    const ids = input.map((l) => l.purchaseRequisitionLineId!);
    wf.assertUniqueSourceLines(ids);
    const peek = new Map((await ProcurementFacade.peekLines(m, ids)).map((p) => [p.id, p]));
    const foreign = ids.filter((id) => peek.get(id)?.salesContractId !== salesContractId);
    if (foreign.length) throw new BusinessError('PR_LINE_NOT_IN_CONTRACT', `PR line(s) ${foreign.join(', ')} do not belong to a PR of this HĐ`);
    await SalesContractFacade.lockActiveLines(m, salesContractId, [...peek.values()].flatMap((p) => (p.salesContractLineId ? [p.salesContractLineId] : [])));
    const pr = await ProcurementFacade.lockLinesForIssue(m, ids); // a PR line never changes PR, so the HĐ check above still holds
    const categories = new Set([...pr.values()].map((l) => l.category));
    if (categories.size > 1) throw new BusinessError('GIR_CATEGORY_MIXED', 'Sales goods and materials cannot be mixed in one request');
    const prCategory = [...categories][0]; // PR-based: the category always comes from the PRs
    return {
      category: prCategory,
      lines: input.map((l) => {
        const p = pr.get(l.purchaseRequisitionLineId!)!;
        return { purchaseRequisitionLineId: p.id, salesContractLineId: prCategory === 'SALES_GOODS' ? p.salesContractLineId : null, productId: p.productId, quantity: l.quantity };
      }),
    };
  }

  /**
   * B/D source (CT16–CT19): one source HĐ, different from the target, not CANCELED (a completed HĐ is fine), and its
   * responsible Sales — the Sales stamped on its lots (CT15, CT17). Read FOR SHARE so the HĐ cannot be canceled meanwhile.
   */
  private async resolveSource(m: EntityManager, targetId: number, input: GirSourceInput) {
    if (!input.sourceSalesContractId || !input.sourceOwnerUserId) {
      throw new BusinessError('GIR_SOURCE_REQUIRED', 'Pick the source HĐ and its source Sales for an available-stock request');
    }
    if (input.sourceSalesContractId === targetId) {
      throw new BusinessError('SOURCE_CONTRACT_INVALID', 'The source HĐ must differ from the target HĐ; use a PR-based request for the same HĐ');
    }
    const source = await SalesContractFacade.sourceContract(m, input.sourceSalesContractId);
    if (!source || source.status === 'CANCELED') throw new BusinessError('SOURCE_CONTRACT_INVALID', 'The source HĐ does not exist or is canceled');
    if (source.responsibleSalesUserId !== input.sourceOwnerUserId) {
      throw new BusinessError('SOURCE_SALES_MISMATCH', 'The source Sales must be the responsible Sales of the source HĐ');
    }
    return { sourceSalesContractId: input.sourceSalesContractId, sourceOwnerUserId: input.sourceOwnerUserId };
  }

  /** D: purpose is mandatory. C: optional reference, inherited from the PRs when left empty. A/B: none. */
  private async resolvePurpose(m: EntityManager, issueType: string, category: LineCategory, purpose: string | undefined, lines: ResolvedLine[]) {
    const text = purpose?.trim() || null;
    if (category !== 'MATERIAL') return null;
    if (issueType === 'AVAILABLE_STOCK') {
      if (!text) throw new BusinessError('PURPOSE_REQUIRED', 'Materials from available stock need a purpose of use');
      return text;
    }
    if (text) return text;
    const inherited = await ProcurementFacade.purposesOf(m, lines.flatMap((l) => (l.purchaseRequisitionLineId ? [l.purchaseRequisitionLineId] : [])));
    return inherited.length ? inherited.join('; ') : null;
  }

  /** Who may confirm step 1 of an AVAILABLE_STOCK GIR: only its source Sales, and only with GIR.SALES_CONFIRM. */
  private async sourceConfirmers(m: EntityManager, doc: GirHeader) {
    const all = await wf.usersWithPermission(m, 'GIR.SALES_CONFIRM', doc.created_by);
    return all.filter((u: { id: number }) => u.id === doc.source_owner_user_id);
  }

  /** PR-line quota used by GIRs that hold it (03 §10.1, CT2): WAITING/REJECTED/APPROVED (COMPLETED → issued), plus `includeGirId`. */
  private async prLineUsage(m: EntityManager, prLineIds: number[], excludeGirId: number | null, includeGirId: number | null = null) {
    const rows: { id: number; used: string }[] = await m.query(
      `SELECT l.purchase_requisition_line_id AS id, COALESCE(SUM(${USED_EXPR}), 0) AS used
         FROM goods_issue_request_lines l JOIN goods_issue_requests g ON g.id = l.goods_issue_request_id
        WHERE l.purchase_requisition_line_id = ANY($1) AND g.id <> COALESCE($2, -1)
          AND (g.approval_status IN (${HOLDING}) OR g.id = COALESCE($3, -1))
        GROUP BY l.purchase_requisition_line_id`,
      [prLineIds, excludeGirId, includeGirId],
    );
    return new Map(rows.map((r) => [r.id, Number(r.used)]));
  }

  private async peek(m: EntityManager, id: number): Promise<GirHeader> {
    const [doc] = await m.query(`SELECT * FROM goods_issue_requests WHERE id = $1`, [id]);
    if (!doc) throw new NotFoundException(`GIR ${id} not found`);
    return doc;
  }

  /** HĐ lines first (quota), then PR lines (PR quota), then the GIR row — the agreed lock order (CT8). */
  private async lockForDecision(m: EntityManager, id: number): Promise<GirHeader & { prLines: Map<number, PrLineForIssue> }> {
    const head = await this.peek(m, id);
    const lineIds: { sales_contract_line_id: number | null; purchase_requisition_line_id: number | null }[] = await m.query(
      `SELECT sales_contract_line_id, purchase_requisition_line_id FROM goods_issue_request_lines WHERE goods_issue_request_id = $1`,
      [id],
    );
    await SalesContractFacade.lockActiveLines(m, head.sales_contract_id, lineIds.flatMap((l) => (l.sales_contract_line_id ? [l.sales_contract_line_id] : [])));
    const prIds = lineIds.flatMap((l) => (l.purchase_requisition_line_id ? [l.purchase_requisition_line_id] : []));
    const prLines = prIds.length ? await ProcurementFacade.lockLinesForIssue(m, prIds) : new Map<number, PrLineForIssue>();
    return { ...((await wf.lockDocument(m, 'GIR', id)) as GirHeader), prLines };
  }

  /**
   * Checks at Submit and at every approval step (03 §3, §10.1): lines, Sales-confirmed products (sales goods), HĐ-line quota,
   * PR-line quota (A/C); `PO done` only at Submit (not retroactive, C60); stock for AVAILABLE_STOCK.
   */
  private async checkBeforeApproval(m: EntityManager, doc: GirHeader & { prLines: Map<number, PrLineForIssue> }, phase: 'submit' | 'approve') {
    const lines: { salesContractLineId: number | null; productId: number; purchaseRequisitionLineId: number | null }[] = await m.query(
      `SELECT sales_contract_line_id AS "salesContractLineId", product_id AS "productId", purchase_requisition_line_id AS "purchaseRequisitionLineId"
         FROM goods_issue_request_lines WHERE goods_issue_request_id = $1`,
      [doc.id],
    );
    if (!lines.length) throw new BusinessError('GIR_EMPTY', 'The request has no lines');
    if (doc.issue_type === 'PURCHASE_REQUISITION') {
      if (phase === 'submit') {
        const notDone = [...new Set([...doc.prLines.values()].filter((p) => !p.poDone).map((p) => p.prNumber))];
        if (notDone.length) throw new BusinessError('PR_NOT_PO_DONE', `${notDone.join(', ')} is not fully ordered on approved POs (PO done)`);
      }
      const ids = [...doc.prLines.keys()];
      const used = await this.prLineUsage(m, ids, null, doc.id);
      const over = ids.find((id) => (used.get(id) ?? 0) > doc.prLines.get(id)!.quantity);
      if (over) {
        throw new BusinessError('PR_LINE_QUOTA_EXCEEDED', `PR line ${over}: requested ${used.get(over)} > PR quantity ${doc.prLines.get(over)!.quantity}`);
      }
    }
    const unconfirmed = await SalesContractFacade.unapprovedProducts(m, lines.flatMap((l) => (l.salesContractLineId ? [{ salesContractLineId: l.salesContractLineId, productId: l.productId }] : [])));
    if (unconfirmed.length) {
      throw new BusinessError('PRODUCT_NOT_CONFIRMED', `Product ${unconfirmed[0].productId} is not confirmed by Sales for HĐ line ${unconfirmed[0].salesContractLineId}`);
    }
    await this.checkQuota(m, doc.id);
    if (doc.issue_type === 'AVAILABLE_STOCK') {
      await this.assertWarehouseAllowed(m, doc.issue_type, doc.warehouse_id);
      await this.checkAvailable(m, doc);
    }
  }

  private async insertLines(m: EntityManager, girId: number, lines: ResolvedLine[]) {
    for (const l of lines) {
      await ProductUsage.markUsed(m, l.productId, { stock: true });
      await m.query(
        `INSERT INTO goods_issue_request_lines (goods_issue_request_id, purchase_requisition_line_id, sales_contract_line_id, product_id, quantity)
         VALUES ($1, $2, $3, $4, $5)`,
        [girId, l.purchaseRequisitionLineId, l.salesContractLineId, l.productId, l.quantity],
      );
    }
  }

  private async assertWarehouseAllowed(m: EntityManager, issueType: IssueType, warehouseId: number) {
    const [w] = await m.query(`SELECT is_active, allow_available_stock_issue FROM warehouses WHERE id = $1`, [warehouseId]);
    if (!w?.is_active) throw new BusinessError('WAREHOUSE_NOT_FOUND', 'Warehouse not found or inactive');
    if (issueType === 'AVAILABLE_STOCK' && !w.allow_available_stock_issue) {
      throw new BusinessError('WAREHOUSE_NOT_ALLOWED_FOR_AVAILABLE_STOCK', 'This warehouse is not configured for available-stock issues');
    }
  }

  /**
   * HĐ-line quota of sales goods (A/B, 03 §10.1, CT2), at Submit and every approval step. Counts the GIRs holding the quota
   * (WAITING/REJECTED/APPROVED; COMPLETED → issued) plus this GIR itself (a DRAFT/REJECTED being submitted counts once).
   * The caller holds FOR UPDATE on those HĐ lines, so concurrent submits on one line are serialized.
   */
  private async checkQuota(m: EntityManager, girId: number) {
    const rows: { id: number; quantity: string; used: string }[] = await m.query(
      `SELECT scl.id, scl.quantity, COALESCE(SUM(${USED_EXPR}), 0) AS used
         FROM sales_contract_lines scl
         JOIN goods_issue_request_lines l ON l.sales_contract_line_id = scl.id
         JOIN goods_issue_requests g ON g.id = l.goods_issue_request_id AND g.category = 'SALES_GOODS'
                                     AND (g.approval_status IN (${HOLDING}) OR g.id = $1)
        WHERE scl.id IN (SELECT sales_contract_line_id FROM goods_issue_request_lines WHERE goods_issue_request_id = $1)
        GROUP BY scl.id, scl.quantity`,
      [girId],
    );
    const over = rows.find((r) => Number(r.used) > Number(r.quantity));
    if (over) throw new BusinessError('SALES_CONTRACT_QUOTA_EXCEEDED', `HĐ line ${over.id}: requested ${Number(over.used)} > contract ${Number(over.quantity)}`);
  }

  /**
   * AVAILABLE_STOCK: per product, requested ≤ available in the GIR's source scope (warehouse + source HĐ + source Sales),
   * at submit and at both approval steps (CT13). The GIR reserves nothing; a drop meanwhile blocks the step.
   */
  private async checkAvailable(m: EntityManager, doc: GirHeader) {
    const rows: { product_id: number; qty: string }[] = await m.query(
      `SELECT product_id, SUM(quantity) AS qty FROM goods_issue_request_lines WHERE goods_issue_request_id = $1 GROUP BY product_id`,
      [doc.id],
    );
    const available = await InventoryFacade.availableInScope(m, doc.warehouse_id, rows.map((r) => r.product_id), sourceScope(doc));
    const short = rows.find((r) => Number(r.qty) > available.get(r.product_id)!);
    if (short) {
      throw new BusinessError('INSUFFICIENT_AVAILABLE_STOCK', `Product ${short.product_id}: requested ${Number(short.qty)} > available ${available.get(short.product_id)}`, HttpStatus.CONFLICT);
    }
  }
}

/** Statuses that hold HĐ-line and PR-line quota (CT2); DRAFT and CANCELED never do. */
const HOLDING = `'WAITING_FOR_APPROVE', 'REJECTED', 'APPROVED'`;

/** Quota usage of one GIR line: requested quantity, or only the issued quantity once the GIR is COMPLETED (03 §10.1). */
const USED_EXPR = `CASE WHEN g.execution_status = 'COMPLETED' THEN
    (SELECT COALESCE(SUM(gl.quantity), 0) FROM goods_issue_lines gl JOIN goods_issues gi ON gi.id = gl.goods_issue_id
      WHERE gl.goods_issue_request_line_id = l.id AND gi.approval_status = 'APPROVED')
  ELSE l.quantity END`;
