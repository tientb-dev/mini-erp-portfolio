import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { lockGrantsShared } from './authorization';
import { BusinessError } from '../workflow/workflow';

/**
 * Data Scope engine (OA3.2, ADR-0018 §5.3). Resolves effective scopes per permission and turns them into one SQL
 * predicate (lists, detail, assertCanRead) and one TypeScript predicate on a projected state (CREATE drafts); both
 * follow the same table below and are tested for parity. No business rules here; ADMIN has no bypass (it holds ALL
 * or every supported scope as rows, BA-OA3-02). Nothing is cached: load once per request/transaction.
 */
export type ScopeType = 'ALL' | 'CREATOR' | 'RESPONSIBLE' | 'ASSIGNED' | 'ORG_UNIT' | 'ORG_UNIT_TREE' | 'WAREHOUSE';

export interface DataScope {
  userId: number;
  /**
   * Granted permissions. `null`: unscoped permission (`supported_scopes = '{}'`), granted as is. Array: union of scope
   * rows of every active Role granting it (BA-SCP-05); a grant without scope rows adds nothing (fail-closed, F01), so
   * `[]` means granted but denied on data, while a valid grant from another Role still counts (BA-OA3-05).
   */
  grants: Record<string, ScopeType[] | null>;
  /** Units of every ACTIVE membership (BA-SCP-13). */
  orgUnitIds: number[];
  /** `orgUnitIds` plus all their descendants, any status. */
  orgTreeIds: number[];
  warehouseIds: number[];
  permissionNames?: Record<string, string>;
  permissionModules?: Record<string, string>;
  sources?: Record<string, { roleId: number; roleCode: string; roleName: string; scopes: ScopeType[] }[]>;
  orgUnits?: { id: number; code: string; name: string; parentId: number | null; isPrimary: boolean }[];
}

/**
 * One statement, so grants, scopes, memberships and the tree come from one snapshot. `lock`: for checks inside a
 * business transaction; takes the `grants` gate shared first (same as `grantRole(lock)`/`lockActor`, idempotent if held),
 * so every writer that can change the result (role scopes/grants, memberships, unit parent, account) waits for commit.
 * Call it before row locks, or after `lockActor` (which already holds the gate).
 */
export async function loadDataScope(m: EntityManager, userId: number, lock = false, describe = false): Promise<DataScope> {
  if (lock) await lockGrantsShared(m);
  const [row] = await m.query(`WITH g AS (
      SELECT g.permission, g.role_id, g.role_code, g.role_name, p.module, p.name, p.supported_scopes = '{}' AS unscoped, s.scope_type
        FROM v_user_grants g JOIN permissions p ON p.id = g.permission_id
        LEFT JOIN role_permission_scopes s ON s.role_id = g.role_id AND s.permission_id = g.permission_id
       WHERE g.user_id = $1),
    units AS (SELECT DISTINCT om.org_unit_id AS id FROM org_memberships om WHERE om.user_id = $1 AND om.status = 'ACTIVE'),
    tree AS (WITH RECURSIVE t AS (SELECT id FROM units UNION SELECT o.id FROM org_units o JOIN t ON o.parent_id = t.id) SELECT id FROM t)
    SELECT
      (SELECT coalesce(json_object_agg(x.permission, x.scopes), '{}') FROM (
         SELECT permission, CASE WHEN bool_or(unscoped) THEN NULL
           ELSE coalesce(array_agg(DISTINCT scope_type) FILTER (WHERE scope_type IS NOT NULL), '{}') END AS scopes
           FROM g GROUP BY permission) x) AS grants,
      CASE WHEN $2 THEN (SELECT coalesce(json_object_agg(permission, name), '{}')
        FROM (SELECT DISTINCT permission, name FROM g) names) END AS "permissionNames",
      CASE WHEN $2 THEN (SELECT coalesce(json_object_agg(permission, module), '{}')
        FROM (SELECT DISTINCT permission, module FROM g) modules) END AS "permissionModules",
      CASE WHEN $2 THEN (SELECT coalesce(json_object_agg(permission, roles), '{}') FROM (
        SELECT permission, json_agg(json_build_object('roleId', role_id, 'roleCode', role_code, 'roleName', role_name, 'scopes', scopes)
          ORDER BY role_code) AS roles FROM (
          SELECT permission, role_id, role_code, role_name,
            coalesce(array_agg(DISTINCT scope_type ORDER BY scope_type) FILTER (WHERE scope_type IS NOT NULL), '{}') AS scopes
          FROM g GROUP BY permission, role_id, role_code, role_name
        ) by_role GROUP BY permission
      ) by_permission) END AS sources,
      CASE WHEN $2 THEN (SELECT coalesce(json_agg(json_build_object('id', o.id, 'code', o.code, 'name', o.name, 'parentId', o.parent_id,
        'isPrimary', coalesce(om.is_primary, false)) ORDER BY o.code), '[]')
        FROM tree JOIN org_units o ON o.id = tree.id LEFT JOIN org_memberships om
          ON om.org_unit_id = o.id AND om.user_id = $1 AND om.status = 'ACTIVE') END AS "orgUnits",
      ARRAY(SELECT id FROM units ORDER BY 1) AS "orgUnitIds",
      ARRAY(SELECT id FROM tree ORDER BY 1) AS "orgTreeIds",
      ARRAY(SELECT uw.warehouse_id FROM user_warehouses uw WHERE uw.user_id = $1 ORDER BY 1) AS "warehouseIds"`, [userId, describe]);
  const { sources, orgUnits, permissionModules, permissionNames, ...scope } = row;
  return { userId, ...scope, ...(describe ? { sources, orgUnits, permissionModules, permissionNames } : {}) };
}

export const hasPermission = (s: DataScope, permission: string) => permission in s.grants;

/**
 * Columns the owning module declares (not a rule engine). `assigned` is an SQL boolean using `:uid` for the user id
 * (e.g. EXISTS over workflow nodes, current or past assignee, BA-OA3-04). A granted scope with no declared column is a
 * catalog/module mismatch and throws (supported_scopes must match the declared columns).
 */
export interface ScopeColumns {
  creator?: string; responsible?: string[]; assigned?: string; orgUnit?: string; warehouse?: string;
}

/**
 * SQL predicate for `permission`, placeholders from `$first`. `null` ⇒ deny (no grant, or grant with no scope).
 * Unscoped permission or ALL ⇒ `TRUE`. Otherwise OR of the user's scopes of that permission only (BA-AUTH-05).
 */
export function scopeFilter(s: DataScope, permission: string, cols: ScopeColumns, first = 1): { sql: string; params: unknown[] } | null {
  const scopes = s.grants[permission];
  if (scopes === undefined) return null;
  if (scopes === null || scopes.includes('ALL')) return { sql: 'TRUE', params: [] };
  if (!scopes.length) return null;
  const params: unknown[] = [];
  const p = (v: unknown) => { params.push(v); return `$${first + params.length - 1}`; };
  const col = (c: string | undefined, scope: ScopeType) => {
    if (!c) throw new Error(`Scope ${scope} of ${permission} has no declared column`);
    return c;
  };
  const parts = [...scopes].sort().map(scope => {
    switch (scope) {
      case 'CREATOR': return `${col(cols.creator, scope)} = ${p(s.userId)}`;
      case 'RESPONSIBLE': {
        if (!cols.responsible?.length) col(undefined, scope);
        const uid = p(s.userId);
        return `(${cols.responsible!.map(c => `${c} = ${uid}`).join(' OR ')})`;
      }
      case 'ASSIGNED': return `(${col(cols.assigned, scope).replace(/:uid\b/g, p(s.userId))})`;
      // NULL owner/warehouse never matches: `NULL = ANY(...)` is NULL, filtered out like FALSE (BA-SCP-12).
      case 'ORG_UNIT': return `${col(cols.orgUnit, scope)} = ANY(${p(s.orgUnitIds)}::int[])`;
      case 'ORG_UNIT_TREE': return `${col(cols.orgUnit, scope)} = ANY(${p(s.orgTreeIds)}::int[])`;
      case 'WAREHOUSE': return `${col(cols.warehouse, scope)} = ANY(${p(s.warehouseIds)}::int[])`;
      default: throw new Error(`Unknown scope ${scope}`);
    }
  });
  return { sql: `(${parts.join(' OR ')})`, params };
}

/** Projected document state for CREATE (F-OA0-03) or an in-memory row; missing/NULL fields never match. */
export interface ScopeDraft {
  creatorId?: number | null; responsibleIds?: (number | null)[]; assigneeIds?: number[];
  orgUnitId?: number | null; warehouseId?: number | null;
}

/** TypeScript twin of `scopeFilter`: same grants, same OR, same NULL handling. */
export function matchesDraft(s: DataScope, permission: string, d: ScopeDraft): boolean {
  const scopes = s.grants[permission];
  if (scopes === undefined) return false;
  if (scopes === null || scopes.includes('ALL')) return true;
  const inList = (v: number | null | undefined, list: number[]) => v != null && list.includes(v);
  return scopes.some(scope => {
    switch (scope) {
      case 'CREATOR': return d.creatorId != null && d.creatorId === s.userId;
      case 'RESPONSIBLE': return (d.responsibleIds ?? []).includes(s.userId);
      case 'ASSIGNED': return (d.assigneeIds ?? []).includes(s.userId);
      case 'ORG_UNIT': return inList(d.orgUnitId, s.orgUnitIds);
      case 'ORG_UNIT_TREE': return inList(d.orgUnitId, s.orgTreeIds);
      case 'WAREHOUSE': return inList(d.warehouseId, s.warehouseIds);
      default: return false;
    }
  });
}

/** Document source for row checks: `from` is a trusted table expression with alias, `id` the key column. */
export interface ScopeSource { from: string; id: string; cols: ScopeColumns }

/** Whether row `id` exists and matches `permission`'s scope (same predicate as lists). */
export async function inScope(m: EntityManager, s: DataScope, permission: string, src: ScopeSource, id: number): Promise<boolean> {
  const f = scopeFilter(s, permission, src.cols, 2);
  if (!f) return false;
  const [row] = await m.query(`SELECT 1 FROM ${src.from} WHERE ${src.id} = $1 AND ${f.sql}`, [id, ...f.params]);
  return Boolean(row);
}

/** BA-OA3-07: no VIEW → 403; VIEW but outside scope (or missing row) → 404, indistinguishable from an unknown id. */
export async function assertCanRead(m: EntityManager, s: DataScope, view: string, src: ScopeSource, id: number) {
  if (!hasPermission(s, view)) throw new ForbiddenException(`Missing permission: ${view}`);
  if (!(await inScope(m, s, view, src, id))) throw new NotFoundException();
}

/**
 * Action on an existing document (BA-AUTH-02/06): readable first (403/404 as above), then the action permission and its
 * own scope (403). Business rules come after, in the owning module. Inside a transaction load `s` with `lock`.
 */
export async function assertCanAct(m: EntityManager, s: DataScope, view: string, action: string, src: ScopeSource, id: number) {
  await assertCanRead(m, s, view, src, id);
  if (!hasPermission(s, action) || !(await inScope(m, s, action, src, id))) throw new ForbiddenException(`Missing permission: ${action}`);
}

/** CREATE on the projected state: action scope and read scope (`canAccessDraft`); re-check in the saving transaction. */
export const canAccessDraft = (s: DataScope, view: string, action: string, d: ScopeDraft) =>
  matchesDraft(s, action, d) && matchesDraft(s, view, d);

/**
 * Owner unit of a new HĐ/PR (§4.4, BA-OA3-06): undefined → primary unit; a number must be one of the creator's ACTIVE
 * memberships; NULL only when the creator has none. Never inherited from a source document (BA-SCP-11), fixed after
 * creation. Call under the `grants` gate (`loadDataScope(m, uid, true)`), so memberships cannot change meanwhile.
 */
export async function ownerOrgUnit(m: EntityManager, userId: number, requested: number | null | undefined): Promise<number | null> {
  const units: { id: number; primary: boolean }[] = await m.query(
    `SELECT org_unit_id AS id, is_primary AS primary FROM org_memberships WHERE user_id = $1 AND status = 'ACTIVE'`, [userId]);
  if (!units.length) {
    if (requested == null) return null;
  } else if (requested === undefined) {
    const primary = units.find((u) => u.primary);
    if (primary) return primary.id;
  } else if (units.some((u) => u.id === requested)) return requested!;
  throw new BusinessError('OWNER_ORG_UNIT_INVALID', 'The owner unit must be one of your active organization units');
}
