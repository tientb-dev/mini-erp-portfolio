import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { bootTestApp, login } from './test-utils';

describe('Organization units OA2.2 (PostgreSQL, HTTP)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let admin: string;
  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, url: string) => http().get(url).set(bearer(t));
  const create = (body: object, t = admin) => http().post('/admin/org-units').set(bearer(t)).send(body);
  const put = (id: number, body: object, t = admin) => http().put(`/admin/org-units/${id}`).set(bearer(t)).send(body);
  const status = (id: number, isActive: boolean, version: number, t = admin) =>
    http().patch(`/admin/org-units/${id}/status`).set(bearer(t)).send({ isActive, version });
  const detail = async (id: number) => (await get(admin, `/admin/org-units/${id}`).expect(200)).body;
  const unit = async (code: string, parentId?: number) => (await create({ code, name: code, parentId }).expect(201)).body.id as number;
  const actions = async (id: number) => (await ds.query(`SELECT action, metadata FROM approval_histories
    WHERE document_type = 'ORG_UNIT' AND document_id = $1 ORDER BY id`, [id])) as { action: string; metadata: Record<string, unknown> | null }[];

  beforeAll(async () => {
    ({ app, ds } = await bootTestApp());
    admin = await login(app, process.env.SEED_ADMIN_USERNAME!, process.env.SEED_ADMIN_PASSWORD!);
  }, 120_000);
  afterAll(async () => app?.close());

  it('builds a multi-level tree with case-insensitive unique codes and returns it flat with inactive units', async () => {
    const root = (await create({ code: ' OA22-ROOT ', name: ' Công ty ', description: 'Gốc' }).expect(201)).body.id;
    const l1 = await unit('OA22-L1', root);
    const l2 = await unit('OA22-L2', l1);
    const l3 = await unit('OA22-L3', l2);
    expect(await detail(l3)).toMatchObject({ code: 'OA22-L3', parent: { id: l2, code: 'OA22-L2' }, headUserId: null, isActive: true, version: 1 });
    expect(await detail(root)).toMatchObject({ name: 'Công ty', description: 'Gốc', parent: null });
    expect((await create({ code: 'oa22-root', name: 'x' }).expect(409)).body.code).toBe('DUPLICATE_VALUE');
    await create({ code: 'bad code', name: 'x' }).expect(400);
    await create({ code: 'OA22-EMPTY', name: '  ' }).expect(400);
    expect((await create({ code: 'OA22-ORPHAN', name: 'x', parentId: 999999 }).expect(422)).body.code).toBe('ORG_UNIT_PARENT_NOT_FOUND');
    await status(l3, false, 1).expect(204);
    const tree = (await get(admin, '/admin/org-units/tree').expect(200)).body as { id: number; parentId: number | null; isActive: boolean }[];
    expect([root, l1, l2, l3].map(id => tree.find(n => n.id === id)!).map(n => [n.parentId, n.isActive]))
      .toEqual([[null, true], [root, true], [l1, true], [l2, false]]);
    expect(Object.keys(tree[0]!).sort()).toEqual(['code', 'id', 'isActive', 'name', 'parentId', 'version']);
    expect((await create({ code: 'OA22-UNDER-OFF', name: 'x', parentId: l3 }).expect(422)).body.code).toBe('ORG_UNIT_PARENT_INACTIVE');
  });

  it('rejects self-parenting and cycles at any depth, and moves a subtree with before/after audit', async () => {
    const a = await unit('OA22-CA');
    const b = await unit('OA22-CB', a);
    const c = await unit('OA22-CC', b);
    expect((await put(a, { name: 'OA22-CA', parentId: a, version: 1 }).expect(422)).body.code).toBe('ORG_UNIT_CYCLE');
    expect((await put(a, { name: 'OA22-CA', parentId: b, version: 1 }).expect(422)).body.code).toBe('ORG_UNIT_CYCLE');
    expect((await put(a, { name: 'OA22-CA', parentId: c, version: 1 }).expect(422)).body.code).toBe('ORG_UNIT_CYCLE');
    const other = await unit('OA22-CX');
    await put(b, { name: 'OA22-CB', parentId: other, version: 1 }).expect(204);
    expect(await detail(c)).toMatchObject({ parent: { id: b } });
    expect(await detail(b)).toMatchObject({ parent: { id: other }, version: 2 });
    await put(b, { name: 'OA22-CB', parentId: null, version: 2 }).expect(204);
    expect((await detail(b)).parent).toBeNull();
    expect((await actions(b)).slice(1)).toEqual([
      { action: 'ORG_UNIT_UPDATED', metadata: { before: { name: 'OA22-CB', description: null, parent: { id: a, code: 'OA22-CA', name: 'OA22-CA' } },
        after: { name: 'OA22-CB', description: null, parent: { id: other, code: 'OA22-CX', name: 'OA22-CX' } } } },
      { action: 'ORG_UNIT_UPDATED', metadata: { before: { name: 'OA22-CB', description: null, parent: { id: other, code: 'OA22-CX', name: 'OA22-CX' } },
        after: { name: 'OA22-CB', description: null, parent: null } } },
    ]);
  });

  it('updates with the version, keeps the code, records no-op saves nowhere and has no delete', async () => {
    const id = await unit('OA22-EDIT');
    await put(id, { name: 'Mới', description: 'Mô tả', version: 1 }).expect(204);
    expect(await detail(id)).toMatchObject({ code: 'OA22-EDIT', name: 'Mới', description: 'Mô tả', version: 2 });
    expect((await put(id, { name: 'Cũ', version: 1 }).expect(409)).body.code).toBe('VERSION_CONFLICT');
    await put(id, { code: 'OTHER', name: 'Mới', version: 2 }).expect(400);
    await put(id, { name: 'Mới', description: 'Mô tả', version: 2 }).expect(204);
    expect((await detail(id)).version).toBe(2);
    await http().delete(`/admin/org-units/${id}`).set(bearer(admin)).expect(404);
    await put(999999, { name: 'x', version: 1 }).expect(404);
    expect(await actions(id)).toEqual([
      { action: 'ORG_UNIT_CREATED', metadata: { after: { code: 'OA22-EDIT', name: 'OA22-EDIT', description: null, parent: null } } },
      { action: 'ORG_UNIT_UPDATED', metadata: { before: { name: 'OA22-EDIT', description: null }, after: { name: 'Mới', description: 'Mô tả' } } },
    ]);
    expect((await get(admin, `/admin/org-units/${id}/history`).expect(200)).body.items).toHaveLength(2);
  });

  it('blocks deactivating a unit with active children and activating one under an inactive parent', async () => {
    const p = await unit('OA22-SP');
    const ch = await unit('OA22-SC', p);
    expect((await status(p, false, 1).expect(422)).body.code).toBe('ORG_UNIT_HAS_ACTIVE_CHILDREN');
    await status(ch, false, 1).expect(204);
    await status(p, false, 1).expect(204);
    expect((await status(ch, true, 2).expect(422)).body.code).toBe('ORG_UNIT_PARENT_INACTIVE');
    expect((await status(p, true, 1).expect(409)).body.code).toBe('VERSION_CONFLICT');
    await status(p, false, 2).expect(204);
    await status(p, true, 2).expect(204);
    await status(ch, true, 2).expect(204);
    expect((await actions(p)).map(a => a.action)).toEqual(['ORG_UNIT_CREATED', 'ORG_UNIT_DISABLED', 'ORG_UNIT_ENABLED']);
  });

  it('serializes concurrent reparents so no cycle can form', async () => {
    for (let round = 0; round < 3; round++) {
      const x = await unit(`OA22-RX${round}`);
      const y = await unit(`OA22-RY${round}`);
      const results = await Promise.all([put(x, { name: `OA22-RX${round}`, parentId: y, version: 1 }), put(y, { name: `OA22-RY${round}`, parentId: x, version: 1 })]);
      expect(results.map(r => r.status).sort()).toEqual([204, 422]);
      expect(results.find(r => r.status === 422)!.body.code).toBe('ORG_UNIT_CYCLE');
      const [{ n }] = await ds.query(`WITH RECURSIVE up AS (SELECT id, parent_id, 1 AS d FROM org_units WHERE id = $1
        UNION ALL SELECT o.id, o.parent_id, d + 1 FROM org_units o JOIN up ON o.id = up.parent_id WHERE d < 10) SELECT max(d)::int AS n FROM up`, [x]);
      expect(n).toBeLessThanOrEqual(2);
    }
  });

  it('serializes deactivating a parent with adding or moving a child under it', async () => {
    for (let round = 0; round < 3; round++) {
      const p = await unit(`OA22-DP${round}`);
      const loose = await unit(`OA22-DL${round}`);
      const results = await Promise.all([status(p, false, 1), create({ code: `OA22-DN${round}`, name: 'x', parentId: p }),
        put(loose, { name: `OA22-DL${round}`, parentId: p, version: 1 })]);
      const [{ active }] = await ds.query(`SELECT count(*)::int AS active FROM org_units c JOIN org_units p ON p.id = c.parent_id
        WHERE p.status = 'INACTIVE' AND c.status = 'ACTIVE' AND p.id = $1`, [p]);
      expect(active).toBe(0);
      expect(results.every(r => [201, 204, 422].includes(r.status))).toBe(true);
    }
  });

  it('keeps every endpoint to ORGANIZATION.VIEW / ORGANIZATION.MANAGE holders and re-checks the session', async () => {
    const sales = await login(app, 'sales', 'role-users-test');
    const id = await unit('OA22-AUTH');
    for (const res of [await get(sales, '/admin/org-units/tree'), await get(sales, `/admin/org-units/${id}`),
      await get(sales, `/admin/org-units/${id}/history`), await create({ code: 'OA22-NO', name: 'x' }, sales),
      await put(id, { name: 'x', version: 1 }, sales), await status(id, false, 1, sales)]) {
      expect(res.status).toBe(403);
    }
    await http().get('/admin/org-units/tree').expect(401);
    const token = await login(app, process.env.SEED_ADMIN_USERNAME!, process.env.SEED_ADMIN_PASSWORD!);
    await http().post('/auth/logout').set(bearer(token)).expect(204);
    await create({ code: 'OA22-REVOKED', name: 'x' }, token).expect(401);
    expect(await ds.query(`SELECT 1 FROM org_units WHERE code = 'OA22-REVOKED'`)).toEqual([]);
  });
});
