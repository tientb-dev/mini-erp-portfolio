import { EntityManager } from 'typeorm';

export const DOCUMENT_TARGETS = ['PR', 'PO', 'GRR', 'GIR', 'GR', 'GI', 'SALES_CONTRACT'] as const;
export type DocumentTarget = typeof DOCUMENT_TARGETS[number];
/** Activity History targets: documents plus administration targets (USER security events, ROLE changes). */
export type ActivityTarget = DocumentTarget | 'USER' | 'ROLE';
export const DOCUMENT_PAGE_SIZE = 25;

export interface ActivityDetails {
  round?: number;
  previousStatus?: string;
  nextStatus?: string;
  metadata?: Record<string, unknown>;
}

// Callers authorize the target through its owning module, using the same manager for writes.
export function insertNote(m: EntityManager, type: DocumentTarget, id: number, authorId: number, body: string) {
  return m.query('INSERT INTO document_notes (target_type, target_id, author_id, body) VALUES ($1, $2, $3, $4)',
    [type, id, authorId, body]);
}

/** `USER` and `ROLE` are administration targets (OA1.2, OA1.3); they are not document targets for notes or dossiers. */
export function appendActivity(m: EntityManager, type: ActivityTarget, id: number, action: string, actorId: number,
  reason?: string, details: ActivityDetails = {}) {
  return m.query(`INSERT INTO approval_histories
    (document_type, document_id, action, actor_id, reason, previous_status, next_status, approval_round, metadata)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [type, id, action, actorId, reason ?? null, details.previousStatus ?? null, details.nextStatus ?? null,
      details.round ?? null, details.metadata ?? null]);
}

const activityColumns = `h.action, h.reason, h.approval_round AS round, h.previous_status AS "previousStatus",
  h.next_status AS "nextStatus", h.created_at AS "createdAt", u.full_name AS "actorName"`;

export function legacyActivityList(m: EntityManager, type: DocumentTarget, id: number) {
  return m.query(`SELECT ${activityColumns} FROM approval_histories h JOIN users u ON u.id = h.actor_id
    WHERE h.document_type = $1 AND h.document_id = $2 ORDER BY h.id`, [type, id]);
}

export async function latestRoundActivity(m: EntityManager, type: DocumentTarget, id: number, round: number, action: string) {
  const [entry] = await m.query(`SELECT h.id, ${activityColumns}, h.metadata
    FROM approval_histories h JOIN users u ON u.id = h.actor_id
    WHERE h.document_type = $1 AND h.document_id = $2 AND h.approval_round = $3 AND h.action = $4
    ORDER BY h.id DESC LIMIT 1`, [type, id, round, action]);
  return entry ?? null;
}

export async function documentPage(m: EntityManager, type: ActivityTarget, id: number, kind: 'notes' | 'history', before?: number) {
  const rows: { id: number }[] = await m.query(kind === 'notes'
    ? `SELECT n.id, n.body, n.created_at AS "createdAt", u.full_name AS "authorName"
       FROM document_notes n JOIN users u ON u.id = n.author_id
       WHERE n.target_type = $1 AND n.target_id = $2 AND ($3::int IS NULL OR n.id < $3)
       ORDER BY n.id DESC LIMIT $4`
    : `SELECT h.id, ${activityColumns}, h.actor_id AS "actorId", h.metadata
       FROM approval_histories h JOIN users u ON u.id = h.actor_id
       WHERE h.document_type = $1 AND h.document_id = $2 AND ($3::int IS NULL OR h.id < $3)
       ORDER BY h.id DESC LIMIT $4`, [type, id, before ?? null, DOCUMENT_PAGE_SIZE + 1]);
  const items = rows.slice(0, DOCUMENT_PAGE_SIZE);
  return { items, nextCursor: rows.length > DOCUMENT_PAGE_SIZE ? items.at(-1)!.id : null };
}
