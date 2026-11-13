import { ForbiddenException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import type { CurrentUser } from '../identity/auth';
import { InventoryFacade } from '../inventory/inventory.service';
import { ProductUsage } from '../master-data/product-usage';
import { SalesContractFacade } from '../sales-contracts/sales-contracts.service';
import * as wf from '../workflow/workflow';
import { BusinessError } from '../workflow/workflow';

export type IssueType = 'SALES_CONTRACT' | 'AVAILABLE_STOCK';
export interface GirLineInput { salesContractLineId: number; productId: number; quantity: number }
interface GirHeader extends wf.DocHeader {
  issue_type: IssueType;
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

  create(user: CurrentUser, input: { issueType: IssueType; salesContractId: number; warehouseId: number; lines: GirLineInput[] }) {
    wf.assertWarehouse(user, input.warehouseId);
    return this.ds.transaction(async (m) => {
      await this.assertWarehouseAllowed(m, input.issueType, input.warehouseId);
      await SalesContractFacade.lockActiveLines(m, input.salesContractId, input.lines.map((l) => l.salesContractLineId));
      const number = await wf.nextDocumentNumber(m, 'GIR');
      const [gir] = await m.query(
        `INSERT INTO goods_issue_requests (document_number, issue_type, sales_contract_id, warehouse_id, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [number, input.issueType, input.salesContractId, input.warehouseId, user.id],
      );
      await this.insertLines(m, gir.id, input.lines);
      await this.checkQuota(m, gir.id);
      if (input.issueType === 'AVAILABLE_STOCK') await this.checkAvailable(m, gir.id, input.warehouseId);
      return { id: gir.id as number, documentNumber: number };
    });
  }

  /** Replace lines of a DRAFT/REJECTED GIR (submitted GIRs are never edited directly, 03 §3). */
  update(user: CurrentUser, id: number, version: number, lines: GirLineInput[]) {
    return this.ds.transaction(async (m) => {
      const head = await this.peek(m, id);
      await SalesContractFacade.lockActiveLines(m, head.sales_contract_id, lines.map((l) => l.salesContractLineId));
      const doc = (await wf.lockDocument(m, 'GIR', id)) as GirHeader;
      wf.assertWarehouse(user, doc.warehouse_id);
      wf.assertCreator(doc, user);
      wf.assertStatus(doc, ['DRAFT', 'REJECTED']);
      wf.assertVersion(doc, version);
      await m.query(`DELETE FROM goods_issue_request_lines WHERE goods_issue_request_id = $1`, [id]);
      await this.insertLines(m, id, lines);
      await m.query(`UPDATE goods_issue_requests SET version = version + 1, updated_at = now() WHERE id = $1`, [id]);
      await this.checkQuota(m, id);
      if (doc.issue_type === 'AVAILABLE_STOCK') await this.checkAvailable(m, id, doc.warehouse_id);
    });
  }

  /** SALES_CONTRACT: one approver (GIR.APPROVE + warehouse). AVAILABLE_STOCK: Sales (GIR.SALES_CONFIRM) then warehouse manager. */
  submit(user: CurrentUser, id: number, approverId: number, warehouseApproverId?: number) {
    return this.ds.transaction(async (m) => {
      const doc = await this.lockForDecision(m, id);
      wf.assertWarehouse(user, doc.warehouse_id);
      await this.checkBeforeApproval(m, doc);
      if (doc.issue_type === 'SALES_CONTRACT') return wf.submit(m, 'GIR', doc, user, approverId);

      wf.assertCreator(doc, user);
      wf.assertStatus(doc, ['DRAFT', 'REJECTED']);
      const sales = await wf.usersWithPermission(m, 'GIR.SALES_CONFIRM', doc.created_by);
      const managers = await wf.eligibleApprovers(m, 'GIR', doc.created_by, doc.warehouse_id);
      if (!sales.some((u) => u.id === approverId) || !managers.some((u) => u.id === warehouseApproverId)) {
        throw new BusinessError('APPROVER_NOT_ELIGIBLE', 'Pick a Sales confirmer and a warehouse manager with the required permission and warehouse');
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
        await this.checkBeforeApproval(m, doc);
        await wf.setStatus(m, 'GIR', doc, 'WAITING_FOR_APPROVE', ', approval_step = 2, assigned_approver_id = warehouse_approver_id');
        await wf.record(m, 'GIR', id, 'CONFIRM', user.id);
        return;
      }
      if (!user.permissions.includes('GIR.APPROVE')) throw new ForbiddenException('Missing permission: GIR.APPROVE');
      wf.assertWarehouse(user, doc.warehouse_id);
      await this.checkBeforeApproval(m, doc);
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
        ? await wf.usersWithPermission(this.ds.manager, 'GIR.SALES_CONFIRM', doc.created_by)
        : await wf.eligibleApprovers(this.ds.manager, 'GIR', doc.created_by, doc.warehouse_id),
      warehouseApprovers: doc.issue_type === 'AVAILABLE_STOCK' ? await wf.eligibleApprovers(this.ds.manager, 'GIR', doc.created_by, doc.warehouse_id) : [],
    };
  }

  list(user: CurrentUser, assignedToMe: boolean) {
    return this.ds.query(
      `SELECT g.id, g.document_number AS "documentNumber", g.issue_type AS "issueType", g.approval_status AS "approvalStatus",
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
              g.sales_contract_id AS "salesContractId", s.document_number AS "salesContractNumber", w.code AS "warehouseCode",
              g.created_by AS "createdBy", c.full_name AS "createdByName", g.assigned_approver_id AS "assignedApproverId",
              a.full_name AS "assignedApproverName", wa.full_name AS "warehouseApproverName", g.completion_reason AS "completionReason",
              g.created_at AS "createdAt"
         FROM goods_issue_requests g
         JOIN sales_contracts s ON s.id = g.sales_contract_id
         JOIN warehouses w ON w.id = g.warehouse_id
         JOIN users c ON c.id = g.created_by
         LEFT JOIN users a ON a.id = g.assigned_approver_id
         LEFT JOIN users wa ON wa.id = g.warehouse_approver_id
        WHERE g.id = $1`,
      [id],
    );
    if (!gir) throw new NotFoundException();
    if (!user.warehouseIds.includes(gir.warehouseId) && ![gir.createdBy, gir.assignedApproverId].includes(user.id)) {
      throw new ForbiddenException('Warehouse is outside your scope');
    }
    const lines = await this.ds.query(
      `SELECT l.id, l.sales_contract_line_id AS "salesContractLineId", scl.item_name AS "contractItem", scl.quantity AS "contractQuantity",
              l.product_id AS "productId", p.part_number AS "partNumber", p.name AS "productName", p.is_serial_tracked AS "isSerialTracked",
              u.code AS uom, l.quantity,
              EXISTS (SELECT 1 FROM sales_contract_line_products x WHERE x.sales_contract_line_id = l.sales_contract_line_id
                         AND x.product_id = l.product_id AND x.status = 'APPROVED') AS "productConfirmed",
              COALESCE((SELECT SUM(gl.quantity) FROM goods_issue_lines gl JOIN goods_issues gi ON gi.id = gl.goods_issue_id
                         WHERE gl.goods_issue_request_line_id = l.id AND gi.approval_status = 'APPROVED'), 0) AS "issuedQuantity",
              COALESCE((SELECT SUM(gl.quantity) FROM goods_issue_lines gl JOIN goods_issues gi ON gi.id = gl.goods_issue_id
                         WHERE gl.goods_issue_request_line_id = l.id AND gi.approval_status IN ('WAITING_FOR_APPROVE', 'APPROVED')), 0) AS "committedQuantity"
         FROM goods_issue_request_lines l
         JOIN sales_contract_lines scl ON scl.id = l.sales_contract_line_id
         JOIN products p ON p.id = l.product_id
         JOIN units_of_measure u ON u.id = p.unit_of_measure_id
        WHERE l.goods_issue_request_id = $1 ORDER BY l.id`,
      [id],
    );
    const issues = await this.ds.query(
      `SELECT id, document_number AS "documentNumber", approval_status AS "approvalStatus" FROM goods_issues WHERE goods_issue_request_id = $1 ORDER BY id`,
      [id],
    );
    return { ...gir, lines, goodsIssues: issues, history: await wf.history(this.ds.manager, 'GIR', id) };
  }

  /** Remaining quota per HĐ line of a contract (UI: contract qty, requested elsewhere, remaining). */
  quota(salesContractId: number, excludeGirId?: number) {
    return this.ds.query(
      `SELECT scl.id AS "salesContractLineId", scl.quantity AS "contractQuantity",
              COALESCE(SUM(${USED_EXPR}) FILTER (WHERE g.id <> COALESCE($2, -1)), 0) AS "usedQuantity"
         FROM sales_contract_lines scl
         LEFT JOIN goods_issue_request_lines l ON l.sales_contract_line_id = scl.id
         LEFT JOIN goods_issue_requests g ON g.id = l.goods_issue_request_id AND g.approval_status <> 'CANCELED'
        WHERE scl.sales_contract_id = $1
        GROUP BY scl.id, scl.quantity ORDER BY scl.id`,
      [salesContractId, excludeGirId ?? null],
    );
  }

  // ---------- internals ----------

  private async peek(m: EntityManager, id: number): Promise<GirHeader> {
    const [doc] = await m.query(`SELECT * FROM goods_issue_requests WHERE id = $1`, [id]);
    if (!doc) throw new NotFoundException(`GIR ${id} not found`);
    return doc;
  }

  /** HĐ lines first (quota), then the GIR row — the agreed lock order. */
  private async lockForDecision(m: EntityManager, id: number): Promise<GirHeader> {
    const head = await this.peek(m, id);
    const lineIds: { sales_contract_line_id: number }[] = await m.query(
      `SELECT sales_contract_line_id FROM goods_issue_request_lines WHERE goods_issue_request_id = $1`,
      [id],
    );
    await SalesContractFacade.lockActiveLines(m, head.sales_contract_id, lineIds.map((l) => l.sales_contract_line_id));
    return (await wf.lockDocument(m, 'GIR', id)) as GirHeader;
  }

  private async checkBeforeApproval(m: EntityManager, doc: GirHeader) {
    const lines: { salesContractLineId: number; productId: number }[] = await m.query(
      `SELECT sales_contract_line_id AS "salesContractLineId", product_id AS "productId" FROM goods_issue_request_lines WHERE goods_issue_request_id = $1`,
      [doc.id],
    );
    if (!lines.length) throw new BusinessError('GIR_EMPTY', 'The request has no lines');
    const unconfirmed = await SalesContractFacade.unapprovedProducts(m, lines);
    if (unconfirmed.length) {
      throw new BusinessError('PRODUCT_NOT_CONFIRMED', `Product ${unconfirmed[0].productId} is not confirmed by Sales for HĐ line ${unconfirmed[0].salesContractLineId}`);
    }
    await this.checkQuota(m, doc.id);
    if (doc.issue_type === 'AVAILABLE_STOCK') {
      await this.assertWarehouseAllowed(m, doc.issue_type, doc.warehouse_id);
      await this.checkAvailable(m, doc.id, doc.warehouse_id);
    }
  }

  private async insertLines(m: EntityManager, girId: number, lines: GirLineInput[]) {
    for (const l of lines) {
      await ProductUsage.markUsed(m, l.productId, { stock: true });
      await m.query(
        `INSERT INTO goods_issue_request_lines (goods_issue_request_id, sales_contract_line_id, product_id, quantity) VALUES ($1, $2, $3, $4)`,
        [girId, l.salesContractLineId, l.productId, l.quantity],
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

  /** Quota per HĐ line id (03 §10.1); caller holds FOR UPDATE on those HĐ lines. */
  private async checkQuota(m: EntityManager, girId: number) {
    const rows: { id: number; quantity: string; used: string }[] = await m.query(
      `SELECT scl.id, scl.quantity, COALESCE(SUM(${USED_EXPR}), 0) AS used
         FROM sales_contract_lines scl
         JOIN goods_issue_request_lines l ON l.sales_contract_line_id = scl.id
         JOIN goods_issue_requests g ON g.id = l.goods_issue_request_id AND g.approval_status <> 'CANCELED'
        WHERE scl.id IN (SELECT sales_contract_line_id FROM goods_issue_request_lines WHERE goods_issue_request_id = $1)
        GROUP BY scl.id, scl.quantity`,
      [girId],
    );
    const over = rows.find((r) => Number(r.used) > Number(r.quantity));
    if (over) throw new BusinessError('SALES_CONTRACT_QUOTA_EXCEEDED', `HĐ line ${over.id}: requested ${Number(over.used)} > contract ${Number(over.quantity)}`);
  }

  /** AVAILABLE_STOCK: per product, requested ≤ available at the source warehouse (no reservation by GIR). */
  private async checkAvailable(m: EntityManager, girId: number, warehouseId: number) {
    const rows: { product_id: number; qty: string }[] = await m.query(
      `SELECT product_id, SUM(quantity) AS qty FROM goods_issue_request_lines WHERE goods_issue_request_id = $1 GROUP BY product_id`,
      [girId],
    );
    const available = await InventoryFacade.available(m, warehouseId, rows.map((r) => r.product_id));
    const short = rows.find((r) => Number(r.qty) > available.get(r.product_id)!);
    if (short) {
      throw new BusinessError('INSUFFICIENT_AVAILABLE_STOCK', `Product ${short.product_id}: requested ${Number(short.qty)} > available ${available.get(short.product_id)}`, HttpStatus.CONFLICT);
    }
  }
}

/** Quota usage of one GIR line: requested quantity, or only the issued quantity once the GIR is COMPLETED (03 §10.1). */
const USED_EXPR = `CASE WHEN g.execution_status = 'COMPLETED' THEN
    (SELECT COALESCE(SUM(gl.quantity), 0) FROM goods_issue_lines gl JOIN goods_issues gi ON gi.id = gl.goods_issue_id
      WHERE gl.goods_issue_request_line_id = l.id AND gi.approval_status = 'APPROVED')
  ELSE l.quantity END`;
