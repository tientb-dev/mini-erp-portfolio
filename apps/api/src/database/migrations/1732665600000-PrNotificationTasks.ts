import { MigrationInterface, QueryRunner } from 'typeorm';

export class PrNotificationTasks1732665600000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE pr_notifications ADD COLUMN task_step text CHECK (task_step IN ('APPROVAL', 'RECEIPT')),
        ADD COLUMN resolved_at timestamptz;
      UPDATE pr_notifications n SET task_step = CASE WHEN n.action = 'SUBMIT' THEN 'APPROVAL' ELSE 'RECEIPT' END,
        action = CASE WHEN n.action = 'SUBMIT' THEN 'REQUEST_APPROVAL' ELSE 'REQUEST_RECEIPT' END, resolved_at = now()
        FROM purchase_requisitions pr WHERE pr.id = n.pr_id
        AND (n.action = 'SUBMIT' OR (n.action = 'APPROVE' AND n.recipient_id <> pr.created_by));
      UPDATE pr_notifications n SET resolved_at = NULL FROM (
        SELECT DISTINCT ON (n.pr_id, n.round, n.task_step) n.id
        FROM pr_notifications n JOIN purchase_requisitions pr ON pr.id = n.pr_id
        WHERE n.round = pr.approval_round AND n.recipient_id = pr.assigned_approver_id AND
          ((n.task_step = 'APPROVAL' AND pr.approval_status = 'WAITING_FOR_APPROVE') OR
           (n.task_step = 'RECEIPT' AND pr.approval_status = 'WAITING_FOR_RECEIPT'))
        ORDER BY n.pr_id, n.round, n.task_step, n.id DESC
      ) current_tasks WHERE n.id = current_tasks.id;
      CREATE UNIQUE INDEX idx_pr_notification_open_task ON pr_notifications (pr_id)
        WHERE task_step IS NOT NULL AND resolved_at IS NULL;
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`
      DROP INDEX idx_pr_notification_open_task;
      UPDATE pr_notifications SET action = 'SUBMIT' WHERE action = 'REQUEST_APPROVAL';
      UPDATE pr_notifications SET action = 'APPROVE' WHERE action = 'REQUEST_RECEIPT';
      ALTER TABLE pr_notifications DROP COLUMN task_step, DROP COLUMN resolved_at;
    `);
  }
}
