import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import type { CurrentUser } from '../identity/auth';
import { ProductUsage } from '../master-data/product-usage';
import { SalesContractFacade } from "../sales-contracts/sales-contracts.service";
import * as wf from '../workflow/workflow';
import { BusinessError } from '../workflow/workflow';

export interface PrLineInput { salesContractLineId: number; productId: number; quantity: number }
export interface SourceLineInput { sourceLineId: number; quantity: number }

/**
 * Upstream of GR (PR → PO). Minimal by design for the GR slice: main products only (no temporary
 * products/mapping yet), one-level approval, quantity limits re-checked at submit and approve.
 */
@Injectable()
export class ProcurementService {
  constructor(private readonly ds: DataSource) {}

  createPurchaseRequisition(user: CurrentUser, salesContractId: number, lines: PrLineInput[]) {
    return this.ds.transaction(async (m) => {
      await SalesContractFacade.lockActiveLines(m, salesContractId, lines.map((l) => l.salesContractLineId));
      const number = await wf.nextDocumentNumber(m, 'PR');
      const [pr] = await m.query(`INSERT INTO purchase_requisitions (document_number, sales_contract_id, created_by) VALUES ($1, $2, $3) RETURNING id`, [
        number, salesContractId, user.id,
      ]);
      for (const l of lines) {
        // Locks the product for share and marks it used: code/name/UoM become immutable (03 §1c, T9).
        await ProductUsage.markUsed(m, l.productId, { stock: false });
        const [p] = await m.query(`SELECT part_number, name, description, unit_of_measure_id FROM products WHERE id = $1`, [l.productId]);
        await m.query(
          `INSERT INTO purchase_requisition_lines (purchase_requisition_id, sales_contract_line_id, product_id, snapshot_code, snapshot_name,
             snapshot_description, unit_of_measure_id, quantity) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [pr.id, l.salesContractLineId, l.productId, p.part_number, p.name, p.description, p.unit_of_measure_id, l.quantity],
        );
      }
      return { id: pr.id as number, documentNumber: number };
    });
  }

  /** PO from lines of APPROVED PRs, one supplier; each PO line inherits the PR line UoM (T7). */
  createPurchaseOrder(user: CurrentUser, supplierId: number, lines: SourceLineInput[]) {
    return this.ds.transaction(async (m) => {
      const number = await wf.nextDocumentNumber(m, 'PO');
      const [po] = await m.query(`INSERT INTO purchase_orders (document_number, supplier_id, created_by) VALUES ($1, $2, $3) RETURNING id`, [
        number, supplierId, user.id,
      ]);
      for (const l of lines) {
        const [prl] = await m.query(
          `SELECT prl.unit_of_measure_id FROM purchase_requisition_lines prl
             JOIN purchase_requisitions pr ON pr.id = prl.purchase_requisition_id
            WHERE prl.id = $1 AND pr.approval_status = 'APPROVED' FOR SHARE OF pr`,
          [l.sourceLineId],
        );
        if (!prl) throw new BusinessError('SOURCE_NOT_APPROVED', `PR line ${l.sourceLineId} is not on an APPROVED PR`);
        await m.query(`INSERT INTO purchase_order_lines (purchase_order_id, purchase_requisition_line_id, unit_of_measure_id, quantity) VALUES ($1, $2, $3, $4)`, [
          po.id, l.sourceLineId, prl.unit_of_measure_id, l.quantity,
        ]);
      }
      await this.checkPoLimits(m, po.id, true);
      return { id: po.id as number, documentNumber: number };
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

  /** PO source re-check (03 §7): every referenced PR must still be APPROVED (PR headers locked for share). */
  private async checkPoSources(m: EntityManager, poId: number) {
    const prs: { document_number: string; approval_status: string }[] = await m.query(
      `SELECT document_number, approval_status FROM purchase_requisitions
        WHERE id IN (SELECT prl.purchase_requisition_id FROM purchase_order_lines pol
                       JOIN purchase_requisition_lines prl ON prl.id = pol.purchase_requisition_line_id WHERE pol.purchase_order_id = $1)
        ORDER BY id FOR SHARE`,
      [poId],
    );
    const bad = prs.find((p) => p.approval_status !== 'APPROVED');
    if (bad) throw new BusinessError('SOURCE_NOT_APPROVED', `PR ${bad.document_number} is no longer APPROVED`);
  }

  submit(type: 'PR' | 'PO', id: number, user: CurrentUser, approverId: number) {
    return this.ds.transaction(async (m) => {
      const doc = await wf.lockDocument(m, type, id);
      if (type === 'PO') { await this.checkPoSources(m, id); await this.checkPoLimits(m, id, true); }
      await wf.submit(m, type, doc, user, approverId);
    });
  }

  approve(type: 'PR' | 'PO', id: number, user: CurrentUser) {
    return this.ds.transaction(async (m) => {
      const doc = await wf.lockDocument(m, type, id);
      if (type === 'PO') { await this.checkPoSources(m, id); await this.checkPoLimits(m, id, false); }
      await wf.approve(m, type, doc, user);
    });
  }

  /** Reject / recall / cancel; an APPROVED PR (PO) needs no non-canceled PO (GRR) referencing it (03 §6). */
  decide(type: 'PR' | 'PO', action: 'reject' | 'recall' | 'cancel', id: number, user: CurrentUser, reason?: string) {
    return this.ds.transaction(async (m) => {
      const doc = await wf.lockDocument(m, type, id);
      const childSql = type === 'PR'
        ? `SELECT 1 FROM purchase_order_lines pol JOIN purchase_orders po ON po.id = pol.purchase_order_id
             JOIN purchase_requisition_lines prl ON prl.id = pol.purchase_requisition_line_id
            WHERE prl.purchase_requisition_id = $1 AND po.approval_status <> 'CANCELED' LIMIT 1`
        // shortcut: reads the Inbound table directly until PO lines carry the ADR-0003 aggregate maintained by Inbound.
        : `SELECT 1 FROM goods_receipt_requests WHERE purchase_order_id = $1 AND approval_status <> 'CANCELED' LIMIT 1`;
      await wf.decide(m, type, doc, user, action, reason, async () => (await m.query(childSql, [id])).length > 0);
    });
  }

  /** `assignedToMe` = "Chờ tôi duyệt" (04 §4). PR/PO are not warehouse-scoped: the VIEW permission sees all. */
  listPrs(user: CurrentUser, assignedToMe: boolean) {
    return this.ds.query(
      `SELECT ${wf.DOC_COLUMNS}, s.document_number AS "salesContractNumber", c.name AS "customerName"
         FROM purchase_requisitions d JOIN sales_contracts s ON s.id = d.sales_contract_id JOIN customers c ON c.id = s.customer_id
        WHERE NOT $2 OR (d.approval_status = 'WAITING_FOR_APPROVE' AND d.assigned_approver_id = $1)
        ORDER BY d.id DESC`,
      [user.id, assignedToMe],
    );
  }

  async getPr(id: number) {
    const [pr] = await this.ds.query(
      `SELECT ${wf.DOC_COLUMNS}, s.document_number AS "salesContractNumber", c.name AS "customerName"
         FROM purchase_requisitions d JOIN sales_contracts s ON s.id = d.sales_contract_id JOIN customers c ON c.id = s.customer_id
        WHERE d.id = $1`,
      [id],
    );
    if (!pr) throw new NotFoundException();
    const lines = await this.ds.query(
      `SELECT l.id, sl.item_name AS "ref", l.snapshot_code AS "partNumber", l.snapshot_name AS "productName", u.code AS uom, l.quantity,
              COALESCE((SELECT SUM(pol.quantity) FROM purchase_order_lines pol JOIN purchase_orders po ON po.id = pol.purchase_order_id
                         WHERE pol.purchase_requisition_line_id = l.id AND po.approval_status IN ('WAITING_FOR_APPROVE', 'APPROVED')), 0) AS "usedQuantity"
         FROM purchase_requisition_lines l
         JOIN sales_contract_lines sl ON sl.id = l.sales_contract_line_id
         JOIN units_of_measure u ON u.id = l.unit_of_measure_id
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
    return { ...pr, lines, children, history: await wf.history(this.ds.manager, 'PR', id) };
  }

  /** Lines of APPROVED PRs with quantity not yet covered by WAITING/APPROVED POs, for the PO form. */
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
          WHERE pr.approval_status = 'APPROVED') x
        WHERE remaining > 0 ORDER BY id`,
    );
  }

  listPos(user: CurrentUser, assignedToMe: boolean) {
    return this.ds.query(
      `SELECT ${wf.DOC_COLUMNS}, sp.name AS "supplierName"
         FROM purchase_orders d JOIN suppliers sp ON sp.id = d.supplier_id
        WHERE NOT $2 OR (d.approval_status = 'WAITING_FOR_APPROVE' AND d.assigned_approver_id = $1)
        ORDER BY d.id DESC`,
      [user.id, assignedToMe],
    );
  }

  async getPo(id: number) {
    const [po] = await this.ds.query(
      `SELECT ${wf.DOC_COLUMNS}, sp.name AS "supplierName" FROM purchase_orders d JOIN suppliers sp ON sp.id = d.supplier_id WHERE d.id = $1`,
      [id],
    );
    if (!po) throw new NotFoundException();
    const lines = await this.ds.query(
      `SELECT l.id, pr.document_number AS "ref", p.part_number AS "partNumber", p.name AS "productName", u.code AS uom, l.quantity
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
