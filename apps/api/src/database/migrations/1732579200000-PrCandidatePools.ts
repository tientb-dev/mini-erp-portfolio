import { MigrationInterface, QueryRunner } from 'typeorm';

export class PrCandidatePools1732579200000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE pr_candidate_pool_members (
        pool text NOT NULL CHECK (pool IN ('SALES', 'PM', 'RECEIPT')),
        user_id int NOT NULL REFERENCES users(id),
        PRIMARY KEY (pool, user_id)
      );
      INSERT INTO pr_candidate_pool_members (pool, user_id)
        SELECT route, approver_id FROM pr_workflow_routes
        UNION SELECT 'RECEIPT', receiver_id FROM pr_workflow_routes;
      DROP TABLE pr_workflow_routes;
      ALTER TABLE purchase_requisitions ADD COLUMN draft_approver_id int REFERENCES users(id),
        ADD COLUMN draft_receiver_id int REFERENCES users(id);
    `);
  }

  async down(): Promise<void> {
    throw new Error('Candidate pools cannot be rolled back losslessly to a single assignment per route');
  }
}
