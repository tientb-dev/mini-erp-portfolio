import { EntityManager } from 'typeorm';

export type PrPendingStep = 'APPROVAL' | 'RECEIPT';

export function notifyPr(m: EntityManager, id: number, recipients: number[], action: string, round: number, reason?: string) {
  return m.query(`INSERT INTO pr_notifications (pr_id, recipient_id, action, round, reason)
    SELECT $1, id, $3, $4, $5 FROM unnest($2::int[]) AS recipients(id) GROUP BY id`, [id, recipients, action, round, reason ?? null]);
}

export function assignPrTask(m: EntityManager, id: number, recipient: number, round: number, step: PrPendingStep) {
  return m.query(`INSERT INTO pr_notifications (pr_id, recipient_id, action, round, task_step) VALUES ($1, $2, $3, $4, $5)`,
    [id, recipient, step === 'APPROVAL' ? 'REQUEST_APPROVAL' : 'REQUEST_RECEIPT', round, step]);
}

export function resolvePrTasks(m: EntityManager, id: number, round: number) {
  return m.query(`UPDATE pr_notifications SET resolved_at = now()
    WHERE pr_id = $1 AND round = $2 AND task_step IS NOT NULL AND resolved_at IS NULL`, [id, round]);
}
