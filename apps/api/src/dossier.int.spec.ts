import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { bootTestApp, login } from './test-utils';
import { snapshotDocumentDossier } from './modules/document-dossier/dossier-snapshot';
import { dossierMaxFileBytes } from './modules/document-dossier/dossier-file-policy';

describe('Common dossier foundation (PostgreSQL)', () => {
  let app: INestApplication;
  let db: DataSource;
  let admin: string;
  let sales: string;
  let actor: number;
  const http = () => request(app.getHttpServer());
  const types = '/dossier-types';
  const configurations = '/dossier-configurations';
  const put = (type: string, version: number, dossierTypeIds: number[]) => http().put(configurations + '/' + type)
    .auth(admin, { type: 'bearer' }).send({ version, dossierTypeIds });
  const read = (type: string) => http().get(configurations + '/' + type).auth(admin, { type: 'bearer' });
  const create = async (code: string) => (await http().post(types).auth(admin, { type: 'bearer' }).send({ code, name: code }).expect(201)).body;
  const status = (id: number, isActive: boolean) => http().patch(types + '/' + id + '/status').auth(admin, { type: 'bearer' }).send({ isActive });

  beforeAll(async () => {
    ({ app, ds: db } = await bootTestApp());
    admin = await login(app, process.env.SEED_ADMIN_USERNAME!, process.env.SEED_ADMIN_PASSWORD!);
    sales = await login(app, 'sales', 'role-users-test');
    actor = (await http().get('/auth/me').auth(admin, { type: 'bearer' }).expect(200)).body.id;
  });
  afterAll(async () => { await app?.close(); });

  it('enforces separate permissions, unique code and catalog CRUD', async () => {
    await http().get(types).auth(sales, { type: 'bearer' }).expect(403);
    await http().get(configurations).auth(sales, { type: 'bearer' }).expect(403);
    await http().post(types).auth(sales, { type: 'bearer' }).send({ code: 'NO', name: 'No' }).expect(403);
    await http().put(configurations + '/PR').auth(sales, { type: 'bearer' }).send({ version: 0, dossierTypeIds: [] }).expect(403);
    const created = await create('ledger');
    expect(created).toMatchObject({ code: 'LEDGER', isActive: true });
    await http().post(types).auth(admin, { type: 'bearer' }).send({ code: ' Ledger ', name: 'Other' }).expect(409);
    await http().patch(types + '/' + created.id).auth(admin, { type: 'bearer' })
      .send({ code: 'AMENDED', name: 'Edited', description: 'Checklist' }).expect(200);
    await status(created.id, false).expect(204);
    expect((await http().get(types + '/' + created.id).auth(admin, { type: 'bearer' }).expect(200)).body)
      .toMatchObject({ code: 'AMENDED', name: 'Edited', description: 'Checklist', isActive: false });
    await http().delete(types + '/' + created.id).auth(admin, { type: 'bearer' }).expect(404);
    await http().get(types + '/' + created.id).auth(admin, { type: 'bearer' }).expect(200);
    const list = (await http().get(configurations).auth(admin, { type: 'bearer' }).expect(200)).body;
    expect(list).toHaveLength(7);
    expect(list.every((entry: {count: number}) => entry.count === 0)).toBe(true);
    // DOSSIER_CONFIG.MANAGE is admin-only (BA-N-02): a business role cannot receive it.
    await expect(db.query(`INSERT INTO role_permissions (role_id, permission_id)
      SELECT r.id, p.id FROM roles r CROSS JOIN permissions p WHERE r.code = 'SALES' AND p.code = 'DOSSIER_CONFIG.MANAGE'`))
      .rejects.toThrow('Admin-only permission requires the system role');
    // HTTP authorization stays covered: ADMIN holds the key, a business role without it gets 403 on every endpoint.
    await http().get(configurations + '/catalog').auth(admin, { type: 'bearer' }).expect(200);
    await http().get(configurations + '/catalog').auth(sales, { type: 'bearer' }).expect(403);
    await http().get(configurations).auth(sales, { type: 'bearer' }).expect(403);
    await http().put(configurations + '/PO').auth(sales, { type: 'bearer' }).send({ version: 0, dossierTypeIds: [] }).expect(403);
    await http().get(types).auth(sales, { type: 'bearer' }).expect(403);
  });

  it('preserves order and rows during invalid, concurrent and rolled-back updates', async () => {
    const a = await create('ORDER-A'), b = await create('ORDER-B');
    await put('PO', 0, [a.id, a.id]).expect(400);
    await put('PO', 0, [b.id, a.id]).expect(204);
    expect((await read('PO').expect(200)).body).toMatchObject({ version: 1, items: [{ id: b.id }, { id: a.id }] });
    await status(b.id, false).expect(204);
    await put('GRR', 0, [b.id]).expect(422);
    await put('PO', 1, [a.id, b.id]).expect(204);
    await put('PO', 2, [999999]).expect(422);
    const [first, second] = await Promise.all([put('PO', 2, [a.id]), put('PO', 2, [])]);
    expect([first.status, second.status].sort()).toEqual([204, 409]);
    const current = (await read('PO').expect(200)).body;
    expect(current.version).toBe(3);

    await db.query('ALTER TABLE document_dossier_type_mappings ADD CONSTRAINT test_dossier_rollback CHECK (position < 2)');
    try {
      await status(b.id, true).expect(204);
      await put('PO', 3, [a.id, b.id]).expect(500);
    } finally {
      await db.query('ALTER TABLE document_dossier_type_mappings DROP CONSTRAINT test_dossier_rollback');
    }
    expect((await read('PO').expect(200)).body).toEqual(current);
    await put('PO', 3, []).expect(204);
    await http().get(types + '/' + b.id).auth(admin, { type: 'bearer' }).expect(200);
    await http().delete(types + '/' + b.id).auth(admin, { type: 'bearer' }).expect(404);
  });

  it('snapshots once, including empty configurations, and ignores changed or inactive definitions', async () => {
    const a = await create('SNAPSHOT-A'), b = await create('SNAPSHOT-B');
    await put('PR', 0, [b.id, a.id]).expect(204);
    await status(b.id, false).expect(204);
    const snapshot = (type: 'PR' | 'GI', id: number) => db.transaction(m => snapshotDocumentDossier(m, type, id, actor));
    expect(await snapshot('PR', 71)).toBe(true);
    expect(await snapshot('GI', 72)).toBe(true);
    expect(await snapshot('GI', 72)).toBe(false);
    await put('GI', 0, [a.id]).expect(204);
    expect(await snapshot('GI', 72)).toBe(false);
    await http().patch(types + '/' + a.id).auth(admin, { type: 'bearer' })
      .send({ code: 'NEW-CODE', name: 'New name' }).expect(200);
    await status(a.id, false).expect(204);
    await put('PR', 1, []).expect(204);
    expect(await snapshot('PR', 71)).toBe(false);
    expect(await snapshot('PR', 73)).toBe(true);
    expect(await db.query(`SELECT document_id, snapshot_code, snapshot_name, position, has_paper, current_attachment_id
      FROM document_dossiers ORDER BY id`)).toEqual([{
      document_id: 71, snapshot_code: 'SNAPSHOT-A', snapshot_name: 'SNAPSHOT-A', position: 2, has_paper: false, current_attachment_id: null,
    }]);
    await expect(db.transaction(async m => {
      await snapshotDocumentDossier(m, 'GI', 74, actor);
      throw new Error('rollback marker');
    })).rejects.toThrow('rollback marker');
    expect(await snapshot('GI', 74)).toBe(true);
    expect((await Promise.all([snapshot('GI', 75), snapshot('GI', 75)])).filter(Boolean)).toHaveLength(1);
  });

  it('uses 20 MiB by default and supports a validated override', () => {
    expect(dossierMaxFileBytes()).toBe(20 * 1024 * 1024);
    expect(dossierMaxFileBytes('45000000')).toBe(45000000);
    expect(() => dossierMaxFileBytes('0')).toThrow();
  });
});
