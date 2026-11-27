import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { bootTestApp, login } from './test-utils';
import { dataSourceOptions } from './database/data-source';
import { OA3_GRANTS, planGrantMapping } from './database/oa3-grant-mapping';
import { SUPPORTED_SCOPES } from './database/migrations/1734048000000-DataScope';
import { seed } from './database/seed';

/** OA3.1 Data Scope schema and Role API (ADR-0018 §4.1). The scope engine is not active on business reads yet. */
describe('Data Scope schema & Role API OA3.1 (PostgreSQL, HTTP)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let admin: string;
  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const roleScopes = async (code: string) => Object.fromEntries((await ds.query(`SELECT p.code,
      array_agg(s.scope_type ORDER BY s.scope_type COLLATE "C") AS scopes FROM role_permission_scopes s
      JOIN roles r ON r.id = s.role_id JOIN permissions p ON p.id = s.permission_id WHERE r.code = $1 GROUP BY p.code`, [code]))
    .map((r: { code: string; scopes: string[] }) => [r.code, r.scopes]));
  const detail = async (id: number) => (await http().get(`/admin/roles/${id}`).set(bearer(admin)).expect(200)).body;
  const actions = async (id: number) => (await ds.query(`SELECT action, metadata FROM approval_histories
    WHERE document_type = 'ROLE' AND document_id = $1 ORDER BY id`, [id])) as { action: string; metadata: Record<string, unknown> }[];
  const create = (body: object) => http().post('/admin/roles').set(bearer(admin)).send({ userIds: [], ...body });
  const put = (id: number, body: object) => http().put(`/admin/roles/${id}`).set(bearer(admin)).send(body);
  const sortedScopes = (o: Record<string, string[]>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, [...v].sort()]));

  beforeAll(async () => {
    ({ app, ds } = await bootTestApp());
    admin = await login(app, process.env.SEED_ADMIN_USERNAME!, process.env.SEED_ADMIN_PASSWORD!);
  }, 120_000);
  afterAll(async () => app?.close());

  it('declares supported scopes in the catalog; admin-only and unscoped keys have none', async () => {
    const catalog = (await http().get('/admin/permissions').set(bearer(admin)).expect(200)).body as
      { code: string; adminOnly: boolean; supportedScopes: string[] }[];
    for (const p of catalog) expect(p.supportedScopes).toEqual(SUPPORTED_SCOPES[p.code] ?? []);
    expect(catalog.filter(p => p.adminOnly).every(p => !p.supportedScopes.length)).toBe(true);
    for (const key of ['PO.VIEW', 'GIR.VIEW', 'INVENTORY.VIEW', 'PRODUCT.VIEW']) expect(catalog.find(p => p.code === key)!.supportedScopes).toEqual([]);
  });

  it('gives the system role ALL when supported, otherwise every supported scope', async () => {
    const expected = Object.fromEntries(Object.entries(SUPPORTED_SCOPES)
      .map(([code, list]) => [code, list.includes('ALL') ? ['ALL'] : [...list].sort()]));
    expect(await roleScopes('ADMIN')).toEqual(expected);
    expect((await roleScopes('ADMIN'))['PR.CREATE']).toEqual(['CREATOR', 'ORG_UNIT', 'ORG_UNIT_TREE', 'RESPONSIBLE']);
  });

  it('grants a key added by a later migration to the system role with its scopes', async () => {
    const qr = ds.createQueryRunner();
    await qr.startTransaction();
    try {
      await qr.query(`INSERT INTO permissions (code, module, name, supported_scopes) VALUES ('X.VIEW', 'X', 'X', '{CREATOR,ORG_UNIT}')`);
      expect(await qr.query(`SELECT s.scope_type FROM role_permission_scopes s JOIN permissions p ON p.id = s.permission_id
        JOIN roles r ON r.id = s.role_id AND r.is_system WHERE p.code = 'X.VIEW' ORDER BY 1`)).toEqual([{ scope_type: 'CREATOR' }, { scope_type: 'ORG_UNIT' }]);
    } finally { await qr.rollbackTransaction(); await qr.release(); }
  });

  it('protects scope validity, the system role and admin-only keys at the database', async () => {
    const reject = (sql: string, pattern: RegExp) => expect(ds.query(sql)).rejects.toThrow(pattern);
    const ids = `(SELECT id FROM roles WHERE code = 'SALES'), (SELECT id FROM permissions WHERE code = '%s')`;
    await reject(`INSERT INTO role_permission_scopes VALUES (${ids.replace('%s', 'SALES_CONTRACT.VIEW')}, 'ASSIGNED')`, /not supported/);
    await reject(`INSERT INTO role_permission_scopes VALUES (${ids.replace('%s', 'PR.CREATE')}, 'ALL')`, /not supported/);
    await reject(`INSERT INTO role_permission_scopes VALUES (${ids.replace('%s', 'PR.CREATE')}, 'EVERYTHING')`, /not supported|check constraint/);
    // A scope needs the grant (FK): SALES does not hold PR.APPROVE.
    await reject(`INSERT INTO role_permission_scopes VALUES (${ids.replace('%s', 'PR.APPROVE')}, 'ASSIGNED')`, /foreign key/);
    await reject(`UPDATE role_permission_scopes SET scope_type = 'ALL' WHERE role_id = (SELECT id FROM roles WHERE code = 'SALES')
      AND permission_id = (SELECT id FROM permissions WHERE code = 'PR.CREATE') AND scope_type = 'CREATOR'`, /not supported/);
    const admin_ = `(SELECT id FROM roles WHERE code = 'ADMIN')`;
    await reject(`DELETE FROM role_permission_scopes WHERE role_id = ${admin_}`, /protected/);
    await reject(`INSERT INTO role_permission_scopes VALUES (${admin_}, (SELECT id FROM permissions WHERE code = 'PR.VIEW'), 'CREATOR')`, /protected/);
    await reject(`UPDATE role_permission_scopes SET scope_type = 'ASSIGNED' WHERE role_id = ${admin_}`, /protected/);
    await reject('TRUNCATE role_permission_scopes', /truncated/);
    await reject(`UPDATE permissions SET supported_scopes = '{CREATOR}' WHERE code = 'PR.VIEW'`, /outside the new supported/);
    await reject(`UPDATE permissions SET supported_scopes = '{ALL}' WHERE code = 'ROLE.VIEW'`, /check constraint/);
    await reject(`UPDATE permissions SET supported_scopes = '{ANYTHING}' WHERE code = 'PO.VIEW'`, /check constraint/);
    // Removing a grant removes its scopes (no orphan scope rows).
    const qr = ds.createQueryRunner();
    await qr.startTransaction();
    try {
      await qr.query(`DELETE FROM role_permissions WHERE role_id = (SELECT id FROM roles WHERE code = 'SALES')
        AND permission_id = (SELECT id FROM permissions WHERE code = 'PR.VIEW')`);
      expect(await qr.query(`SELECT count(*)::int AS n FROM role_permission_scopes s JOIN roles r ON r.id = s.role_id
        JOIN permissions p ON p.id = s.permission_id WHERE r.code = 'SALES' AND p.code = 'PR.VIEW'`)).toEqual([{ n: 0 }]);
    } finally { await qr.rollbackTransaction(); await qr.release(); }
  });

  it('F01: the DB accepts a scoped grant without scopes (SQL, last scope removed, key turned scoped); the API never saves one', async () => {
    const qr = ds.createQueryRunner();
    await qr.startTransaction();
    try {
      const role = (await qr.query(`INSERT INTO roles (code, name) VALUES ('OA31_F01', 'F01') RETURNING id`))[0].id;
      const perm = (code: string) => `(SELECT id FROM permissions WHERE code = '${code}')`;
      // (1) Direct SQL grant without scope, (2) last scope deleted, (3) an unscoped key becomes scoped.
      await qr.query(`INSERT INTO role_permissions VALUES ($1, ${perm('PR.VIEW')}), ($1, ${perm('PR.CREATE')}), ($1, ${perm('PO.VIEW')})`, [role]);
      await qr.query(`INSERT INTO role_permission_scopes VALUES ($1, ${perm('PR.CREATE')}, 'CREATOR')`, [role]);
      await qr.query(`DELETE FROM role_permission_scopes WHERE role_id = $1`, [role]);
      await qr.query(`UPDATE permissions SET supported_scopes = '{ALL}' WHERE code = 'PO.VIEW'`);
      expect(await qr.query(`SELECT count(*)::int AS n FROM role_permission_scopes WHERE role_id = $1`, [role])).toEqual([{ n: 0 }]);
      // Such a grant is fail-closed at runtime from OA3.2; the API refusal is covered by the SCOPE_REQUIRED test below.
    } finally { await qr.rollbackTransaction(); await qr.release(); }
  });

  it('F02: a supported_scopes change keeps ADMIN on the widest valid scope in the same transaction', async () => {
    const qr = ds.createQueryRunner();
    await qr.startTransaction();
    try {
      const admin_ = async (code: string) => (await qr.query(`SELECT s.scope_type FROM role_permission_scopes s
        JOIN roles r ON r.id = s.role_id AND r.is_system JOIN permissions p ON p.id = s.permission_id WHERE p.code = $1
        ORDER BY s.scope_type COLLATE "C"`, [code])).map((r: { scope_type: string }) => r.scope_type);
      await qr.query(`UPDATE permissions SET supported_scopes = '{WAREHOUSE}' WHERE code = 'PO.VIEW'`);
      expect(await admin_('PO.VIEW')).toEqual(['WAREHOUSE']); // unscoped → scoped
      await qr.query(`UPDATE permissions SET supported_scopes = '{CREATOR,ALL}' WHERE code = 'PO.VIEW'`);
      expect(await admin_('PO.VIEW')).toEqual(['ALL']); // ALL appears
      await qr.query(`UPDATE permissions SET supported_scopes = '{CREATOR,RESPONSIBLE,ORG_UNIT,ORG_UNIT_TREE,ASSIGNED}' WHERE code = 'PR.CREATE'`);
      expect(await admin_('PR.CREATE')).toEqual(['ASSIGNED', 'CREATOR', 'ORG_UNIT', 'ORG_UNIT_TREE', 'RESPONSIBLE']); // widened
      await qr.query(`UPDATE permissions SET supported_scopes = '{ASSIGNED,ORG_UNIT}' WHERE code = 'PR.APPROVE'`);
      expect(await admin_('PR.APPROVE')).toEqual(['ASSIGNED', 'ORG_UNIT']); // ALL removed: business roles hold only G
      await qr.query(`UPDATE permissions SET supported_scopes = '{}' WHERE code = 'PR.REASSIGN'`);
      expect(await admin_('PR.REASSIGN')).toEqual([]); // scoped → unscoped
      // Still no direct write on ADMIN scopes.
      await expect(qr.query(`DELETE FROM role_permission_scopes s USING roles r WHERE r.id = s.role_id AND r.is_system`)).rejects.toThrow(/protected/);
    } finally { await qr.rollbackTransaction(); await qr.release(); }
  });

  it('adds HĐ/PR responsible unit columns, nullable, referencing org_units, without backfill', async () => {
    const cols = await ds.query(`SELECT table_name, is_nullable FROM information_schema.columns
      WHERE column_name = 'owner_org_unit_id' AND table_schema = current_schema() ORDER BY 1`);
    expect(cols).toEqual([{ table_name: 'purchase_requisitions', is_nullable: 'YES' }, { table_name: 'sales_contracts', is_nullable: 'YES' }]);
    expect(await ds.query(`SELECT count(*)::int AS n FROM pg_constraint WHERE contype = 'f' AND confrelid = 'org_units'::regclass
      AND conrelid IN ('sales_contracts'::regclass, 'purchase_requisitions'::regclass)`)).toEqual([{ n: 2 }]);
  });

  it('seeds the approved matrix, removes HĐ access from COMMON and leaves administered roles alone', async () => {
    for (const code of Object.keys(OA3_GRANTS)) expect(await roleScopes(code)).toEqual(sortedScopes(OA3_GRANTS[code]));
    const scToRoles = (await ds.query(`SELECT r.code FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
      JOIN permissions p ON p.id = rp.permission_id WHERE p.code = 'SALES_CONTRACT.VIEW' ORDER BY 1`)).map((r: { code: string }) => r.code);
    expect(scToRoles).toEqual(['ADMIN', 'PM', 'SALES']);
    // OA3.3b: the full matrix is seeded (no deferred grants), so a fresh seed needs no mapping.
    expect(await planGrantMapping(ds.manager)).toEqual({ add: [], remove: [], rescope: [], unmapped: [] });
    const before = await roleScopes('SALES');
    await seed(ds);
    expect(await roleScopes('SALES')).toEqual(before);
  });

  it('plans the grant mapping read-only: rescope, remove, add and custom roles left as administered', async () => {
    const qr = ds.createQueryRunner();
    await qr.startTransaction();
    try {
      const sales = `(SELECT id FROM roles WHERE code = 'SALES')`;
      const perm = (code: string) => `(SELECT id FROM permissions WHERE code = '${code}')`;
      await qr.query(`DELETE FROM role_permission_scopes WHERE role_id = ${sales} AND permission_id = ${perm('PR.CREATE')} AND scope_type = 'RESPONSIBLE'`);
      await qr.query(`INSERT INTO role_permissions VALUES ((SELECT id FROM roles WHERE code = 'WAREHOUSE_MANAGER'), ${perm('SALES_CONTRACT.VIEW')})`);
      await qr.query(`DELETE FROM role_permissions WHERE role_id = (SELECT id FROM roles WHERE code = 'PURCHASING') AND permission_id = ${perm('PR.RECEIVE')}`);
      await qr.query(`INSERT INTO roles (code, name) VALUES ('OA31_CUSTOM', 'Custom')`);
      await qr.query(`INSERT INTO role_permissions VALUES ((SELECT id FROM roles WHERE code = 'OA31_CUSTOM'), ${perm('PR.VIEW')})`);
      expect(await planGrantMapping(qr.manager)).toEqual({
        add: expect.arrayContaining([{ role: 'PURCHASING', permission: 'PR.RECEIVE', scopes: ['ASSIGNED'] }]),
        remove: [{ role: 'WAREHOUSE_MANAGER', permission: 'SALES_CONTRACT.VIEW' }],
        rescope: [{ role: 'SALES', permission: 'PR.CREATE', before: ['CREATOR'], after: ['CREATOR', 'RESPONSIBLE'] }],
        unmapped: [{ role: 'OA31_CUSTOM', permission: 'PR.VIEW' }],
      });
    } finally { await qr.rollbackTransaction(); await qr.release(); }
  });

  it('blocks a role save with a missing, unsupported or orphan scope; never defaults to ALL', async () => {
    const code = (res: request.Response) => res.body.code;
    expect(code(await create({ code: 'OA31_MISS', name: 'x', permissions: ['PR.VIEW', 'PO.VIEW'] }).expect(422))).toBe('SCOPE_REQUIRED');
    expect(code(await create({ code: 'OA31_MISS', name: 'x', permissions: ['PR.VIEW'], scopes: { 'PR.VIEW': [] } }).expect(422))).toBe('SCOPE_REQUIRED');
    expect(code(await create({ code: 'OA31_MISS', name: 'x', permissions: ['PR.CREATE'], scopes: { 'PR.CREATE': ['ALL'] } }).expect(422))).toBe('SCOPE_NOT_SUPPORTED');
    expect(code(await create({ code: 'OA31_MISS', name: 'x', permissions: ['PO.VIEW'], scopes: { 'PO.VIEW': ['ALL'] } }).expect(422))).toBe('SCOPE_NOT_SUPPORTED');
    expect(code(await create({ code: 'OA31_MISS', name: 'x', permissions: ['PR.VIEW'], scopes: { 'PR.VIEW': 'ALL' } }).expect(422))).toBe('SCOPE_NOT_SUPPORTED');
    expect(code(await create({ code: 'OA31_MISS', name: 'x', permissions: ['PO.VIEW'], scopes: { 'PR.VIEW': ['ALL'] } }).expect(422))).toBe('SCOPE_WITHOUT_PERMISSION');
    expect(code(await create({ code: 'OA31_MISS', name: 'x', permissions: [], scopes: [] }).expect(400))).toBe('BAD_REQUEST');
    expect(await ds.query(`SELECT 1 FROM roles WHERE code = 'OA31_MISS'`)).toEqual([]);
  });

  it('creates, reads, rescopes and copies scopes with before/after audit, version and atomic rollback', async () => {
    const { id } = (await create({ code: 'OA31_ROLE', name: 'Scoped', permissions: ['PR.VIEW', 'PR.APPROVE', 'PO.VIEW'],
      scopes: { 'PR.VIEW': ['ASSIGNED', 'CREATOR', 'CREATOR'], 'PR.APPROVE': ['ASSIGNED'] } }).expect(201)).body;
    let role = await detail(id);
    expect(role.scopes).toEqual({ 'PR.VIEW': ['ASSIGNED', 'CREATOR'], 'PR.APPROVE': ['ASSIGNED'] });
    expect((await actions(id))[0]).toMatchObject({ action: 'ROLE_CREATED', metadata: { scopes: role.scopes } });

    const base = { name: role.name, description: role.description, userIds: [] };
    // Widen PR.VIEW, add PR.RECEIVE, drop PR.APPROVE (its scopes go with it).
    await put(id, { ...base, version: role.version, permissions: ['PR.VIEW', 'PR.RECEIVE', 'PO.VIEW'],
      scopes: { 'PR.VIEW': ['ORG_UNIT_TREE', 'CREATOR'], 'PR.RECEIVE': ['ALL'] } }).expect(204);
    const next = await detail(id);
    expect(next.version).toBe(role.version + 1);
    expect(next.scopes).toEqual({ 'PR.VIEW': ['CREATOR', 'ORG_UNIT_TREE'], 'PR.RECEIVE': ['ALL'] });
    const log = (await actions(id)).slice(1);
    expect(log).toEqual(expect.arrayContaining([
      { action: 'PERMISSIONS_REMOVED', metadata: { permissions: ['PR.APPROVE'], scopes: { 'PR.APPROVE': ['ASSIGNED'] } } },
      { action: 'PERMISSIONS_ADDED', metadata: { permissions: ['PR.RECEIVE'], scopes: { 'PR.RECEIVE': ['ALL'] } } },
      { action: 'SCOPES_UPDATED', metadata: { before: { 'PR.VIEW': ['ASSIGNED', 'CREATOR'] }, after: { 'PR.VIEW': ['CREATOR', 'ORG_UNIT_TREE'] } } },
    ]));
    role = next;

    // Same scopes in another order: no change event.
    await put(id, { ...base, version: role.version, permissions: role.permissions, scopes: { 'PR.VIEW': ['ORG_UNIT_TREE', 'CREATOR'], 'PR.RECEIVE': ['ALL'] } }).expect(204);
    expect((await actions(id)).filter(a => a.action === 'SCOPES_UPDATED')).toHaveLength(1);
    role = await detail(id);

    // Stale version: 409, nothing changes.
    expect((await put(id, { ...base, version: role.version - 1, permissions: role.permissions, scopes: { 'PR.VIEW': ['ALL'], 'PR.RECEIVE': ['ALL'] } })
      .expect(409)).body.code).toBe('VERSION_CONFLICT');
    // Valid scopes but an invalid member: the whole save rolls back.
    await put(id, { ...base, userIds: [999_999], version: role.version, permissions: role.permissions, scopes: { 'PR.VIEW': ['ALL'], 'PR.RECEIVE': ['ALL'] } }).expect(422);
    expect(await detail(id)).toMatchObject({ version: role.version, scopes: role.scopes });

    // Copy = Create prefilled with permissions + scopes; the source is read from the database.
    const copy = (await create({ code: 'OA31_COPY', name: 'Copy', permissions: role.permissions, scopes: role.scopes, copiedFrom: id }).expect(201)).body;
    expect((await detail(copy.id)).scopes).toEqual(role.scopes);
    expect((await actions(copy.id))[0]).toMatchObject({ action: 'ROLE_COPIED', metadata: { scopes: role.scopes, copiedFrom: { id } } });
  });

  it('keeps the system role scopes fixed through the API', async () => {
    const id = (await ds.query(`SELECT id FROM roles WHERE code = 'ADMIN'`))[0].id;
    const role = await detail(id);
    const body = { name: role.name, description: role.description, permissions: role.permissions, userIds: role.users.map((u: { id: number }) => u.id), version: role.version };
    expect((await put(id, { ...body, scopes: { ...role.scopes, 'PR.VIEW': ['CREATOR'] } }).expect(422)).body.code).toBe('SYSTEM_ROLE_PROTECTED');
    expect((await put(id, body).expect(422)).body.code).toBe('SCOPE_REQUIRED');
    await put(id, { ...body, scopes: role.scopes }).expect(204);
    expect((await detail(id)).scopes).toEqual(role.scopes);
  });

  describe('migration down/up', () => {
    const schema = 'oa31_migration';
    let up: DataSource;
    afterAll(async () => {
      if (up?.isInitialized) await up.destroy();
      await ds.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    });

    it('reverts to OA2 schema and reapplies with the same system role scopes', async () => {
      await ds.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE; CREATE SCHEMA ${schema}`);
      up = new DataSource({ ...dataSourceOptions(), extra: { options: `-c search_path=${schema}` } } as never);
      await up.initialize();
      await up.runMigrations();
      const scopes = await up.query('SELECT role_id, permission_id, scope_type FROM role_permission_scopes ORDER BY 1, 2, 3');
      expect(scopes.length).toBe(Object.keys(SUPPORTED_SCOPES).length + 3); // PR.CREATE carries 4 scopes
      await up.undoLastMigration();
      expect(await up.query(`SELECT to_regclass('role_permission_scopes') AS t`)).toEqual([{ t: null }]);
      expect(await up.query(`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema = '${schema}'
        AND column_name IN ('supported_scopes', 'owner_org_unit_id')`)).toEqual([{ n: 0 }]);
      // The OA1.1 new-key trigger is back to grants only (would fail if it still wrote the dropped scope table).
      await up.query(`INSERT INTO permissions (code, module, name) VALUES ('Y.VIEW', 'Y', 'Y')`);
      expect(await up.query(`SELECT count(*)::int AS n FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE p.code = 'Y.VIEW'`)).toEqual([{ n: 1 }]);
      expect(await up.runMigrations()).toHaveLength(1);
      expect(await up.query('SELECT role_id, permission_id, scope_type FROM role_permission_scopes ORDER BY 1, 2, 3')).toEqual(scopes);
    }, 120_000);
  });
});
