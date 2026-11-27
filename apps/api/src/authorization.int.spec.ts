import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource, QueryRunner } from 'typeorm';
import { bootTestApp, login } from './test-utils';
import { dataSourceOptions } from './database/data-source';
import { ROLES, seed } from './database/seed';
import { grantRole } from './modules/identity/authorization';
import { hashPassword } from './modules/identity/password';
import { listCandidates } from './modules/procurement/pr-eligibility';

const ADMIN_ONLY = ['DOSSIER_CONFIG.MANAGE', 'DOSSIER_TYPE.MANAGE', 'PR.CONFIGURE', 'ROLE.MANAGE', 'ROLE.VIEW', 'USER.MANAGE', 'USER.VIEW'];
const NEW_KEYS = ['ROLE.MANAGE', 'ROLE.VIEW', 'USER.MANAGE', 'USER.VIEW'];

const roleGrants = (ds: DataSource): Promise<string[]> => ds.query(`SELECT r.code || '>' || p.code AS g FROM role_permissions rp
  JOIN roles r ON r.id = rp.role_id JOIN permissions p ON p.id = rp.permission_id ORDER BY 1`).then(rows => rows.map((r: { g: string }) => r.g));
const userGrants = (ds: DataSource): Promise<string[]> => ds.query(`SELECT DISTINCT u.username || '>' || p.code AS g FROM users u
  JOIN user_roles ur ON ur.user_id = u.id JOIN role_permissions rp ON rp.role_id = ur.role_id
  JOIN permissions p ON p.id = rp.permission_id ORDER BY 1`).then(rows => rows.map((r: { g: string }) => r.g));
const diff = (a: string[], b: string[]) => ({ added: b.filter(x => !a.includes(x)), removed: a.filter(x => !b.includes(x)) });

describe('Authorization foundation OA1.1 (PostgreSQL)', () => {
  let app: INestApplication;
  let ds: DataSource;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => ({ app, ds } = await bootTestApp()), 120_000);
  afterAll(async () => app?.close());

  it('syncs the catalog with metadata, admin_only classification and a protected system role holding every key', async () => {
    expect(await ds.query('SELECT code FROM permissions WHERE module IS NULL OR name IS NULL')).toEqual([]);
    expect((await ds.query('SELECT code FROM permissions WHERE admin_only ORDER BY code')).map((p: { code: string }) => p.code)).toEqual(ADMIN_ONLY);
    for (const code of ['PR.REASSIGN', 'PR.DOSSIER_MANAGE', 'DOSSIER_TYPE.VIEW']) {
      expect((await ds.query('SELECT admin_only FROM permissions WHERE code = $1', [code]))[0].admin_only).toBe(false);
    }
    expect(await ds.query(`SELECT code FROM roles WHERE is_system`)).toEqual([{ code: 'ADMIN' }]);
    expect(await ds.query(`SELECT p.code FROM permissions p WHERE NOT EXISTS (SELECT 1 FROM role_permissions rp
      JOIN roles r ON r.id = rp.role_id WHERE r.is_system AND rp.permission_id = p.id)`)).toEqual([]);
    expect(await ds.query(`SELECT r.code, p.code FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
      JOIN permissions p ON p.id = rp.permission_id WHERE p.admin_only AND NOT r.is_system`)).toEqual([]);
    // A key added by a later migration is granted to ADMIN in the same statement.
    const r = ds.createQueryRunner();
    await r.startTransaction();
    try {
      await r.query(`INSERT INTO permissions (code, module, name) VALUES ('TEST.NEW', 'TEST', 'Test')`);
      expect(await r.query(`SELECT 1 FROM v_user_grants WHERE role_code = 'ADMIN' AND permission = 'TEST.NEW' LIMIT 1`)).toHaveLength(1);
    } finally {
      await r.rollbackTransaction();
      await r.release();
    }
    expect(await ds.query(`SELECT 1 FROM permissions WHERE code = 'TEST.NEW'`)).toEqual([]);
  });

  it('keeps grant joins inside the Authorization module', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (path.endsWith('.ts') && !path.endsWith('.spec.ts') && /\b(user_roles|role_permissions)\b/.test(readFileSync(path, 'utf8'))) {
          offenders.push(path.replace(/\\/g, '/').replace(/^.*\/src\//, ''));
        }
      }
    };
    walk(join(__dirname, 'modules'));
    // Grant tables are read and written only inside the identity (Authorization) module.
    expect(offenders.filter(path => !path.startsWith('modules/identity/'))).toEqual([]);
    expect(offenders).toContain('modules/identity/authorization.ts');
  });

  it('rejects admin-only grants to business roles and protects the ADMIN role', async () => {
    const reject = (sql: string) => expect(ds.query(sql)).rejects.toThrow(/protected|system role|defined by migrations|truncated|still granted/);
    await reject(`INSERT INTO role_permissions (role_id, permission_id)
      SELECT r.id, p.id FROM roles r, permissions p WHERE r.code = 'SALES' AND p.code = 'ROLE.MANAGE'`);
    await reject(`INSERT INTO roles (code, name, is_system) VALUES ('ROOT', 'Root', true)`);
    await reject(`UPDATE roles SET is_system = true WHERE code = 'SALES'`);
    await reject(`UPDATE roles SET is_active = false WHERE code = 'ADMIN'`);
    await reject(`UPDATE roles SET code = 'ADMIN2' WHERE code = 'ADMIN'`);
    await reject(`DELETE FROM roles WHERE code = 'ADMIN'`);
    await reject(`DELETE FROM role_permissions WHERE role_id = (SELECT id FROM roles WHERE code = 'ADMIN')`);
    // UPDATE paths: moving an ADMIN grant away, re-pointing a business grant to an admin-only key, flag flips.
    await reject(`UPDATE role_permissions SET role_id = (SELECT id FROM roles WHERE code = 'SALES')
      WHERE role_id = (SELECT id FROM roles WHERE code = 'ADMIN') AND permission_id = (SELECT id FROM permissions WHERE code = 'PRODUCT.VIEW')`);
    await reject(`UPDATE role_permissions SET permission_id = (SELECT id FROM permissions WHERE code = 'USER.MANAGE')
      WHERE role_id = (SELECT id FROM roles WHERE code = 'SALES') AND permission_id = (SELECT id FROM permissions WHERE code = 'PRODUCT.VIEW')`);
    await reject(`UPDATE permissions SET admin_only = true WHERE code = 'SALES_CONTRACT.CREATE'`);
    await reject(`UPDATE roles SET id = 999999 WHERE code = 'ADMIN'`);
    await reject('TRUNCATE role_permissions');
    await reject('TRUNCATE roles CASCADE');
    // A key nobody but ADMIN holds can still be reclassified; the flag change is a catalog migration concern.
    await ds.query(`UPDATE permissions SET admin_only = true WHERE code = 'PO.APPROVE'`);
    await ds.query(`UPDATE permissions SET admin_only = false WHERE code = 'PO.APPROVE'`);
    expect(await ds.query(`SELECT 1 FROM roles r JOIN role_permissions rp ON rp.role_id = r.id WHERE r.code = 'ADMIN'`))
      .toHaveLength((await ds.query('SELECT 1 FROM permissions')).length);
    await ds.query(`UPDATE roles SET name = 'Quản trị hệ thống', description = 'System' WHERE code = 'ADMIN'`);
    expect(await ds.query(`SELECT name, description, is_system, is_active FROM roles WHERE code = 'ADMIN'`))
      .toEqual([{ name: 'Quản trị hệ thống', description: 'System', is_system: true, is_active: true }]);
    await ds.query(`UPDATE roles SET name = 'Administrator', description = NULL WHERE code = 'ADMIN'`);
  });

  it('reads and locks the same effective grants', async () => {
    const users: { id: number }[] = await ds.query('SELECT id FROM users');
    const permissions: { code: string }[] = await ds.query('SELECT code FROM permissions');
    await ds.query(`UPDATE roles SET is_active = false WHERE code = 'PM'`);
    try {
      await ds.transaction(async m => {
        for (const u of users) for (const p of permissions) {
          expect(!!(await grantRole(m, u.id, p.code, true))).toBe(!!(await grantRole(m, u.id, p.code)));
        }
      });
      expect(await ds.query(`SELECT 1 FROM v_user_grants WHERE role_code = 'PM'`)).toEqual([]);
    } finally {
      await ds.query(`UPDATE roles SET is_active = true WHERE code = 'PM'`);
    }
  });

  it('applies role deactivation, membership and grant revocation from the next request', async () => {
    const token = await login(app, 'purchaser', 'role-users-test');
    const prs = () => http().get('/purchase-requisitions').auth(token, { type: 'bearer' });
    await prs().expect(200);
    const restore: string[] = [];
    try {
      await ds.query(`UPDATE roles SET is_active = false WHERE code = 'PURCHASING'`);
      restore.push(`UPDATE roles SET is_active = true WHERE code = 'PURCHASING'`);
      await prs().expect(403);
      expect((await http().get('/auth/me').auth(token, { type: 'bearer' }).expect(200)).body).toMatchObject({ roleCodes: [], permissions: [] });
      expect((await ds.transaction(m => listCandidates(m, 'RECEIPT', null, false))).map(c => c.username)).not.toContain('purchaser');
      await ds.query(restore.pop()!);
      await prs().expect(200);

      await ds.query(`DELETE FROM role_permissions WHERE role_id = (SELECT id FROM roles WHERE code = 'PURCHASING')
        AND permission_id = (SELECT id FROM permissions WHERE code = 'PO.VIEW')`);
      restore.push(`INSERT INTO role_permissions (role_id, permission_id) SELECT r.id, p.id FROM roles r, permissions p
        WHERE r.code = 'PURCHASING' AND p.code = 'PO.VIEW'`);
      await http().get('/purchase-orders').auth(token, { type: 'bearer' }).expect(403);
      await ds.query(restore.pop()!);

      await ds.query(`DELETE FROM user_roles WHERE user_id = (SELECT id FROM users WHERE username = 'purchaser')`);
      restore.push(`INSERT INTO user_roles (user_id, role_id) SELECT u.id, r.id FROM users u, roles r
        WHERE u.username = 'purchaser' AND r.code = 'PURCHASING'`);
      await prs().expect(403);
      await ds.query(restore.pop()!);
      await prs().expect(200);
    } finally {
      for (const sql of restore.reverse()) await ds.query(sql);
    }
  });

  it('re-running the seed keeps administered grants, memberships, role status and passwords', async () => {
    const restore: string[] = [];
    try {
      await ds.query(`DELETE FROM role_permissions WHERE role_id = (SELECT id FROM roles WHERE code = 'SALES')
        AND permission_id = (SELECT id FROM permissions WHERE code = 'CUSTOMER.CREATE')`);
      restore.push(`INSERT INTO role_permissions SELECT r.id, p.id FROM roles r, permissions p WHERE r.code = 'SALES' AND p.code = 'CUSTOMER.CREATE'`);
      await ds.query(`DELETE FROM user_roles WHERE user_id = (SELECT id FROM users WHERE username = 'pm')`);
      restore.push(`INSERT INTO user_roles SELECT u.id, r.id FROM users u, roles r WHERE u.username = 'pm' AND r.code = 'PM'`);
      await ds.query(`DELETE FROM user_warehouses WHERE user_id = (SELECT id FROM users WHERE username = 'warehouse')`);
      restore.push(`INSERT INTO user_warehouses SELECT u.id, w.id FROM users u, warehouses w WHERE u.username = 'warehouse' AND w.code = 'HCM'`);
      await ds.query(`UPDATE roles SET is_active = false, name = 'Renamed by admin' WHERE code = 'PM_HEAD'`);
      restore.push(`UPDATE roles SET is_active = true, name = 'Trưởng bộ phận PM' WHERE code = 'PM_HEAD'`);
      const hash = 'admin-set';
      await ds.query(`UPDATE users SET password_hash = $1 WHERE username = 'sales'`, [hash]);
      const before = { grants: await roleGrants(ds), users: await userGrants(ds),
        state: await ds.query(`SELECT u.username, u.password_hash, u.is_active, array(SELECT w.warehouse_id FROM user_warehouses w WHERE w.user_id = u.id) AS w
          FROM users u ORDER BY u.id`), roles: await ds.query('SELECT code, name, is_active FROM roles ORDER BY id') };
      await seed(ds);
      await seed(ds);
      expect({ grants: await roleGrants(ds), users: await userGrants(ds),
        state: await ds.query(`SELECT u.username, u.password_hash, u.is_active, array(SELECT w.warehouse_id FROM user_warehouses w WHERE w.user_id = u.id) AS w
          FROM users u ORDER BY u.id`), roles: await ds.query('SELECT code, name, is_active FROM roles ORDER BY id') }).toEqual(before);
      expect(before.state.find((u: { username: string }) => u.username === 'sales').password_hash).toBe(hash);
      expect(before.grants).not.toContain('SALES>CUSTOMER.CREATE');
    } finally {
      for (const sql of restore.reverse()) await ds.query(sql);
      await ds.query(`UPDATE users SET password_hash = $1 WHERE username = 'sales'`, [await hashPassword('role-users-test')]);
    }
  });

  describe('live grant locking', () => {
    const purchaser = async () => (await ds.query(`SELECT id FROM users WHERE username = 'purchaser'`))[0].id as number;
    const runner = async () => {
      const r = ds.createQueryRunner();
      await r.connect();
      await r.startTransaction();
      return r;
    };
    const end = async (r: QueryRunner, commit = false) => {
      if (r.isTransactionActive) await (commit ? r.commitTransaction() : r.rollbackTransaction());
      await r.release();
    };

    it('blocks every revoke path while a workflow action holds the grant', async () => {
      const holder = await runner();
      try {
        expect(await grantRole(holder.manager, await purchaser(), 'PR.RECEIVE', true)).toMatchObject({ role: 'Mua hàng' });
        for (const revoke of [
          `UPDATE roles SET is_active = false WHERE code = 'PURCHASING'`,
          `DELETE FROM role_permissions WHERE role_id = (SELECT id FROM roles WHERE code = 'PURCHASING')
             AND permission_id = (SELECT id FROM permissions WHERE code = 'PR.RECEIVE')`,
          `DELETE FROM user_roles WHERE user_id = (SELECT id FROM users WHERE username = 'purchaser')`,
          `UPDATE users SET is_active = false WHERE username = 'purchaser'`,
        ]) {
          const other = await runner();
          try {
            await other.query(`SET LOCAL lock_timeout = '300ms'`);
            await expect(other.query(revoke)).rejects.toThrow(/lock timeout/);
          } finally {
            await end(other);
          }
        }
      } finally {
        await end(holder);
      }
    });

    it('sees a revoke committed while the live check waited, without deadlock', async () => {
      for (const [revoke, restore] of [
        [`UPDATE roles SET is_active = false WHERE code = 'PURCHASING'`, `UPDATE roles SET is_active = true WHERE code = 'PURCHASING'`],
        [`DELETE FROM role_permissions WHERE role_id = (SELECT id FROM roles WHERE code = 'PURCHASING')
            AND permission_id = (SELECT id FROM permissions WHERE code = 'PR.RECEIVE')`,
         `INSERT INTO role_permissions (role_id, permission_id) SELECT r.id, p.id FROM roles r, permissions p
            WHERE r.code = 'PURCHASING' AND p.code = 'PR.RECEIVE'`],
      ]) {
        const revoker = await runner();
        const checker = await runner();
        try {
          await revoker.query(revoke);
          const check = grantRole(checker.manager, await purchaser(), 'PR.RECEIVE', true);
          await new Promise(resolve => setTimeout(resolve, 200));
          await revoker.commitTransaction();
          expect(await check).toBeUndefined();
        } finally {
          await end(revoker);
          await end(checker);
          await ds.query(restore);
        }
      }
      expect(await grantRole(ds.manager, await purchaser(), 'PR.RECEIVE', true)).toBeDefined();
    });
  });

  describe('grant gate (F-OA1.3-21)', () => {
    const runner = async () => {
      const r = ds.createQueryRunner();
      await r.connect();
      await r.startTransaction();
      await r.query(`SET LOCAL lock_timeout = '500ms'`);
      return r;
    };
    const close = async (...runners: QueryRunner[]) => {
      for (const r of runners) { if (r.isTransactionActive) await r.rollbackTransaction(); await r.release(); }
    };
    const shared = `SELECT pg_advisory_xact_lock_shared(hashtext('grants'))`;
    const exclusive = `SELECT pg_advisory_xact_lock(hashtext('grants'))`;

    it('lets live grant checks run side by side (shared/shared)', async () => {
      const [a, b] = [await runner(), await runner()];
      try {
        const purchaser = (await ds.query(`SELECT id FROM users WHERE username = 'purchaser'`))[0].id;
        expect(await grantRole(a.manager, purchaser, 'PR.RECEIVE', true)).toBeDefined();
        expect(await grantRole(b.manager, purchaser, 'PR.RECEIVE', true)).toBeDefined();
      } finally { await close(a, b); }
    });

    it('is transaction-scoped: commit and rollback both release it, and one transaction never blocks itself', async () => {
      for (const end of ['commit', 'rollback'] as const) {
        const holder = await runner();
        const other = await runner();
        try {
          await holder.query(exclusive);
          await holder.query(shared); // own exclusive + own shared: no self-conflict, no upgrade
          await expect(other.query(shared)).rejects.toThrow(/lock timeout/);
          await (end === 'commit' ? holder.commitTransaction() : holder.rollbackTransaction());
          await other.rollbackTransaction();
          await other.startTransaction();
          await other.query(`SET LOCAL lock_timeout = '500ms'`);
          await other.query(exclusive);
        } finally { await close(holder, other); }
      }
    });

    it('serializes a revoke against a live check in both orders', async () => {
      const checker = await runner();
      const revoker = await runner();
      try {
        await checker.query(shared);
        await expect(revoker.query(exclusive)).rejects.toThrow(/lock timeout/);
      } finally { await close(checker, revoker); }
      const first = await runner();
      const second = await runner();
      try {
        await first.query(exclusive);
        await expect(second.query(shared)).rejects.toThrow(/lock timeout/);
      } finally { await close(first, second); }
    });
  });

  describe('upgrade from the OA0 baseline', () => {
    const schema = 'oa_upgrade';
    let up: DataSource;
    const options = (all: boolean) => {
      const base = dataSourceOptions();
      const migrations = base.migrations as Function[];
      const oa11 = migrations.findIndex(mig => mig.name === 'AuthorizationFoundation1733443200000');
      return { ...base, migrations: all ? migrations : migrations.slice(0, oa11), extra: { options: `-c search_path=${schema}` } };
    };

    afterAll(async () => {
      if (up?.isInitialized) await up.destroy();
      await ds.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    });

    it('adds only approved grants, keeps administered configuration through seed and survives down/up', async () => {
      await ds.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE; CREATE SCHEMA ${schema}`);
      up = new DataSource(options(false) as never);
      await up.initialize();
      await up.runMigrations();
      // Baseline seed (OA0): catalog by seed, ADMIN with every key, business roles, one user per role.
      const baselineKeys = [...new Set(Object.values(ROLES).flatMap(r => r.permissions).concat(
        'DOSSIER_TYPE.VIEW', 'DOSSIER_TYPE.MANAGE', 'DOSSIER_CONFIG.MANAGE', 'PR.DOSSIER_MANAGE', 'PRODUCT.UPDATE', 'PROCUREMENT_CATALOG.MANAGE',
        'WAREHOUSE.CREATE', 'WAREHOUSE.UPDATE', 'CUSTOMER.UPDATE', 'SUPPLIER.UPDATE', 'UOM.MANAGE', 'PR.CONFIGURE', 'PR.REASSIGN', 'PO.APPROVE'))];
      await up.query(`INSERT INTO permissions (code) SELECT unnest($1::text[]) ON CONFLICT DO NOTHING`, [baselineKeys]);
      await up.query(`INSERT INTO roles (code, name) VALUES ('ADMIN', 'Administrator')`);
      for (const [code, r] of Object.entries(ROLES)) {
        await up.query('INSERT INTO roles (code, name) VALUES ($1, $2)', [code, r.name]);
        await up.query(`INSERT INTO role_permissions SELECT r.id, p.id FROM roles r, permissions p WHERE r.code = $1 AND p.code = ANY($2)`, [code, r.permissions]);
      }
      await up.query(`INSERT INTO role_permissions SELECT r.id, p.id FROM roles r, permissions p WHERE r.code = 'ADMIN' ON CONFLICT DO NOTHING`);
      await up.query(`INSERT INTO users (username, password_hash, full_name) SELECT lower(code), 'x', name FROM roles`);
      await up.query(`INSERT INTO user_roles SELECT u.id, r.id FROM users u JOIN roles r ON lower(r.code) = u.username`);
      // Administered configuration that the old seed would have restored: SALES no longer creates customers.
      await up.query(`DELETE FROM role_permissions WHERE role_id = (SELECT id FROM roles WHERE code = 'SALES')
        AND permission_id = (SELECT id FROM permissions WHERE code = 'CUSTOMER.CREATE')`);
      const before = { roles: await roleGrants(up), users: await userGrants(up) };
      const missingInCatalog = (await up.query('SELECT code FROM permissions')).length;
      expect(missingInCatalog).toBe(baselineKeys.length);

      await up.destroy();
      up = new DataSource(options(true) as never);
      await up.initialize();
      await up.runMigrations();
      const after = { roles: await roleGrants(up), users: await userGrants(up) };
      // OA1.2 keeps every account as it was: hash, status, no forced change.
      expect(await up.query('SELECT DISTINCT password_hash, is_active, must_change_password, failed_login_count FROM users'))
        .toEqual([{ password_hash: 'x', is_active: true, must_change_password: false, failed_login_count: 0 }]);
      // Approved: the new admin-only keys go to ADMIN only. Anything else is unexpected.
      expect(diff(before.roles, after.roles)).toEqual({ added: NEW_KEYS.map(k => `ADMIN>${k}`), removed: [] });
      expect(diff(before.users, after.users)).toEqual({ added: NEW_KEYS.map(k => `admin>${k}`), removed: [] });

      await seed(up);
      await seed(up);
      const reseeded = await roleGrants(up);
      expect(reseeded.filter(g => !after.roles.includes(g))).toEqual([]);
      expect(reseeded).not.toContain('SALES>CUSTOMER.CREATE');
      expect(after.roles.filter(g => !reseeded.includes(g))).toEqual([]);

      expect(await up.runMigrations()).toEqual([]);
      // Revert OA1.3, OA1.2 then OA1.1.
      await up.undoLastMigration();
      await up.undoLastMigration();
      await up.undoLastMigration();
      expect(await roleGrants(up)).toEqual(before.roles);
      await up.runMigrations();
      expect(await roleGrants(up)).toEqual(reseeded);
    }, 120_000);
  });
});
