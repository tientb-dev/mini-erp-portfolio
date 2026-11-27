import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { bootTestApp, login } from './test-utils';

const PW = 'initial passphrase 1';
const NEW_PW = 'changed passphrase';

/**
 * OA2.4 Personal Profile & Integration (PostgreSQL, HTTP): GET/PATCH /me (BA-USR-09), and the two-way consistency of
 * User ↔ Organization ↔ Job Title ↔ Role as the profile sees it: version, audit, effective permissions, account lifecycle.
 */
describe('Personal profile OA2.4 (PostgreSQL, HTTP)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let admin: string;
  let salesRole: number;
  let warehouse: number;
  let seq = 0;
  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, url: string) => http().get(url).set(bearer(t));
  const patchMe = (t: string, body: object) => http().patch('/me').set(bearer(t)).send(body);
  const ver = async (id: number) => (await ds.query('SELECT version FROM users WHERE id = $1', [id]))[0].version as number;
  const events = async (id: number) => (await ds.query(`SELECT action, metadata, actor_id AS "actorId" FROM approval_histories
    WHERE document_type = 'USER' AND document_id = $1 ORDER BY id`, [id])) as { action: string; metadata: any; actorId: number }[];
  const unit = async () => (await http().post('/admin/org-units').set(bearer(admin)).send({ code: `P24-U${++seq}`, name: `Unit ${seq}`, parentId: null }).expect(201)).body.id as number;
  const title = async () => (await http().post('/admin/job-titles').set(bearer(admin)).send({ code: `P24-T${++seq}`, name: `Title ${seq}` }).expect(201)).body.id as number;
  /** An employee with an account, a primary unit and the SALES role, signed in after the forced password change. */
  const person = async () => {
    const [u, t] = [await unit(), await title()];
    const n = ++seq;
    const id = (await http().post('/admin/users').set(bearer(admin)).send({
      profile: { employeeCode: `P24-E${n}`, fullName: `Person ${n}`, email: `p${n}@x.vn` }, account: { username: `p24-${n}`, initialPassword: PW },
      memberships: [{ orgUnitId: u, jobTitleId: t, isPrimary: true }], roleIds: [salesRole], warehouseIds: [warehouse] }).expect(201)).body.id as number;
    const first = (await http().post('/auth/login').send({ username: `p24-${n}`, password: PW }).expect(200)).body.accessToken as string;
    // Forced change before any other call (BA-USR-06): the profile is not reachable yet.
    expect((await get(first, '/me')).body.code).toBe('PASSWORD_CHANGE_REQUIRED');
    await http().post('/auth/change-password').set(bearer(first)).send({ currentPassword: PW, newPassword: NEW_PW }).expect(204);
    return { id, unit: u, title: t, token: await login(app, `p24-${n}`, NEW_PW), username: `p24-${n}` };
  };

  beforeAll(async () => {
    ({ app, ds } = await bootTestApp());
    admin = await login(app, process.env.SEED_ADMIN_USERNAME!, process.env.SEED_ADMIN_PASSWORD!);
    [{ id: salesRole }] = await ds.query(`SELECT id FROM roles WHERE code = 'SALES'`);
    [{ id: warehouse }] = await ds.query(`SELECT id FROM warehouses ORDER BY id LIMIT 1`);
  }, 120_000);
  afterAll(async () => app?.close());

  it('reads the own profile: employee, account, organization, manager, roles and warehouses; no secret', async () => {
    const p = await person();
    const me = (await get(p.token, '/me').expect(200)).body;
    expect(me).toMatchObject({ id: p.id, username: p.username, employmentStatus: 'ACTIVE', accountStatus: 'ACTIVE', mustChangePassword: false,
      primaryOrgUnit: { id: p.unit }, primaryJobTitle: { id: p.title } });
    expect(me.memberships).toEqual([expect.objectContaining({ orgUnit: expect.objectContaining({ id: p.unit }), isPrimary: true, manager: null })]);
    expect(me.roles.map((r: any) => r.code)).toEqual(['SALES']);
    expect(me.warehouses.map((w: any) => w.id)).toEqual([warehouse]);
    expect(JSON.stringify(me)).not.toMatch(/password_hash|passwordHash|"hash"/i);
  });

  it('changes only email and phone, with version and the same audit as the admin save; nothing else is accepted', async () => {
    const p = await person();
    const v = await ver(p.id);
    await patchMe(p.token, { email: 'new@x.vn', phone: '0901 000 111', version: v }).expect(204);
    expect(await ver(p.id)).toBe(v + 1);
    expect((await events(p.id)).at(-1)).toMatchObject({ action: 'EMPLOYEE_UPDATED', actorId: p.id,
      metadata: { before: { email: expect.any(String), phone: null }, after: { email: 'new@x.vn', phone: '0901 000 111' } } });
    // Unchanged → no bump, no history; stale version → 409.
    await patchMe(p.token, { email: 'new@x.vn', version: v + 1 }).expect(204);
    expect(await ver(p.id)).toBe(v + 1);
    expect((await patchMe(p.token, { phone: '1', version: v })).body.code).toBe('VERSION_CONFLICT');
    // BA-USR-09 enforced by the API, not only the UI: any other field is rejected and nothing changes.
    for (const extra of [{ fullName: 'X' }, { employeeCode: 'X' }, { roleIds: [1] }, { memberships: [] }, { username: 'x' }, { isActive: false }]) {
      expect((await patchMe(p.token, { ...extra, version: v + 1 })).status).toBe(400);
    }
    expect((await patchMe(p.token, { email: 'not-an-email', version: v + 1 })).status).toBe(400);
    expect(await ver(p.id)).toBe(v + 1);
    // The self-service path needs no USER.* permission (SALES has none) but the admin API still refuses the same user.
    expect((await http().put(`/admin/users/${p.id}`).set(bearer(p.token)).send({ profile: { fullName: 'X' }, version: v + 1 })).status).toBe(403);
    expect((await get(p.token, `/admin/users/${p.id}`)).status).toBe(403);
  });

  it('shares one version with the admin save: a self change makes a stale admin save conflict, and the reverse', async () => {
    const p = await person();
    const v = await ver(p.id);
    await patchMe(p.token, { phone: '123', version: v }).expect(204);
    const stale = await http().put(`/admin/users/${p.id}`).set(bearer(admin)).send({ profile: { fullName: 'Renamed', email: null, phone: null }, version: v });
    expect([stale.status, stale.body.code]).toEqual([409, 'VERSION_CONFLICT']);
    await http().put(`/admin/users/${p.id}`).set(bearer(admin)).send({ profile: { fullName: 'Renamed', email: 'p@x.vn', phone: '123' }, version: v + 1 }).expect(204);
    expect((await patchMe(p.token, { phone: '9', version: v + 1 })).body.code).toBe('VERSION_CONFLICT');
    expect((await get(p.token, '/me').expect(200)).body).toMatchObject({ fullName: 'Renamed', version: v + 2 });
  });

  it('sees organization, job title, manager and role changes made from both sides; effective permissions follow roles', async () => {
    const p = await person();
    const [u2, t2] = [await unit(), await title()];
    const mgr = await person();
    // From the unit side (Membership API): add a second, primary membership with a manager.
    await http().post('/admin/memberships').set(bearer(admin)).send({ userId: p.id, orgUnitId: u2, jobTitleId: t2, managerUserId: mgr.id, isPrimary: true,
      version: await ver(p.id) }).expect(201);
    let me = (await get(p.token, '/me').expect(200)).body;
    expect(me.primaryOrgUnit.id).toBe(u2);
    expect(me.memberships.map((m: any) => [m.orgUnit.id, m.isPrimary, m.manager?.id ?? null])).toEqual([[u2, true, mgr.id], [p.unit, false, null]]);
    // Catalog renames show through (references, not copies).
    const jt = (await get(admin, `/admin/job-titles/${t2}`).expect(200)).body;
    await http().put(`/admin/job-titles/${t2}`).set(bearer(admin)).send({ name: 'Renamed title', description: null, version: jt.version }).expect(204);
    me = (await get(p.token, '/me').expect(200)).body;
    expect(me.primaryJobTitle.name).toBe('Renamed title');
    // The unit side sees the same membership (BA-UI-09).
    expect((await get(admin, `/admin/org-units/${u2}/members`).expect(200)).body.map((m: any) => m.id)).toEqual([p.id]);
    // From the role side: removing the user from SALES drops the permissions on the next request (BA-RBAC-09).
    expect((await get(p.token, '/auth/me').expect(200)).body.permissions).toContain('PR.CREATE');
    const role = (await get(admin, `/admin/roles/${salesRole}`).expect(200)).body;
    await http().put(`/admin/roles/${salesRole}`).set(bearer(admin)).send({ name: role.name, description: role.description, permissions: role.permissions, scopes: role.scopes,
      userIds: role.users.map((u: any) => u.id).filter((id: number) => id !== p.id), version: role.version }).expect(204);
    expect((await get(p.token, '/auth/me').expect(200)).body.permissions).not.toContain('PR.CREATE');
    me = (await get(p.token, '/me').expect(200)).body;
    expect(me.roles).toEqual([]);
    expect((await events(p.id)).map(e => e.action)).toEqual(expect.arrayContaining(['MEMBERSHIPS_CHANGED', 'ROLES_REMOVED']));
  });

  it('follows the account lifecycle: reset, deactivation and employment end close the profile session', async () => {
    const p = await person();
    await http().post(`/admin/users/${p.id}/reset-password`).set(bearer(admin)).send({ temporaryPassword: 'temporary passphrase', version: await ver(p.id) }).expect(204);
    expect((await get(p.token, '/me')).status).toBe(401);
    const second = await person();
    await http().patch(`/admin/users/${second.id}/account-status`).set(bearer(admin)).send({ isActive: false, version: await ver(second.id) }).expect(204);
    expect((await patchMe(second.token, { phone: '1', version: await ver(second.id) })).status).toBe(401);
    const third = await person();
    await http().patch(`/admin/users/${third.id}/employment-status`).set(bearer(admin)).send({ status: 'INACTIVE', version: await ver(third.id) }).expect(204);
    expect((await get(third.token, '/me')).status).toBe(401);
    // Reactivating the employee does not reactivate the account or revive the old token (BA-USR-04, BA-USR-13).
    await http().patch(`/admin/users/${third.id}/employment-status`).set(bearer(admin)).send({ status: 'ACTIVE', version: await ver(third.id) }).expect(204);
    expect((await get(admin, `/admin/users/${third.id}`).expect(200)).body.accountStatus).toBe('INACTIVE');
    expect((await get(third.token, '/me')).status).toBe(401);
    expect((await http().post('/auth/login').send({ username: third.username, password: NEW_PW })).status).toBe(401);
  });
});
