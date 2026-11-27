import { EntityManager } from 'typeorm';

/**
 * Initial grants of the scoped permissions, approved by BA at OA3.0 (BA-N-13). Keyed by the seeded business role codes;
 * a role outside this list (custom role) is never inferred (BA OA3.0 §2). ADMIN is handled by the migration triggers.
 * A scoped permission a mapped role holds but this list omits is removed (e.g. SALES_CONTRACT.VIEW from COMMON).
 */
export const OA3_GRANTS: Record<string, Record<string, string[]>> = {
  SALES: {
    'SALES_CONTRACT.VIEW': ['CREATOR', 'RESPONSIBLE'], 'SALES_CONTRACT.CREATE': ['CREATOR', 'RESPONSIBLE'],
    'PR.VIEW': ['CREATOR', 'RESPONSIBLE', 'ASSIGNED'], 'PR.CREATE': ['CREATOR', 'RESPONSIBLE'],
  },
  PM: {
    'SALES_CONTRACT.VIEW': ['RESPONSIBLE'],
    'PR.VIEW': ['CREATOR', 'RESPONSIBLE', 'ASSIGNED'], 'PR.CREATE': ['CREATOR', 'RESPONSIBLE'],
  },
  PURCHASING: { 'PR.VIEW': ['ALL'], 'PR.RECEIVE': ['ASSIGNED'] },
  SALES_HEAD: { 'PR.VIEW': ['ASSIGNED'], 'PR.APPROVE': ['ASSIGNED'] },
  PM_HEAD: { 'PR.VIEW': ['ASSIGNED'], 'PR.APPROVE': ['ASSIGNED'] },
  WAREHOUSE_MANAGER: {},
};

export interface GrantPlan {
  /** `ROLE>PERMISSION` grants to add, with their scopes. */
  add: { role: string; permission: string; scopes: string[] }[];
  /** Scoped grants of a mapped role that the approved matrix does not list. */
  remove: { role: string; permission: string }[];
  /** Existing grants whose scopes are set (or replaced) to the approved ones. */
  rescope: { role: string; permission: string; before: string[]; after: string[] }[];
  /** Custom roles holding scoped permissions: left as administered, fail-closed until an admin sets scopes. */
  unmapped: { role: string; permission: string }[];
}

/**
 * Read-only plan for converting existing grants to the approved matrix (dry-run; applied with snapshot at OA3.5).
 * shortcut: plan only, no apply mode; OA3.5 adds apply + before/after snapshot (§8.3).
 */
export async function planGrantMapping(m: EntityManager): Promise<GrantPlan> {
  const held: { role: string; permission: string; scopes: string[] }[] = await m.query(`
    SELECT r.code AS role, p.code AS permission,
      ARRAY(SELECT s.scope_type FROM role_permission_scopes s WHERE s.role_id = r.id AND s.permission_id = p.id ORDER BY s.scope_type COLLATE "C") AS scopes
      FROM role_permissions rp JOIN roles r ON r.id = rp.role_id AND NOT r.is_system
      JOIN permissions p ON p.id = rp.permission_id AND p.supported_scopes <> '{}' ORDER BY 1, 2`);
  const roles: string[] = (await m.query('SELECT code FROM roles WHERE NOT is_system')).map((r: { code: string }) => r.code);
  const plan: GrantPlan = { add: [], remove: [], rescope: [], unmapped: [] };
  for (const h of held) {
    const target = OA3_GRANTS[h.role];
    if (!target) plan.unmapped.push({ role: h.role, permission: h.permission });
    else if (!target[h.permission]) plan.remove.push({ role: h.role, permission: h.permission });
    else if ([...target[h.permission]].sort().join() !== h.scopes.join()) {
      plan.rescope.push({ role: h.role, permission: h.permission, before: h.scopes, after: target[h.permission] });
    }
  }
  for (const [role, grants] of Object.entries(OA3_GRANTS)) {
    if (!roles.includes(role)) continue;
    for (const [permission, scopes] of Object.entries(grants)) {
      if (!held.some(h => h.role === role && h.permission === permission)) plan.add.push({ role, permission, scopes });
    }
  }
  return plan;
}
