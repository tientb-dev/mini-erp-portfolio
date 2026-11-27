import { EntityManager } from 'typeorm';

/**
 * Single place that resolves grants (ADR-0018). Read paths use the view `v_user_grants` (active account + active role);
 * live checks inside a transaction use `grantRole(..., true)`, which locks the base rows. Business rules stay in modules.
 * Every function takes the caller's EntityManager so checks run in the same transaction as the write.
 */

/**
 * Active permissions, active role codes and warehouses of an active account; undefined when it cannot act.
 * With `sessionId` (every HTTP request) the session must also be open, unexpired and owned by the user (OA1.2).
 */
export async function loadGrants(m: EntityManager, userId: number, sessionId?: string): Promise<{
  id: number; username: string; fullName: string; mustChangePassword: boolean;
  permissions: string[]; roleCodes: string[]; warehouseIds: number[];
} | undefined> {
  const [user] = await m.query(`SELECT u.id, u.username, u.full_name AS "fullName", u.must_change_password AS "mustChangePassword",
      ARRAY(SELECT DISTINCT g.permission FROM v_user_grants g WHERE g.user_id = u.id ORDER BY 1) AS permissions,
      ARRAY(SELECT r.code FROM user_roles ur JOIN roles r ON r.id = ur.role_id AND r.is_active
        WHERE ur.user_id = u.id ORDER BY r.id) AS "roleCodes",
      ARRAY(SELECT uw.warehouse_id FROM user_warehouses uw WHERE uw.user_id = u.id ORDER BY 1) AS "warehouseIds"
    FROM users u WHERE u.id = $1 AND u.is_active
      AND ($2::uuid IS NULL OR EXISTS (SELECT 1 FROM user_sessions s WHERE s.id = $2 AND s.user_id = u.id
        AND s.revoked_at IS NULL AND s.expires_at > now()))`, [userId, sessionId ?? null]);
  return user;
}

/**
 * Coarse grant lock (F-OA1.3-09). A live grant check takes it shared; every administrative change that can revoke a
 * grant (role status, role permissions, role memberships, account disable) takes it exclusive before touching any row.
 * A single-statement FOR SHARE scan locks users/user_roles/roles/role_permissions in plan order, so without this gate a
 * revoke that locks the same rows in another order could form a wait cycle. Lock order everywhere:
 * admin-guard → grants → users rows (id order) → roles row → grant/membership rows.
 */
export const lockGrantsShared = (m: EntityManager) => m.query(`SELECT pg_advisory_xact_lock_shared(hashtext('grants'))`);
export const lockGrantsExclusive = (m: EntityManager) => m.query(`SELECT pg_advisory_xact_lock(hashtext('grants'))`);

/**
 * First active role (name) granting `permission` to an active user, or undefined.
 * `lock`: live check for workflow actions. Takes the grant gate shared, then FOR SHARE on the base rows (not the view),
 * so a concurrent revoke waits for this transaction and a revoke committed first is seen after the wait.
 */
export async function grantRole(m: EntityManager, userId: number, permission: string, lock = false): Promise<{ role: string; fullName: string } | undefined> {
  if (lock) await lockGrantsShared(m);
  const [grant] = lock
    ? await m.query(`SELECT r.name AS role, u.full_name AS "fullName" FROM users u JOIN user_roles ur ON ur.user_id = u.id
        JOIN roles r ON r.id = ur.role_id JOIN role_permissions rp ON rp.role_id = r.id
        JOIN permissions p ON p.id = rp.permission_id
        WHERE u.id = $1 AND u.is_active AND r.is_active AND p.code = $2
        ORDER BY r.id LIMIT 1 FOR SHARE OF u, ur, r, rp`, [userId, permission])
    : await m.query(`SELECT g.role_name AS role, u.full_name AS "fullName" FROM v_user_grants g JOIN users u ON u.id = g.user_id
        WHERE g.user_id = $1 AND g.permission = $2 ORDER BY g.role_id LIMIT 1`, [userId, permission]);
  return grant;
}

/** Active users holding `permission` (optionally in `warehouseId`), excluding `excludeUserId`. */
export function usersWithPermission(m: EntityManager, permission: string, excludeUserId: number, warehouseId?: number) {
  return m.query(
    `SELECT DISTINCT u.id, u.username, u.full_name AS "fullName"
       FROM v_user_grants g JOIN users u ON u.id = g.user_id
      WHERE g.permission = $1 AND u.id <> $2
        AND ($3::int IS NULL OR EXISTS (SELECT 1 FROM user_warehouses uw WHERE uw.user_id = u.id AND uw.warehouse_id = $3))
      ORDER BY u.username`,
    [permission, excludeUserId, warehouseId ?? null],
  ) as Promise<{ id: number; username: string; fullName: string }[]>;
}

/**
 * Last Admin Protection (BA-USR-08, BA-SEC-04). Call `lockAdminGuard` first in the transaction (lock order:
 * admin-guard → users rows → roles), apply the change, then check `activeAdminCount` (`assertAdminRemains`). Shared with role/membership
 * changes in OA1.3. A temporary login lockout does not remove admin standing.
 */
export const lockAdminGuard = (m: EntityManager) => m.query(`SELECT pg_advisory_xact_lock(hashtext('admin-guard'))`);
/** Active accounts holding an active system role. */
export async function activeAdminCount(m: EntityManager): Promise<number> {
  const [{ admins }] = await m.query(`SELECT count(DISTINCT u.id)::int AS admins FROM users u
    JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id AND r.is_system AND r.is_active
    WHERE u.is_active`);
  return admins;
}
