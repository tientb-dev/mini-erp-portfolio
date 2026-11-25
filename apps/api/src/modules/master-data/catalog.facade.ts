import { EntityManager } from 'typeorm';
import { BusinessError } from '../workflow/workflow';

const selectionTables = {
  brand: 'brands', uom: 'units_of_measure', customer: 'customers', supplier: 'suppliers',
} as const;

export class CatalogFacade {
  static async assertActive(m: EntityManager, kind: keyof typeof selectionTables, id: number) {
    const [record] = await m.query(`SELECT id FROM ${selectionTables[kind]} WHERE id = $1 AND is_active FOR SHARE`, [id]);
    if (!record) throw new BusinessError(`${kind.toUpperCase()}_NOT_FOUND`, `${kind} ${id} not found or inactive`);
  }

  static async assertActiveWarehouse(m: EntityManager, id: number) {
    const [warehouse] = await m.query('SELECT id FROM warehouses WHERE id = $1 AND is_active FOR SHARE', [id]);
    if (!warehouse) throw new BusinessError('WAREHOUSE_NOT_FOUND', 'Warehouse not found or inactive');
  }

  static async contractItem(m: EntityManager, productId: number | null, temporaryProductId: number | null) {
    const [item] = productId !== null
      ? await m.query(`SELECT part_number AS code, name, description, unit_of_measure_id AS "unitOfMeasureId"
                        FROM products WHERE id = $1 AND is_active FOR UPDATE`, [productId])
      : await m.query(`SELECT code, name, description FROM temporary_products WHERE id = $1 AND is_active FOR SHARE`, [temporaryProductId]);
    return item as { code: string; name: string; description: string | null; unitOfMeasureId?: number } | undefined;
  }
}
