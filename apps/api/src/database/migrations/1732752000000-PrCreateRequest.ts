import { MigrationInterface, QueryRunner } from 'typeorm';

export class PrCreateRequest1732752000000 implements MigrationInterface {
  async up(q: QueryRunner) {
    await q.query(`ALTER TABLE purchase_requisitions ADD COLUMN create_request_key uuid, ADD COLUMN create_request_fingerprint text;
      CREATE UNIQUE INDEX idx_pr_create_request ON purchase_requisitions (created_by, create_request_key)
      WHERE create_request_key IS NOT NULL`);
  }

  async down(q: QueryRunner) {
    await q.query(`DROP INDEX idx_pr_create_request;
      ALTER TABLE purchase_requisitions DROP COLUMN create_request_key, DROP COLUMN create_request_fingerprint`);
  }
}
