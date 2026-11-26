import { MigrationInterface, QueryRunner } from 'typeorm';

const tables = ['brands', 'units_of_measure', 'warehouses', 'customers', 'suppliers', 'currencies', 'tax_rates'];

export class MasterDataDescription1733356800000 implements MigrationInterface {
  async up(q: QueryRunner) {
    for (const table of tables) await q.query(`ALTER TABLE "${table}" ADD COLUMN description text`);
  }

  async down(q: QueryRunner) {
    for (const table of tables) await q.query(`ALTER TABLE "${table}" DROP COLUMN description`);
  }
}
