import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { bootTestApp, login } from './test-utils';
import { hashPassword } from './modules/identity/password';
import { RoleAdminService } from './modules/identity/role-admin';

const PW = 'correct horse battery';

describe('Role & Permission management OA1.3 (PostgreSQL, HTTP)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let admin: string;
  let adminId: number;
  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, url: string) => http().get(url).set(bearer(t));
  const create = (t: string, body: object) => http().post('/admin/roles').set(bearer(t)).send(body);
  const put = (t: string, id: number, body: object) => http().put(`/admin/roles/${id}`).set(bearer(t)).send(body);
  const status = (t: string, id: number, isActive: boolean, version: number) =>
    http().patch(`/admin/roles/${id}/status`).set(bearer(t)).send({ isActive, version });
  const detail = async (id: number) => (await get(admin, `/admin/roles/${id}`).expect(200)).body;
  const actions = async (id: number) => (await ds.query(`SELECT action, metadata FROM approval_histories
    WHERE document_type = 'ROLE' AND document_id = $1 ORDER BY id`, [id])) as { action: string; metadata: Record<string, unknown> | null }[];
  const adminRoleId = async () => (await ds.query(`SELECT id FROM roles WHERE code = 'ADMIN'`))[0].id as number;

  let seq = 0;
  async function makeUser(role?: string) {
    const username = `oa13-${++seq}`;
    const [{ id }] = await ds.query(`INSERT INTO users (employee_code, username, password_hash, full_name) VALUES ($1, $1, $2, $3) RETURNING id`,
      [username, await hashPassword(PW), `Role User ${seq}`]);
    if (role) await ds.query('INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE code = $2', [id, role]);
    return { id: id as number, username };
  }
  const tokenOf = async (username: string) => (await http().post('/auth/login').send({ username, password: PW }).expect(200)).body.accessToken as string;
  const editable = (role: { name: string; description: string | null; permissions: string[]; users: { id: number }[]; version: number }) =>
    ({ name: role.name, description: role.description, permissions: role.permissions, userIds: role.users.map(u => u.id), version: role.version });

  beforeAll(async () => {
    ({ app, ds } = await bootTestApp());
    admin = await login(app, process.env.SEED_ADMIN_USERNAME!, process.env.SEED_ADMIN_PASSWORD!);
    adminId = (await get(admin, '/auth/me').expect(200)).body.id;
  }, 120_000);
  afterAll(async () => app?.close());

  it('serves a read-only catalog grouped by module in display order', async () => {
    const catalog = (await get(admin, '/admin/permissions').expect(200)).body as { code: string; module: string; adminOnly: boolean }[];
    expect(catalog[0]).toMatchObject({ code: 'PRODUCT.VIEW', module: 'MASTER_DATA', adminOnly: false });
    expect(catalog.find(p => p.code === 'ROLE.MANAGE')).toMatchObject({ module: 'ADMINISTRATION', adminOnly: true });
    expect(new Set(catalog.map(p => p.code)).size).toBe(catalog.length);
    await http().post('/admin/permissions').set(bearer(admin)).send({ code: 'X.Y' }).expect(404);
    await http().put('/admin/permissions').set(bearer(admin)).send({}).expect(404);
  });

  it('creates, lists, searches, filters, sorts and pages roles server-side', async () => {
    const u = await makeUser();
    const res = await create(admin, { code: 'OA13_LIST_A', name: 'Kế toán', description: 'Accounting', permissions: ['PRODUCT.VIEW', 'PO.VIEW'], userIds: [u.id] }).expect(201);
    await create(admin, { code: 'OA13_LIST_B', name: 'Kiểm soát', permissions: [], userIds: [] }).expect(201);
    expect((await create(admin, { code: 'oa13_list_a', name: 'dup', permissions: [], userIds: [] }).expect(400)).body.code).toBe('BAD_REQUEST');
    expect((await create(admin, { code: 'OA13_LIST_A', name: 'dup', permissions: [], userIds: [] }).expect(409)).body.code).toBe('DUPLICATE_VALUE');
    const page = (await get(admin, '/admin/roles?q=oa13_list&sort=code&direction=desc&size=25').expect(200)).body;
    expect(page.total).toBe(2);
    expect(page.items.map((r: { code: string }) => r.code)).toEqual(['OA13_LIST_B', 'OA13_LIST_A']);
    expect(page.items[1]).toMatchObject({ name: 'Kế toán', description: 'Accounting', userCount: 1, permissionCount: 2, isActive: true, isSystem: false });
    const second = (await get(admin, '/admin/roles?q=OA13_LIST&sort=code&size=25&page=1').expect(200)).body;
    expect(second).toEqual({ items: [], total: 2 });
    await status(admin, res.body.id, false, 1).expect(204);
    expect((await get(admin, '/admin/roles?q=OA13_LIST&status=false').expect(200)).body.items.map((r: { code: string }) => r.code)).toEqual(['OA13_LIST_A']);
    await get(admin, '/admin/roles?sort=password').expect(400);
    const role = await detail(res.body.id);
    expect(role).toMatchObject({ code: 'OA13_LIST_A', isActive: false, permissions: ['PRODUCT.VIEW', 'PO.VIEW'], users: [{ id: u.id, username: u.username }] });
    expect(role.history.map((h: { action: string }) => h.action)).toEqual(['ROLE_DEACTIVATED', 'ROLE_CREATED']);
  });

  it('rejects admin-only, unknown and direct-to-user grants, and keeps code immutable', async () => {
    expect((await create(admin, { code: 'OA13_BAD', name: 'x', permissions: ['USER.MANAGE'], userIds: [] }).expect(422)).body.code).toBe('ADMIN_ONLY_PERMISSION');
    expect((await create(admin, { code: 'OA13_BAD', name: 'x', permissions: ['NOPE.KEY'], userIds: [] }).expect(422)).body.code).toBe('UNKNOWN_PERMISSION');
    expect((await create(admin, { code: 'OA13_BAD', name: 'x', permissions: [], userIds: [999999] }).expect(422)).body.code).toBe('UNKNOWN_USER');
    const { id } = (await create(admin, { code: 'OA13_IMMUTABLE', name: 'x', permissions: [], userIds: [] }).expect(201)).body;
    const role = await detail(id);
    await put(admin, id, { ...editable(role), code: 'OTHER' }).expect(400);
    expect((await put(admin, id, { ...editable(role), permissions: ['ROLE.VIEW'] }).expect(422)).body.code).toBe('ADMIN_ONLY_PERMISSION');
    await http().post('/admin/users/1/permissions').set(bearer(admin)).send({}).expect(404);
    expect((await detail(id)).code).toBe('OA13_IMMUTABLE');
  });

  it('copies into an independent role and records the source', async () => {
    const { id: source } = (await create(admin, { code: 'OA13_SRC', name: 'Nguồn', description: 'd', permissions: ['GR.VIEW'], userIds: [] }).expect(201)).body;
    const src = await detail(source);
    const { id: copy } = (await create(admin, { code: 'OA13_COPY', name: src.name, description: src.description, permissions: src.permissions,
      userIds: [], copiedFrom: source }).expect(201)).body;
    await put(admin, source, { ...editable(src), permissions: ['GR.VIEW', 'GRR.VIEW'] }).expect(204);
    expect((await detail(copy)).permissions).toEqual(['GR.VIEW']);
    const [created] = await actions(copy);
    expect(created).toMatchObject({ action: 'ROLE_COPIED', metadata: { copiedFrom: { id: source, code: 'OA13_SRC' }, permissions: ['GR.VIEW'] } });
  });

  it('applies grant, membership and status changes from the next request, keeping rows on deactivation', async () => {
    const u = await makeUser();
    const t = await tokenOf(u.username);
    await get(t, '/purchase-orders').expect(403);
    const { id } = (await create(admin, { code: 'OA13_EFFECT', name: 'Effect', permissions: ['PO.VIEW'], userIds: [u.id] }).expect(201)).body;
    await get(t, '/purchase-orders').expect(200);
    let role = await detail(id);
    await status(admin, id, false, role.version).expect(204);
    await get(t, '/purchase-orders').expect(403);
    role = await detail(id);
    expect(role).toMatchObject({ permissions: ['PO.VIEW'], users: [{ id: u.id }] });
    await status(admin, id, true, role.version).expect(204);
    await get(t, '/purchase-orders').expect(200);
    role = await detail(id);
    await put(admin, id, { ...editable(role), permissions: [] }).expect(204);
    await get(t, '/purchase-orders').expect(403);
    role = await detail(id);
    await put(admin, id, { ...editable(role), permissions: ['PO.VIEW'], userIds: [] }).expect(204);
    await get(t, '/purchase-orders').expect(403);
    expect((await actions(id)).map(a => a.action)).toEqual(['ROLE_CREATED', 'ROLE_DEACTIVATED', 'ROLE_ACTIVATED', 'PERMISSIONS_REMOVED',
      'PERMISSIONS_ADDED', 'USERS_REMOVED']);
  });

  it('detects concurrent edits with the version', async () => {
    const { id } = (await create(admin, { code: 'OA13_VERSION', name: 'v1', permissions: [], userIds: [] }).expect(201)).body;
    const role = await detail(id);
    const results = await Promise.all([put(admin, id, { ...editable(role), name: 'first' }), put(admin, id, { ...editable(role), name: 'second' })]);
    expect(results.map(r => r.status).sort()).toEqual([204, 409]);
    expect(results.find(r => r.status === 409)!.body.code).toBe('VERSION_CONFLICT');
    expect((await actions(id)).filter(a => a.action === 'ROLE_UPDATED')).toHaveLength(1);
    await status(admin, id, false, role.version).expect(409);
  });

  it('protects the system role ADMIN on every new path', async () => {
    const id = await adminRoleId();
    const role = await detail(id);
    expect(role.isSystem).toBe(true);
    expect((await put(admin, id, { ...editable(role), permissions: role.permissions.slice(1) }).expect(422)).body.code).toBe('SYSTEM_ROLE_PROTECTED');
    expect((await status(admin, id, false, role.version).expect(422)).body.code).toBe('SYSTEM_ROLE_PROTECTED');
    await put(admin, id, { ...editable(role), name: 'Quản trị hệ thống', description: 'Toàn quyền' }).expect(204);
    const renamed = await detail(id);
    expect(renamed).toMatchObject({ code: 'ADMIN', name: 'Quản trị hệ thống', isActive: true, permissions: role.permissions });
    // Self-change is denied whichever role is edited (OA0 §5.4).
    expect((await put(admin, id, { ...editable(renamed), userIds: renamed.users.map((u: { id: number }) => u.id).filter((u: number) => u !== adminId) })
      .expect(403)).body.code).toBe('SELF_CHANGE_DENIED');
    const { id: other } = (await create(admin, { code: 'OA13_SELF', name: 'x', permissions: [], userIds: [] }).expect(201)).body;
    expect((await put(admin, other, { ...editable(await detail(other)), userIds: [adminId] }).expect(403)).body.code).toBe('SELF_CHANGE_DENIED');
    expect((await create(admin, { code: 'OA13_SELF2', name: 'x', permissions: [], userIds: [adminId] }).expect(403)).body.code).toBe('SELF_CHANGE_DENIED');
    await put(admin, id, { ...editable(renamed), name: 'Administrator', description: null }).expect(204);
  });

  it('keeps administration to ROLE.VIEW / ROLE.MANAGE holders', async () => {
    const sales = await login(app, 'sales', 'role-users-test');
    const id = await adminRoleId();
    for (const res of [await get(sales, '/admin/roles'), await get(sales, `/admin/roles/${id}`), await get(sales, '/admin/permissions'),
      await get(sales, '/admin/roles/user-options'), await create(sales, { code: 'OA13_NO', name: 'x', permissions: [], userIds: [] }),
      await put(sales, id, {}), await status(sales, id, false, 1), await get(sales, `/admin/roles/${id}/history`)]) {
      expect(res.status).toBe(403);
    }
    const options = (await get(admin, '/admin/roles/user-options?q=sales').expect(200)).body;
    expect(options.items).toEqual(expect.arrayContaining([expect.objectContaining({ username: 'sales', isActive: true })]));
    expect(Object.keys(options.items[0]).sort()).toEqual(['fullName', 'id', 'isActive', 'username']);
  });

  it('pages the user picker server-side with a stable total', async () => {
    for (let i = 0; i < 27; i++) await makeUser();
    const first = (await get(admin, '/admin/roles/user-options?q=oa13-&sort=username&size=25&page=0').expect(200)).body;
    const second = (await get(admin, '/admin/roles/user-options?q=oa13-&sort=username&size=25&page=1').expect(200)).body;
    expect(first.total).toBe(second.total);
    expect(first.items).toHaveLength(25);
    expect(second.items.length).toBe(first.total - 25);
    const ids = [...first.items, ...second.items].map((u: { id: number }) => u.id);
    expect(new Set(ids).size).toBe(ids.length);
    const desc = (await get(admin, '/admin/roles/user-options?q=oa13-&sort=username&direction=desc&size=25').expect(200)).body;
    expect(desc.items[0].username >= desc.items[1].username).toBe(true);
    await get(admin, '/admin/roles/user-options?size=7').expect(400);
  });

  it('excludes the acting admin in SQL before COUNT and paging, wherever they fall in the results (F-OA1.3-19)', async () => {
    // 60 picker candidates around three acting admins placed first, in the middle and last by username.
    for (let i = 0; i < 60; i++) {
      await ds.query(`INSERT INTO users (employee_code, username, password_hash, full_name) VALUES ($1, $1, 'x', $2)`, [`pick-${String(i).padStart(3, '0')}`, `Pick ${i}`]);
    }
    const actors: string[] = [];
    for (const name of ['pick-000a', 'pick-030a', 'pick-zzz']) {
      const [{ id }] = await ds.query(`INSERT INTO users (employee_code, username, password_hash, full_name) VALUES ($1, $1, $2, $1) RETURNING id`, [name, await hashPassword(PW)]);
      await ds.query(`INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE code = 'ADMIN'`, [id]);
      actors.push(name);
    }
    for (const actor of actors) {
      const token = await tokenOf(actor);
      const pages = [];
      for (let page = 0; page < 3; page++) pages.push((await get(token, `/admin/roles/user-options?q=pick-&size=25&page=${page}`).expect(200)).body);
      const names = pages.flatMap(page => page.items.map((u: { username: string }) => u.username));
      expect(pages.every(page => page.total === 62)).toBe(true);
      expect(names).toHaveLength(62);
      expect(names).not.toContain(actor);
      expect(new Set(names).size).toBe(62);
    }
  });

  it('validates the copy source from the database and never trusts client audit data', async () => {
    const before = (await get(admin, '/admin/roles?size=100').expect(200)).body.total;
    expect((await create(admin, { code: 'OA13_FORGED', name: 'x', permissions: [], userIds: [], copiedFrom: 999999 }).expect(422)).body.code)
      .toBe('COPY_SOURCE_NOT_FOUND');
    expect((await create(admin, { code: 'OA13_FORGED', name: 'x', permissions: [], userIds: [], copiedFrom: await adminRoleId() }).expect(422)).body.code)
      .toBe('SYSTEM_ROLE_PROTECTED');
    await create(admin, { code: 'OA13_FORGED', name: 'x', permissions: [], userIds: [], copiedFrom: 1, metadata: { copiedFrom: 'fake' } }).expect(400);
    expect((await get(admin, '/admin/roles?size=100').expect(200)).body.total).toBe(before);
    expect(await ds.query(`SELECT 1 FROM roles WHERE code = 'OA13_FORGED'`)).toEqual([]);
  });

  it('stops an admin whose role was revoked while the save waited on the grant gate', async () => {
    const actor = await makeUser('ADMIN');
    const token = await tokenOf(actor.username);
    const { id } = (await create(admin, { code: 'OA13_WAIT', name: 'wait', permissions: [], userIds: [] }).expect(201)).body;
    const role = await detail(id);
    const holder = ds.createQueryRunner();
    await holder.connect();
    await holder.startTransaction();
    try {
      await holder.query(`SELECT pg_advisory_xact_lock(hashtext('grants'))`);
      const save = put(token, id, { ...editable(role), name: 'should not commit' }).then(r => r.status);
      await new Promise(resolve => setTimeout(resolve, 300));
      await holder.query('DELETE FROM user_roles WHERE user_id = $1', [actor.id]);
      await holder.commitTransaction();
      expect(await save).toBe(403);
    } finally {
      if (holder.isTransactionActive) await holder.rollbackTransaction();
      await holder.release();
    }
    expect((await detail(id)).name).toBe('wait');
  });

  it('keeps one administrator when two admins remove each other from ADMIN at the same time', async () => {
    const id = await adminRoleId();
    const a = await makeUser('ADMIN');
    const b = await makeUser('ADMIN');
    const [ta, tb] = [await tokenOf(a.username), await tokenOf(b.username)];
    const others: { id: number }[] = await ds.query(`SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id
      WHERE ur.role_id = $1 AND u.is_active AND u.id <> ALL($2)`, [id, [a.id, b.id]]);
    await ds.query('UPDATE users SET is_active = false WHERE id = ANY($1)', [others.map(o => o.id)]);
    try {
      // The seeded admins are disabled for this race, so read with one of the two contenders.
      const role = (await get(ta, `/admin/roles/${id}`).expect(200)).body;
      const without = (userId: number) => ({ ...editable(role), userIds: role.users.map((u: { id: number }) => u.id).filter((u: number) => u !== userId) });
      const results = await Promise.all([put(ta, id, without(b.id)), put(tb, id, without(a.id))]);
      // The loser either lost ROLE.MANAGE (live re-check: 403) or met a stale version (409); never both admins gone.
      expect(results.map(r => r.status).sort()[0]).toBe(204);
      expect([403, 409]).toContain(results.map(r => r.status).sort()[1]);
      const remaining = await ds.query(`SELECT ur.user_id FROM user_roles ur WHERE ur.role_id = $1 AND ur.user_id = ANY($2)`, [id, [a.id, b.id]]);
      expect(remaining).toHaveLength(1);
      expect((await actions(id)).filter(x => x.action === 'USERS_REMOVED')).toHaveLength(1);
    } finally {
      await ds.query('UPDATE users SET is_active = true WHERE id = ANY($1)', [others.map(o => o.id)]);
    }
  });

  it('re-checks the acting session and ROLE.MANAGE inside the transaction', async () => {
    const service = app.get(RoleAdminService);
    const actor = await makeUser('ADMIN');
    await tokenOf(actor.username);
    const [{ id: sid }] = await ds.query('SELECT id FROM user_sessions WHERE user_id = $1', [actor.id]);
    const { id } = (await create(admin, { code: 'OA13_LIVE', name: 'live', permissions: [], userIds: [] }).expect(201)).body;
    const role = await detail(id);
    await ds.query(`DELETE FROM user_roles WHERE user_id = $1`, [actor.id]);
    await expect(service.update({ id: actor.id, sessionId: sid }, id, { ...editable(role), name: 'x' })).rejects.toMatchObject({ status: 403 });
    await expect(service.setStatus({ id: actor.id, sessionId: sid }, id, { isActive: false, version: role.version })).rejects.toMatchObject({ status: 403 });
    await ds.query(`INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE code = 'ADMIN'`, [actor.id]);
    await ds.query(`UPDATE user_sessions SET revoked_at = now(), revoke_reason = 'LOGOUT' WHERE id = $1`, [sid]);
    await expect(service.update({ id: actor.id, sessionId: sid }, id, { ...editable(role), name: 'x' })).rejects.toMatchObject({ status: 401 });
    expect((await detail(id)).name).toBe('live');
  });

  it('rolls back role, grants, memberships and audit together', async () => {
    const u = await makeUser();
    const { id } = (await create(admin, { code: 'OA13_ROLLBACK', name: 'before', permissions: ['PO.VIEW'], userIds: [] }).expect(201)).body;
    const role = await detail(id);
    await ds.query(`CREATE FUNCTION oa13_fail() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.action = 'USERS_ADDED' THEN RAISE EXCEPTION 'oa13 rollback fixture'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER oa13_fail BEFORE INSERT ON approval_histories FOR EACH ROW EXECUTE FUNCTION oa13_fail()`);
    try {
      await put(admin, id, { ...editable(role), name: 'after', permissions: ['GR.VIEW'], userIds: [u.id] }).expect(500);
    } finally {
      await ds.query('DROP TRIGGER oa13_fail ON approval_histories; DROP FUNCTION oa13_fail()');
    }
    const after = await detail(id);
    expect(after).toMatchObject({ name: 'before', permissions: ['PO.VIEW'], users: [], version: role.version });
    expect((await actions(id)).map(a => a.action)).toEqual(['ROLE_CREATED']);
  });
});
