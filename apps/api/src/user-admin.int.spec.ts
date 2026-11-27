import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { dataSourceOptions } from './database/data-source';
import { activeAdminCount } from './modules/identity/authorization';
import { bootTestApp, login } from './test-utils';

const PW = 'initial passphrase 1';

describe('User management OA2.3a (PostgreSQL, HTTP)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let admin: string;
  let adminId: number;
  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, url: string) => http().get(url).set(bearer(t));
  const create = (t: string, body: object) => http().post('/admin/users').set(bearer(t)).send(body);
  const put = (t: string, id: number, profile: object, version: number) => http().put(`/admin/users/${id}`).set(bearer(t)).send({ profile, version });
  const employment = (t: string, id: number, status: string, version: number) =>
    http().patch(`/admin/users/${id}/employment-status`).set(bearer(t)).send({ status, version });
  const account = (t: string, id: number, username: string, version: number, initialPassword = PW) =>
    http().post(`/admin/users/${id}/account`).set(bearer(t)).send({ username, initialPassword, version });
  const ver = async (id: number) => (await ds.query('SELECT version FROM users WHERE id = $1', [id]))[0].version as number;
  const accountStatus = (t: string, id: number, isActive: boolean, version: number) =>
    http().patch(`/admin/users/${id}/account-status`).set(bearer(t)).send({ isActive, version });
  const signIn = (username: string, password = PW) => http().post('/auth/login').send({ username, password });
  const detail = async (id: number) => (await get(admin, `/admin/users/${id}`).expect(200)).body;
  const events = async (id: number) => (await ds.query(`SELECT action, metadata FROM approval_histories
    WHERE document_type = 'USER' AND document_id = $1 ORDER BY id`, [id])) as { action: string; metadata: Record<string, unknown> | null }[];
  let seq = 0;
  const employee = async (withAccount = false) => {
    const n = ++seq;
    const body = { profile: { employeeCode: `E23-${n}`, fullName: `Employee ${n}` }, ...(withAccount ? { account: { username: `u23-${n}`, initialPassword: PW } } : {}) };
    const id = (await create(admin, body).expect(201)).body.id as number;
    return { id, code: `E23-${n}`, username: `u23-${n}` };
  };
  /** Signs in a new account: the initial password must be changed first (BA-USR-06). */
  const activeToken = async (username: string) => {
    const t = (await signIn(username).expect(200)).body.accessToken as string;
    await http().post('/auth/change-password').set(bearer(t)).send({ currentPassword: PW, newPassword: 'changed passphrase' }).expect(204);
    return (await signIn(username, 'changed passphrase').expect(200)).body.accessToken as string;
  };

  beforeAll(async () => {
    ({ app, ds } = await bootTestApp());
    admin = await login(app, process.env.SEED_ADMIN_USERNAME!, process.env.SEED_ADMIN_PASSWORD!);
    adminId = (await get(admin, '/auth/me').expect(200)).body.id;
  }, 120_000);
  afterAll(async () => app?.close());

  it('seeds employee codes without inventing data: admin ADMIN, role users their role code', async () => {
    expect(await ds.query(`SELECT employee_code FROM users WHERE username = $1`, [process.env.SEED_ADMIN_USERNAME])).toEqual([{ employee_code: 'ADMIN' }]);
    expect(await ds.query(`SELECT employee_code FROM users WHERE username = 'sales'`)).toEqual([{ employee_code: 'SALES' }]);
  });

  describe('profiles and accounts', () => {
    it('creates an employee without an account and grants one later', async () => {
      const e = await employee();
      let d = await detail(e.id);
      expect(d).toMatchObject({ employeeCode: e.code, username: null, accountStatus: 'NONE', employmentStatus: 'ACTIVE', accountActive: false, roles: [] });
      await accountStatus(admin, e.id, true, await ver(e.id)).expect(409).expect(r => expect(r.body.code).toBe('NO_ACCOUNT'));
      await http().post(`/admin/users/${e.id}/reset-password`).set(bearer(admin)).send({ temporaryPassword: PW, version: await ver(e.id) }).expect(409);
      await account(admin, e.id, e.username, d.version, 'short').expect(400).expect(r => expect(r.body.code).toBe('PASSWORD_POLICY'));
      await account(admin, e.id, e.username, d.version).expect(204);
      d = await detail(e.id);
      expect(d).toMatchObject({ username: e.username, accountStatus: 'ACTIVE', mustChangePassword: true, version: 2 });
      await account(admin, e.id, 'other-name', d.version).expect(409).expect(r => expect(r.body.code).toBe('ACCOUNT_EXISTS'));
      // Case-insensitive sign-in (BA-USR-02).
      expect((await signIn(e.username.toUpperCase()).expect(200)).body.mustChangePassword).toBe(true);
      expect((await events(e.id)).map(x => x.action)).toEqual(['EMPLOYEE_CREATED', 'ACCOUNT_CREATED', 'LOGIN_SUCCEEDED']);
      expect(JSON.stringify(await events(e.id))).not.toMatch(/scrypt|passphrase|password_hash/);
    });

    it('creates an employee with an account in one transaction and rolls back both on a conflict', async () => {
      const e = await employee(true);
      expect(await detail(e.id)).toMatchObject({ username: e.username, accountStatus: 'ACTIVE', mustChangePassword: true });
      const before = (await ds.query('SELECT count(*)::int AS n FROM users'))[0].n;
      await create(admin, { profile: { employeeCode: 'E23-ROLLBACK', fullName: 'X' }, account: { username: e.username.toUpperCase(), initialPassword: PW } })
        .expect(409).expect(r => expect(r.body.code).toBe('USERNAME_TAKEN'));
      expect((await ds.query('SELECT count(*)::int AS n FROM users'))[0].n).toBe(before);
      expect(await ds.query(`SELECT 1 FROM users WHERE employee_code = 'E23-ROLLBACK'`)).toEqual([]);
    });

    it('keeps employee codes and usernames unique case-insensitively and the code immutable', async () => {
      const e = await employee();
      await create(admin, { profile: { employeeCode: e.code.toLowerCase(), fullName: 'Dup' } }).expect(409)
        .expect(r => expect(r.body.code).toBe('EMPLOYEE_CODE_TAKEN'));
      await create(admin, { profile: { employeeCode: 'admin', fullName: 'Dup' } }).expect(409);
      const other = await employee();
      await account(admin, other.id, process.env.SEED_ADMIN_USERNAME!.toUpperCase(), 1).expect(409)
        .expect(r => expect(r.body.code).toBe('USERNAME_TAKEN'));
      expect((await detail(other.id)).version).toBe(1);
      await put(admin, e.id, { employeeCode: 'NEW', fullName: 'X' }, 1).expect(400);
      await create(admin, { profile: { employeeCode: 'bad code', fullName: 'X' } }).expect(400);
    });

    it('updates the profile with the version, audits before/after and skips no-op saves', async () => {
      const e = await employee();
      await put(admin, e.id, { fullName: 'Renamed', email: 'a@example.com', phone: '+84 90 000' }, 1).expect(204);
      await put(admin, e.id, { fullName: 'Stale' }, 1).expect(409).expect(r => expect(r.body.code).toBe('VERSION_CONFLICT'));
      await put(admin, e.id, { fullName: 'Renamed', email: 'a@example.com', phone: '+84 90 000' }, 2).expect(204);
      expect(await detail(e.id)).toMatchObject({ fullName: 'Renamed', email: 'a@example.com', phone: '+84 90 000', version: 2 });
      expect((await events(e.id)).at(-1)).toEqual({ action: 'EMPLOYEE_UPDATED', metadata: {
        before: { fullName: `Employee ${seq}`, email: null, phone: null }, after: { fullName: 'Renamed', email: 'a@example.com', phone: '+84 90 000' } } });
      await put(admin, e.id, { fullName: 'X', email: 'not-an-email' }, 2).expect(400);
      expect((await get(admin, `/admin/users/${e.id}/history`).expect(200)).body.items.length).toBeGreaterThan(0);
    });

    it('lists server-side with search, filters, sorting and paging', async () => {
      const a = await employee(true);
      const b = await employee();
      const list = async (qs: string) => (await get(admin, `/admin/users?${qs}`).expect(200)).body;
      expect((await list(`q=${a.username}`)).items.map((i: { id: number }) => i.id)).toEqual([a.id]);
      const none = await list('accountStatus=NONE&size=100');
      expect(none.items.map((i: { id: number }) => i.id)).toContain(b.id);
      expect(none.items.every((i: { accountStatus: string }) => i.accountStatus === 'NONE')).toBe(true);
      const [{ id: salesRole }] = await ds.query(`SELECT id FROM roles WHERE code = 'SALES'`);
      expect((await list(`roleId=${salesRole}`)).items.map((i: { username: string }) => i.username)).toEqual(['sales']);
      const page = await list('size=25&page=0&sort=employeeCode&direction=desc');
      expect(page.total).toBe((await ds.query('SELECT count(*)::int AS n FROM users'))[0].n);
      expect(Object.keys(page.items[0])).not.toContain('passwordHash');
      await get(admin, '/admin/users?size=7').expect(400);
    });
  });

  describe('employment lifecycle', () => {
    it('deactivating the employee disables the account and revokes every session; reactivation keeps it disabled', async () => {
      const e = await employee(true);
      const t = await activeToken(e.username);
      await get(t, '/auth/me').expect(200);
      let d = await detail(e.id);
      await employment(admin, e.id, 'INACTIVE', d.version).expect(204);
      await get(t, '/auth/me').expect(401);
      await signIn(e.username, 'changed passphrase').expect(401);
      expect(await ds.query(`SELECT DISTINCT revoke_reason FROM user_sessions WHERE user_id = $1 AND revoke_reason <> 'PASSWORD_CHANGED'`, [e.id]))
        .toEqual([{ revoke_reason: 'EMPLOYMENT_INACTIVE' }]);
      d = await detail(e.id);
      expect(d).toMatchObject({ employmentStatus: 'INACTIVE', accountStatus: 'INACTIVE' });
      await accountStatus(admin, e.id, true, await ver(e.id)).expect(409).expect(r => expect(r.body.code).toBe('EMPLOYMENT_INACTIVE'));

      await employment(admin, e.id, 'ACTIVE', d.version).expect(204);
      d = await detail(e.id);
      expect(d).toMatchObject({ employmentStatus: 'ACTIVE', accountStatus: 'INACTIVE' });
      await get(t, '/auth/me').expect(401);
      await accountStatus(admin, e.id, true, await ver(e.id)).expect(204);
      await get(t, '/auth/me').expect(401);
      await signIn(e.username, 'changed passphrase').expect(200);
      const ev = (await events(e.id)).filter(x => /^EMPLOYEE_(DE)?ACTIVATED$/.test(x.action));
      expect(ev).toEqual([
        { action: 'EMPLOYEE_DEACTIVATED', metadata: { before: { employmentStatus: 'ACTIVE', accountActive: true }, after: { employmentStatus: 'INACTIVE', accountActive: false } } },
        { action: 'EMPLOYEE_ACTIVATED', metadata: { before: { employmentStatus: 'INACTIVE', accountActive: false }, after: { employmentStatus: 'ACTIVE', accountActive: false } } },
      ]);
    });

    it('blocks granting an account to an inactive employee and enforces the status invariant in the database', async () => {
      const e = await employee();
      await employment(admin, e.id, 'INACTIVE', 1).expect(204);
      await account(admin, e.id, e.username, 2).expect(409).expect(r => expect(r.body.code).toBe('EMPLOYMENT_INACTIVE'));
      await expect(ds.query('UPDATE users SET is_active = true WHERE id = $1', [e.id])).rejects.toThrow(/chk_users_account_requires/);
      await expect(ds.query(`UPDATE users SET username = 'x' WHERE id = $1`, [e.id])).rejects.toThrow(/chk_users_account_pair/);
    });
  });

  describe('authorization and self-change', () => {
    it('keeps every endpoint to USER.VIEW / USER.MANAGE holders', async () => {
      const sales = await login(app, 'sales', process.env.SEED_ROLE_USERS_PASSWORD!);
      await get(sales, '/admin/users').expect(403);
      await get(sales, `/admin/users/${adminId}`).expect(403);
      await get(sales, `/admin/users/${adminId}/history`).expect(403);
      await create(sales, { profile: { employeeCode: 'E23-NO', fullName: 'X' } }).expect(403);
      await put(sales, adminId, { fullName: 'X' }, 1).expect(403);
      await employment(sales, adminId, 'INACTIVE', 1).expect(403);
      await account(sales, adminId, 'x', 1).expect(403);
      await http().get('/admin/users').expect(401);
    });

    it('lets an administrator change only their own email and phone', async () => {
      const d = await detail(adminId);
      await employment(admin, adminId, 'INACTIVE', d.version).expect(403).expect(r => expect(r.body.code).toBe('SELF_CHANGE_DENIED'));
      await put(admin, adminId, { fullName: 'Someone else' }, d.version).expect(403).expect(r => expect(r.body.code).toBe('SELF_CHANGE_DENIED'));
      await put(admin, adminId, { fullName: d.fullName, email: 'me@example.com' }, d.version).expect(204);
      expect(await detail(adminId)).toMatchObject({ email: 'me@example.com', employmentStatus: 'ACTIVE', accountStatus: 'ACTIVE' });
    });

    it('re-checks the acting session inside the transaction', async () => {
      const e = await employee();
      const second = await login(app, process.env.SEED_ADMIN_USERNAME!, process.env.SEED_ADMIN_PASSWORD!);
      await http().post('/auth/logout').set(bearer(second)).expect(204);
      await put(second, e.id, { fullName: 'X' }, 1).expect(401);
      expect((await detail(e.id)).version).toBe(1);
    });
  });

  describe('concurrency', () => {
    it('admits exactly one of two concurrent creates with the same employee code or username', async () => {
      const results = await Promise.all([1, 2].map(i => create(admin, {
        profile: { employeeCode: i === 1 ? 'E23-RACE' : 'e23-race', fullName: `Race ${i}` } })));
      expect(results.map(r => r.status).sort()).toEqual([201, 409]);
      const [a, b] = [await employee(), await employee()];
      const accounts = await Promise.all([account(admin, a.id, 'u23-race', 1), account(admin, b.id, 'U23-RACE', 1)]);
      expect(accounts.map(r => r.status).sort()).toEqual([204, 409]);
      expect(accounts.find(r => r.status === 409)!.body.code).toBe('USERNAME_TAKEN');
    });

    it('serializes concurrent saves on one employee: one wins the version, the other gets VERSION_CONFLICT', async () => {
      const e = await employee();
      const results = await Promise.all([put(admin, e.id, { fullName: 'A' }, 1), employment(admin, e.id, 'INACTIVE', 1), account(admin, e.id, e.username, 1)]);
      expect(results.filter(r => r.status === 204 || r.status === 409).length).toBe(3);
      expect(results.filter(r => r.status === 204).length).toBeGreaterThanOrEqual(1);
      expect((await detail(e.id)).version).toBe(2);
    });

    it('runs deactivation, reset, unlock and account disable on one account concurrently without deadlock', async () => {
      for (let round = 0; round < 3; round++) {
        const e = await employee(true);
        const results = await Promise.all([
          employment(admin, e.id, 'INACTIVE', 1),
          http().post(`/admin/users/${e.id}/reset-password`).set(bearer(admin)).send({ temporaryPassword: 'temporary passphrase', version: 1 }),
          http().post(`/admin/users/${e.id}/unlock`).set(bearer(admin)).send({ version: 1 }),
          accountStatus(admin, e.id, false, 1),
        ]);
        expect(results.map(r => r.status).every(s => s === 204 || s === 409)).toBe(true);
        // F01: one shared version, so only the first writer wins; the account is off exactly when a disabling call won.
        const disabled = results[0].status === 204 || results[3].status === 204;
        expect(await ds.query('SELECT is_active FROM users WHERE id = $1', [e.id])).toEqual([{ is_active: !disabled }]);
        expect(await ds.query('SELECT 1 FROM user_sessions WHERE user_id = $1 AND revoked_at IS NULL', [e.id])).toEqual([]);
      }
    }, 60_000);

    it('keeps one administrator when the last two deactivate each other at the same time (runs last)', async () => {
      // Leave exactly two admins: the seeded admin and a new one; the seeded approver is retired.
      const [approver] = await ds.query('SELECT id, version FROM users WHERE username = $1', [process.env.SEED_APPROVER_USERNAME]);
      await employment(admin, approver.id, 'INACTIVE', approver.version).expect(204);
      const x = await employee(true);
      await ds.query(`INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE code = 'ADMIN'`, [x.id]);
      const xt = await activeToken(x.username);
      expect(await activeAdminCount(ds.manager)).toBe(2);
      const [me, them] = [await detail(adminId), await detail(x.id)];
      const results = await Promise.all([employment(admin, x.id, 'INACTIVE', them.version), employment(xt, adminId, 'INACTIVE', me.version)]);
      expect(results.map(r => r.status).sort()).toEqual([204, 401]);
      expect(await activeAdminCount(ds.manager)).toBe(1);
    }, 60_000);
  });

  describe('migration preflight (upgrade from OA2.2)', () => {
    const schema = 'oa23_upgrade';
    let up: DataSource | undefined;
    const open = async (all: boolean) => {
      const base = dataSourceOptions();
      const migrations = base.migrations as Function[];
      const at = migrations.findIndex(mig => mig.name === 'EmployeeProfiles1733875200000');
      up = new DataSource({ ...base, migrations: migrations.slice(0, all ? at + 1 : at), extra: { options: `-c search_path=${schema}` } } as never);
      await up.initialize();
      return up;
    };
    afterEach(async () => {
      if (up?.isInitialized) await up.destroy();
      delete process.env.EMPLOYEE_CODES;
      await ds.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    });

    it('stops on case-insensitive duplicate usernames, undeclared or duplicate codes, then upgrades and reverts', async () => {
      await ds.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE; CREATE SCHEMA ${schema}`);
      const db = await open(false);
      await db.runMigrations();
      await db.query(`INSERT INTO users (username, password_hash, full_name) VALUES ('Anna', 'x', 'Anna'), ('anna', 'x', 'Anna 2'), ('bob', 'x', 'Bob')`);
      await db.destroy();
      const run = async () => { const d = await open(true); try { await d.runMigrations(); } finally { await d.destroy(); } };

      await expect(run()).rejects.toThrow(/usernames differ only by case/);
      await ds.query(`DELETE FROM ${schema}.users WHERE username = 'anna'`);
      process.env.EMPLOYEE_CODES = JSON.stringify({ anna: 'E1' });
      await expect(run()).rejects.toThrow(/declare an employee code in EMPLOYEE_CODES for: bob/);
      process.env.EMPLOYEE_CODES = JSON.stringify({ anna: 'E1', bob: 'e1' });
      await expect(run()).rejects.toThrow(/duplicate employee codes: e1/);
      expect(await ds.query(`SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND column_name = 'employee_code'`, [schema])).toEqual([]);

      process.env.EMPLOYEE_CODES = JSON.stringify({ anna: 'E1', BOB: 'E2' });
      const d = await open(true);
      await d.runMigrations();
      expect(await d.query('SELECT username, employee_code, employment_status, is_active FROM users ORDER BY id')).toEqual([
        { username: 'Anna', employee_code: 'E1', employment_status: 'ACTIVE', is_active: true },
        { username: 'bob', employee_code: 'E2', employment_status: 'ACTIVE', is_active: true }]);
      await expect(d.query(`INSERT INTO users (employee_code, username, password_hash, full_name) VALUES ('E3', 'ANNA', 'x', 'X')`)).rejects.toThrow(/ux_users_username_ci/);
      await d.undoLastMigration();
      await d.query(`INSERT INTO users (username, password_hash, full_name) VALUES ('carl', 'x', 'Carl')`);
      await expect(d.runMigrations()).rejects.toThrow(/for: carl/);
    }, 120_000);
  });
});
