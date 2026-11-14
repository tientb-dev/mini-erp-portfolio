import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import type { CurrentUser } from '../identity/auth';
import { ProductUsage } from '../master-data/product-usage';
import { SalesContractFacade } from "../sales-contracts/sales-contracts.service";
import * as wf from '../workflow/workflow';
import { BusinessError } from '../workflow/workflow';

/** `id` set = existing line being edited. */
/** SALES_GOODS lines must reference their HĐ line; MATERIAL lines may (ADR-0012). */
export interface PrLineInput { id?: number; salesContractLineId?: number | null; productId: number; quantity: number }
export type LineCategory = 'SALES_GOODS' | 'MATERIAL';

/** A PR line as seen by a GIR (A/C): its PR, HĐ, category and approved PO coverage. */
export interface PrLineForIssue {
  id: number; purchaseRequisitionId: number; prNumber: string; salesContractId: number; category: LineCategory;
  salesContractLineId: number | null; productId: number; quantity: number; poDone: boolean;
}

function assertPrLines(category: LineCategory, lines: PrLineInput[]) {
  if (category === 'SALES_GOODS' && lines.some((l) => !l.salesContractLineId)) {
    throw new BusinessError('SALES_CONTRACT_LINE_REQUIRED', 'Every sales-goods PR line must reference its HĐ line');
  }
  wf.assertUniqueSourceLines(lines.flatMap((l) => (l.salesContractLineId ? [l.salesContractLineId] : [])));
}
const scLineIds = (lines: PrLineInput[]) => lines.flatMap((l) => (l.salesContractLineId ? [l.salesContractLineId] : []));
export interface SourceLineInput { id?: number; sourceLineId: number; quantity: number }

/** PO receipt status from line aggregates (03 §1, CT12); a PO with nothing received (or no lines) is NOT_RECEIVED. */
const RECEIPT_STATUS_SQL = `CASE
    WHEN NOT EXISTS (SELECT 1 FROM purchase_order_lines x WHERE x.purchase_order_id = d.id AND x.received_quantity > 0) THEN 'NOT_RECEIVED'
    WHEN NOT EXISTS (SELECT 1 FROM purchase_order_lines x WHERE x.purchase_order_id = d.id AND x.received_quantity < x.quantity) THEN 'RECEIVED'
    ELSE 'PARTIALLY_RECEIVED' END`;

/**
 * Facade for Inbound (ADR-0003): Inbound calls Procurement, never the reverse. Runs inside the caller's transaction.
 */
export class ProcurementFacade {
  /**
   * Adds (approve GR, sign 1) or removes (recall of an APPROVED GR, sign -1) received quantities on PO lines.
   * Locks the PO lines in id order; the CHECK 0 ≤ received ≤ ordered is the last line of defence.
   */
  /**
   * PR lines for a GIR (A/C), locked FOR UPDATE in id order (lock order HĐ lines → PR lines → GIR, CT8).
   * `poDone`: the whole PR is `PO done` — every line has Σ APPROVED PO quantity = its quantity (03 §3, CT1).
   */
  static async lockLinesForIssue(m: EntityManager, ids: number[]): Promise<Map<number, PrLineForIssue>> {
    const sorted = [...new Set(ids)].sort((a, b) => a - b);
    await m.query(`SELECT id FROM purchase_requisition_lines WHERE id = ANY($1) ORDER BY id FOR UPDATE`, [sorted]);
    const rows: PrLineForIssue[] = await m.query(
      `SELECT l.id, l.purchase_requisition_id AS "purchaseRequisitionId", pr.document_number AS "prNumber", pr.sales_contract_id AS "salesContractId",
              pr.category, l.sales_contract_line_id AS "salesContractLineId", l.product_id AS "productId", l.quantity::float AS quantity,
              pr.approval_status = 'APPROVED' AND NOT EXISTS (
                SELECT 1 FROM purchase_requisition_lines x
                 WHERE x.purchase_requisition_id = pr.id
                   AND x.quantity <> COALESCE((SELECT SUM(pol.quantity) FROM purchase_order_lines pol JOIN purchase_orders po ON po.id = pol.purchase_order_id
                                                WHERE pol.purchase_requisition_line_id = x.id AND po.approval_status = 'APPROVED'), 0)) AS "poDone"
         FROM purchase_requisition_lines l JOIN purchase_requisitions pr ON pr.id = l.purchase_requisition_id WHERE l.id = ANY($1)`,
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

  /** Unlocked read of PR lines (HĐ and HĐ line), so a GIR can validate and lock HĐ lines before PR lines (CT8). */
  static peekLines(m: EntityManager, prLineIds: number[]): Promise<{ id: number; salesContractId: number; salesContractLineId: number | null }[]> {
    return m.query(
      `SELECT l.id, pr.sales_contract_id AS "salesContractId", l.sales_contract_line_id AS "salesContractLineId"
         FROM purchase_requisition_lines l JOIN purchase_requisitions pr ON pr.id = l.purchase_requisition_id WHERE l.id = ANY($1)`,
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
        WHERE pr.sales_contract_id = $1 AND pr.approval_status = 'APPROVED'
          AND NOT EXISTS (SELECT 1 FROM purchase_requisition_lines x WHERE x.purchase_requisition_id = pr.id
                            AND x.quantity <> COALESCE((SELECT SUM(pol.quantity) FROM purchase_order_lines pol JOIN purchase_orders po ON po.id = pol.purchase_order_id
                                                         WHERE pol.purchase_requisition_line_id = x.id AND po.approval_status = 'APPROVED'), 0))
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

/**
 * Upstream of GR (PR → PO). Minimal by design for the GR slice: main products only (no temporary
 * products/mapping yet), one-level approval, quantity limits re-checked at submit and approve.
 */
@Injectable()
export class ProcurementService {
  constructor(private readonly ds: DataSource) {}

  /** `category`: sales goods (from the HĐ screen, every line keeps its HĐ line) or material (HĐ line optional); never mixed (CM3). */
  createPurchaseRequisition(user: CurrentUser, salesContractId: number, lines: PrLineInput[], category: LineCategory = 'SALES_GOODS') {
    return this.ds.transaction(async (m) => {
      assertPrLines(category, lines);
      await SalesContractFacade.lockActiveLines(m, salesContractId, scLineIds(lines));
      const number = await wf.nextDocumentNumber(m, 'PR');
      const [pr] = await m.query(
        `INSERT INTO purchase_requisitions (document_number, sales_contract_id, category, created_by) VALUES ($1, $2, $3, $4) RETURNING id`,
        [number, salesContractId, category, user.id],
      );
      for (const l of lines) await this.writePrLine(m, pr.id, l);
      return { id: pr.id as number, documentNumber: number };
    });
  }

  /**
   * Inserts a PR line, or updates line `l.id` in place. Snapshot and UoM always follow the chosen main product (03 §1a).
   * A line referenced by a (canceled) PO line keeps its product: that PO still shows it.
   */
  private async writePrLine(m: EntityManager, prId: number, l: PrLineInput) {
    // Locks the product for share and marks it used: code/name/UoM become immutable (03 §1c, T9).
    await ProductUsage.markUsed(m, l.productId, { stock: false });
    const [p] = await m.query(`SELECT part_number, name, description, unit_of_measure_id FROM products WHERE id = $1`, [l.productId]);
    const values = [prId, l.salesContractLineId ?? null, l.productId, p.part_number, p.name, p.description, p.unit_of_measure_id, l.quantity];
    if (!l.id) {
      await m.query(
        `INSERT INTO purchase_requisition_lines (purchase_requisition_id, sales_contract_line_id, product_id, snapshot_code, snapshot_name,
           snapshot_description, unit_of_measure_id, quantity) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        values,
      );
      return;
    }
    wf.assertLineUpdated(await m.query(
      `UPDATE purchase_requisition_lines l SET sales_contract_line_id = $2, product_id = $3, snapshot_code = $4, snapshot_name = $5,
         snapshot_description = $6, unit_of_measure_id = $7, quantity = $8
        WHERE l.id = $9 AND l.purchase_requisition_id = $1
          AND ((l.product_id = $3 AND l.sales_contract_line_id IS NOT DISTINCT FROM $2)
               OR NOT EXISTS (SELECT 1 FROM purchase_order_lines pol WHERE pol.purchase_requisition_line_id = l.id))`,
      [...values, l.id],
    ), l.id);
  }

  /** Edit a DRAFT/REJECTED PR by its creator: lines (HĐ line, product → UoM, quantity); the HĐ stays the same. */
  updatePurchaseRequisition(user: CurrentUser, id: number, version: number, lines: PrLineInput[]) {
    return this.ds.transaction(async (m) => {
      const [head] = await m.query(`SELECT sales_contract_id, category FROM purchase_requisitions WHERE id = $1`, [id]);
      if (!head) throw new NotFoundException();
      // The request is the full line set (omitted lines are deleted), so checking it covers the saved result. Category is fixed.
      assertPrLines(head.category, lines);
      // Lock order: HĐ lines → document (ARCHITECTURE §2.1a); the HĐ must still be ACTIVE.
      await SalesContractFacade.lockActiveLines(m, head.sales_contract_id, scLineIds(lines));
      const doc = await wf.lockDocument(m, 'PR', id);
      wf.assertEditable(doc, user, version);
      await wf.deleteOmittedLines(m, 'purchase_requisition_lines', 'purchase_requisition_id', id, lines.flatMap((l) => (l.id ? [l.id] : [])));
      for (const l of lines) await this.writePrLine(m, id, l);
      await wf.markEdited(m, 'PR', id, user.id);
    });
  }

  /** PO from lines of APPROVED PRs, one supplier; each PO line inherits the PR line UoM (T7). */
  createPurchaseOrder(user: CurrentUser, supplierId: number, lines: SourceLineInput[]) {
    wf.assertUniqueSourceLines(lines.map((l) => l.sourceLineId));
    return this.ds.transaction(async (m) => {
      const number = await wf.nextDocumentNumber(m, 'PO');
      const [po] = await m.query(`INSERT INTO purchase_orders (document_number, supplier_id, created_by) VALUES ($1, $2, $3) RETURNING id`, [
        number, supplierId, user.id,
      ]);
      for (const l of lines) await this.writePoLine(m, po.id, l);
      await this.checkPoLimits(m, po.id, true);
      return { id: po.id as number, documentNumber: number };
    });
  }

  /** New line: the PR line must be on an APPROVED PR; UoM inherited. Existing line: only the quantity changes. */
  private async writePoLine(m: EntityManager, poId: number, l: SourceLineInput) {
    if (l.id) {
      wf.assertLineUpdated(await m.query(
        `UPDATE purchase_order_lines SET quantity = $4 WHERE id = $1 AND purchase_order_id = $2 AND purchase_requisition_line_id = $3`,
        [l.id, poId, l.sourceLineId, l.quantity],
      ), l.id);
      return;
    }
    const [prl] = await m.query(
      `SELECT prl.unit_of_measure_id FROM purchase_requisition_lines prl
         JOIN purchase_requisitions pr ON pr.id = prl.purchase_requisition_id
        WHERE prl.id = $1 AND pr.approval_status = 'APPROVED' FOR SHARE OF pr`,
      [l.sourceLineId],
    );
    if (!prl) throw new BusinessError('SOURCE_NOT_APPROVED', `PR line ${l.sourceLineId} is not on an APPROVED PR`);
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
      `SELECT ${wf.DOC_COLUMNS}, d.category, s.document_number AS "salesContractNumber", c.name AS "customerName"
         FROM purchase_requisitions d JOIN sales_contracts s ON s.id = d.sales_contract_id JOIN customers c ON c.id = s.customer_id
        WHERE NOT $2 OR (d.approval_status = 'WAITING_FOR_APPROVE' AND d.assigned_approver_id = $1)
        ORDER BY d.id DESC`,
      [user.id, assignedToMe],
    );
  }

  async getPr(id: number) {
    const [pr] = await this.ds.query(
      `SELECT ${wf.DOC_COLUMNS}, d.sales_contract_id AS "salesContractId", d.category, s.document_number AS "salesContractNumber", c.name AS "customerName"
         FROM purchase_requisitions d JOIN sales_contracts s ON s.id = d.sales_contract_id JOIN customers c ON c.id = s.customer_id
        WHERE d.id = $1`,
      [id],
    );
    if (!pr) throw new NotFoundException();
    const lines = await this.ds.query(
      `SELECT l.id, l.sales_contract_line_id AS "sourceLineId", l.product_id AS "productId", sl.item_name AS "ref", l.snapshot_code AS "partNumber", l.snapshot_name AS "productName", u.code AS uom, l.quantity,
              COALESCE((SELECT SUM(pol.quantity) FROM purchase_order_lines pol JOIN purchase_orders po ON po.id = pol.purchase_order_id
                         WHERE pol.purchase_requisition_line_id = l.id AND po.approval_status IN ('WAITING_FOR_APPROVE', 'APPROVED')), 0) AS "usedQuantity"
         FROM purchase_requisition_lines l
         LEFT JOIN sales_contract_lines sl ON sl.id = l.sales_contract_line_id
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
