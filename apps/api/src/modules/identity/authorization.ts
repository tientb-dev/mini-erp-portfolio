import { EntityManager } from 'typeorm';

/**
 * Single place that resolves grants (ADR-0018). Read paths use the view `v_user_grants` (active account + active role);
 * live checks inside a transaction use `grantRole(..., true)`, which locks the base rows. Business rules stay in modules.
 * Every function takes the caller's EntityManager so checks run in the same transaction as the write.
 */

/** Active permissions, active role codes and warehouses of an active account; undefined when it cannot sign in. */
export async function loadGrants(m: EntityManager, userId: number): Promise<{
  id: number; username: string; fullName: string; permissions: string[]; roleCodes: string[]; warehouseIds: number[];
} | undefined> {
  const [user] = await m.query(`SELECT u.id, u.username, u.full_name AS "fullName",
      ARRAY(SELECT DISTINCT g.permission FROM v_user_grants g WHERE g.user_id = u.id ORDER BY 1) AS permissions,
      ARRAY(SELECT r.code FROM user_roles ur JOIN roles r ON r.id = ur.role_id AND r.is_active
        WHERE ur.user_id = u.id ORDER BY r.id) AS "roleCodes",
      ARRAY(SELECT uw.warehouse_id FROM user_warehouses uw WHERE uw.user_id = u.id ORDER BY 1) AS "warehouseIds"
    FROM users u WHERE u.id = $1 AND u.is_active`, [userId]);
  return user;
}

/**
 * First active role (name) granting `permission` to an active user, or undefined.
 * `lock`: live check for workflow actions. FOR SHARE on the base rows (not the view) so a concurrent revoke of the
 * user, role membership, role status or grant waits for this transaction, and a committed revoke is seen after the wait.
 */
export async function grantRole(m: EntityManager, userId: number, permission: string, lock = false): Promise<{ role: string; fullName: string } | undefined> {
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
