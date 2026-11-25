import { DataSource, EntityManager } from 'typeorm';
import { DOCUMENT_MONEY_PRECISION } from '../../common/document-money';
import { BusinessError } from '../workflow/workflow';

const selectionTables = {
  brand: 'brands', uom: 'units_of_measure', customer: 'customers', supplier: 'suppliers',
} as const;

export class CatalogFacade {
  static productPicker(ds: DataSource, source: 'main' | 'temporary', query: {
    q?: string; brandId?: number; sort?: string; direction?: 'asc' | 'desc'; page?: number; size?: number;
  }) {
    const main = source === 'main';
    const code = main ? 'p.part_number' : 'p.code';
    const table = main ? 'products p JOIN brands b ON b.id = p.brand_id JOIN units_of_measure u ON u.id = p.unit_of_measure_id' : 'temporary_products p';
    const details = main ? ', b.id AS "brandId", b.name AS brand, u.id AS "unitOfMeasureId", u.code AS uom' : '';
    const columns = { code, name: 'p.name', description: 'p.description', ...(main && { brand: 'b.name', uom: 'u.code' }) };
    const sort = query.sort && Object.hasOwn(columns, query.sort) ? columns[query.sort as keyof typeof columns] : code;
    const where = `FROM ${table} WHERE p.is_active AND
      (strpos(lower(${code}), lower($1)) > 0 OR strpos(lower(p.name), lower($1)) > 0)
      ${main ? 'AND ($2::int IS NULL OR p.brand_id = $2)' : 'AND $2::int IS NULL'}`;
    const values = [query.q?.trim() ?? '', main ? query.brandId ?? null : null];
    const size = query.size ?? 25;
    return ds.transaction('REPEATABLE READ', async m => {
      const [{ total }] = await m.query(`SELECT count(*)::int AS total ${where}`, values);
      const items = await m.query(`SELECT p.id, ${code} AS code, p.name, p.description ${details} ${where}
        ORDER BY ${sort} ${query.direction === 'desc' ? 'DESC' : 'ASC'} NULLS LAST, p.id LIMIT $3 OFFSET $4`,
        [...values, size, ((query.page ?? 1) - 1) * size]);
      return { items, total };
    });
  }

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
