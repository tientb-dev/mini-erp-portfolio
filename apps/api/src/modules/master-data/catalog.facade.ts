import { EntityManager } from 'typeorm';
import { DOCUMENT_MONEY_PRECISION } from '../../common/document-money';
import { BusinessError } from '../workflow/workflow';

const selectionTables = {
  brand: 'brands', uom: 'units_of_measure', customer: 'customers', supplier: 'suppliers',
} as const;

export class CatalogFacade {
  static async assertDocumentTaxRate(m: EntityManager, id: number) {
    const [record] = await m.query('SELECT rate = trunc(rate, $2) AS valid FROM tax_rates WHERE id = $1 AND is_active FOR SHARE',
      [id, DOCUMENT_MONEY_PRECISION.taxRate]);
    if (!record) throw new BusinessError('TAX_RATE_NOT_FOUND', 'Tax rate not found or inactive');
    if (!record.valid) throw new BusinessError('PR_INVALID_TAX_RATE', 'Choose a tax rate with up to two decimal places');
  }

  static activeBrandSuppliers(m: EntityManager, brandId: number) {
    return m.query(`SELECT s.id, s.code, s.name FROM suppliers s
      JOIN brand_suppliers bs ON bs.supplier_id = s.id WHERE bs.brand_id = $1 AND s.is_active ORDER BY s.code`, [brandId]);
  }

  static async assertBrandSupplier(m: EntityManager, brandId: number | null, supplierId: number) {
    await m.query('SELECT id FROM brands WHERE id = $1 FOR SHARE', [brandId]);
    await this.assertActive(m, 'supplier', supplierId);
    const [link] = await m.query('SELECT 1 FROM brand_suppliers WHERE brand_id = $1 AND supplier_id = $2 FOR SHARE', [brandId, supplierId]);
    if (!link) throw new BusinessError('PR_SUPPLIER_NOT_LINKED', 'Choose a supplier linked to the selected brand');
  }

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
