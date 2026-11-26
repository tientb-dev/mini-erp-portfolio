import { NotFoundException } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';
import { EntityManager } from 'typeorm';
import { BusinessError } from '../workflow/workflow';

export class CatalogSelectionDto {
  @ApiPropertyOptional()
  @IsOptional() @Transform(({ value }) => value === 'true' ? true : value === 'false' ? false : value)
  @IsBoolean() activeOnly?: boolean;

  @ApiPropertyOptional()
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) includeId?: number;
}
export class StatusDto {
  @ApiProperty() @IsBoolean() isActive!: boolean;
}

type CatalogTable = 'brands' | 'temporary_products' | 'units_of_measure' | 'customers' | 'suppliers' | 'currencies' | 'tax_rates';
export const selectionParams = (query: CatalogSelectionDto) => [query.activeOnly ?? false, query.includeId ?? null];
export const selectionFilter = 'NOT $1::boolean OR is_active OR id = $2::int';

export function updateCatalogStatus(manager: EntityManager, table: CatalogTable, id: number, active: boolean) {
  return manager.transaction(async m => {
    const [row] = await m.query(`SELECT code FROM ${table} WHERE id = $1 FOR UPDATE`, [id]);
    if (!row) throw new NotFoundException();
    if (!active) {
      const productField = table === 'brands' ? 'brand_id' : table === 'units_of_measure' ? 'unit_of_measure_id' : null;
      if (productField) {
        const [product] = await m.query(`SELECT id FROM products WHERE ${productField} = $1 AND is_active LIMIT 1`, [id]);
        if (product) throw new BusinessError('CATALOG_HAS_ACTIVE_PRODUCTS', 'This record is referenced by active main products');
      }
      if (table === 'currencies' && row.code === 'VND') {
        throw new BusinessError('DEFAULT_CURRENCY_REQUIRED', 'The default VND currency must stay active');
      }
    }
    await m.query(`UPDATE ${table} SET is_active = $2 WHERE id = $1`, [id, active]);
  });
}

export async function assertWarehouseCanDeactivate(m: EntityManager, id: number) {
  const [stock] = await m.query('SELECT 1 FROM inventories WHERE warehouse_id = $1 AND on_hand_quantity > 0 LIMIT 1', [id]);
  if (stock) throw new BusinessError('WAREHOUSE_HAS_STOCK', 'This warehouse still has stock');
  const [open] = await m.query(`
    SELECT 1 FROM goods_receipt_requests r WHERE r.warehouse_id = $1 AND r.approval_status <> 'CANCELED'
      AND NOT EXISTS (SELECT 1 FROM goods_receipts g WHERE g.goods_receipt_request_id = r.id AND g.approval_status = 'APPROVED')
    UNION ALL SELECT 1 FROM goods_receipts WHERE warehouse_id = $1 AND approval_status NOT IN ('APPROVED', 'CANCELED')
    UNION ALL SELECT 1 FROM goods_issue_requests WHERE warehouse_id = $1 AND approval_status <> 'CANCELED' AND execution_status <> 'COMPLETED'
    UNION ALL SELECT 1 FROM goods_issues WHERE warehouse_id = $1 AND approval_status NOT IN ('APPROVED', 'CANCELED')
    LIMIT 1`, [id]);
  if (open) throw new BusinessError('WAREHOUSE_HAS_UNFINISHED_DOCUMENTS', 'This warehouse has unfinished warehouse documents');
}
