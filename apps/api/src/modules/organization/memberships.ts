import { HttpStatus } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { BusinessError } from '../workflow/workflow';

/** Desired ACTIVE membership of one employee, keyed by unit (one ACTIVE membership per unit). */
export interface MembershipSpec { orgUnitId: number; jobTitleId: number; managerUserId?: number | null; isPrimary: boolean }

interface Ref { id: number; code: string; name: string }
interface MembershipView { orgUnit: Ref; jobTitle: Ref; managerUserId: number | null; isPrimary: boolean }
export interface MembershipChanges { added: MembershipView[]; updated: { before: MembershipView; after: MembershipView }[]; ended: MembershipView[] }

const invalid = (code: string, message: string, status?: HttpStatus) => new BusinessError(code, message, status);

/** Advisory lock taken by every write to memberships or unit heads, right after the users/roles rows (§11.0 lock graph). */
export const lockOrgTree = (m: EntityManager) => m.query(`SELECT pg_advisory_xact_lock(hashtext('org-tree'))`);

/**
 * Replaces the employee's ACTIVE memberships with `specs` (BA-ORG-04/10/11/13, §4.3). Missing units are ENDED, never
 * deleted. The caller already holds the gate and the users rows of the employee and of every manager in `specs` (a
 * concurrent deactivation of a manager waits on that row). Lock order from here: org-tree → org_units
 * FOR SHARE → job_titles FOR SHARE → org_memberships FOR UPDATE. Re-joining a unit inserts a new row; ENDED rows stay (BA-ORG-13). Returns undefined when nothing changed.
 */
export async function saveMemberships(m: EntityManager, userId: number, actorId: number, specs: MembershipSpec[]): Promise<MembershipChanges | undefined> {
  const unitIds = specs.map(s => s.orgUnitId);
  if (new Set(unitIds).size !== unitIds.length) throw invalid('MEMBERSHIP_DUPLICATE_UNIT', 'An employee has one membership per unit');
  if (specs.length && specs.filter(s => s.isPrimary).length !== 1) {
    throw invalid('PRIMARY_ORG_UNIT_REQUIRED', 'Choose exactly one primary unit');
  }
  if (specs.some(s => s.managerUserId === userId)) throw invalid('MANAGER_SELF', 'An employee cannot be their own manager');

  // F05: org-tree alone serializes manager changes: this is the only writer of manager_user_id and it always takes org-tree.
  await lockOrgTree(m);
  const current: { id: number; org_unit_id: number; job_title_id: number; manager_user_id: number | null; is_primary: boolean }[] = await m.query(
    `SELECT id, org_unit_id, job_title_id, manager_user_id, is_primary FROM org_memberships WHERE user_id = $1 AND status = 'ACTIVE'`, [userId]);
  const allUnits = [...new Set([...unitIds, ...current.map(c => c.org_unit_id)])];
  const units: (Ref & { status: string; head_user_id: number | null })[] = await m.query(
    'SELECT id, code, name, status, head_user_id FROM org_units WHERE id = ANY($1) ORDER BY id FOR SHARE', [allUnits]);
  const allTitles = [...new Set([...specs.map(s => s.jobTitleId), ...current.map(c => c.job_title_id)])];
  const titles: (Ref & { status: string })[] = await m.query(
    'SELECT id, code, name, status FROM job_titles WHERE id = ANY($1) ORDER BY id FOR SHARE', [allTitles]);
  // Row locks last; the gate and org-tree already serialize writers, this keeps the documented order explicit.
  await m.query(`SELECT 1 FROM org_memberships WHERE user_id = $1 AND status = 'ACTIVE' ORDER BY id FOR UPDATE`, [userId]);

  const unit = (id: number) => units.find(u => u.id === id)!;
  const title = (id: number) => titles.find(t => t.id === id)!;
  const view = (s: { org_unit_id: number; job_title_id: number; manager_user_id: number | null; is_primary: boolean }): MembershipView => ({
    orgUnit: ref(unit(s.org_unit_id)), jobTitle: ref(title(s.job_title_id)), managerUserId: s.manager_user_id, isPrimary: s.is_primary });

  const changes: MembershipChanges = { added: [], updated: [], ended: [] };
  const writes: { spec: MembershipSpec; existing?: (typeof current)[number] }[] = [];
  for (const spec of specs) {
    const existing = current.find(c => c.org_unit_id === spec.orgUnitId);
    const manager = spec.managerUserId ?? null;
    const titleChanged = !existing || existing.job_title_id !== spec.jobTitleId;
    const managerChanged = !existing || existing.manager_user_id !== manager;
    if (existing && !titleChanged && !managerChanged && existing.is_primary === spec.isPrimary) continue;
    const u = units.find(x => x.id === spec.orgUnitId);
    if (!u) throw invalid('ORG_UNIT_NOT_FOUND', 'The unit does not exist');
    if (u.status !== 'ACTIVE') throw invalid('ORG_UNIT_INACTIVE', `Unit ${u.code} is inactive`, HttpStatus.CONFLICT);
    const t = titles.find(x => x.id === spec.jobTitleId);
    if (!t) throw invalid('JOB_TITLE_NOT_FOUND', 'The job title does not exist');
    if (titleChanged && t.status !== 'ACTIVE') throw invalid('JOB_TITLE_INACTIVE', `Job title ${t.code} is inactive`, HttpStatus.CONFLICT);
    if (manager !== null && managerChanged) {
      const [mgr] = await m.query('SELECT employment_status FROM users WHERE id = $1', [manager]);
      if (!mgr) throw invalid('MANAGER_NOT_FOUND', 'The manager does not exist');
      if (mgr.employment_status !== 'ACTIVE') throw invalid('MANAGER_INACTIVE', 'The manager is not an active employee', HttpStatus.CONFLICT);
    }
    writes.push({ spec, existing });
  }
  const ended = current.filter(c => !unitIds.includes(c.org_unit_id));
  for (const e of ended) {
    // BA-N-05: the head keeps the membership until the unit gets another head or none.
    if (unit(e.org_unit_id).head_user_id === userId) {
      throw invalid('ORG_UNIT_HEAD_MEMBERSHIP', `The employee heads ${unit(e.org_unit_id).code}; change the head first`, HttpStatus.CONFLICT);
    }
  }
  if (!writes.length && !ended.length) return undefined;

  if (ended.length) {
    await m.query(`UPDATE org_memberships SET status = 'ENDED', ended_at = now(), version = version + 1, updated_at = now(), updated_by = $2
      WHERE id = ANY($1)`, [ended.map(e => e.id), actorId]);
    changes.ended = ended.map(view);
  }
  // Clearing a primary flag goes before setting one: the partial unique index allows one ACTIVE primary at a time.
  for (const { spec, existing } of writes.sort((a, b) => Number(a.spec.isPrimary) - Number(b.spec.isPrimary))) {
    const next = { org_unit_id: spec.orgUnitId, job_title_id: spec.jobTitleId, manager_user_id: spec.managerUserId ?? null, is_primary: spec.isPrimary };
    if (existing) {
      await m.query(`UPDATE org_memberships SET job_title_id = $2, manager_user_id = $3, is_primary = $4, version = version + 1,
        updated_at = now(), updated_by = $5 WHERE id = $1`, [existing.id, next.job_title_id, next.manager_user_id, next.is_primary, actorId]);
      changes.updated.push({ before: view(existing), after: view(next) });
    } else {
      await m.query(`INSERT INTO org_memberships (user_id, org_unit_id, job_title_id, manager_user_id, is_primary, created_by, updated_by)
        VALUES ($1, $2, $3, $4, $5, $6, $6)`, [userId, next.org_unit_id, next.job_title_id, next.manager_user_id, next.is_primary, actorId]);
      changes.added.push(view(next));
    }
  }
  // BA-ORG-11: walking up the manager chain of ACTIVE memberships must not reach the employee (under org-tree).
  const [cycle] = await m.query(`WITH RECURSIVE up AS (
      SELECT manager_user_id AS id FROM org_memberships WHERE user_id = $1 AND status = 'ACTIVE' AND manager_user_id IS NOT NULL
      UNION SELECT o.manager_user_id FROM org_memberships o JOIN up ON o.user_id = up.id WHERE o.status = 'ACTIVE' AND o.manager_user_id IS NOT NULL)
    SELECT 1 FROM up WHERE id = $1`, [userId]);
  if (cycle) throw invalid('MANAGER_CYCLE', 'The manager chain would loop back to this employee', HttpStatus.CONFLICT);
  return changes;
}

/**
 * BA-N-06: an employee who heads a unit or directly manages an ACTIVE membership cannot be deactivated. The caller holds
 * the employee's users row FOR UPDATE; every head/manager assignment locks that row first, so neither side can race.
 */
export async function assertNotHeadOrManager(m: EntityManager, userId: number) {
  const [head] = await m.query('SELECT code FROM org_units WHERE head_user_id = $1 LIMIT 1', [userId]);
  if (head) throw invalid('EMPLOYEE_IS_HEAD', `The employee heads unit ${head.code}; change the head first`, HttpStatus.CONFLICT);
  const [managed] = await m.query(`SELECT 1 FROM org_memberships WHERE manager_user_id = $1 AND status = 'ACTIVE' LIMIT 1`, [userId]);
  if (managed) throw invalid('EMPLOYEE_IS_MANAGER', 'The employee is a direct manager; reassign their reports first', HttpStatus.CONFLICT);
}

const ref = (r: Ref): Ref => ({ id: r.id, code: r.code, name: r.name });

/** ACTIVE memberships of an employee as specs (base of the membership API, which edits this set and saves it back). */
export async function currentMemberships(m: EntityManager, userId: number): Promise<(MembershipSpec & { id: number; version: number })[]> {
  return m.query(`SELECT id, version, org_unit_id AS "orgUnitId", job_title_id AS "jobTitleId", manager_user_id AS "managerUserId",
    is_primary AS "isPrimary" FROM org_memberships WHERE user_id = $1 AND status = 'ACTIVE' ORDER BY id`, [userId]);
}

export async function activeManagerIds(m: EntityManager, userId: number): Promise<number[]> {
  return (await currentMemberships(m, userId)).map(s => s.managerUserId).filter((x): x is number => x != null);
}

/**
 * Closure F01: an employee is reactivated only when every ACTIVE membership still meets today's rules: unit ACTIVE, job
 * title ACTIVE, manager an ACTIVE employee. The caller holds the exclusive gate and the users rows of the employee and
 * managers; order continues org-tree → org_units FOR SHARE → job_titles FOR SHARE. Invalid data is reported, never fixed.
 */
export async function assertMembershipsValid(m: EntityManager, userId: number) {
  await lockOrgTree(m);
  const rows: { unit_code: string; unit_status: string; title_code: string; title_status: string; manager_status: string | null }[] = await m.query(
    `SELECT o.code AS unit_code, o.status AS unit_status, jt.code AS title_code, jt.status AS title_status, mg.employment_status AS manager_status
       FROM org_memberships om JOIN org_units o ON o.id = om.org_unit_id JOIN job_titles jt ON jt.id = om.job_title_id
       LEFT JOIN users mg ON mg.id = om.manager_user_id
      WHERE om.user_id = $1 AND om.status = 'ACTIVE' ORDER BY o.id FOR SHARE OF o, jt`, [userId]);
  for (const r of rows) {
    if (r.unit_status !== 'ACTIVE') throw invalid('ORG_UNIT_INACTIVE', `Unit ${r.unit_code} is inactive; end or move that membership first`, HttpStatus.CONFLICT);
    if (r.title_status !== 'ACTIVE') throw invalid('JOB_TITLE_INACTIVE', `Job title ${r.title_code} is inactive; change it first`, HttpStatus.CONFLICT);
    if (r.manager_status && r.manager_status !== 'ACTIVE') throw invalid('MANAGER_INACTIVE', 'A direct manager is inactive; change it first', HttpStatus.CONFLICT);
  }
}
