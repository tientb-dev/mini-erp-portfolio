import { MigrationInterface, QueryRunner } from 'typeorm';

export class PrWorkflow1732406400000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM purchase_requisitions) THEN
          RAISE EXCEPTION 'PR workflow migration requires empty purchase_requisitions';
        END IF;
      END $$;
      ALTER TABLE sales_contracts ADD COLUMN responsible_pm_user_id int REFERENCES users(id);
      ALTER TABLE purchase_requisitions DROP CONSTRAINT purchase_requisitions_approval_status_check,
        ADD COLUMN creator_route text NOT NULL CHECK (creator_route IN ('SALES', 'PM')),
        ADD COLUMN approval_round int NOT NULL DEFAULT 0,
        ADD CONSTRAINT purchase_requisitions_approval_status_check CHECK
          (approval_status IN ('DRAFT', 'WAITING_FOR_APPROVE', 'WAITING_FOR_RECEIPT', 'DONE', 'REJECTED', 'CANCELED'));
      CREATE TABLE pr_workflow_routes (
        route text PRIMARY KEY CHECK (route IN ('SALES', 'PM')),
        approver_id int NOT NULL REFERENCES users(id),
        receiver_id int NOT NULL REFERENCES users(id),
        receipt_role text NOT NULL REFERENCES roles(code)
      );
      CREATE TABLE pr_workflow_nodes (
        pr_id int NOT NULL REFERENCES purchase_requisitions(id),
        round int NOT NULL,
        step text NOT NULL CHECK (step IN ('APPROVAL', 'RECEIPT')),
        department text NOT NULL,
        assignee_id int NOT NULL REFERENCES users(id),
        result text CHECK (result IN ('APPROVED', 'REJECTED')),
        actor_id int REFERENCES users(id),
        acted_at timestamptz,
        invalidated_at timestamptz,
        PRIMARY KEY (pr_id, round, step)
      );
      ALTER TABLE approval_histories ADD COLUMN approval_round int,
        ADD COLUMN previous_status text, ADD COLUMN next_status text;
      CREATE TABLE pr_notes (
        id serial PRIMARY KEY,
        pr_id int NOT NULL REFERENCES purchase_requisitions(id),
        author_id int NOT NULL REFERENCES users(id),
        body text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE pr_notifications (
        id serial PRIMARY KEY,
        pr_id int NOT NULL REFERENCES purchase_requisitions(id),
        recipient_id int NOT NULL REFERENCES users(id),
        action text NOT NULL,
        round int NOT NULL,
        reason text,
        created_at timestamptz NOT NULL DEFAULT now(),
        read_at timestamptz
      );
      CREATE INDEX pr_notifications_recipient_idx ON pr_notifications (recipient_id, id DESC);
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`
      DROP TABLE pr_notifications, pr_notes, pr_workflow_nodes, pr_workflow_routes;
      ALTER TABLE approval_histories DROP COLUMN approval_round, DROP COLUMN previous_status, DROP COLUMN next_status;
      ALTER TABLE purchase_requisitions DROP CONSTRAINT purchase_requisitions_approval_status_check,
        DROP COLUMN creator_route, DROP COLUMN approval_round,
        ADD CONSTRAINT purchase_requisitions_approval_status_check CHECK
          (approval_status IN ('DRAFT', 'WAITING_FOR_APPROVE', 'APPROVED', 'REJECTED', 'CANCELED'));
      ALTER TABLE sales_contracts DROP COLUMN responsible_pm_user_id;
    `);
  }
}
