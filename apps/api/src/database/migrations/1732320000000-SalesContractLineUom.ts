import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * HĐ lines reference the UoM catalog (PR #16): `unit_of_measure_id` NOT NULL replaces the free-text `uom_name`.
 * Existing rows are mapped only on an exact name match with exactly one catalog entry. If any row cannot be mapped the
 * migration fails (and rolls back) instead of guessing or deleting data; fix or reset that data first. The FK (NO ACTION)
 * blocks deleting a UoM still used by a line.
 */
export class SalesContractLineUom1732320000000 implements MigrationInterface {
  name = 'SalesContractLineUom1732320000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE sales_contract_lines ADD COLUMN unit_of_measure_id int REFERENCES units_of_measure(id);
      UPDATE sales_contract_lines l SET unit_of_measure_id = u.id
        FROM units_of_measure u
       WHERE u.name = l.uom_name AND (SELECT COUNT(*) FROM units_of_measure x WHERE x.name = l.uom_name) = 1;
    `);
    const unmapped: { uom_name: string; count: number }[] = await q.query(
      `SELECT uom_name, COUNT(*)::int AS count FROM sales_contract_lines WHERE unit_of_measure_id IS NULL GROUP BY uom_name ORDER BY uom_name`);
    if (unmapped.length) {
      throw new Error(`sales_contract_lines with a UoM not in the catalog: ${unmapped.map((r) => `"${r.uom_name}" (${r.count})`).join(', ')}. ` +
        'Add the UoM to units_of_measure or fix these lines, then rerun the migration.');
    }
    await q.query(`ALTER TABLE sales_contract_lines ALTER COLUMN unit_of_measure_id SET NOT NULL, DROP COLUMN uom_name`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE sales_contract_lines ADD COLUMN uom_name varchar(50);
      UPDATE sales_contract_lines l SET uom_name = u.name FROM units_of_measure u WHERE u.id = l.unit_of_measure_id;
      ALTER TABLE sales_contract_lines ALTER COLUMN uom_name SET NOT NULL, DROP COLUMN unit_of_measure_id;
    `);
  }
}
