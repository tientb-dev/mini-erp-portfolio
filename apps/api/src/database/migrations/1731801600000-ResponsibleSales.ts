import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Responsible sales per HĐ (03 §9.1, CT5/CT17, ADR-0013). Existing contracts stay NULL: the creator is not assumed
 * to be the responsible sales. NOT VALID keeps legacy ACTIVE rows readable/cancelable while every new activation
 * must carry a responsible sales.
 */
export class ResponsibleSales1731801600000 implements MigrationInterface {
  name = 'ResponsibleSales1731801600000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE sales_contracts ADD COLUMN responsible_sales_user_id int REFERENCES users(id);
      ALTER TABLE sales_contracts ADD CONSTRAINT chk_sales_contracts_responsible_sales
        CHECK (status <> 'ACTIVE' OR responsible_sales_user_id IS NOT NULL) NOT VALID;
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE sales_contracts DROP CONSTRAINT chk_sales_contracts_responsible_sales, DROP COLUMN responsible_sales_user_id`);
  }
}
