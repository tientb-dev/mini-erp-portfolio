import { EntityManager } from 'typeorm';
import { BusinessError } from '../workflow/workflow';

export const PR_POOLS = ['SALES', 'PM', 'RECEIPT'] as const;
export type PrPool = typeof PR_POOLS[number];
export type PrRoute = Exclude<PrPool, 'RECEIPT'>;
const permissionFor = (pool: PrPool) => pool === 'RECEIPT' ? 'PR.RECEIVE' : 'PR.APPROVE';

interface Candidate {
  id: number;
  fullName: string;
  username: string;
  role: string;
}

export function lockPool(m: EntityManager, pool: PrPool, exclusive: boolean) {
  const lock = exclusive ? 'pg_advisory_xact_lock' : 'pg_advisory_xact_lock_shared';
  return m.query(`SELECT ${lock}(hashtext('pr-candidate-pool'), hashtext($1))`, [pool]);
}

export function currentGrant(m: EntityManager, id: number, permission: string): Promise<{ role: string; fullName: string }[]> {
  return m.query(`SELECT r.name AS role, u.full_name AS "fullName" FROM users u JOIN user_roles ur ON ur.user_id = u.id
    JOIN roles r ON r.id = ur.role_id JOIN role_permissions rp ON rp.role_id = r.id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE u.id = $1 AND u.is_active AND p.code = $2
    ORDER BY r.id LIMIT 1 FOR SHARE OF u, ur, rp`, [id, permission]);
}

export function listCandidates(m: EntityManager, pool: PrPool, exclude: number | null = null, configured = true): Promise<Candidate[]> {
  return m.query(`SELECT DISTINCT ON (u.id) u.id, u.full_name AS "fullName", u.username, r.name AS role
    FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
    JOIN role_permissions rp ON rp.role_id = r.id JOIN permissions p ON p.id = rp.permission_id
    WHERE u.is_active AND p.code = $2 AND ($3::int IS NULL OR u.id <> $3)
      AND (NOT $4 OR EXISTS (SELECT 1 FROM pr_candidate_pool_members c WHERE c.pool = $1 AND c.user_id = u.id))
    ORDER BY u.id, r.id`, [pool, permissionFor(pool), exclude, configured]);
}

export async function eligible(m: EntityManager, pool: PrPool, userId: number, creatorId: number) {
  if (userId === creatorId) return undefined;
  await lockPool(m, pool, false);
  const [member] = await m.query('SELECT user_id FROM pr_candidate_pool_members WHERE pool = $1 AND user_id = $2', [pool, userId]);
  if (!member) return undefined;
  const [grant] = await currentGrant(m, userId, permissionFor(pool));
  return grant;
}

export async function configurePool(m: EntityManager, pool: PrPool, userIds: number[]) {
  await lockPool(m, pool, true);
  const candidates = await listCandidates(m, pool, null, false);
  if (userIds.some(id => !candidates.some(candidate => candidate.id === id))) {
    throw new BusinessError('PR_CANDIDATE_NOT_ELIGIBLE', 'Select active users with permission for this candidate pool');
  }
  await m.query('DELETE FROM pr_candidate_pool_members WHERE pool = $1', [pool]);
  await m.query('INSERT INTO pr_candidate_pool_members (pool, user_id) SELECT $1, unnest($2::int[])', [pool, userIds]);
}
