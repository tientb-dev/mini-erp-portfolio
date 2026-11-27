import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource, EntityManager } from 'typeorm';
import { bootTestApp, login } from './test-utils';
import {
  DataScope, ScopeColumns, ScopeDraft, ScopeSource, assertCanAct, assertCanRead, canAccessDraft, loadDataScope, matchesDraft, scopeFilter,
} from './modules/identity/data-scope';

const PW = 'initial passphrase 1';

/** OA3.2 scope engine on PostgreSQL: union, fail-closed, memberships, tree, NULL owner, SQL/TS parity, locking. */
describe('Data Scope engine OA3.2 (PostgreSQL)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let admin: string;
  let adminId: number;
  const http = () => request(app.getHttpServer());
  const bearer = () => ({ Authorization: `Bearer ${admin}` });
  let seq = 0;
  const n = () => ++seq;

  const unit = async (parentId?: number) => {
    const i = n();
    return (await http().post('/admin/org-units').set(bearer()).send({ code: `S32-${i}`, name: `Unit ${i}`, parentId }).expect(201)).body.id as number;
  };
  const role = async (permissions: string[], scopes: Record<string, string[]> = {}) => {
    const i = n();
    return (await http().post('/admin/roles').set(bearer()).send({ code: `R32_${i}`, name: `Role ${i}`, permissions, scopes, userIds: [] })
      .expect(201)).body.id as number;
  };
  let titleId: number;
  const employee = async (roleIds: number[], units: number[] = []) => {
    const i = n();
    const res = await http().post('/admin/users').set(bearer()).send({
      profile: { employeeCode: `E32-${i}`, fullName: `Employee ${i}` }, account: { username: `u32-${i}`, initialPassword: PW }, roleIds,
      memberships: units.map((orgUnitId, k) => ({ orgUnitId, jobTitleId: titleId, isPrimary: k === 0 })) });
    expect(res.status).toBe(201);
    return res.body.id as number;
  };
  /** Grants a permission to a Role by SQL with no scope row: allowed by the DB (F01), must fail closed at runtime. */
  const grantWithoutScope = (roleId: number, code: string) => ds.query(`INSERT INTO role_permissions (role_id, permission_id)
    SELECT $1, id FROM permissions WHERE code = $2`, [roleId, code]);
  const load = (userId: number) => loadDataScope(ds.manager, userId);
  const version = async (table: string, id: number) => (await ds.query(`SELECT version FROM ${table} WHERE id = $1`, [id]))[0].version as number;

  beforeAll(async () => {
    ({ app, ds } = await bootTestApp());
    admin = await login(app, process.env.SEED_ADMIN_USERNAME!, process.env.SEED_ADMIN_PASSWORD!);
    [{ id: adminId }] = await ds.query('SELECT id FROM users WHERE username = $1', [process.env.SEED_ADMIN_USERNAME]);
    titleId = (await http().post('/admin/job-titles').set(bearer()).send({ code: 'T32', name: 'Title 32' }).expect(201)).body.id;
  }, 120_000);
  afterAll(async () => app?.close());

  it('unions scopes of the same permission across roles, never across permissions', async () => {
    const a = await role(['SALES_CONTRACT.VIEW', 'PR.VIEW'], { 'SALES_CONTRACT.VIEW': ['CREATOR'], 'PR.VIEW': ['ASSIGNED'] });
    const b = await role(['SALES_CONTRACT.VIEW'], { 'SALES_CONTRACT.VIEW': ['ORG_UNIT_TREE', 'CREATOR'] });
    const s = await load(await employee([a, b]));
    expect(s.grants['SALES_CONTRACT.VIEW']).toEqual(['CREATOR', 'ORG_UNIT_TREE']);
    expect(s.grants['PR.VIEW']).toEqual(['ASSIGNED']);
    expect(s.grants['SALES_CONTRACT.CREATE']).toBeUndefined();
  });

  it('fails closed per grant: a grant without scope adds nothing, a valid grant of another role still counts', async () => {
    const empty = await role(['PO.VIEW']);
    await grantWithoutScope(empty, 'SALES_CONTRACT.VIEW');
    const only = await load(await employee([empty]));
    expect(only.grants['SALES_CONTRACT.VIEW']).toEqual([]);
    expect(scopeFilter(only, 'SALES_CONTRACT.VIEW', { creator: 'x' })).toBeNull();
    expect(matchesDraft(only, 'SALES_CONTRACT.VIEW', { creatorId: only.userId })).toBe(false);
    // Unscoped permission (supported_scopes '{}'): granted as is, no scope rows needed.
    expect(only.grants['PO.VIEW']).toBeNull();
    expect(scopeFilter(only, 'PO.VIEW', {})).toEqual({ sql: 'TRUE', params: [] });
    expect(scopeFilter(only, 'PR.VIEW', { creator: 'x' })).toBeNull();

    const valid = await role(['SALES_CONTRACT.VIEW'], { 'SALES_CONTRACT.VIEW': ['CREATOR'] });
    const both = await load(await employee([empty, valid]));
    expect(both.grants['SALES_CONTRACT.VIEW']).toEqual(['CREATOR']);
    expect(matchesDraft(both, 'SALES_CONTRACT.VIEW', { creatorId: both.userId })).toBe(true);
  });

  it('gives ADMIN no bypass: ALL where supported, otherwise only its supported scopes', async () => {
    const s = await load(adminId);
    expect(s.grants['SALES_CONTRACT.VIEW']).toEqual(['ALL']);
    expect(matchesDraft(s, 'SALES_CONTRACT.VIEW', {})).toBe(true);
    expect(s.grants['PR.CREATE']).toEqual(['CREATOR', 'ORG_UNIT', 'ORG_UNIT_TREE', 'RESPONSIBLE']);
    expect(matchesDraft(s, 'PR.CREATE', { creatorId: s.userId + 1, orgUnitId: null })).toBe(false);
  });

  it('drops grants of inactive roles and inactive accounts', async () => {
    const r = await role(['SALES_CONTRACT.VIEW'], { 'SALES_CONTRACT.VIEW': ['ALL'] });
    const id = await employee([r]);
    await http().patch(`/admin/roles/${r}/status`).set(bearer()).send({ isActive: false, version: await version('roles', r) }).expect(204);
    expect((await load(id)).grants).toEqual({});
  });

  it('resolves every ACTIVE membership and a multi-level tree; ended memberships and other branches are out', async () => {
    const a = await unit(); const a1 = await unit(a); const a11 = await unit(a1); const a111 = await unit(a11);
    const b = await unit(); const b1 = await unit(b); const c = await unit();
    const id = await employee([], [a1, b, c]);
    let s = await load(id);
    expect(s.orgUnitIds).toEqual([a1, b, c].sort((x, y) => x - y));
    expect(s.orgTreeIds).toEqual([a1, a11, a111, b, b1, c].sort((x, y) => x - y));
    expect(s.orgTreeIds).not.toContain(a);
    // End membership C through the membership API.
    const [mc] = await ds.query(`SELECT id, version FROM org_memberships WHERE user_id = $1 AND org_unit_id = $2`, [id, c]);
    await http().post(`/admin/memberships/${mc.id}/end`).set(bearer()).send({ version: mc.version }).expect(204);
    s = await load(id);
    expect(s.orgUnitIds).not.toContain(c);
    expect(s.orgTreeIds).not.toContain(c);
  });

  describe('SQL and TypeScript predicates agree', () => {
    // Rows cover NULL owner, NULL creator, both responsible columns, current/past assignee and a warehouse.
    const cols: ScopeColumns = {
      creator: 'd.creator_id', responsible: ['d.sales_id', 'd.pm_id'], orgUnit: 'd.owner_org_unit_id', warehouse: 'd.warehouse_id',
      assigned: 'EXISTS (SELECT 1 FROM t32_assign x WHERE x.doc_id = d.id AND x.user_id = :uid)',
    };
    const src: ScopeSource = { from: 't32_docs d', id: 'd.id', cols };
    let m: EntityManager;
    let rows: (ScopeDraft & { id: number })[];
    const qr = () => ds.createQueryRunner();
    let runner: ReturnType<typeof qr>;

    beforeAll(async () => {
      runner = qr();
      await runner.connect();
      m = runner.manager;
      await m.query(`CREATE TEMP TABLE t32_docs (id int PRIMARY KEY, creator_id int, sales_id int, pm_id int, owner_org_unit_id int, warehouse_id int);
        CREATE TEMP TABLE t32_assign (doc_id int, user_id int)`);
    });
    afterAll(async () => runner.release());

    const seedRows = async (uid: number, units: number[]) => {
      await m.query('TRUNCATE t32_docs, t32_assign');
      const vals = [uid, uid + 1000, null];
      const owners = [...units, units[0] + 100000, null];
      let id = 0;
      rows = [];
      for (const creator of vals) for (const sales of vals) for (const owner of owners) for (const assignee of [uid, null]) {
        id++;
        const pm = id % 3 === 0 ? uid : null;
        const wh = id % 4 === 0 ? 1 : null;
        await m.query('INSERT INTO t32_docs VALUES ($1, $2, $3, $4, $5, $6)', [id, creator, sales, pm, owner, wh]);
        if (assignee) await m.query('INSERT INTO t32_assign VALUES ($1, $2)', [id, assignee]);
        rows.push({ id, creatorId: creator, responsibleIds: [sales, pm], orgUnitId: owner, warehouseId: wh, assigneeIds: assignee ? [assignee] : [] });
      }
    };
    const sqlIds = async (s: DataScope, permission: string) => {
      const f = scopeFilter(s, permission, cols);
      if (!f) return [];
      return (await m.query(`SELECT d.id FROM t32_docs d WHERE ${f.sql} ORDER BY d.id`, f.params)).map((r: { id: number }) => r.id);
    };
    const tsIds = (s: DataScope, permission: string) => rows.filter(r => matchesDraft(s, permission, r)).map(r => r.id);

    it('for every scope type alone and for unions, on a loaded scope with memberships and a tree', async () => {
      const a = await unit(); const a1 = await unit(a); const b = await unit();
      const base = await load(await employee([], [a, b]));
      expect(base.orgTreeIds).toContain(a1);
      await seedRows(base.userId, [a, a1, b]);
      const all = ['ALL', 'CREATOR', 'RESPONSIBLE', 'ASSIGNED', 'ORG_UNIT', 'ORG_UNIT_TREE', 'WAREHOUSE'] as const;
      const combos: (typeof all[number])[][] = [...all.map(x => [x]), ['CREATOR', 'ORG_UNIT'], ['RESPONSIBLE', 'ASSIGNED', 'ORG_UNIT_TREE'], [], [...all].slice(1)];
      for (const scopes of combos) {
        const s: DataScope = { ...base, warehouseIds: [1], grants: { P: scopes } };
        const ts = tsIds(s, 'P');
        expect({ scopes, ids: await sqlIds(s, 'P') }).toEqual({ scopes, ids: ts });
        if (!scopes.length) expect(ts).toEqual([]);
      }
      // NULL owner never matches ORG_UNIT / ORG_UNIT_TREE.
      const tree: DataScope = { ...base, grants: { P: ['ORG_UNIT_TREE'] } };
      expect(rows.filter(r => r.orgUnitId === null).some(r => matchesDraft(tree, 'P', r))).toBe(false);
      // Unknown permission and unscoped permission.
      expect(await sqlIds({ ...base, grants: {} }, 'P')).toEqual([]);
      expect(await sqlIds({ ...base, grants: { P: null } }, 'P')).toEqual(rows.map(r => r.id));
    });

    it('throws when a granted scope has no declared column (catalog/module mismatch)', () => {
      const s: DataScope = { userId: 1, orgUnitIds: [], orgTreeIds: [], warehouseIds: [], grants: { P: ['ASSIGNED'] } };
      expect(() => scopeFilter(s, 'P', { creator: 'x' })).toThrow(/no declared column/);
    });

    it('assertCanRead / assertCanAct: no VIEW → 403, out of scope or unknown → 404, action out of scope → 403', async () => {
      const s: DataScope = { userId: 7, orgUnitIds: [], orgTreeIds: [], warehouseIds: [], grants: { V: ['CREATOR'], A: ['RESPONSIBLE'] } };
      await m.query('TRUNCATE t32_docs, t32_assign');
      await m.query(`INSERT INTO t32_docs (id, creator_id, sales_id) VALUES (1, 7, 7), (2, 7, NULL), (3, 8, 7)`);
      await expect(assertCanRead(m, { ...s, grants: {} }, 'V', src, 1)).rejects.toMatchObject({ status: 403 });
      await expect(assertCanRead(m, s, 'V', src, 3)).rejects.toMatchObject({ status: 404 });
      await expect(assertCanRead(m, s, 'V', src, 99)).rejects.toMatchObject({ status: 404 });
      await expect(assertCanRead(m, { ...s, grants: { V: [] } }, 'V', src, 1)).rejects.toMatchObject({ status: 404 });
      await assertCanRead(m, s, 'V', src, 1);
      await assertCanAct(m, s, 'V', 'A', src, 1);
      await expect(assertCanAct(m, s, 'V', 'A', src, 2)).rejects.toMatchObject({ status: 403 });
      await expect(assertCanAct(m, s, 'V', 'A', src, 3)).rejects.toMatchObject({ status: 404 });
      expect(canAccessDraft(s, 'V', 'A', { creatorId: 7, responsibleIds: [7] })).toBe(true);
      expect(canAccessDraft(s, 'V', 'A', { creatorId: 7, responsibleIds: [null] })).toBe(false);
    });
  });

  describe('locking: scope writers wait for a reader holding the gate shared; no deadlock', () => {
    /** Reader transaction: gate shared + scope load, held open until `release` resolves. */
    const holdReader = async (userId: number) => {
      const r = ds.createQueryRunner();
      await r.connect();
      await r.startTransaction();
      const before = await loadDataScope(r.manager, userId, true);
      return { before, r, done: async () => { await r.commitTransaction(); await r.release(); } };
    };
    const waitingOnGate = async () => (await ds.query(`SELECT count(*)::int AS n FROM pg_locks
      WHERE locktype = 'advisory' AND NOT granted`))[0].n as number;
    const until = async (cond: () => Promise<boolean>) => {
      for (let i = 0; i < 100; i++) { if (await cond()) return; await new Promise(res => setTimeout(res, 20)); }
      throw new Error('condition not reached');
    };

    const writers: [string, (ctx: { userId: number; units: number[]; roleId: number }) => Promise<request.Response>, (s: DataScope, ctx: { units: number[] }) => boolean][] = [
      ['membership API add', async ({ userId, units }) => http().post('/admin/memberships').set(bearer())
        .send({ userId, orgUnitId: units[2], jobTitleId: titleId, isPrimary: false, version: await version('users', userId) }),
      (s, { units }) => s.orgUnitIds.includes(units[2])],
      ['user save memberships', async ({ userId, units }) => {
        const d = (await http().get(`/admin/users/${userId}`).set(bearer()).expect(200)).body;
        return http().put(`/admin/users/${userId}`).set(bearer()).send({ profile: { fullName: d.fullName, email: d.email, phone: d.phone },
          version: d.version, memberships: [{ orgUnitId: units[1], jobTitleId: titleId, isPrimary: true }] });
      }, (s, { units }) => !s.orgUnitIds.includes(units[0])],
      ['unit parent move', async ({ units }) => {
        const u = (await http().get(`/admin/org-units/${units[2]}`).set(bearer()).expect(200)).body;
        return http().put(`/admin/org-units/${units[2]}`).set(bearer()).send({ name: u.name, description: u.description, parentId: units[0], version: u.version });
      }, (s, { units }) => s.orgTreeIds.includes(units[2])],
      ['role scope change', async ({ userId, roleId }) => http().put(`/admin/roles/${roleId}`).set(bearer()).send({ name: 'Scoped',
        permissions: ['SALES_CONTRACT.VIEW'], scopes: { 'SALES_CONTRACT.VIEW': ['CREATOR'] }, userIds: [userId], version: await version('roles', roleId) }),
      s => s.grants['SALES_CONTRACT.VIEW']?.join() === 'CREATOR'],
      // F01: a child created under a member's unit enters orgTreeIds.
      ['unit create child', ({ units }) => http().post('/admin/org-units').set(bearer()).send({ code: `S32-${n()}`, name: 'Child', parentId: units[0] }),
      s => s.orgTreeIds.length === 2],
    ];

    it('unit status change also waits for the reader (gate exclusive on every unit write)', async () => {
      const units = [await unit(), await unit()];
      const reader = await holdReader(await employee([], [units[0]]));
      const pending = http().patch(`/admin/org-units/${units[1]}/status`).set(bearer()).send({ isActive: false, version: await version('org_units', units[1]) });
      let finished = false;
      void pending.then(() => { finished = true; });
      await until(async () => (await waitingOnGate()) > 0);
      expect(finished).toBe(false);
      await reader.done();
      expect((await pending).status).toBe(204);
    });

    it.each(writers)('%s waits for the reader, then the next load sees it', async (_name, write, changed) => {
      const units = [await unit(), await unit(), await unit()];
      const roleId = await role(['SALES_CONTRACT.VIEW'], { 'SALES_CONTRACT.VIEW': ['ORG_UNIT_TREE'] });
      const userId = await employee([roleId], [units[0]]);
      const reader = await holdReader(userId);
      expect(changed(reader.before, { units })).toBe(false);
      const pending = write({ userId, units, roleId });
      let finished = false;
      void pending.then(() => { finished = true; });
      await until(async () => (await waitingOnGate()) > 0);
      // Still inside the reader's transaction: its view is unchanged and the writer has not committed.
      expect(changed(await loadDataScope(reader.r.manager, userId), { units })).toBe(false);
      expect(finished).toBe(false);
      await reader.done();
      const res = await pending;
      expect(res.status).toBeLessThan(300);
      expect(changed(await load(userId), { units })).toBe(true);
    });

    it('readers and every scope writer in parallel, 3 rounds: all succeed, no deadlock', async () => {
      for (let round = 0; round < 3; round++) {
        const units = [await unit(), await unit(), await unit()];
        const roleId = await role(['SALES_CONTRACT.VIEW'], { 'SALES_CONTRACT.VIEW': ['ORG_UNIT_TREE'] });
        const userId = await employee([roleId], [units[0]]);
        const reader = async () => ds.transaction(async m => {
          const s = await loadDataScope(m, userId, true);
          // Typical action after the gate: lock the actor row, then work; re-load inside the same transaction.
          await m.query('SELECT 1 FROM users WHERE id = $1 FOR SHARE', [userId]);
          await m.query('SELECT pg_sleep(0.02)');
          await loadDataScope(m, userId, true);
          return s;
        });
        // One write per subject (membership add, unit move, role scopes) so each version check holds.
        const ctx = { userId, units, roleId };
        const [add, , move, rescope] = writers.map(w => w[1]);
        const results = await Promise.all([reader(), add(ctx), reader(), move(ctx), reader(), rescope(ctx), reader()]);
        for (const r of results) if ('status' in r) expect(r.status).toBeLessThan(300);
        const s = await load(userId);
        for (const w of [writers[0], writers[2], writers[3]]) expect(w[2](s, ctx)).toBe(true);
      }
    });
  });
});
