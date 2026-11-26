import { MigrationInterface, QueryRunner } from 'typeorm';

const tables = ['brands', 'temporary_products', 'units_of_measure', 'customers', 'suppliers', 'currencies', 'tax_rates'];

export class MasterDataStatus1733011200000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    for (const table of tables) await q.query(`ALTER TABLE ${table} ADD COLUMN is_active boolean NOT NULL DEFAULT true`);
  }

  async down(q: QueryRunner): Promise<void> {
    for (const table of tables) await q.query(`ALTER TABLE ${table} DROP COLUMN is_active`);
  }
}
