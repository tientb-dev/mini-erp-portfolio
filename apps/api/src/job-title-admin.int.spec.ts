import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { bootTestApp, login } from './test-utils';

describe('Job title management OA2.1 (PostgreSQL, HTTP)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let admin: string;
  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, url: string) => http().get(url).set(bearer(t));
  const create = (t: string, body: object) => http().post('/admin/job-titles').set(bearer(t)).send(body);
  const put = (t: string, id: number, body: object) => http().put(`/admin/job-titles/${id}`).set(bearer(t)).send(body);
  const status = (t: string, id: number, isActive: boolean, version: number) =>
    http().patch(`/admin/job-titles/${id}/status`).set(bearer(t)).send({ isActive, version });
  const detail = async (id: number) => (await get(admin, `/admin/job-titles/${id}`).expect(200)).body;
  const actions = async (id: number) => (await ds.query(`SELECT action, metadata FROM approval_histories
    WHERE document_type = 'JOB_TITLE' AND document_id = $1 ORDER BY id`, [id])) as { action: string; metadata: Record<string, unknown> | null }[];

  beforeAll(async () => {
    ({ app, ds } = await bootTestApp());
    admin = await login(app, process.env.SEED_ADMIN_USERNAME!, process.env.SEED_ADMIN_PASSWORD!);
  }, 120_000);
  afterAll(async () => app?.close());

  it('registers ORGANIZATION.* as admin-only keys held by ADMIN only', async () => {
    const rows = await ds.query(`SELECT p.code, p.admin_only, array_agg(r.code ORDER BY r.code) AS roles FROM permissions p
      JOIN role_permissions rp ON rp.permission_id = p.id JOIN roles r ON r.id = rp.role_id
      WHERE p.code LIKE 'ORGANIZATION.%' GROUP BY p.code, p.admin_only ORDER BY p.code`);
    expect(rows).toEqual([
      { code: 'ORGANIZATION.MANAGE', admin_only: true, roles: ['ADMIN'] },
      { code: 'ORGANIZATION.VIEW', admin_only: true, roles: ['ADMIN'] },
    ]);
  });

  it('creates with a case-insensitive unique code, and lists, searches, filters, sorts and pages server-side', async () => {
    const { id } = (await create(admin, { code: ' OA21-A ', name: ' Trưởng phòng ', description: 'Quản lý phòng' }).expect(201)).body;
    expect(await detail(id)).toMatchObject({ code: 'OA21-A', name: 'Trưởng phòng', description: 'Quản lý phòng', isActive: true, version: 1 });
    expect((await create(admin, { code: 'oa21-a', name: 'Trùng' }).expect(409)).body.code).toBe('DUPLICATE_VALUE');
    await create(admin, { code: 'bad code', name: 'x' }).expect(400);
    await create(admin, { code: 'OA21_EMPTY', name: '   ' }).expect(400);
    for (const n of [1, 2, 3]) await create(admin, { code: `OA21-P${n}`, name: `Nhân viên ${n}` }).expect(201);

    const page = (await get(admin, '/admin/job-titles?q=oa21-p&sort=code&direction=desc&size=25&page=0').expect(200)).body;
    expect(page.total).toBe(3);
    expect(page.items.map((r: { code: string }) => r.code)).toEqual(['OA21-P3', 'OA21-P2', 'OA21-P1']);
    expect(Object.keys(page.items[0]).sort()).toEqual(['code', 'description', 'id', 'isActive', 'name', 'version']);
    const second = (await get(admin, '/admin/job-titles?q=OA21&size=25&page=1').expect(200)).body;
    expect(second.items).toEqual([]);
    expect(second.total).toBe(4);
    expect((await get(admin, '/admin/job-titles?q=Trưởng').expect(200)).body.items.map((r: { id: number }) => r.id)).toEqual([id]);
    expect((await get(admin, '/admin/job-titles?q=%25').expect(200)).body.total).toBe(0);
    await get(admin, '/admin/job-titles?size=10').expect(400);
    await get(admin, '/admin/job-titles?sort=description').expect(400);
  });

  it('updates name and description with the version, keeps the code immutable and has no delete', async () => {
    const { id } = (await create(admin, { code: 'OA21-EDIT', name: 'Cũ' }).expect(201)).body;
    await put(admin, id, { name: 'Mới', description: 'Mô tả', version: 1 }).expect(204);
    expect(await detail(id)).toMatchObject({ code: 'OA21-EDIT', name: 'Mới', description: 'Mô tả', version: 2 });
    expect((await put(admin, id, { name: 'Lỗi thời', version: 1 }).expect(409)).body.code).toBe('VERSION_CONFLICT');
    await put(admin, id, { code: 'OTHER', name: 'Mới', version: 2 }).expect(400);
    await put(admin, id, { name: 'Mới', description: 'Mô tả', version: 2 }).expect(204);
    expect((await detail(id)).version).toBe(2);
    await http().delete(`/admin/job-titles/${id}`).set(bearer(admin)).expect(404);
    await put(admin, 999999, { name: 'x', version: 1 }).expect(404);
    expect(await actions(id)).toEqual([
      { action: 'JOB_TITLE_CREATED', metadata: { after: { code: 'OA21-EDIT', name: 'Cũ', description: null } } },
      { action: 'JOB_TITLE_UPDATED', metadata: { before: { name: 'Cũ', description: null }, after: { name: 'Mới', description: 'Mô tả' } } },
    ]);
  });

  it('deactivates and reactivates with the version and records each change once', async () => {
    const { id } = (await create(admin, { code: 'OA21-LIFE', name: 'Vòng đời' }).expect(201)).body;
    await status(admin, id, false, 1).expect(204);
    expect(await detail(id)).toMatchObject({ isActive: false, version: 2 });
    expect((await get(admin, '/admin/job-titles?q=OA21-LIFE&status=false').expect(200)).body.total).toBe(1);
    expect((await get(admin, '/admin/job-titles?q=OA21-LIFE&status=true').expect(200)).body.total).toBe(0);
    expect((await status(admin, id, true, 1).expect(409)).body.code).toBe('VERSION_CONFLICT');
    await status(admin, id, false, 2).expect(204);
    await status(admin, id, true, 2).expect(204);
    expect((await detail(id)).isActive).toBe(true);
    expect((await actions(id)).map(a => a.action)).toEqual(['JOB_TITLE_CREATED', 'JOB_TITLE_DISABLED', 'JOB_TITLE_ENABLED']);
    const history = (await get(admin, `/admin/job-titles/${id}/history`).expect(200)).body;
    expect(history.items).toHaveLength(3);
  });

  it('copies into an independent active job title and records the source from the database', async () => {
    const { id: source } = (await create(admin, { code: 'OA21-SRC', name: 'Nguồn', description: 'd' }).expect(201)).body;
    await status(admin, source, false, 1).expect(204);
    const { id: copy } = (await create(admin, { code: 'OA21-COPY', name: 'Nguồn', description: 'd', copiedFrom: source }).expect(201)).body;
    expect(await detail(copy)).toMatchObject({ isActive: true, version: 1 });
    expect((await actions(copy))[0]).toMatchObject({ action: 'JOB_TITLE_COPIED', metadata: { copiedFrom: { id: source, code: 'OA21-SRC', name: 'Nguồn' } } });
    expect((await create(admin, { code: 'OA21-NOSRC', name: 'x', copiedFrom: 999999 }).expect(422)).body.code).toBe('COPY_SOURCE_NOT_FOUND');
    expect(await ds.query(`SELECT 1 FROM job_titles WHERE code = 'OA21-NOSRC'`)).toEqual([]);
  });

  it('keeps every endpoint to ORGANIZATION.VIEW / ORGANIZATION.MANAGE holders', async () => {
    const sales = await login(app, 'sales', 'role-users-test');
    const [{ id }] = await ds.query(`SELECT id FROM job_titles ORDER BY id LIMIT 1`);
    for (const res of [await get(sales, '/admin/job-titles'), await get(sales, `/admin/job-titles/${id}`),
      await get(sales, `/admin/job-titles/${id}/history`), await create(sales, { code: 'OA21-NO', name: 'x' }),
      await put(sales, id, { name: 'x', version: 1 }), await status(sales, id, false, 1)]) {
      expect(res.status).toBe(403);
    }
    await http().get('/admin/job-titles').expect(401);
  });

  it('re-checks the acting session inside the transaction', async () => {
    const token = await login(app, process.env.SEED_ADMIN_USERNAME!, process.env.SEED_ADMIN_PASSWORD!);
    await http().post('/auth/logout').set(bearer(token)).expect(204);
    await create(token, { code: 'OA21-REVOKED', name: 'x' }).expect(401);
    expect(await ds.query(`SELECT 1 FROM job_titles WHERE code = 'OA21-REVOKED'`)).toEqual([]);
  });
});
