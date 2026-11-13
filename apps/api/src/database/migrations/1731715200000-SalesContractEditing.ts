import { MigrationInterface, QueryRunner } from 'typeorm';

/** Optimistic concurrency and last-editor audit for editing DRAFT sales contracts (03 §9.1, ARCHITECTURE §1.1). */
export class SalesContractEditing1731715200000 implements MigrationInterface {
  name = 'SalesContractEditing1731715200000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE sales_contracts
        ADD COLUMN version int NOT NULL DEFAULT 1,
        ADD COLUMN updated_by int REFERENCES users(id),
        ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE sales_contracts DROP COLUMN version, DROP COLUMN updated_by, DROP COLUMN updated_at`);
  }
}
