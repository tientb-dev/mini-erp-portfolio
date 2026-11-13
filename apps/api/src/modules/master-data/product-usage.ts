import { HttpStatus } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { BusinessError } from '../workflow/workflow';

/**
 * Master Data facade for "product used in documents" (03 §1b–1c, ARCHITECTURE §2.1).
 * Document modules call `markUsed` inside their transaction; the row lock serializes it with product edits,
 * so an edit can never slip between "check unused" and "first document reference".
 */
export class ProductUsage {
  /** Locks the product for share (blocks concurrent edits) and sets the usage markers once. */
  static async markUsed(m: EntityManager, productId: number, opts: { stock: boolean }): Promise<{ unitOfMeasureId: number; isSerialTracked: boolean }> {
    const [p] = await m.query(
      `SELECT is_used, is_stock_used, unit_of_measure_id, is_serial_tracked FROM products WHERE id = $1 AND is_active FOR SHARE`,
      [productId],
    );
    if (!p) throw new BusinessError('PRODUCT_NOT_FOUND', `Product ${productId} not found or inactive`);
    if (!p.is_used || (opts.stock && !p.is_stock_used)) {
      await m.query(`UPDATE products SET is_used = true, is_stock_used = is_stock_used OR $2 WHERE id = $1`, [productId, opts.stock]);
    }
    return { unitOfMeasureId: p.unit_of_measure_id, isSerialTracked: p.is_serial_tracked };
  }

  /** Called by the product edit use case after `SELECT … FOR UPDATE`. */
  static assertEditable(
    current: { partNumber: string; name: string; unitOfMeasureId: number; isSerialTracked: boolean; isUsed: boolean; isStockUsed: boolean },
    change: { partNumber?: string; name?: string; unitOfMeasureId?: number; isSerialTracked?: boolean },
  ): void {
    const changed = <K extends keyof typeof change>(k: K) => change[k] !== undefined && change[k] !== current[k];
    if (current.isUsed && (changed('partNumber') || changed('name'))) {
      throw new BusinessError('PRODUCT_IDENTITY_LOCKED', 'Code and name cannot change after the product is used in documents', HttpStatus.CONFLICT);
    }
    if (current.isUsed && changed('unitOfMeasureId')) {
      throw new BusinessError('PRODUCT_UOM_LOCKED', 'UoM cannot change after the product is used in documents', HttpStatus.CONFLICT);
    }
    if (current.isStockUsed && changed('isSerialTracked')) {
      throw new BusinessError('SERIAL_TRACKING_LOCKED', 'Serial tracking cannot change after the product appears on GRR/GR/GIR/GI', HttpStatus.CONFLICT);
    }
  }
}
