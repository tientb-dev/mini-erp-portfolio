import { HttpStatus } from '@nestjs/common';
import { EntityManager, QueryFailedError } from 'typeorm';
import { BusinessError } from '../workflow/workflow';

/** SN identity: trim both ends, case-insensitive (03 §2). */
export const normalizeSerial = (sn: string) => sn.trim().toUpperCase();

export interface ReceiptLine {
  warehouseId: number;
  productId: number;
  quantity: string;
  sourceDocumentType: string;
  /** GR line id; also the lot key. */
  sourceLineId: number;
  sourceSalesContractId: number;
  ownerUserId: number;
  serials: { goodsReceiptDetailId: number; serialNumber: string; normalizedSerialNumber: string }[];
}

/**
 * Inventory facade (ADR-0004). Must run inside the caller's transaction so the document status,
 * balances, movements and serials commit or roll back together.
 */
export class InventoryFacade {
  /** Approved GR → increase on-hand, write movements, create one lot per GR line (ADR-0013), register serials. */
  static async receive(m: EntityManager, lines: ReceiptLine[]): Promise<void> {
    // Lock balance rows in a fixed order (warehouse, product) to avoid deadlocks with GI.
    const sorted = [...lines].sort((a, b) => a.warehouseId - b.warehouseId || a.productId - b.productId);
    for (const l of sorted) {
      await m.query(`INSERT INTO inventories (warehouse_id, product_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [l.warehouseId, l.productId]);
      await m.query(`SELECT id FROM inventories WHERE warehouse_id = $1 AND product_id = $2 FOR UPDATE`, [l.warehouseId, l.productId]);
    }
    for (const l of sorted) {
      await m.query(`UPDATE inventories SET on_hand_quantity = on_hand_quantity + $3 WHERE warehouse_id = $1 AND product_id = $2`, [
        l.warehouseId, l.productId, l.quantity,
      ]);
      await m.query(
        `INSERT INTO inventory_transactions (warehouse_id, product_id, movement_type, quantity, source_document_type, source_line_id)
         VALUES ($1, $2, 'IN', $3, $4, $5)`,
        [l.warehouseId, l.productId, l.quantity, l.sourceDocumentType, l.sourceLineId],
      );
      // approved_at = now(): same transaction timestamp as goods_receipts.approved_at. Unique GR line guards double counting.
      await m.query(
        `INSERT INTO inventory_lots (warehouse_id, product_id, goods_receipt_line_id, source_sales_contract_id, owner_user_id, approved_at, received_quantity, on_hand_quantity)
         VALUES ($1, $2, $3, $4, $5, now(), $6, $6)`,
        [l.warehouseId, l.productId, l.sourceLineId, l.sourceSalesContractId, l.ownerUserId, l.quantity],
      );
      for (const s of l.serials) {
        let serialId: number;
        try {
          [{ id: serialId }] = await m.query(
            `INSERT INTO inventory_serials (product_id, warehouse_id, serial_number, normalized_serial_number, goods_receipt_detail_id)
             VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [l.productId, l.warehouseId, s.serialNumber, s.normalizedSerialNumber, s.goodsReceiptDetailId],
          );
        } catch (e) {
          if (e instanceof QueryFailedError && (e as { constraint?: string }).constraint === 'uq_inventory_serials_product_sn') {
            throw new BusinessError('SN_ALREADY_RECEIVED', `Serial ${s.serialNumber} has already been received`, HttpStatus.CONFLICT);
          }
          throw e;
        }
        await m.query(
          `INSERT INTO inventory_serial_transactions (inventory_serial_id, movement_type, source_document_type, source_line_id)
           VALUES ($1, 'IN', $2, $3)`,
          [serialId, l.sourceDocumentType, l.sourceLineId],
        );
      }
    }
  }

  /** Serials (by product + normalized SN) already recorded in inventory, for early checks at submit. */
  static async existingSerials(m: EntityManager, pairs: { productId: number; normalized: string }[]): Promise<string[]> {
    if (!pairs.length) return [];
    const rows: { serial_number: string }[] = await m.query(
      `SELECT s.serial_number FROM inventory_serials s
         JOIN unnest($1::int[], $2::text[]) AS p(product_id, sn) ON p.product_id = s.product_id AND p.sn = s.normalized_serial_number`,
      [pairs.map((p) => p.productId), pairs.map((p) => p.normalized)],
    );
    return rows.map((r) => r.serial_number);
  }

  /** Available = on hand − reserved for one warehouse, keyed by product (no lock: read-only check, GIR does not reserve). */
  static async available(m: EntityManager, warehouseId: number, productIds: number[]): Promise<Map<number, number>> {
    const rows: { product_id: number; available: string }[] = await m.query(
      `SELECT product_id, on_hand_quantity - reserved_quantity AS available FROM inventories WHERE warehouse_id = $1 AND product_id = ANY($2)`,
      [warehouseId, productIds],
    );
    return new Map(productIds.map((p) => [p, Number(rows.find((r) => r.product_id === p)?.available ?? 0)]));
  }

  /**
   * Available (on hand − reserved by GIs) per product over the lots of one warehouse inside `scope` (ADR-0013).
   * Read-only: GIRs never reserve (CT13); GI submit re-checks under locks.
   */
  static async availableInScope(m: EntityManager, warehouseId: number, productIds: number[], scope: StockScope): Promise<Map<number, number>> {
    const rows: { product_id: number; available: string }[] = await m.query(
      `SELECT product_id, SUM(on_hand_quantity - reserved_quantity) AS available FROM inventory_lots
        WHERE warehouse_id = $1 AND product_id = ANY($2)
          AND ($3::int IS NULL OR source_sales_contract_id = $3) AND ($4::int IS NULL OR owner_user_id = $4)
        GROUP BY product_id`,
      [warehouseId, productIds, scope.sourceSalesContractId ?? null, scope.ownerUserId ?? null],
    );
    return new Map(productIds.map((p) => [p, Number(rows.find((r) => r.product_id === p)?.available ?? 0)]));
  }

  /** Stock sources of a warehouse for B/D pickers: per source HĐ + Sales + product, available > 0. */
  static availableSources(m: EntityManager, warehouseId: number) {
    return m.query(
      `SELECT l.source_sales_contract_id AS "sourceSalesContractId", l.owner_user_id AS "sourceOwnerUserId", u.full_name AS "sourceOwnerName",
              l.product_id AS "productId", p.part_number AS "partNumber", p.name AS "productName", SUM(l.on_hand_quantity - l.reserved_quantity) AS available
         FROM inventory_lots l JOIN users u ON u.id = l.owner_user_id JOIN products p ON p.id = l.product_id
        WHERE l.warehouse_id = $1 AND l.on_hand_quantity > l.reserved_quantity
        GROUP BY 1, 2, 3, 4, 5, 6 ORDER BY 1, 2, 4`,
      [warehouseId],
    ) as Promise<{ sourceSalesContractId: number; sourceOwnerUserId: number; sourceOwnerName: string; productId: number; partNumber: string;
      productName: string; available: string }[]>;
  }

  /** Locks balance rows in (product) order; returns available per product. */
  private static async lockBalances(m: EntityManager, warehouseId: number, productIds: number[]) {
    const ids = [...new Set(productIds)].sort((a, b) => a - b);
    const rows: { product_id: number; on_hand_quantity: string; reserved_quantity: string }[] = await m.query(
      `SELECT product_id, on_hand_quantity, reserved_quantity FROM inventories WHERE warehouse_id = $1 AND product_id = ANY($2) ORDER BY product_id FOR UPDATE`,
      [warehouseId, ids],
    );
    return new Map(ids.map((p) => {
      const r = rows.find((x) => x.product_id === p);
      return [p, r ? Number(r.on_hand_quantity) - Number(r.reserved_quantity) : 0];
    }));
  }

  /** Serial rows (by GR detail) locked FOR UPDATE in id order. */
  private static lockSerials(m: EntityManager, detailIds: number[]) {
    return m.query(
      `SELECT id, goods_receipt_detail_id, product_id, warehouse_id, status, serial_number FROM inventory_serials
        WHERE goods_receipt_detail_id = ANY($1) ORDER BY id FOR UPDATE`,
      [detailIds],
    ) as Promise<{ id: number; goods_receipt_detail_id: number; product_id: number; warehouse_id: number; status: string; serial_number: string }[]>;
  }

  /**
   * GI submit (03 §4, §7): lock balances, verify available ≥ quantity, reserve quantity; lock serials, verify
   * IN_STOCK at the right warehouse + product, mark RESERVED. All-or-nothing inside the caller's transaction.
   */
  static async reserve(m: EntityManager, warehouseId: number, items: IssueItem[], scope: StockScope = {}): Promise<void> {
    const need = sumByProduct(items);
    const available = await this.lockBalances(m, warehouseId, [...need.keys()]);
    for (const [productId, qty] of need) {
      if ((available.get(productId) ?? 0) < qty) {
        throw new BusinessError('INSUFFICIENT_AVAILABLE_STOCK', `Available stock of product ${productId} is ${available.get(productId) ?? 0}, need ${qty}`, HttpStatus.CONFLICT);
      }
    }
    const detailIds = items.flatMap((i) => i.serialDetailIds);
    if (detailIds.length) {
      const serials = await this.lockSerials(m, detailIds);
      for (const i of items) {
        for (const d of i.serialDetailIds) {
          const s = serials.find((x) => x.goods_receipt_detail_id === d);
          if (!s || s.status !== 'IN_STOCK' || s.warehouse_id !== warehouseId || s.product_id !== i.productId) {
            throw new BusinessError('SN_NOT_AVAILABLE', `Serial ${s?.serial_number ?? d} is not available in this warehouse for this product`, HttpStatus.CONFLICT);
          }
        }
      }
      await m.query(`UPDATE inventory_serials SET status = 'RESERVED' WHERE goods_receipt_detail_id = ANY($1)`, [detailIds]);
    }
    for (const [productId, qty] of need) {
      await m.query(`UPDATE inventories SET reserved_quantity = reserved_quantity + $3 WHERE warehouse_id = $1 AND product_id = $2`, [warehouseId, productId, qty]);
    }
    await this.allocate(m, warehouseId, items, scope);
  }

  /**
   * Allocates each GI line to lots and reserves them (ADR-0013 §3). Bulk lines: FIFO by GR approval time (approved_at, id)
   * over the lots inside `scope`; serial lines: the lots their serials were received in, which must be inside `scope`.
   * Lots are locked FOR UPDATE in (approved_at, id) order, always after the inventories rows of the same product, so
   * concurrent GIs on the same product are serialized by the balance lock.
   */
  private static async allocate(m: EntityManager, warehouseId: number, items: IssueItem[], scope: StockScope) {
    const products = [...new Set(items.map((i) => i.productId))].sort((a, b) => a - b);
    for (const productId of products) {
      const lots: { id: number; source_sales_contract_id: number; owner_user_id: number; free: string }[] = await m.query(
        `SELECT id, source_sales_contract_id, owner_user_id, on_hand_quantity - reserved_quantity AS free FROM inventory_lots
          WHERE warehouse_id = $1 AND product_id = $2 AND on_hand_quantity > reserved_quantity ORDER BY approved_at, id FOR UPDATE`,
        [warehouseId, productId],
      );
      const inScope = (l: (typeof lots)[number]) =>
        (scope.sourceSalesContractId === undefined || l.source_sales_contract_id === scope.sourceSalesContractId) &&
        (scope.ownerUserId === undefined || l.owner_user_id === scope.ownerUserId);
      const free = new Map(lots.map((l) => [l.id, Number(l.free)]));
      const plan: { lineId: number; lotId: number; qty: number }[] = [];
      for (const i of items.filter((x) => x.productId === productId)) {
        if (i.serialDetailIds.length) {
          const bySerial: { lot_id: number; n: string }[] = await m.query(
            `SELECT l.id AS lot_id, COUNT(*) AS n FROM goods_receipt_details d JOIN inventory_lots l ON l.goods_receipt_line_id = d.goods_receipt_line_id
              WHERE d.id = ANY($1) GROUP BY l.id ORDER BY l.id`,
            [i.serialDetailIds],
          );
          for (const r of bySerial) {
            const lot = lots.find((l) => l.id === r.lot_id);
            const n = Number(r.n);
            if (!lot || !inScope(lot) || free.get(lot.id)! < n) {
              throw new BusinessError('STOCK_OUT_OF_SCOPE', `Selected serials of product ${productId} are outside the allowed stock source`, HttpStatus.CONFLICT);
            }
            free.set(lot.id, free.get(lot.id)! - n);
            plan.push({ lineId: i.sourceLineId, lotId: lot.id, qty: n });
          }
        } else {
          let need = i.quantity;
          for (const lot of lots.filter(inScope)) {
            const take = Math.min(need, free.get(lot.id)!);
            if (take <= 0) continue;
            free.set(lot.id, free.get(lot.id)! - take);
            plan.push({ lineId: i.sourceLineId, lotId: lot.id, qty: take });
            need -= take;
            if (need === 0) break;
          }
          if (need > 0) {
            throw new BusinessError('INSUFFICIENT_AVAILABLE_STOCK', `Available stock of product ${productId} in the allowed source is short by ${need}`, HttpStatus.CONFLICT);
          }
        }
      }
      for (const p of plan) {
        await m.query(`INSERT INTO goods_issue_line_allocations (goods_issue_line_id, inventory_lot_id, quantity) VALUES ($1, $2, $3)`, [p.lineId, p.lotId, p.qty]);
        await m.query(`UPDATE inventory_lots SET reserved_quantity = reserved_quantity + $2 WHERE id = $1`, [p.lotId, p.qty]);
      }
    }
  }

  /** Allocations of the given GI lines, with their lots locked FOR UPDATE in (approved_at, id) order. */
  private static async lockAllocations(m: EntityManager, items: IssueItem[]) {
    const lineIds = items.map((i) => i.sourceLineId);
    await m.query(
      `SELECT l.id FROM inventory_lots l WHERE l.id IN (SELECT inventory_lot_id FROM goods_issue_line_allocations WHERE goods_issue_line_id = ANY($1))
        ORDER BY l.approved_at, l.id FOR UPDATE`,
      [lineIds],
    );
    const rows: { goods_issue_line_id: number; inventory_lot_id: number; quantity: string }[] = await m.query(
      `SELECT goods_issue_line_id, inventory_lot_id, quantity FROM goods_issue_line_allocations WHERE goods_issue_line_id = ANY($1)`,
      [lineIds],
    );
    for (const i of items) {
      const allocated = rows.filter((r) => r.goods_issue_line_id === i.sourceLineId).reduce((s, r) => s + Number(r.quantity), 0);
      if (allocated !== i.quantity) {
        throw new BusinessError('ALLOCATION_MISMATCH', `GI line ${i.sourceLineId}: allocated ${allocated}, expected ${i.quantity}`, HttpStatus.CONFLICT);
      }
    }
    return rows;
  }

  /** GI reject/recall: undo `reserve`, releasing exactly the allocated lots. */
  static async release(m: EntityManager, warehouseId: number, items: IssueItem[]): Promise<void> {
    const need = sumByProduct(items);
    await this.lockBalances(m, warehouseId, [...need.keys()]);
    for (const a of await this.lockAllocations(m, items)) {
      await m.query(`UPDATE inventory_lots SET reserved_quantity = reserved_quantity - $2 WHERE id = $1`, [a.inventory_lot_id, a.quantity]);
    }
    await m.query(`DELETE FROM goods_issue_line_allocations WHERE goods_issue_line_id = ANY($1)`, [items.map((i) => i.sourceLineId)]);
    const detailIds = items.flatMap((i) => i.serialDetailIds);
    if (detailIds.length) {
      await this.lockSerials(m, detailIds);
      await m.query(`UPDATE inventory_serials SET status = 'IN_STOCK' WHERE goods_receipt_detail_id = ANY($1) AND status = 'RESERVED'`, [detailIds]);
    }
    for (const [productId, qty] of need) {
      await m.query(`UPDATE inventories SET reserved_quantity = reserved_quantity - $3 WHERE warehouse_id = $1 AND product_id = $2`, [warehouseId, productId, qty]);
    }
  }

  /**
   * GI approve: reserved → issued. Decreases on hand and reserved on the balance and on the lots allocated at submit
   * (FIFO is not recomputed), writes OUT movements; serials become ISSUED (kept forever). Allocations stay as the issue trail.
   */
  static async issue(m: EntityManager, warehouseId: number, items: IssueItem[]): Promise<void> {
    const need = sumByProduct(items);
    await this.lockBalances(m, warehouseId, [...need.keys()]);
    for (const a of await this.lockAllocations(m, items)) {
      await m.query(`UPDATE inventory_lots SET on_hand_quantity = on_hand_quantity - $2, reserved_quantity = reserved_quantity - $2 WHERE id = $1`, [
        a.inventory_lot_id, a.quantity,
      ]);
    }
    const detailIds = items.flatMap((i) => i.serialDetailIds);
    const serials = detailIds.length ? await this.lockSerials(m, detailIds) : [];
    if (serials.some((s) => s.status !== 'RESERVED') || serials.length !== detailIds.length) {
      throw new BusinessError('SN_NOT_RESERVED', 'Selected serials are no longer reserved for this goods issue', HttpStatus.CONFLICT);
    }
    for (const [productId, qty] of need) {
      // CHECK constraints reject negative on hand / reserved and reserved > on hand (last line of defense).
      await m.query(
        `UPDATE inventories SET on_hand_quantity = on_hand_quantity - $3, reserved_quantity = reserved_quantity - $3 WHERE warehouse_id = $1 AND product_id = $2`,
        [warehouseId, productId, qty],
      );
    }
    for (const i of items) {
      await m.query(
        `INSERT INTO inventory_transactions (warehouse_id, product_id, movement_type, quantity, source_document_type, source_line_id)
         VALUES ($1, $2, 'OUT', $3, 'GI', $4)`,
        [warehouseId, i.productId, i.quantity, i.sourceLineId],
      );
    }
    if (serials.length) {
      await m.query(`UPDATE inventory_serials SET status = 'ISSUED' WHERE goods_receipt_detail_id = ANY($1)`, [detailIds]);
      for (const i of items) {
        await m.query(
          `INSERT INTO inventory_serial_transactions (inventory_serial_id, movement_type, source_document_type, source_line_id)
           SELECT id, 'OUT', 'GI', $2 FROM inventory_serials WHERE goods_receipt_detail_id = ANY($1)`,
          [i.serialDetailIds, i.sourceLineId],
        );
      }
    }
  }
}

/** Stock a GI may take (ADR-0013): always warehouse + product; optionally one source HĐ and/or one responsible sales. */
export interface StockScope { sourceSalesContractId?: number; ownerUserId?: number }

export interface IssueItem { productId: number; quantity: number; sourceLineId: number; serialDetailIds: number[] }

function sumByProduct(items: IssueItem[]): Map<number, number> {
  const map = new Map<number, number>();
  for (const i of items) map.set(i.productId, (map.get(i.productId) ?? 0) + i.quantity);
  return map;
}
