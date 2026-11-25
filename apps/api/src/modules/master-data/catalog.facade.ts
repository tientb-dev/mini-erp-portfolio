import { EntityManager } from 'typeorm';

export class CatalogFacade {
  static async contractItem(m: EntityManager, productId: number | null, temporaryProductId: number | null) {
    const [item] = productId !== null
      ? await m.query(`SELECT part_number AS code, name, description, unit_of_measure_id AS "unitOfMeasureId"
                        FROM products WHERE id = $1 AND is_active FOR UPDATE`, [productId])
      : await m.query(`SELECT code, name, description FROM temporary_products WHERE id = $1 FOR SHARE`, [temporaryProductId]);
    return item as { code: string; name: string; description: string | null; unitOfMeasureId?: number } | undefined;
  }
}
