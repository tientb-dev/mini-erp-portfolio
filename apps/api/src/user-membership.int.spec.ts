import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { dataSourceOptions } from './database/data-source';
import { activeAdminCount } from './modules/identity/authorization';
import { bootTestApp, login } from './test-utils';

const PW = 'initial passphrase 1';
type Spec = { orgUnitId: number; jobTitleId: number; managerUserId?: number | null; isPrimary: boolean };

describe('User management OA2.3b: memberships, roles, warehouses, atomic save (PostgreSQL, HTTP)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let admin: string;
  let adminId: number;
  let salesRole: number;
  let adminRole: number;
  let warehouse: number;
  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, url: string) => http().get(url).set(bearer(t));
  const ver = async (id: number) => (await ds.query('SELECT version FROM users WHERE id = $1', [id]))[0].version as number;
  const detail = async (id: number) => (await get(admin, `/admin/users/${id}`).expect(200)).body;
  const save = async (t: string, id: number, body: object, version?: number) => {
    const d = await detail(id);
    return http().put(`/admin/users/${id}`).set(bearer(t))
      .send({ profile: { fullName: d.fullName, email: d.email, phone: d.phone }, version: version ?? d.version, ...body });
  };
  const userEvents = async (id: number) => (await ds.query(`SELECT action, metadata FROM approval_histories
    WHERE document_type = 'USER' AND document_id = $1 ORDER BY id`, [id])) as { action: string; metadata: Record<string, any> }[];
  const roleEvents = async (id: number) => (await ds.query(`SELECT action, metadata FROM approval_histories
    WHERE document_type = 'ROLE' AND document_id = $1 ORDER BY id`, [id])) as { action: string; metadata: Record<string, any> }[];
  const roleVersion = async (id: number) => (await ds.query('SELECT version FROM roles WHERE id = $1', [id]))[0].version as number;
  const unitOf = async (id: number) => (await get(admin, `/admin/org-units/${id}`).expect(200)).body;
  const unitStatus = async (t: string, id: number, isActive: boolean) =>
    http().patch(`/admin/org-units/${id}/status`).set(bearer(t)).send({ isActive, version: (await unitOf(id)).version });
  const setHead = async (t: string, id: number, headUserId: number | null) => {
    const u = await unitOf(id);
    return http().put(`/admin/org-units/${id}`).set(bearer(t))
      .send({ name: u.name, description: u.description, parentId: u.parent?.id ?? null, headUserId, version: u.version });
  };
  const titleStatus = async (t: string, id: number, isActive: boolean) => {
    const { version } = (await get(admin, `/admin/job-titles/${id}`).expect(200)).body;
    return http().patch(`/admin/job-titles/${id}/status`).set(bearer(t)).send({ isActive, version });
  };
  const employment = async (t: string, id: number, status: string) =>
    http().patch(`/admin/users/${id}/employment-status`).set(bearer(t)).send({ status, version: await ver(id) });

  let seq = 0;
  const unit = async (parentId?: number) => {
    const n = ++seq;
    return (await http().post('/admin/org-units').set(bearer(admin)).send({ code: `U23B-${n}`, name: `Unit ${n}`, parentId }).expect(201)).body.id as number;
  };
  const title = async () => {
    const n = ++seq;
    return (await http().post('/admin/job-titles').set(bearer(admin)).send({ code: `T23B-${n}`, name: `Title ${n}` }).expect(201)).body.id as number;
  };
  const employee = async (body: object = {}, withAccount = false) => {
    const n = ++seq;
    const res = await http().post('/admin/users').set(bearer(admin)).send({
      profile: { employeeCode: `E23B-${n}`, fullName: `Employee ${n}` },
      ...(withAccount ? { account: { username: `u23b-${n}`, initialPassword: PW } } : {}), ...body });
    expect(res.status).toBe(201);
    return { id: res.body.id as number, username: `u23b-${n}` };
  };
  const member = (orgUnitId: number, jobTitleId: number, isPrimary = true, managerUserId?: number): Spec => ({ orgUnitId, jobTitleId, isPrimary, managerUserId });
  const activeToken = async (username: string) => {
    const t = (await http().post('/auth/login').send({ username, password: PW }).expect(200)).body.accessToken as string;
    await http().post('/auth/change-password').set(bearer(t)).send({ currentPassword: PW, newPassword: 'changed passphrase' }).expect(204);
    return login(app, username, 'changed passphrase');
  };
  const code = (r: request.Response) => r.body.code as string;
  // Helpers above read the current version first, so they resolve to the response; this asserts success.
  const done = async (p: Promise<request.Response>) => { const r = await p; expect([r.status, r.body?.code]).toEqual([204, undefined]); return r; };

  beforeAll(async () => {
    ({ app, ds } = await bootTestApp());
    admin = await login(app, process.env.SEED_ADMIN_USERNAME!, process.env.SEED_ADMIN_PASSWORD!);
    adminId = (await get(admin, '/auth/me').expect(200)).body.id;
    [{ id: salesRole }] = await ds.query(`SELECT id FROM roles WHERE code = 'SALES'`);
    [{ id: adminRole }] = await ds.query(`SELECT id FROM roles WHERE code = 'ADMIN'`);
    [{ id: warehouse }] = await ds.query(`SELECT id FROM warehouses ORDER BY id LIMIT 1`);
  }, 120_000);
  afterAll(async () => app?.close());

  describe('centralized save', () => {
    it('creates an employee with account, memberships, roles and warehouses in one transaction', async () => {
      const [a, b, t] = [await unit(), await unit(), await title()];
      const mgr = await employee();
      const e = await employee({ memberships: [member(a, t, true, mgr.id), member(b, t, false)], roleIds: [salesRole], warehouseIds: [warehouse] }, true);
      const d = await detail(e.id);
      expect(d.version).toBe(1);
      expect(d.memberships.map((x: any) => [x.orgUnit.id, x.jobTitle.id, x.isPrimary, x.manager?.id ?? null])).toEqual([[a, t, true, mgr.id], [b, t, false, null]]);
      expect(d.roles.map((r: any) => r.id)).toEqual([salesRole]);
      expect(d.warehouses.map((w: any) => w.id)).toEqual([warehouse]);
      expect((await userEvents(e.id)).map(x => x.action)).toEqual(['EMPLOYEE_CREATED', 'ACCOUNT_CREATED', 'ROLES_ADDED', 'MEMBERSHIPS_CHANGED', 'WAREHOUSES_CHANGED']);
      expect((await roleEvents(salesRole)).at(-1)).toMatchObject({ action: 'USERS_ADDED', metadata: { users: [{ id: e.id }] } });

      // List: unit filter and primary unit/title; the unit's Nhân sự tab returns the same people (BA-UI-09).
      const listed = (await get(admin, `/admin/users?orgUnitId=${b}`).expect(200)).body;
      expect(listed.items.map((x: any) => x.id)).toEqual([e.id]);
      expect(listed.items[0]).toMatchObject({ primaryOrgUnit: { id: a }, primaryJobTitle: { id: t } });
      const members = (await get(admin, `/admin/org-units/${a}/members`).expect(200)).body;
      expect(members.map((x: any) => x.id)).toEqual((await get(admin, `/admin/users?orgUnitId=${a}`).expect(200)).body.items.map((x: any) => x.id));
      expect(members[0]).toMatchObject({ isPrimary: true, jobTitle: { id: t }, manager: { id: mgr.id }, isHead: false });
      const tree = (await get(admin, '/admin/org-units/tree').expect(200)).body;
      expect(tree.find((n: any) => n.id === a).memberCount).toBe(1);
      // Organization grants nothing (BA-ORG-08): effective permissions are exactly the SALES role's.
      const [{ n }] = await ds.query(`SELECT count(*)::int AS n FROM v_user_grants WHERE user_id = $1 AND role_id <> $2`, [e.id, salesRole]);
      expect(n).toBe(0);
    });

    it('bumps users.version once per save and records nothing when nothing changed', async () => {
      const [a, b, t] = [await unit(), await unit(), await title()];
      const e = await employee({}, true);
      await done(save(admin, e.id, { profile: { fullName: 'Renamed' }, memberships: [member(a, t)], roleIds: [salesRole], warehouseIds: [warehouse] }));
      expect(await ver(e.id)).toBe(2);
      const before = (await userEvents(e.id)).length;
      await done(save(admin, e.id, { memberships: [member(a, t)], roleIds: [salesRole], warehouseIds: [warehouse] }));
      expect([await ver(e.id), (await userEvents(e.id)).length]).toEqual([2, before]);
      // Swap the primary unit (partial unique index allows one at a time), end nothing else.
      await done(save(admin, e.id, { memberships: [member(a, t, false), member(b, t, true)] }));
      await done(save(admin, e.id, { memberships: [member(b, t, true)] }));
      expect(await ver(e.id)).toBe(4);
      const ended = await ds.query(`SELECT status, ended_at IS NOT NULL AS ended FROM org_memberships WHERE user_id = $1 AND org_unit_id = $2`, [e.id, a]);
      expect(ended).toEqual([{ status: 'ENDED', ended: true }]); // BA-ORG-13: kept in history
      const last = (await userEvents(e.id)).at(-1)!;
      expect(last).toMatchObject({ action: 'MEMBERSHIPS_CHANGED', metadata: { ended: [{ orgUnit: { id: a } }], added: [], updated: [] } });
      // Missing list = unchanged.
      await done(save(admin, e.id, { profile: { fullName: 'Renamed again' } }));
      expect((await detail(e.id)).memberships).toHaveLength(1);
    });

    it('validates primary unit, active unit and title, manager rules', async () => {
      const [a, b, t, off, offTitle] = [await unit(), await unit(), await title(), await unit(), await title()];
      await done(unitStatus(admin, off, false));
      await done(titleStatus(admin, offTitle, false));
      const e = await employee();
      const inactive = await employee();
      await done(employment(admin, inactive.id, 'INACTIVE'));
      for (const [memberships, expected] of [
        [[member(a, t), member(b, t)], 'PRIMARY_ORG_UNIT_REQUIRED'],
        [[member(a, t, false)], 'PRIMARY_ORG_UNIT_REQUIRED'],
        [[member(a, t), member(a, t, false)], 'MEMBERSHIP_DUPLICATE_UNIT'],
        [[member(off, t)], 'ORG_UNIT_INACTIVE'],
        [[member(a, offTitle)], 'JOB_TITLE_INACTIVE'],
        [[member(a, t, true, e.id)], 'MANAGER_SELF'],
        [[member(a, t, true, inactive.id)], 'MANAGER_INACTIVE'],
        [[member(999999, t)], 'ORG_UNIT_NOT_FOUND'],
      ] as [Spec[], string][]) {
        const res = await save(admin, e.id, { memberships });
        expect([res.status, code(res)]).toEqual([expect.any(Number), expected]);
      }
      expect([await ver(e.id), (await detail(e.id)).memberships]).toEqual([1, []]);
      // An employee with no membership is valid (BA-N-08).
      await done(save(admin, e.id, { memberships: [] }));
      expect(await ver(e.id)).toBe(1);
    });

    it('rejects a direct manager cycle (BA-ORG-11)', async () => {
      const [a, t] = [await unit(), await title()];
      const x = await employee();
      const y = await employee({ memberships: [member(a, t, true, x.id)] });
      const z = await employee({ memberships: [member(a, t, true, y.id)] });
      const res = await save(admin, x.id, { memberships: [member(a, t, true, z.id)] });
      expect([res.status, code(res)]).toEqual([409, 'MANAGER_CYCLE']);
      expect((await detail(x.id)).memberships).toEqual([]);
    });

    it('rolls back profile, roles, memberships and audit when the last part fails (acceptance 12)', async () => {
      const [a, t] = [await unit(), await title()];
      const e = await employee({}, true);
      const snapshot = async () => ({
        d: await detail(e.id), events: (await userEvents(e.id)).length, roleVersion: await roleVersion(salesRole),
        roleEvents: (await roleEvents(salesRole)).length, memberships: (await ds.query('SELECT count(*)::int AS n FROM org_memberships WHERE user_id = $1', [e.id]))[0].n });
      const before = await snapshot();
      const bad = await save(admin, e.id, { profile: { fullName: 'Should not stick' }, roleIds: [salesRole], memberships: [member(a, t)], warehouseIds: [999999] });
      expect([bad.status, code(bad)]).toEqual([422, 'UNKNOWN_WAREHOUSE']);
      expect(await snapshot()).toEqual(before);
      const stale = await save(admin, e.id, { roleIds: [salesRole], memberships: [member(a, t)] }, before.d.version + 1);
      expect([stale.status, code(stale)]).toEqual([409, 'VERSION_CONFLICT']);
      const unknownRole = await save(admin, e.id, { memberships: [member(a, t)], roleIds: [999999] });
      expect(code(unknownRole)).toBe('UNKNOWN_ROLE');
      expect(await snapshot()).toEqual(before);
      // Roles need an account.
      const noAccount = await employee();
      expect(code(await save(admin, noAccount.id, { roleIds: [salesRole] }))).toBe('NO_ACCOUNT');
    });

    it('keeps users and roles versions and histories in step from both screens (acceptance 7, 8)', async () => {
      const e = await employee({}, true);
      const rv = await roleVersion(salesRole);
      await done(save(admin, e.id, { roleIds: [salesRole] }));
      expect([await ver(e.id), await roleVersion(salesRole)]).toEqual([2, rv + 1]);
      await done(save(admin, e.id, { roleIds: [] }));
      expect([await ver(e.id), await roleVersion(salesRole)]).toEqual([3, rv + 2]);
      // From the Role screen: the user's version moves and the user's history records it.
      const role = (await get(admin, `/admin/roles/${salesRole}`).expect(200)).body;
      await http().put(`/admin/roles/${salesRole}`).set(bearer(admin)).send({ name: role.name, description: role.description,
        permissions: role.permissions, scopes: role.scopes, userIds: [...role.users.map((u: any) => u.id), e.id], version: role.version }).expect(204);
      expect(await ver(e.id)).toBe(4);
      expect((await userEvents(e.id)).filter(x => x.action.startsWith('ROLES_')).map(x => [x.action, x.metadata.roles[0].id]))
        .toEqual([['ROLES_ADDED', salesRole], ['ROLES_REMOVED', salesRole], ['ROLES_ADDED', salesRole]]);
      expect((await roleEvents(salesRole)).slice(-3).map(x => [x.action, x.metadata.users[0].id]))
        .toEqual([['USERS_ADDED', e.id], ['USERS_REMOVED', e.id], ['USERS_ADDED', e.id]]);
      // Effective from the next request (BA-RBAC-09).
      expect(await ds.query(`SELECT 1 FROM v_user_grants WHERE user_id = $1 LIMIT 1`, [e.id])).toHaveLength(1);
    });

    it('denies self-change of roles, memberships and warehouses but allows an unchanged save (BA-N-11)', async () => {
      const [a, t] = [await unit(), await title()];
      for (const body of [{ roleIds: [] }, { memberships: [member(a, t)] }, { warehouseIds: [warehouse, 999999] }]) {
        const res = await save(admin, adminId, body);
        expect([res.status, code(res)]).toEqual([403, 'SELF_CHANGE_DENIED']);
      }
      const d = await detail(adminId);
      await done(save(admin, adminId, { roleIds: d.roles.map((r: any) => r.id), warehouseIds: d.warehouses.map((w: any) => w.id), memberships: [] }));
      expect(await ver(adminId)).toBe(d.version);
    });

    it('keeps user administration to ADMIN (USER.MANAGE) and the warehouse grant audited', async () => {
      const e = await employee({}, true);
      const sales = await login(app, 'sales', 'role-users-test');
      expect((await save(sales, e.id, { warehouseIds: [warehouse] })).status).toBe(403);
      expect((await get(sales, `/admin/org-units/1/members`)).status).toBe(403);
      await done(save(admin, e.id, { warehouseIds: [warehouse] }));
      await done(save(admin, e.id, { warehouseIds: [] }));
      expect((await userEvents(e.id)).filter(x => x.action === 'WAREHOUSES_CHANGED').map(x => [x.metadata.added.length, x.metadata.removed.length]))
        .toEqual([[1, 0], [0, 1]]);
    });
  });

  describe('head, manager and dependency rules', () => {
    it('heads come from active members; their membership cannot end; heads and managers cannot be deactivated', async () => {
      const [a, t] = [await unit(), await title()];
      const outsider = await employee();
      expect(code(await setHead(admin, a, outsider.id))).toBe('HEAD_NOT_MEMBER');
      const h = await employee({ memberships: [member(a, t)] });
      await done(setHead(admin, a, h.id));
      expect((await unitOf(a)).head).toMatchObject({ id: h.id });
      expect((await get(admin, `/admin/org-units/${a}/members`).expect(200)).body[0]).toMatchObject({ id: h.id, isHead: true });
      expect(code(await save(admin, h.id, { memberships: [] }))).toBe('ORG_UNIT_HEAD_MEMBERSHIP');
      expect(code(await employment(admin, h.id, 'INACTIVE'))).toBe('EMPLOYEE_IS_HEAD');
      await done(setHead(admin, a, null));
      const report = await employee({ memberships: [member(a, t, true, h.id)] });
      expect(code(await employment(admin, h.id, 'INACTIVE'))).toBe('EMPLOYEE_IS_MANAGER');
      await done(save(admin, report.id, { memberships: [member(a, t)] }));
      await done(employment(admin, h.id, 'INACTIVE'));
      // BA-N-07: memberships stay; an inactive employee can no longer be head.
      expect((await detail(h.id)).memberships).toHaveLength(1);
      expect(code(await setHead(admin, a, h.id))).toBe('HEAD_INACTIVE');
      expect((await ds.query(`SELECT action FROM approval_histories WHERE document_type = 'ORG_UNIT' AND document_id = $1 ORDER BY id`, [a]))
        .map((x: any) => x.action)).toEqual(['ORG_UNIT_CREATED', 'ORG_UNIT_UPDATED', 'ORG_UNIT_UPDATED']);
    });

    it('blocks deactivating units and job titles still in use (ORG_UNIT_IN_USE, JOB_TITLE_IN_USE)', async () => {
      const [a, t] = [await unit(), await title()];
      const e = await employee({ memberships: [member(a, t)] });
      expect(code(await unitStatus(admin, a, false))).toBe('ORG_UNIT_IN_USE');
      expect(code(await titleStatus(admin, t, false))).toBe('JOB_TITLE_IN_USE');
      // An inactive employee no longer blocks the title (BA-UI-03), but still blocks the unit (§4.3).
      await done(employment(admin, e.id, 'INACTIVE'));
      await done(titleStatus(admin, t, false));
      expect(code(await unitStatus(admin, a, false))).toBe('ORG_UNIT_IN_USE');
    });
  });

  describe('concurrency (one lock graph, acceptance 11)', () => {
    const rounds = 3;
    const ok = (r: request.Response) => r.status === 204 || [409, 422].includes(r.status);

    it('job title deactivation vs assigning it: no active membership on an inactive title', async () => {
      for (let i = 0; i < rounds; i++) {
        const [a, t] = [await unit(), await title()];
        const e = await employee();
        const results = await Promise.all([save(admin, e.id, { memberships: [member(a, t)] }), titleStatus(admin, t, false)]);
        expect(results.every(ok)).toBe(true);
        expect(await ds.query(`SELECT 1 FROM org_memberships om JOIN job_titles jt ON jt.id = om.job_title_id
          WHERE om.status = 'ACTIVE' AND jt.status = 'INACTIVE' AND jt.id = $1`, [t])).toEqual([]);
        expect(results.filter(r => r.status === 204)).toHaveLength(1);
      }
    });

    it('unit deactivation vs adding a membership to it', async () => {
      for (let i = 0; i < rounds; i++) {
        const [a, t] = [await unit(), await title()];
        const e = await employee();
        const results = await Promise.all([save(admin, e.id, { memberships: [member(a, t)] }), unitStatus(admin, a, false)]);
        expect(results.every(ok)).toBe(true);
        expect(results.filter(r => r.status === 204)).toHaveLength(1);
        expect(await ds.query(`SELECT 1 FROM org_memberships om JOIN org_units o ON o.id = om.org_unit_id
          WHERE om.status = 'ACTIVE' AND o.status = 'INACTIVE' AND o.id = $1`, [a])).toEqual([]);
      }
    });

    it('assigning a head vs ending that person\'s membership', async () => {
      for (let i = 0; i < rounds; i++) {
        const [a, b, t] = [await unit(), await unit(), await title()];
        const e = await employee({ memberships: [member(a, t, false), member(b, t, true)] });
        const results = await Promise.all([setHead(admin, a, e.id), save(admin, e.id, { memberships: [member(b, t)] })]);
        expect(results.every(ok)).toBe(true);
        expect(results.filter(r => r.status === 204)).toHaveLength(1);
        expect(await ds.query(`SELECT 1 FROM org_units o WHERE o.id = $1 AND o.head_user_id IS NOT NULL AND NOT EXISTS
          (SELECT 1 FROM org_memberships om WHERE om.org_unit_id = o.id AND om.user_id = o.head_user_id AND om.status = 'ACTIVE')`, [a])).toEqual([]);
      }
    });

    it('two opposite manager assignments: exactly one wins, no cycle', async () => {
      for (let i = 0; i < rounds; i++) {
        const [a, t] = [await unit(), await title()];
        const [x, y] = [await employee({ memberships: [member(a, t)] }), await employee({ memberships: [member(a, t)] })];
        const results = await Promise.all([
          save(admin, x.id, { memberships: [member(a, t, true, y.id)] }), save(admin, y.id, { memberships: [member(a, t, true, x.id)] })]);
        expect(results.map(r => r.status).sort()).toEqual([204, 409]);
        expect(code(results.find(r => r.status === 409)!)).toBe('MANAGER_CYCLE');
      }
    });

    it('deactivating an employee vs assigning them as manager: no active report of an inactive manager', async () => {
      for (let i = 0; i < rounds; i++) {
        const [a, t] = [await unit(), await title()];
        const [mgr, e] = [await employee(), await employee()];
        const results = await Promise.all([save(admin, e.id, { memberships: [member(a, t, true, mgr.id)] }), employment(admin, mgr.id, 'INACTIVE')]);
        expect(results.every(ok)).toBe(true);
        expect(results.filter(r => r.status === 204)).toHaveLength(1);
        expect(await ds.query(`SELECT 1 FROM org_memberships om JOIN users u ON u.id = om.manager_user_id
          WHERE om.status = 'ACTIVE' AND u.employment_status = 'INACTIVE' AND u.id = $1`, [mgr.id])).toEqual([]);
      }
    });

    it('user save and role save on the same user, plus unit/title changes: no deadlock, versions consistent', async () => {
      for (let i = 0; i < rounds; i++) {
        const [a, t] = [await unit(), await title()];
        const e = await employee({}, true);
        const role = (await get(admin, `/admin/roles/${salesRole}`).expect(200)).body;
        const v = await ver(e.id);
        const results = await Promise.all([
          save(admin, e.id, { roleIds: [salesRole], memberships: [member(a, t)], warehouseIds: [warehouse] }),
          http().put(`/admin/roles/${salesRole}`).set(bearer(admin)).send({ name: role.name, description: role.description,
            permissions: role.permissions, scopes: role.scopes, userIds: [...role.users.map((u: any) => u.id), e.id], version: role.version }),
          titleStatus(admin, t, false),
          unitStatus(admin, a, false),
        ]);
        expect(results.every(r => r.status !== 500)).toBe(true);
        expect(results.every(ok)).toBe(true);
        // users.version moved once per successful writer touching the user.
        const wrote = [results[0], results[1]].filter(r => r.status === 204).length;
        expect(await ver(e.id)).toBe(v + wrote);
        expect(await ds.query(`SELECT 1 FROM user_roles WHERE user_id = $1 AND role_id = $2`, [e.id, salesRole])).toHaveLength(wrote ? 1 : 0);
      }
    }, 60_000);

    it('two concurrent saves never leave two primary units', async () => {
      const [a, b, t] = [await unit(), await unit(), await title()];
      const e = await employee();
      const results = await Promise.all([save(admin, e.id, { memberships: [member(a, t)] }), save(admin, e.id, { memberships: [member(b, t)] })]);
      expect(results.map(r => r.status).sort()).toEqual([204, 409]);
      expect(await ds.query(`SELECT count(*)::int AS n FROM org_memberships WHERE user_id = $1 AND status = 'ACTIVE' AND is_primary`, [e.id])).toEqual([{ n: 1 }]);
    });
  });

  describe('F01: account operations carry the employee version', () => {
    it('requires version, rejects a stale one and bumps it on every change including unlock', async () => {
      const e = await employee({}, true);
      await http().patch(`/admin/users/${e.id}/account-status`).set(bearer(admin)).send({ isActive: false }).expect(400);
      const stale = await http().post(`/admin/users/${e.id}/unlock`).set(bearer(admin)).send({ version: 99 });
      expect([stale.status, code(stale)]).toEqual([409, 'VERSION_CONFLICT']);
      await ds.query(`UPDATE users SET failed_login_count = 3 WHERE id = $1`, [e.id]);
      await http().post(`/admin/users/${e.id}/unlock`).set(bearer(admin)).send({ version: 1 }).expect(204);
      await http().post(`/admin/users/${e.id}/reset-password`).set(bearer(admin)).send({ temporaryPassword: 'temporary passphrase', version: 2 }).expect(204);
      await http().patch(`/admin/users/${e.id}/account-status`).set(bearer(admin)).send({ isActive: false, version: 3 }).expect(204);
      expect(await ver(e.id)).toBe(4);
    });
  });

  describe('migration (fresh, down/up)', () => {
    const schema = 'oa23b_migration';
    afterAll(async () => ds.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`));

    it('creates org_memberships, refuses down() once history exists, and reverts cleanly otherwise', async () => {
      await ds.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE; CREATE SCHEMA ${schema}`);
      // Stops at OA2.3b so undoLastMigration reverts org_memberships (later migrations are tested on their own).
      const all = dataSourceOptions().migrations as Function[];
      const db = new DataSource({ ...dataSourceOptions(), migrations: all.slice(0, all.findIndex(mig => mig.name === 'OrgMemberships1733961600000') + 1),
        extra: { options: `-c search_path=${schema}` } } as never);
      await db.initialize();
      try {
        await db.runMigrations();
        const exists = async () => (await db.query(`SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'org_memberships'`, [schema])).length;
        expect(await exists()).toBe(1);
        await db.undoLastMigration();
        expect(await exists()).toBe(0);
        await db.runMigrations();
        const [{ id: u }] = await db.query(`INSERT INTO users (employee_code, full_name, is_active) VALUES ('M1', 'M', false) RETURNING id`);
        const [{ id: o }] = await db.query(`INSERT INTO org_units (code, name) VALUES ('O1', 'O') RETURNING id`);
        const [{ id: j }] = await db.query(`INSERT INTO job_titles (code, name) VALUES ('J1', 'J') RETURNING id`);
        await db.query(`INSERT INTO org_memberships (user_id, org_unit_id, job_title_id, is_primary) VALUES ($1, $2, $3, true)`, [u, o, j]);
        await expect(db.query(`INSERT INTO org_memberships (user_id, org_unit_id, job_title_id, is_primary) VALUES ($1, $2, $3, true)`, [u, o, j]))
          .rejects.toThrow(/ux_org_memberships/);
        await expect(db.query(`INSERT INTO org_memberships (user_id, org_unit_id, job_title_id, manager_user_id) VALUES ($1, $2, $3, $1)`, [u, o, j]))
          .rejects.toThrow(/chk_org_memberships_not_self_managed/);
        await expect(db.query(`UPDATE org_memberships SET status = 'ENDED'`)).rejects.toThrow(/chk_org_memberships_ended/);
        await expect(db.undoLastMigration()).rejects.toThrow(/cannot be removed by a rollback/);
        expect(await exists()).toBe(1);
      } finally {
        await db.destroy();
      }
    }, 120_000);
  });

  describe('closure patch F01–F04', () => {
    const memberships = (t: string, body: object) => http().post('/admin/memberships').set(bearer(t)).send(body);
    const mVersion = async (id: number) => (await ds.query('SELECT version FROM org_memberships WHERE id = $1', [id]))[0].version as number;
    const putM = async (t: string, id: number, body: object) => http().put(`/admin/memberships/${id}`).set(bearer(t)).send({ version: await mVersion(id), ...body });
    const endM = async (t: string, id: number, version?: number) => http().post(`/admin/memberships/${id}/end`).set(bearer(t)).send({ version: version ?? await mVersion(id) });

    it('OA2.3c F11: unit members carry membershipId/membershipVersion usable for update/end; same permission', async () => {
      const [a, t, t2] = [await unit(), await title(), await title()];
      const e = await employee({ memberships: [member(a, t)] });
      const members = async () => (await get(admin, `/admin/org-units/${a}/members`).expect(200)).body as any[];
      const [row] = await members();
      const [db] = await ds.query(`SELECT id, version FROM org_memberships WHERE user_id = $1 AND org_unit_id = $2 AND status = 'ACTIVE'`, [e.id, a]);
      expect(row).toMatchObject({ id: e.id, membershipId: db.id, membershipVersion: db.version });
      await done(http().put(`/admin/memberships/${row.membershipId}`).set(bearer(admin)).send({ jobTitleId: t2, isPrimary: true, version: row.membershipVersion }));
      // The listed version is now stale: optimistic locking rejects it; the fresh listing works.
      const stale = await http().post(`/admin/memberships/${row.membershipId}/end`).set(bearer(admin)).send({ version: row.membershipVersion });
      expect([stale.status, code(stale)]).toEqual([409, 'VERSION_CONFLICT']);
      const [fresh] = await members();
      expect(fresh.membershipVersion).toBe(row.membershipVersion + 1);
      await done(http().post(`/admin/memberships/${fresh.membershipId}/end`).set(bearer(admin)).send({ version: fresh.membershipVersion }));
      expect(await members()).toEqual([]);
      const sales = await login(app, 'sales', 'role-users-test');
      expect((await get(sales, `/admin/org-units/${a}/members`)).status).toBe(403);
    });

    it('F01: reactivation re-checks every active membership; an inactive employee can be fixed first', async () => {
      const [a, t, t2] = [await unit(), await title(), await title()];
      const e = await employee({ memberships: [member(a, t)] });
      await done(employment(admin, e.id, 'INACTIVE'));
      await done(titleStatus(admin, t, false));
      const blocked = await employment(admin, e.id, 'ACTIVE');
      expect([blocked.status, code(blocked)]).toEqual([409, 'JOB_TITLE_INACTIVE']);
      expect((await detail(e.id)).employmentStatus).toBe('INACTIVE'); // nothing repaired automatically
      await done(save(admin, e.id, { memberships: [member(a, t2)] }));
      await done(employment(admin, e.id, 'ACTIVE'));
      // Manager made inactive behind the service's back (SQL) is reported too.
      const mgr = await employee();
      const r = await employee({ memberships: [member(a, t2, true, mgr.id)] });
      await done(employment(admin, r.id, 'INACTIVE'));
      await ds.query(`UPDATE users SET employment_status = 'INACTIVE' WHERE id = $1`, [mgr.id]);
      expect(code(await employment(admin, r.id, 'ACTIVE'))).toBe('MANAGER_INACTIVE');
    });

    it('F01: reactivation vs deactivating the title or unit: never an active employee on an inactive title/unit', async () => {
      for (let i = 0; i < 3; i++) {
        const [a, t] = [await unit(), await title()];
        const e = await employee({ memberships: [member(a, t)] });
        await done(employment(admin, e.id, 'INACTIVE'));
        const results = await Promise.all([employment(admin, e.id, 'ACTIVE'), titleStatus(admin, t, false), unitStatus(admin, a, false)]);
        expect(results.every(r => r.status === 204 || r.status === 409)).toBe(true);
        expect(await ds.query(`SELECT 1 FROM org_memberships om JOIN users u ON u.id = om.user_id JOIN job_titles jt ON jt.id = om.job_title_id
          JOIN org_units o ON o.id = om.org_unit_id WHERE u.id = $1 AND om.status = 'ACTIVE' AND u.employment_status = 'ACTIVE'
          AND (jt.status = 'INACTIVE' OR o.status = 'INACTIVE')`, [e.id])).toEqual([]);
      }
    }, 60_000);

    it('F02: membership API adds, updates and ends with the same rules, audit and version as the User save', async () => {
      const [a, b, t, t2] = [await unit(), await unit(), await title(), await title()];
      const e = await employee();
      const first = await memberships(admin, { userId: e.id, orgUnitId: a, jobTitleId: t, isPrimary: false, version: 1 });
      expect(code(first)).toBe('PRIMARY_ORG_UNIT_REQUIRED');
      const added = await memberships(admin, { userId: e.id, orgUnitId: a, jobTitleId: t, isPrimary: true, version: 1 });
      expect(added.status).toBe(201);
      const second = (await memberships(admin, { userId: e.id, orgUnitId: b, jobTitleId: t, isPrimary: true, version: 2 }).expect(201)).body.id as number;
      // Primary moved to b; one version bump per call; same rows as the unit tab.
      expect((await detail(e.id)).memberships.map((x: any) => [x.orgUnit.id, x.isPrimary])).toEqual([[b, true], [a, false]]);
      expect(await ver(e.id)).toBe(3);
      expect((await get(admin, `/admin/org-units/${b}/members`).expect(200)).body.map((x: any) => x.id)).toEqual([e.id]);
      expect(code(await memberships(admin, { userId: e.id, orgUnitId: a, jobTitleId: t, isPrimary: false, version: 3 }))).toBe('MEMBERSHIP_DUPLICATE_UNIT');
      expect(code(await memberships(admin, { userId: e.id, orgUnitId: a, jobTitleId: t, isPrimary: false, version: 1 }))).toBe('VERSION_CONFLICT');
      await done(putM(admin, second, { jobTitleId: t2, isPrimary: true }));
      expect(code(await putM(admin, second, { jobTitleId: t, isPrimary: true, version: 1 }))).toBe('VERSION_CONFLICT');
      expect(code(await endM(admin, second))).toBe('PRIMARY_ORG_UNIT_REQUIRED');
      await done(putM(admin, added.body.id, { jobTitleId: t, isPrimary: true }));
      await done(endM(admin, second));
      expect(code(await endM(admin, second, 99))).toBe('MEMBERSHIP_ENDED');
      expect((await userEvents(e.id)).filter(x => x.action === 'MEMBERSHIPS_CHANGED')).toHaveLength(5);
      // Same guards: self-change, ORGANIZATION.MANAGE, inactive unit, head rule.
      expect(code(await memberships(admin, { userId: adminId, orgUnitId: a, jobTitleId: t, isPrimary: true, version: await ver(adminId) }))).toBe('SELF_CHANGE_DENIED');
      const sales = await login(app, 'sales', 'role-users-test');
      expect((await endM(sales, added.body.id)).status).toBe(403);
      await done(setHead(admin, a, e.id));
      expect(code(await endM(admin, added.body.id))).toBe('ORG_UNIT_HEAD_MEMBERSHIP');
    });

    it('F02: membership API and User save on the same employee serialize on the version', async () => {
      for (let i = 0; i < 3; i++) {
        const [a, b, t] = [await unit(), await unit(), await title()];
        const e = await employee();
        const results = await Promise.all([save(admin, e.id, { memberships: [member(a, t)] }),
          memberships(admin, { userId: e.id, orgUnitId: b, jobTitleId: t, isPrimary: true, version: 1 })]);
        expect(results.filter(r => r.status === 409).map(code)).toEqual(['VERSION_CONFLICT']);
        expect(results.filter(r => r.status === 201 || r.status === 204)).toHaveLength(1);
        expect(await ds.query(`SELECT count(*)::int AS n FROM org_memberships WHERE user_id = $1 AND status = 'ACTIVE'`, [e.id])).toEqual([{ n: 1 }]);
      }
    });

    it('F02: PUT isPrimary on a secondary moves the primary in one transaction; the old primary can then end', async () => {
      const [a, b, t] = [await unit(), await unit(), await title()];
      const e = await employee({ memberships: [member(a, t, true), member(b, t, false)] });
      const [oldP, sec] = (await detail(e.id)).memberships.map((x: any) => x.id as number);
      const [vOld, vSec, vUser] = [await mVersion(oldP), await mVersion(sec), await ver(e.id)];
      const before = (await userEvents(e.id)).length;
      await done(putM(admin, sec, { jobTitleId: t, isPrimary: true }));
      const flags = await ds.query('SELECT id, is_primary FROM org_memberships WHERE id = ANY($1)', [[oldP, sec]]);
      expect(Object.fromEntries(flags.map((r: any) => [r.id, r.is_primary]))).toEqual({ [oldP]: false, [sec]: true });
      expect([await mVersion(oldP), await mVersion(sec), await ver(e.id)]).toEqual([vOld + 1, vSec + 1, vUser + 1]);
      const events = (await userEvents(e.id)).slice(before);
      expect(events.map(x => x.action)).toEqual(['MEMBERSHIPS_CHANGED']);
      expect(events[0].metadata.updated.map((u: any) => [u.before.orgUnit.id, u.before.isPrimary, u.after.isPrimary]).sort())
        .toEqual([[a, true, false], [b, false, true]].sort());
      await done(endM(admin, oldP));
      expect((await detail(e.id)).memberships.map((x: any) => [x.orgUnit.id, x.isPrimary])).toEqual([[b, true]]);
    });

    describe('F02: PUT isPrimary vs a User save adding a unit (both read their versions first)', () => {
      // PUT edits membership b (membership version); the save adds unit c (employee version). Both read before either commits.
      const setup = async () => {
        const [a, b, c, t] = [await unit(), await unit(), await unit(), await title()];
        const e = await employee({ memberships: [member(a, t, true), member(b, t, false)] });
        const sec = (await detail(e.id)).memberships[1].id as number;
        return { a, b, c, t, e, sec, mv: await mVersion(sec), uv: await ver(e.id), events: (await userEvents(e.id)).length };
      };
      type Ctx = Awaited<ReturnType<typeof setup>>;
      const put = (x: Ctx) => putM(admin, x.sec, { jobTitleId: x.t, isPrimary: true, version: x.mv });
      const add = (x: Ctx) => save(admin, x.e.id, { memberships: [member(x.a, x.t, true), member(x.b, x.t, false), member(x.c, x.t, false)] }, x.uv);
      const active = (id: number) => ds.query(`SELECT org_unit_id AS unit, is_primary AS "primary" FROM org_memberships
        WHERE user_id = $1 AND status = 'ACTIVE' ORDER BY org_unit_id`, [id]);
      /** Final state, versions and audit for each valid outcome; exactly one primary in every case. */
      const expectOutcome = async (x: Ctx, putOk: boolean, addOk: boolean) => {
        const rows = [{ unit: x.a, primary: !putOk }, { unit: x.b, primary: putOk }, ...(addOk ? [{ unit: x.c, primary: false }] : [])];
        expect(await active(x.e.id)).toEqual(rows);
        expect(rows.filter(r => r.primary)).toHaveLength(1);
        const writers = Number(putOk) + Number(addOk);
        expect(await ver(x.e.id)).toBe(x.uv + writers);
        expect(await mVersion(x.sec)).toBe(x.mv + Number(putOk));
        const events = (await userEvents(x.e.id)).slice(x.events);
        expect(events.map(ev => ev.action)).toEqual(Array(writers).fill('MEMBERSHIPS_CHANGED'));
        expect(events.reduce((n, ev) => n + ev.metadata.added.length, 0)).toBe(Number(addOk));
        expect(events.reduce((n, ev) => n + ev.metadata.updated.length, 0)).toBe(putOk ? 2 : 0);
      };

      it('PUT commits first: the stale User save gets VERSION_CONFLICT and changes nothing', async () => {
        const x = await setup();
        await done(put(x));
        const late = await add(x);
        expect([late.status, code(late)]).toEqual([409, 'VERSION_CONFLICT']);
        await expectOutcome(x, true, false);
      });

      it('User save commits first: PUT still applies (its membership is untouched) and both changes survive', async () => {
        const x = await setup();
        await done(add(x));
        await done(put(x));
        await expectOutcome(x, true, true);
      });

      it('truly concurrent: the result is one of the two orders above, never a lost update', async () => {
        for (let i = 0; i < 3; i++) {
          const x = await setup();
          const [p, s] = await Promise.all([put(x), add(x)]);
          expect([p, s].every(r => r.status === 204 || (r.status === 409 && code(r) === 'VERSION_CONFLICT'))).toBe(true);
          expect(p.status).toBe(204); // the save never touches b, so PUT has no conflict in either order
          await expectOutcome(x, true, s.status === 204);
        }
      });
    });

    it('F03: empty list ends all; re-joining a unit adds a new row and keeps the ended one', async () => {
      const [a, t] = [await unit(), await title()];
      const e = await employee({ memberships: [member(a, t)] });
      await done(save(admin, e.id, { memberships: [] }));
      expect((await detail(e.id)).memberships).toEqual([]);
      await done(save(admin, e.id, { memberships: [member(a, t)] }));
      expect(await ds.query(`SELECT status FROM org_memberships WHERE user_id = $1 ORDER BY id`, [e.id])).toEqual([{ status: 'ENDED' }, { status: 'ACTIVE' }]);
    });

    it('F04: no new grant on an inactive warehouse; kept grants stay and can be removed', async () => {
      const [{ id: w }] = await ds.query(`INSERT INTO warehouses (code, name) VALUES ('W23B', 'Closure warehouse') RETURNING id`);
      const e = await employee({ warehouseIds: [w] }, true);
      await ds.query('UPDATE warehouses SET is_active = false WHERE id = $1', [w]);
      await done(save(admin, e.id, { profile: { fullName: 'Kept warehouse' }, warehouseIds: [w] }));
      const other = await employee({}, true);
      const res = await save(admin, other.id, { warehouseIds: [w] });
      expect([res.status, code(res)]).toEqual([409, 'WAREHOUSE_INACTIVE']);
      await done(save(admin, e.id, { warehouseIds: [] }));
      expect((await detail(e.id)).warehouses).toEqual([]);
    });
  });

  it('keeps one administrator when two admins remove each other from ADMIN through the user save (runs last)', async () => {
    const [approver] = await ds.query('SELECT id FROM users WHERE username = $1', [process.env.SEED_APPROVER_USERNAME]);
    await done(employment(admin, approver.id, 'INACTIVE'));
    const x = await employee({}, true);
    await done(save(admin, x.id, { roleIds: [adminRole] }));
    const xt = await activeToken(x.username);
    expect(await activeAdminCount(ds.manager)).toBe(2);
    const results = await Promise.all([save(admin, x.id, { roleIds: [] }), save(xt, adminId, { roleIds: [] })]);
    // The second writer either lost USER.MANAGE (403) or hit LAST_ADMIN (409); never both removed.
    expect(results.filter(r => r.status === 204)).toHaveLength(1);
    expect(results.every(r => [204, 403, 409].includes(r.status))).toBe(true);
    expect(await activeAdminCount(ds.manager)).toBe(1);
  }, 60_000);
});
