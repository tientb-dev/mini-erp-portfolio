import { ForbiddenException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import type { CurrentUser } from '../identity/auth';
import { InventoryFacade, normalizeSerial } from '../inventory/inventory.service';
import { ProcurementFacade } from '../procurement/procurement.service';
import { SalesContractFacade } from '../sales-contracts/sales-contracts.service';
import { ProductUsage } from '../master-data/product-usage';
import * as wf from '../workflow/workflow';
import { BusinessError } from '../workflow/workflow';

export interface SourceLineInput { id?: number; sourceLineId: number; quantity: number }

/** First approved GR of a PR line (reference shown on GIR A/C lines, 03 §3a). */
export interface FirstReceipt { goodsReceiptId: number; documentNumber: string; warehouseId: number; warehouseCode: string; approvedAt: Date }

/**
 * Facade for Outbound (read only; Inbound never depends on Outbound). Computed from the documents, nothing stored:
 * only GRs APPROVED now count, so a recalled GR disappears and the next one takes its place.
 */
export class InboundFacade {
  /** Per PR line: the APPROVED GR with the earliest approval in effect (approved_at, then GR id) through GR → GRR → PO line. */
  static async firstReceipts(m: EntityManager, purchaseRequisitionLineIds: number[]): Promise<Map<number, FirstReceipt>> {
    if (!purchaseRequisitionLineIds.length) return new Map();
    const rows: (FirstReceipt & { prLineId: number })[] = await m.query(
      `SELECT DISTINCT ON (pol.purchase_requisition_line_id)
              pol.purchase_requisition_line_id AS "prLineId", gr.id AS "goodsReceiptId", gr.document_number AS "documentNumber",
              gr.warehouse_id AS "warehouseId", w.code AS "warehouseCode", gr.approved_at AS "approvedAt"
         FROM purchase_order_lines pol
         JOIN goods_receipt_request_lines grrl ON grrl.purchase_order_line_id = pol.id
         JOIN goods_receipt_lines grl ON grl.goods_receipt_request_line_id = grrl.id
         JOIN goods_receipts gr ON gr.id = grl.goods_receipt_id AND gr.approval_status = 'APPROVED'
         JOIN warehouses w ON w.id = gr.warehouse_id
        WHERE pol.purchase_requisition_line_id = ANY($1)
        ORDER BY pol.purchase_requisition_line_id, gr.approved_at, gr.id`,
      [purchaseRequisitionLineIds],
    );
    return new Map(rows.map(({ prLineId, ...r }) => [prLineId, r]));
  }
}
export interface DetailInput { id: number; serialNumber?: string | null; location?: string | null; warrantyInfo?: string | null }

/** GRR and GR (03 §1, §2). */
@Injectable()
export class InboundService {
  constructor(private readonly ds: DataSource) {}

  // ---------- GRR ----------

  /** GRR from one APPROVED PO and one warehouse; lines inherit PO line UoM (T7). */
  createGrr(user: CurrentUser, purchaseOrderId: number, warehouseId: number, lines: { sourceLineId: number; quantity: number }[]) {
    wf.assertWarehouse(user, warehouseId);
    return this.ds.transaction(async (m) => {
      const [po] = await m.query(`SELECT approval_status FROM purchase_orders WHERE id = $1 FOR SHARE`, [purchaseOrderId]);
      if (!po) throw new NotFoundException('PO not found');
      if (po.approval_status !== 'APPROVED') throw new BusinessError('SOURCE_NOT_APPROVED', 'GRR requires an APPROVED PO');
      const number = await wf.nextDocumentNumber(m, 'GRR');
      const [grr] = await m.query(
        `INSERT INTO goods_receipt_requests (document_number, purchase_order_id, warehouse_id, created_by) VALUES ($1, $2, $3, $4) RETURNING id`,
        [number, purchaseOrderId, warehouseId, user.id],
      );
      for (const l of lines) await this.writeGrrLine(m, grr.id, purchaseOrderId, l);
      await this.checkGrrLimits(m, grr.id, true);
      return { id: grr.id as number, documentNumber: number };
    });
  }

  /** New line: must be a line of the GRR PO, UoM inherited (T7). Existing line: only the quantity changes. */
  private async writeGrrLine(m: EntityManager, grrId: number, purchaseOrderId: number, l: SourceLineInput) {
    if (l.id) {
      wf.assertLineUpdated(await m.query(
        `UPDATE goods_receipt_request_lines SET quantity = $4 WHERE id = $1 AND goods_receipt_request_id = $2 AND purchase_order_line_id = $3`,
        [l.id, grrId, l.sourceLineId, l.quantity],
      ), l.id);
      return;
    }
    const [pol] = await m.query(
      `SELECT pol.unit_of_measure_id, prl.product_id FROM purchase_order_lines pol
         JOIN purchase_requisition_lines prl ON prl.id = pol.purchase_requisition_line_id
        WHERE pol.id = $1 AND pol.purchase_order_id = $2`,
      [l.sourceLineId, purchaseOrderId],
    );
    if (!pol) throw new BusinessError("SOURCE_LINE_MISMATCH", `PO line ${l.sourceLineId} does not belong to the PO`);
    await ProductUsage.markUsed(m, pol.product_id, { stock: true }); // product now appears on a GRR (03 §1b)
    await m.query(
      `INSERT INTO goods_receipt_request_lines (goods_receipt_request_id, purchase_order_line_id, unit_of_measure_id, quantity) VALUES ($1, $2, $3, $4)`,
      [grrId, l.sourceLineId, pol.unit_of_measure_id, l.quantity],
    );
  }

  /**
   * Edit a DRAFT/REJECTED GRR by its creator: line quantities, add/remove PO lines. PO and warehouse stay the same.
   * Σ GRR ≤ PO is re-checked under the PO line locks (03 §1); the PO must still be APPROVED (source re-check).
   */
  updateGrr(user: CurrentUser, id: number, version: number, lines: SourceLineInput[]) {
    return this.ds.transaction(async (m) => {
      const doc = await wf.lockDocument(m, "GRR", id);
      wf.assertWarehouse(user, doc.warehouse_id!);
      wf.assertEditable(doc, user, version);
      const [{ purchase_order_id: poId }] = await m.query(`SELECT purchase_order_id FROM goods_receipt_requests WHERE id = $1`, [id]);
      await this.checkGrrSource(m, id);
      await wf.deleteOmittedLines(m, "goods_receipt_request_lines", "goods_receipt_request_id", id, lines.flatMap((l) => (l.id ? [l.id] : [])));
      for (const l of lines) await this.writeGrrLine(m, id, poId, l);
      await this.checkGrrLimits(m, id, true);
      await wf.markEdited(m, "GRR", id, user.id);
    });
  }

  /** Σ GRR (WAITING + APPROVED) per PO line ≤ PO line quantity, PO lines locked in id order (03 §1, ADR-0003). */
  private async checkGrrLimits(m: EntityManager, grrId: number, includeThis: boolean) {
    const rows: { id: number; quantity: string; used: string }[] = await m.query(
      `WITH locked AS (
         SELECT pol.id, pol.quantity FROM purchase_order_lines pol
          WHERE pol.id IN (SELECT purchase_order_line_id FROM goods_receipt_request_lines WHERE goods_receipt_request_id = $1)
          ORDER BY pol.id FOR UPDATE)
       SELECT l.id, l.quantity, COALESCE(SUM(gl.quantity) FILTER (
                WHERE g.approval_status IN ('WAITING_FOR_APPROVE', 'APPROVED') OR ($2 AND g.id = $1)), 0) AS used
         FROM locked l
         LEFT JOIN goods_receipt_request_lines gl ON gl.purchase_order_line_id = l.id
         LEFT JOIN goods_receipt_requests g ON g.id = gl.goods_receipt_request_id
        GROUP BY l.id, l.quantity`,
      [grrId, includeThis],
    );
    const over = rows.find((r) => Number(r.used) > Number(r.quantity));
    if (over) throw new BusinessError('QUANTITY_LIMIT_EXCEEDED', `GRR quantity exceeds PO line ${over.id} (${over.used} > ${over.quantity})`);
  }

  /** Every GRR line needs a main product whose UoM equals the line UoM (T1, T8). */
  private async checkGrrProducts(m: EntityManager, grrId: number) {
    const [bad] = await m.query(
      `SELECT gl.id FROM goods_receipt_request_lines gl
         JOIN purchase_order_lines pol ON pol.id = gl.purchase_order_line_id
         JOIN purchase_requisition_lines prl ON prl.id = pol.purchase_requisition_line_id
         JOIN products p ON p.id = prl.product_id
        WHERE gl.goods_receipt_request_id = $1 AND p.unit_of_measure_id <> gl.unit_of_measure_id`,
      [grrId],
    );
    if (bad) throw new BusinessError('GRR_LINE_UOM_MISMATCH', `GRR line ${bad.id}: UoM differs from the product UoM`);
  }

  submitGrr(id: number, user: CurrentUser, approverId: number) {
    return this.ds.transaction(async (m) => {
      const doc = await wf.lockDocument(m, 'GRR', id);
      wf.assertWarehouse(user, doc.warehouse_id!);
      await this.checkGrrSource(m, id);
      await this.checkGrrLimits(m, id, true);
      await this.checkGrrProducts(m, id);
      await wf.submit(m, 'GRR', doc, user, approverId);
    });
  }

  approveGrr(id: number, user: CurrentUser) {
    return this.ds.transaction(async (m) => {
      const doc = await wf.lockDocument(m, 'GRR', id);
      wf.assertWarehouse(user, doc.warehouse_id!);
      await this.checkGrrSource(m, id);
      await this.checkGrrLimits(m, id, false);
      await this.checkGrrProducts(m, id);
      await wf.approve(m, 'GRR', doc, user);
    });
  }

  /** APPROVED GRRs in the caller's warehouses that have no non-canceled GR yet. */
  grrsAvailableForGr(user: CurrentUser) {
    return this.ds.query(
      `SELECT g.id, g.document_number AS "documentNumber", w.code AS "warehouseCode", po.document_number AS "poNumber"
         FROM goods_receipt_requests g
         JOIN warehouses w ON w.id = g.warehouse_id
         JOIN purchase_orders po ON po.id = g.purchase_order_id
        WHERE g.approval_status = 'APPROVED' AND g.warehouse_id = ANY($1)
          AND NOT EXISTS (SELECT 1 FROM goods_receipts r WHERE r.goods_receipt_request_id = g.id AND r.approval_status <> 'CANCELED')
        ORDER BY g.id DESC`,
      [user.warehouseIds],
    );
  }

  // ---------- GR ----------

  /** GR inherits lines, product, quantity and warehouse from an APPROVED GRR; details are split per 03 §2. */
  createGr(user: CurrentUser, grrId: number) {
    return this.ds.transaction(async (m) => {
      const [grr] = await m.query(`SELECT approval_status, warehouse_id FROM goods_receipt_requests WHERE id = $1 FOR SHARE`, [grrId]);
      if (!grr) throw new NotFoundException('GRR not found');
      wf.assertWarehouse(user, grr.warehouse_id);
      if (grr.approval_status !== 'APPROVED') throw new BusinessError('SOURCE_NOT_APPROVED', 'GR requires an APPROVED GRR');
      const [active] = await m.query(`SELECT 1 FROM goods_receipts WHERE goods_receipt_request_id = $1 AND approval_status <> 'CANCELED'`, [grrId]);
      if (active) throw new BusinessError('GR_ALREADY_EXISTS', 'This GRR already has a non-canceled GR', HttpStatus.CONFLICT);

      const number = await wf.nextDocumentNumber(m, 'GR');
      const [gr] = await m.query(
        `INSERT INTO goods_receipts (document_number, goods_receipt_request_id, warehouse_id, created_by) VALUES ($1, $2, $3, $4) RETURNING id`,
        [number, grrId, grr.warehouse_id, user.id],
      );
      const lines: { id: number; product_id: number; unit_of_measure_id: number; quantity: string; is_serial_tracked: boolean }[] = await m.query(
        `SELECT gl.id, prl.product_id, gl.unit_of_measure_id, gl.quantity, p.is_serial_tracked
           FROM goods_receipt_request_lines gl
           JOIN purchase_order_lines pol ON pol.id = gl.purchase_order_line_id
           JOIN purchase_requisition_lines prl ON prl.id = pol.purchase_requisition_line_id
           JOIN products p ON p.id = prl.product_id
          WHERE gl.goods_receipt_request_id = $1 ORDER BY gl.id`,
        [grrId],
      );
      for (const l of lines) {
        await ProductUsage.markUsed(m, l.product_id, { stock: true });
        const [grl] = await m.query(
          `INSERT INTO goods_receipt_lines (goods_receipt_id, goods_receipt_request_line_id, product_id, unit_of_measure_id, quantity)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [gr.id, l.id, l.product_id, l.unit_of_measure_id, l.quantity],
        );
        if (l.is_serial_tracked) {
          const units = Number(l.quantity);
          if (!Number.isInteger(units)) throw new BusinessError('SERIAL_QUANTITY_NOT_INTEGER', 'Serial-tracked quantity must be a whole number');
          // N units = N detail rows with quantity 1; SNs are declared later.
          await m.query(`INSERT INTO goods_receipt_details (goods_receipt_line_id, quantity) SELECT $1, 1 FROM generate_series(1, $2)`, [grl.id, units]);
        } else {
          await m.query(`INSERT INTO goods_receipt_details (goods_receipt_line_id, quantity) VALUES ($1, $2)`, [grl.id, l.quantity]);
        }
      }
      return { id: gr.id as number, documentNumber: number };
    });
  }

  /** Creator or a GR.DECLARE_DETAILS user of the warehouse may edit details of DRAFT/REJECTED GRs (04 §1). */
  updateGrDetails(id: number, user: CurrentUser, version: number, details: DetailInput[]) {
    return this.ds.transaction(async (m) => {
      const doc = await wf.lockDocument(m, 'GR', id);
      wf.assertWarehouse(user, doc.warehouse_id!);
      if (doc.created_by !== user.id && !user.permissions.includes('GR.DECLARE_DETAILS')) {
        throw new ForbiddenException('Only the creator or a GR detail declarer may edit details');
      }
      wf.assertStatus(doc, ['DRAFT', 'REJECTED']);
      wf.assertVersion(doc, version);
      for (const d of details) {
        const [row] = await m.query(
          `SELECT p.is_serial_tracked FROM goods_receipt_details d
             JOIN goods_receipt_lines l ON l.id = d.goods_receipt_line_id
             JOIN products p ON p.id = l.product_id
            WHERE d.id = $1 AND l.goods_receipt_id = $2`,
          [d.id, id],
        );
        if (!row) throw new BusinessError('DETAIL_NOT_FOUND', `Detail ${d.id} does not belong to this GR`);
        const sn = row.is_serial_tracked && d.serialNumber?.trim() ? d.serialNumber.trim() : null;
        await m.query(
          `UPDATE goods_receipt_details SET serial_number = $2, normalized_serial_number = $3, location = $4, warranty_info = $5,
             updated_by = $6, updated_at = now() WHERE id = $1`,
          [d.id, sn, sn && normalizeSerial(sn), d.location ?? null, d.warrantyInfo ?? null, user.id],
        );
      }
      await m.query(`UPDATE goods_receipts SET version = version + 1, updated_at = now() WHERE id = $1`, [id]);
    });
  }

  /** Whole-document SN check: complete, unique within the GR, not already in inventory (03 §2, R5). */
  private async checkGrSerials(m: EntityManager, id: number) {
    const rows: { product_id: number; is_serial_tracked: boolean; serial_number: string | null; normalized_serial_number: string | null }[] = await m.query(
      `SELECT l.product_id, p.is_serial_tracked, d.serial_number, d.normalized_serial_number
         FROM goods_receipt_details d
         JOIN goods_receipt_lines l ON l.id = d.goods_receipt_line_id
         JOIN products p ON p.id = l.product_id
        WHERE l.goods_receipt_id = $1`,
      [id],
    );
    const tracked = rows.filter((r) => r.is_serial_tracked);
    if (tracked.some((r) => !r.normalized_serial_number)) throw new BusinessError('GR_SERIAL_MISSING', 'Every serial-tracked unit needs a serial number');
    const keys = tracked.map((r) => `${r.product_id}|${r.normalized_serial_number}`);
    const dup = keys.find((k, i) => keys.indexOf(k) !== i);
    if (dup) throw new BusinessError('GR_SERIAL_DUPLICATE', `Serial ${dup.split('|')[1]} appears more than once in this GR`);
    const existing = await InventoryFacade.existingSerials(m, tracked.map((r) => ({ productId: r.product_id, normalized: r.normalized_serial_number! })));
    if (existing.length) throw new BusinessError('SN_ALREADY_RECEIVED', `Serial(s) already received: ${existing.join(', ')}`, HttpStatus.CONFLICT);
  }

  submitGr(id: number, user: CurrentUser, approverId: number) {
    return this.ds.transaction(async (m) => {
      const doc = await wf.lockDocument(m, 'GR', id);
      wf.assertWarehouse(user, doc.warehouse_id!);
      await this.checkGrSerials(m, id);
      await wf.submit(m, 'GR', doc, user, approverId);
    });
  }

  /**
   * Approve GR: status, inventory balances, movements and serials in ONE transaction. A duplicate SN
   * (e.g. another GR approved first, R3) throws and rolls everything back; the GR stays WAITING_FOR_APPROVE.
   */
  approveGr(id: number, user: CurrentUser) {
    return this.ds.transaction(async (m) => {
      const doc = await wf.lockDocument(m, 'GR', id);
      wf.assertWarehouse(user, doc.warehouse_id!);
      // Validates WAITING_FOR_APPROVE + assigned approver first; approved_at (FIFO key, ADR-0013) is set in the same UPDATE.
      await wf.approve(m, 'GR', doc, user, ', approved_at = now()');
      await this.checkGrSerials(m, id);
      const lines: { id: number; product_id: number; quantity: string; purchase_order_line_id: number }[] = await m.query(
        `SELECT l.id, l.product_id, l.quantity, rl.purchase_order_line_id FROM goods_receipt_lines l
           JOIN goods_receipt_request_lines rl ON rl.id = l.goods_receipt_request_line_id WHERE l.goods_receipt_id = $1 ORDER BY l.id`,
        [id],
      );
      await ProcurementFacade.applyReceipt(m, lines.map((l) => ({ purchaseOrderLineId: l.purchase_order_line_id, quantity: l.quantity })), 1);
      // Lot provenance (ADR-0013): source HĐ via the PR, responsible sales captured now and immutable afterwards.
      const sourceContract = await ProcurementFacade.sourceContracts(m, lines.map((l) => l.purchase_order_line_id));
      const owner = await SalesContractFacade.responsibleSales(m, [...sourceContract.values()]);
      const details: { id: number; goods_receipt_line_id: number; serial_number: string | null; normalized_serial_number: string | null }[] =
        await m.query(
          `SELECT d.id, d.goods_receipt_line_id, d.serial_number, d.normalized_serial_number FROM goods_receipt_details d
             JOIN goods_receipt_lines l ON l.id = d.goods_receipt_line_id WHERE l.goods_receipt_id = $1`,
          [id],
        );
      await InventoryFacade.receive(
        m,
        lines.map((l) => ({
          warehouseId: doc.warehouse_id!,
          productId: l.product_id,
          quantity: l.quantity,
          sourceDocumentType: 'GR',
          sourceLineId: l.id,
          sourceSalesContractId: sourceContract.get(l.purchase_order_line_id)!,
          ownerUserId: owner.get(sourceContract.get(l.purchase_order_line_id)!)!,
          serials: details
            .filter((d) => d.goods_receipt_line_id === l.id && d.serial_number)
            .map((d) => ({ goodsReceiptDetailId: d.id, serialNumber: d.serial_number!, normalizedSerialNumber: d.normalized_serial_number! })),
        })),
      );
    });
  }

  decideGr(action: 'reject' | 'recall' | 'cancel', id: number, user: CurrentUser, reason?: string) {
    return this.ds.transaction(async (m) => {
      const doc = await wf.lockDocument(m, 'GR', id);
      wf.assertWarehouse(user, doc.warehouse_id!);
      if (action !== 'cancel' && !reason?.trim()) throw new BusinessError('REASON_REQUIRED', 'A reason is required');
      if (action === 'reject') await wf.reject(m, 'GR', doc, user, reason!);
      if (action === 'recall') await wf.recallPending(m, 'GR', doc, user, reason!);
      if (action === 'cancel') await wf.cancel(m, 'GR', doc, user);
    });
  }

  grApprovers(id: number, user: CurrentUser) {
    return this.ds.transaction(async (m) => {
      const [doc] = await m.query(`SELECT created_by, warehouse_id FROM goods_receipts WHERE id = $1`, [id]);
      if (!doc) throw new NotFoundException();
      wf.assertWarehouse(user, doc.warehouse_id);
      return wf.eligibleApprovers(m, 'GR', doc.created_by, doc.warehouse_id);
    });
  }

  grrApprovers(id: number, user: CurrentUser) {
    return this.ds.transaction(async (m) => {
      const [doc] = await m.query(`SELECT created_by, warehouse_id FROM goods_receipt_requests WHERE id = $1`, [id]);
      if (!doc) throw new NotFoundException();
      wf.assertWarehouse(user, doc.warehouse_id);
      return wf.eligibleApprovers(m, 'GRR', doc.created_by, doc.warehouse_id);
    });
  }

  /** GRs in the caller's warehouses; `assignedToMe` = "Chờ tôi duyệt" (P3). */
  listGrs(user: CurrentUser, assignedToMe: boolean) {
    return this.ds.query(
      `SELECT r.id, r.document_number AS "documentNumber", r.approval_status AS "approvalStatus", r.version,
              g.document_number AS "grrNumber", w.code AS "warehouseCode", c.full_name AS "createdByName",
              a.full_name AS "assignedApproverName", r.created_at AS "createdAt"
         FROM goods_receipts r
         JOIN goods_receipt_requests g ON g.id = r.goods_receipt_request_id
         JOIN warehouses w ON w.id = r.warehouse_id
         JOIN users c ON c.id = r.created_by
         LEFT JOIN users a ON a.id = r.assigned_approver_id
        WHERE (r.warehouse_id = ANY($1) OR r.created_by = $2)
          AND (NOT $3 OR (r.approval_status = 'WAITING_FOR_APPROVE' AND r.assigned_approver_id = $2))
        ORDER BY r.id DESC`,
      [user.warehouseIds, user.id, assignedToMe],
    );
  }

  async getGr(id: number, user: CurrentUser) {
    const [gr] = await this.ds.query(
      `SELECT r.id, r.document_number AS "documentNumber", r.approval_status AS "approvalStatus", r.version, r.warehouse_id AS "warehouseId",
              r.created_by AS "createdBy", r.assigned_approver_id AS "assignedApproverId",
              g.document_number AS "grrNumber", po.document_number AS "poNumber", w.code AS "warehouseCode",
              c.full_name AS "createdByName", a.full_name AS "assignedApproverName", r.created_at AS "createdAt"
         FROM goods_receipts r
         JOIN goods_receipt_requests g ON g.id = r.goods_receipt_request_id
         JOIN purchase_orders po ON po.id = g.purchase_order_id
         JOIN warehouses w ON w.id = r.warehouse_id
         JOIN users c ON c.id = r.created_by
         LEFT JOIN users a ON a.id = r.assigned_approver_id
        WHERE r.id = $1`,
      [id],
    );
    if (!gr) throw new NotFoundException();
    if (!user.warehouseIds.includes(gr.warehouseId) && gr.createdBy !== user.id) throw new ForbiddenException('Warehouse is outside your scope');
    const lines = await this.ds.query(
      `SELECT l.id, p.part_number AS "partNumber", p.name AS "productName", p.is_serial_tracked AS "isSerialTracked",
              u.code AS "uom", l.quantity
         FROM goods_receipt_lines l JOIN products p ON p.id = l.product_id JOIN units_of_measure u ON u.id = l.unit_of_measure_id
        WHERE l.goods_receipt_id = $1 ORDER BY l.id`,
      [id],
    );
    const details = await this.ds.query(
      `SELECT d.id, d.goods_receipt_line_id AS "lineId", d.quantity, d.serial_number AS "serialNumber", d.location,
              d.warranty_info AS "warrantyInfo"
         FROM goods_receipt_details d JOIN goods_receipt_lines l ON l.id = d.goods_receipt_line_id
        WHERE l.goods_receipt_id = $1 ORDER BY d.id`,
      [id],
    );
    const histories = await wf.history(this.ds.manager, 'GR', id);
    return { ...gr, lines, details, history: histories };
  }

  /** GRR source re-check (03 §7): the PO must still be APPROVED; locked for share against a concurrent PO recall/cancel. */
  private async checkGrrSource(m: EntityManager, grrId: number) {
    const [po] = await m.query(
      `SELECT document_number, approval_status FROM purchase_orders
        WHERE id = (SELECT purchase_order_id FROM goods_receipt_requests WHERE id = $1) FOR SHARE`,
      [grrId],
    );
    if (po.approval_status !== 'APPROVED') throw new BusinessError('SOURCE_NOT_APPROVED', `PO ${po.document_number} is no longer APPROVED`);
  }

  /** Reject / recall / cancel GRR; an APPROVED GRR needs no non-canceled GR (03 §6). */
  decideGrr(action: 'reject' | 'recall' | 'cancel', id: number, user: CurrentUser, reason?: string) {
    return this.ds.transaction(async (m) => {
      const doc = await wf.lockDocument(m, 'GRR', id);
      wf.assertWarehouse(user, doc.warehouse_id!);
      await wf.decide(m, 'GRR', doc, user, action, reason, async () =>
        (await m.query(`SELECT 1 FROM goods_receipts WHERE goods_receipt_request_id = $1 AND approval_status <> 'CANCELED' LIMIT 1`, [id])).length > 0);
    });
  }

  /** GRRs in the caller's warehouses (or created by / assigned to the caller). */
  listGrrs(user: CurrentUser, assignedToMe: boolean) {
    return this.ds.query(
      `SELECT ${wf.DOC_COLUMNS}, po.document_number AS "poNumber", w.code AS "warehouseCode"
         FROM goods_receipt_requests d JOIN purchase_orders po ON po.id = d.purchase_order_id JOIN warehouses w ON w.id = d.warehouse_id
        WHERE (d.warehouse_id = ANY($1) OR d.created_by = $2 OR d.assigned_approver_id = $2)
          AND (NOT $3 OR (d.approval_status = 'WAITING_FOR_APPROVE' AND d.assigned_approver_id = $2))
        ORDER BY d.id DESC`,
      [user.warehouseIds, user.id, assignedToMe],
    );
  }

  async getGrr(id: number, user: CurrentUser) {
    const [grr] = await this.ds.query(
      `SELECT ${wf.DOC_COLUMNS}, d.warehouse_id AS "warehouseId", d.purchase_order_id AS "purchaseOrderId", po.document_number AS "poNumber", sp.name AS "supplierName", w.code AS "warehouseCode"
         FROM goods_receipt_requests d JOIN purchase_orders po ON po.id = d.purchase_order_id
         JOIN suppliers sp ON sp.id = po.supplier_id JOIN warehouses w ON w.id = d.warehouse_id
        WHERE d.id = $1`,
      [id],
    );
    if (!grr) throw new NotFoundException();
    if (!user.warehouseIds.includes(grr.warehouseId) && grr.createdBy !== user.id && grr.assignedApproverId !== user.id) {
      throw new ForbiddenException('Warehouse is outside your scope');
    }
    const lines = await this.ds.query(
      `SELECT l.id, l.purchase_order_line_id AS "sourceLineId", pr.document_number AS "ref", p.part_number AS "partNumber",
              p.name AS "productName", u.code AS uom, l.quantity
         FROM goods_receipt_request_lines l
         JOIN purchase_order_lines pol ON pol.id = l.purchase_order_line_id
         JOIN purchase_requisition_lines prl ON prl.id = pol.purchase_requisition_line_id
         JOIN purchase_requisitions pr ON pr.id = prl.purchase_requisition_id
         JOIN products p ON p.id = prl.product_id
         JOIN units_of_measure u ON u.id = l.unit_of_measure_id
        WHERE l.goods_receipt_request_id = $1 ORDER BY l.id`,
      [id],
    );
    const children = await this.ds.query(
      `SELECT id, document_number AS "documentNumber", approval_status AS "approvalStatus" FROM goods_receipts WHERE goods_receipt_request_id = $1 ORDER BY id`,
      [id],
    );
    return { ...grr, lines, children, history: await wf.history(this.ds.manager, 'GRR', id) };
  }

  /** PO lines with quantity not yet covered by WAITING/APPROVED GRRs, for the GRR form (APPROVED POs only). */
  poLinesAvailableForGrr(purchaseOrderId: number) {
    return this.ds.query(
      `SELECT * FROM (
         SELECT l.id, pr.document_number AS "prNumber", p.part_number AS "partNumber", p.name AS "productName", u.code AS uom, l.quantity,
                l.quantity - COALESCE((SELECT SUM(gl.quantity) FROM goods_receipt_request_lines gl JOIN goods_receipt_requests g ON g.id = gl.goods_receipt_request_id
                                        WHERE gl.purchase_order_line_id = l.id AND g.approval_status IN ('WAITING_FOR_APPROVE', 'APPROVED')), 0) AS remaining
           FROM purchase_order_lines l
           JOIN purchase_orders po ON po.id = l.purchase_order_id
           JOIN purchase_requisition_lines prl ON prl.id = l.purchase_requisition_line_id
           JOIN purchase_requisitions pr ON pr.id = prl.purchase_requisition_id
           JOIN products p ON p.id = prl.product_id
           JOIN units_of_measure u ON u.id = l.unit_of_measure_id
          WHERE l.purchase_order_id = $1 AND po.approval_status = 'APPROVED') x
        WHERE remaining > 0 ORDER BY id`,
      [purchaseOrderId],
    );
  }
}
