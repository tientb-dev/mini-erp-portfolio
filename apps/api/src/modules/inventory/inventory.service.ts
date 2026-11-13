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
  sourceLineId: number;
  serials: { goodsReceiptDetailId: number; serialNumber: string; normalizedSerialNumber: string }[];
}

/**
 * Inventory facade (ADR-0004). Must run inside the caller's transaction so the document status,
 * balances, movements and serials commit or roll back together.
 */
export class InventoryFacade {
  /** Approved GR → increase on-hand, write movements, register serials. */
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
  static async reserve(m: EntityManager, warehouseId: number, items: IssueItem[]): Promise<void> {
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
  }

  /** GI reject/recall: undo `reserve`. */
  static async release(m: EntityManager, warehouseId: number, items: IssueItem[]): Promise<void> {
    const need = sumByProduct(items);
    await this.lockBalances(m, warehouseId, [...need.keys()]);
    const detailIds = items.flatMap((i) => i.serialDetailIds);
    if (detailIds.length) {
      await this.lockSerials(m, detailIds);
      await m.query(`UPDATE inventory_serials SET status = 'IN_STOCK' WHERE goods_receipt_detail_id = ANY($1) AND status = 'RESERVED'`, [detailIds]);
    }
    for (const [productId, qty] of need) {
      await m.query(`UPDATE inventories SET reserved_quantity = reserved_quantity - $3 WHERE warehouse_id = $1 AND product_id = $2`, [warehouseId, productId, qty]);
    }
  }

  /** GI approve: reserved → issued. Decreases on hand and reserved, writes OUT movements; serials become ISSUED (kept forever). */
  static async issue(m: EntityManager, warehouseId: number, items: IssueItem[]): Promise<void> {
    const need = sumByProduct(items);
    await this.lockBalances(m, warehouseId, [...need.keys()]);
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

export interface IssueItem { productId: number; quantity: number; sourceLineId: number; serialDetailIds: number[] }

function sumByProduct(items: IssueItem[]): Map<number, number> {
  const map = new Map<number, number>();
  for (const i of items) map.set(i.productId, (map.get(i.productId) ?? 0) + i.quantity);
  return map;
}
