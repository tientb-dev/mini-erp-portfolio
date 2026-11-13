import { ForbiddenException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import type { CurrentUser } from '../identity/auth';
import { InventoryFacade, IssueItem } from '../inventory/inventory.service';
import { ProductUsage } from '../master-data/product-usage';
import * as wf from '../workflow/workflow';
import { BusinessError } from '../workflow/workflow';

export interface GiLineInput { goodsIssueRequestLineId: number; quantity: number; goodsReceiptDetailIds?: number[] }

/**
 * GI (03 §4): from an APPROVED, not completed GIR, same warehouse. Submit reserves quantity + SNs, approve issues
 * them, reject/recall releases. Every GI write locks the parent GIR row first, then inventory rows.
 */
@Injectable()
export class GiService {
  constructor(private readonly ds: DataSource) {}

  create(user: CurrentUser, girId: number, lines: GiLineInput[]) {
    return this.ds.transaction(async (m) => {
      const gir = await this.lockOpenGir(m, girId, user);
      const number = await wf.nextDocumentNumber(m, 'GI');
      const [gi] = await m.query(
        `INSERT INTO goods_issues (document_number, goods_issue_request_id, warehouse_id, created_by) VALUES ($1, $2, $3, $4) RETURNING id`,
        [number, girId, gir.warehouse_id, user.id],
      );
      await this.writeLines(m, gi.id, girId, gir.warehouse_id, lines);
      await this.checkGirRemaining(m, gi.id, true);
      return { id: gi.id as number, documentNumber: number };
    });
  }

  /** Replace lines and SN selection of a DRAFT/REJECTED GI (selection does not reserve; 03 §4). */
  update(user: CurrentUser, id: number, version: number, lines: GiLineInput[]) {
    return this.ds.transaction(async (m) => {
      const head = await this.peek(m, id);
      const gir = await this.lockOpenGir(m, head.goods_issue_request_id, user);
      const doc = await wf.lockDocument(m, 'GI', id);
      wf.assertCreator(doc, user);
      wf.assertStatus(doc, ['DRAFT', 'REJECTED']);
      wf.assertVersion(doc, version);
      await m.query(`DELETE FROM goods_issue_serials WHERE goods_issue_line_id IN (SELECT id FROM goods_issue_lines WHERE goods_issue_id = $1)`, [id]);
      await m.query(`DELETE FROM goods_issue_lines WHERE goods_issue_id = $1`, [id]);
      await this.writeLines(m, id, head.goods_issue_request_id, gir.warehouse_id, lines);
      await m.query(`UPDATE goods_issues SET version = version + 1, updated_at = now() WHERE id = $1`, [id]);
      await this.checkGirRemaining(m, id, true);
    });
  }

  /** Re-checks GIR remaining, available stock and SNs, then reserves — all in one transaction (03 §7, D08). */
  submit(user: CurrentUser, id: number, approverId: number) {
    return this.ds.transaction(async (m) => {
      const head = await this.peek(m, id);
      await this.lockOpenGir(m, head.goods_issue_request_id, user);
      const doc = await wf.lockDocument(m, 'GI', id);
      const items = await this.items(m, id);
      if (!items.length) throw new BusinessError('GI_EMPTY', 'The goods issue has no lines');
      for (const i of items) {
        if (i.serialTracked && i.serialDetailIds.length !== i.quantity) {
          throw new BusinessError('GI_SERIAL_COUNT_MISMATCH', `Line ${i.sourceLineId}: select exactly ${i.quantity} serial number(s)`);
        }
      }
      await wf.submit(m, 'GI', doc, user, approverId); // creator, status and approver eligibility first
      await this.checkGirRemaining(m, id, false);
      await InventoryFacade.reserve(m, doc.warehouse_id!, items);
    });
  }

  /** Reservation → issue; GIR becomes IN_PROGRESS. A repeated approve fails on status (no double issue). */
  approve(user: CurrentUser, id: number) {
    return this.ds.transaction(async (m) => {
      const head = await this.peek(m, id);
      await this.lockGir(m, head.goods_issue_request_id);
      const doc = await wf.lockDocument(m, 'GI', id);
      wf.assertWarehouse(user, doc.warehouse_id!);
      await wf.approve(m, 'GI', doc, user);
      await InventoryFacade.issue(m, doc.warehouse_id!, await this.items(m, id));
      await m.query(
        `UPDATE goods_issue_requests SET execution_status = 'IN_PROGRESS' WHERE id = $1 AND execution_status = 'NOT_STARTED'`,
        [head.goods_issue_request_id],
      );
    });
  }

  /** reject (approver) / recall (creator) release the reservation; cancel only for DRAFT/REJECTED (nothing reserved). */
  decide(action: 'reject' | 'recall' | 'cancel', user: CurrentUser, id: number, reason?: string) {
    return this.ds.transaction(async (m) => {
      const head = await this.peek(m, id);
      await this.lockGir(m, head.goods_issue_request_id);
      const doc = await wf.lockDocument(m, 'GI', id);
      wf.assertWarehouse(user, doc.warehouse_id!);
      if (action !== 'cancel' && !reason?.trim()) throw new BusinessError('REASON_REQUIRED', 'A reason is required');
      if (action === 'cancel') return wf.cancel(m, 'GI', doc, user);
      if (action === 'reject') await wf.reject(m, 'GI', doc, user, reason!);
      if (action === 'recall') await wf.recallPending(m, 'GI', doc, user, reason!);
      await InventoryFacade.release(m, doc.warehouse_id!, await this.items(m, id));
    });
  }

  async approvers(user: CurrentUser, id: number) {
    const doc = await this.peek(this.ds.manager, id);
    wf.assertWarehouse(user, doc.warehouse_id);
    return wf.eligibleApprovers(this.ds.manager, 'GI', doc.created_by, doc.warehouse_id);
  }

  /** IN_STOCK serials for a GIR line's product at the GIR warehouse (selection candidates). */
  async availableSerials(user: CurrentUser, girLineId: number) {
    const [line] = await this.ds.query(
      `SELECT l.product_id, g.warehouse_id FROM goods_issue_request_lines l JOIN goods_issue_requests g ON g.id = l.goods_issue_request_id WHERE l.id = $1`,
      [girLineId],
    );
    if (!line) throw new NotFoundException();
    wf.assertWarehouse(user, line.warehouse_id);
    return this.ds.query(
      `SELECT goods_receipt_detail_id AS "goodsReceiptDetailId", serial_number AS "serialNumber" FROM inventory_serials
        WHERE product_id = $1 AND warehouse_id = $2 AND status = 'IN_STOCK' ORDER BY serial_number`,
      [line.product_id, line.warehouse_id],
    );
  }

  list(user: CurrentUser, assignedToMe: boolean) {
    return this.ds.query(
      `SELECT g.id, g.document_number AS "documentNumber", g.approval_status AS "approvalStatus", r.document_number AS "girNumber",
              w.code AS "warehouseCode", c.full_name AS "createdByName", a.full_name AS "assignedApproverName", g.created_at AS "createdAt"
         FROM goods_issues g
         JOIN goods_issue_requests r ON r.id = g.goods_issue_request_id
         JOIN warehouses w ON w.id = g.warehouse_id
         JOIN users c ON c.id = g.created_by
         LEFT JOIN users a ON a.id = g.assigned_approver_id
        WHERE (g.warehouse_id = ANY($1) OR g.created_by = $2)
          AND (NOT $3 OR (g.approval_status = 'WAITING_FOR_APPROVE' AND g.assigned_approver_id = $2))
        ORDER BY g.id DESC`,
      [user.warehouseIds, user.id, assignedToMe],
    );
  }

  async get(user: CurrentUser, id: number) {
    const [gi] = await this.ds.query(
      `SELECT g.id, g.document_number AS "documentNumber", g.approval_status AS "approvalStatus", g.version, g.warehouse_id AS "warehouseId",
              g.goods_issue_request_id AS "goodsIssueRequestId", r.document_number AS "girNumber", r.execution_status AS "girExecutionStatus",
              w.code AS "warehouseCode", g.created_by AS "createdBy", c.full_name AS "createdByName",
              g.assigned_approver_id AS "assignedApproverId", a.full_name AS "assignedApproverName", g.created_at AS "createdAt"
         FROM goods_issues g
         JOIN goods_issue_requests r ON r.id = g.goods_issue_request_id
         JOIN warehouses w ON w.id = g.warehouse_id
         JOIN users c ON c.id = g.created_by
         LEFT JOIN users a ON a.id = g.assigned_approver_id
        WHERE g.id = $1`,
      [id],
    );
    if (!gi) throw new NotFoundException();
    if (!user.warehouseIds.includes(gi.warehouseId) && gi.createdBy !== user.id) throw new ForbiddenException('Warehouse is outside your scope');
    const lines = await this.ds.query(
      `SELECT l.id, l.goods_issue_request_line_id AS "goodsIssueRequestLineId", p.part_number AS "partNumber", p.name AS "productName",
              p.is_serial_tracked AS "isSerialTracked", u.code AS uom, l.quantity,
              COALESCE((SELECT json_agg(json_build_object('goodsReceiptDetailId', s.goods_receipt_detail_id, 'serialNumber', s.serial_number) ORDER BY s.id)
                          FROM goods_issue_serials s WHERE s.goods_issue_line_id = l.id), '[]') AS serials
         FROM goods_issue_lines l JOIN products p ON p.id = l.product_id JOIN units_of_measure u ON u.id = p.unit_of_measure_id
        WHERE l.goods_issue_id = $1 ORDER BY l.id`,
      [id],
    );
    return { ...gi, lines, history: await wf.history(this.ds.manager, 'GI', id) };
  }

  // ---------- internals ----------

  private async peek(m: EntityManager, id: number) {
    const [doc] = await m.query(`SELECT * FROM goods_issues WHERE id = $1`, [id]);
    if (!doc) throw new NotFoundException(`GI ${id} not found`);
    return doc as { goods_issue_request_id: number; warehouse_id: number; created_by: number };
  }

  private async lockGir(m: EntityManager, girId: number) {
    const [gir] = await m.query(`SELECT approval_status, execution_status, warehouse_id FROM goods_issue_requests WHERE id = $1 FOR UPDATE`, [girId]);
    if (!gir) throw new NotFoundException('GIR not found');
    return gir as { approval_status: string; execution_status: string; warehouse_id: number };
  }

  /** GIR must be APPROVED and not COMPLETED to create/edit/submit GIs (03 §10.3). */
  private async lockOpenGir(m: EntityManager, girId: number, user: CurrentUser) {
    const gir = await this.lockGir(m, girId);
    wf.assertWarehouse(user, gir.warehouse_id);
    if (gir.approval_status !== 'APPROVED') throw new BusinessError('SOURCE_NOT_APPROVED', 'Goods issues need an APPROVED request');
    if (gir.execution_status === 'COMPLETED') throw new BusinessError('GIR_COMPLETED', 'The request is completed; no new goods issues', HttpStatus.CONFLICT);
    return gir;
  }

  private async writeLines(m: EntityManager, giId: number, girId: number, warehouseId: number, lines: GiLineInput[]) {
    for (const l of lines) {
      if (!Number.isInteger(l.quantity) || l.quantity <= 0) throw new BusinessError('INVALID_QUANTITY', 'Issue quantity must be a positive whole number');
      const [gl] = await m.query(
        `SELECT l.product_id, p.is_serial_tracked FROM goods_issue_request_lines l JOIN products p ON p.id = l.product_id
          WHERE l.id = $1 AND l.goods_issue_request_id = $2`,
        [l.goodsIssueRequestLineId, girId],
      );
      if (!gl) throw new BusinessError('SOURCE_LINE_MISMATCH', `GIR line ${l.goodsIssueRequestLineId} does not belong to the request`);
      await ProductUsage.markUsed(m, gl.product_id, { stock: true });
      const [line] = await m.query(
        `INSERT INTO goods_issue_lines (goods_issue_id, goods_issue_request_line_id, product_id, quantity) VALUES ($1, $2, $3, $4) RETURNING id`,
        [giId, l.goodsIssueRequestLineId, gl.product_id, l.quantity],
      );
      const detailIds = [...new Set(l.goodsReceiptDetailIds ?? [])];
      if (!gl.is_serial_tracked && detailIds.length) throw new BusinessError('SERIAL_NOT_TRACKED', 'This product is not serial tracked');
      if (detailIds.length > l.quantity) throw new BusinessError('GI_SERIAL_COUNT_MISMATCH', 'More serial numbers selected than the quantity');
      if (!detailIds.length) continue;
      // FOR SHARE on the serials: serializes with GR recall and with other GIs reserving them (B26).
      const serials: { goods_receipt_detail_id: number; serial_number: string; product_id: number; warehouse_id: number; status: string }[] = await m.query(
        `SELECT goods_receipt_detail_id, serial_number, product_id, warehouse_id, status FROM inventory_serials
          WHERE goods_receipt_detail_id = ANY($1) ORDER BY id FOR SHARE`,
        [detailIds],
      );
      for (const d of detailIds) {
        const s = serials.find((x) => x.goods_receipt_detail_id === d);
        // An SN only on a GR detail (pending/recalled GR) is not available (03 §4, D10).
        if (!s || s.product_id !== gl.product_id || s.warehouse_id !== warehouseId || s.status !== 'IN_STOCK') {
          throw new BusinessError('SN_NOT_AVAILABLE', `Serial ${s?.serial_number ?? `#${d}`} is not available for this product in this warehouse`, HttpStatus.CONFLICT);
        }
        await m.query(`INSERT INTO goods_issue_serials (goods_issue_line_id, goods_receipt_detail_id, serial_number) VALUES ($1, $2, $3)`, [
          line.id, d, s.serial_number,
        ]);
      }
    }
  }

  /** Σ GI (WAITING + APPROVED, plus this GI when `includeThis`) per GIR line ≤ GIR line quantity (03 §4). */
  private async checkGirRemaining(m: EntityManager, giId: number, includeThis: boolean) {
    const rows: { id: number; quantity: string; used: string }[] = await m.query(
      `SELECT rl.id, rl.quantity, COALESCE(SUM(gl.quantity) FILTER (
                WHERE g.approval_status IN ('WAITING_FOR_APPROVE', 'APPROVED') OR ($2 AND g.id = $1)), 0) AS used
         FROM goods_issue_request_lines rl
         LEFT JOIN goods_issue_lines gl ON gl.goods_issue_request_line_id = rl.id
         LEFT JOIN goods_issues g ON g.id = gl.goods_issue_id
        WHERE rl.id IN (SELECT goods_issue_request_line_id FROM goods_issue_lines WHERE goods_issue_id = $1)
        GROUP BY rl.id, rl.quantity`,
      [giId, includeThis],
    );
    const over = rows.find((r) => Number(r.used) > Number(r.quantity));
    if (over) throw new BusinessError('GIR_QUANTITY_EXCEEDED', `GIR line ${over.id}: ${Number(over.used)} > requested ${Number(over.quantity)}`);
  }

  private async items(m: EntityManager, giId: number): Promise<(IssueItem & { serialTracked: boolean })[]> {
    const rows: { id: number; product_id: number; quantity: string; is_serial_tracked: boolean; details: number[] | null }[] = await m.query(
      `SELECT l.id, l.product_id, l.quantity, p.is_serial_tracked,
              (SELECT array_agg(s.goods_receipt_detail_id ORDER BY s.goods_receipt_detail_id) FROM goods_issue_serials s WHERE s.goods_issue_line_id = l.id) AS details
         FROM goods_issue_lines l JOIN products p ON p.id = l.product_id WHERE l.goods_issue_id = $1 ORDER BY l.id`,
      [giId],
    );
    return rows.map((r) => ({
      productId: r.product_id, quantity: Number(r.quantity), sourceLineId: r.id, serialTracked: r.is_serial_tracked, serialDetailIds: r.details ?? [],
    }));
  }
}
