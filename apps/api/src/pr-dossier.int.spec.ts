import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { bootTestApp, login, prContext, prSubmission, pricedPr } from './test-utils';
import { DossierStorage } from './modules/document-dossier/dossier-storage';

const endpoint = '/purchase-requisitions';
const pdf = Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n');
const row = (dossierTypeId: number, version = 0, overrides = {}) => ({
  dossierTypeId, version, hasPaper: false, ...overrides,
});

describe('PR dossier (DOSSIER-001 to DOSSIER-009)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let storage: string;
  let admin: string;
  let reader: string;
  let manager: string;
  let scopedReader: string;
  let salesContractId: number;
  let productId: number;
  let salesContractLineId: number;
  let types: number[];
  const http = () => request(app.getHttpServer());
  const get = (path: string, token = admin) => http().get(path).auth(token, { type: 'bearer' });
  const post = (path: string, body: object = {}, token = admin) => http().post(path).auth(token, { type: 'bearer' }).send(body);
  const put = (path: string, body: object, token = admin) => http().put(path).auth(token, { type: 'bearer' }).send(body);
  const dossier = (id: number) => `${endpoint}/${id}/dossier`;
  const template = async () => (await get(endpoint + '/catalog/dossier').expect(200)).body;
  const configure = async (dossierTypeIds: number[]) => {
    const path = '/dossier-configurations/PR';
    const { version } = (await get(path).expect(200)).body;
    await put(path, { version, dossierTypeIds }).expect(204);
  };
  const header = () => pricedPr({ salesContractId, lines: [{ productId, salesContractLineId, quantity: '1' }] });
  const upload = (path: string, bytes = pdf, filename = 'Báo giá.pdf', type = 'application/pdf', token = admin) =>
    http().post(path).auth(token, { type: 'bearer' }).attach('file', bytes, { filename, contentType: type });
  const create = async () => (await post(endpoint, header()).expect(201)).body.id as number;

  beforeAll(async () => {
    storage = await mkdtemp(join(tmpdir(), 'mini-erp-dossier-test-'));
    process.env.DOSSIER_STORAGE_DIR = storage;
    ({ app, ds } = await bootTestApp());
    admin = await login(app, process.env.SEED_ADMIN_USERNAME!, process.env.SEED_ADMIN_PASSWORD!);
    const actor = (await get('/auth/me').expect(200)).body.id;
    reader = await login(app, 'purchaser', 'role-users-test');
    scopedReader = await login(app, 'warehouse', 'role-users-test');
    const sales = await login(app, 'sales', 'role-users-test');
    const { id: salesId } = (await get('/auth/me', sales).expect(200)).body;
    await ds.query(`INSERT INTO role_permissions (role_id, permission_id)
      SELECT ur.role_id, p.id FROM user_roles ur CROSS JOIN permissions p
      WHERE ur.user_id = $1 AND p.code = 'PR.DOSSIER_MANAGE' ON CONFLICT DO NOTHING`, [salesId]);
    manager = await login(app, 'sales', 'role-users-test');
    const { id: customerId } = (await post('/customers', { code: 'PD-CUSTOMER', name: 'Dossier fixture' }).expect(201)).body;
    productId = (await post('/products', { brandId: 1, partNumber: 'PD-PRODUCT', name: 'Dossier fixture',
      unitOfMeasureId: 1, isSerialTracked: false }).expect(201)).body.id;
    salesContractId = (await post('/sales-contracts', { customerId, responsibleSalesUserId: actor,
      lines: [{ itemCode: 'PD-PRODUCT', itemName: 'Dossier fixture', unitOfMeasureId: 1, quantity: 50 }] }).expect(201)).body.id;
    await post(`/sales-contracts/${salesContractId}/activate`).expect(204);
    salesContractLineId = (await get(`/sales-contracts/${salesContractId}`).expect(200)).body.lines[0].id;
    types = await Promise.all(['A', 'B', 'C', 'D'].map(async code =>
      (await post('/dossier-types', { code: 'PD-' + code, name: 'Fixture ' + code }).expect(201)).body.id));
  });

  afterAll(async () => {
    await app?.close();
    delete process.env.DOSSIER_STORAGE_DIR;
    if (storage) await rm(storage, { recursive: true, force: true });
  });

  it('records empty, preserves legacy, and takes immutable first-save snapshots with strict revision checking', async () => {
    await configure([]);
    const legacy = await create();
    const empty = await create();
    await ds.query("DELETE FROM document_dossier_snapshots WHERE document_type = 'PR' AND document_id = $1", [legacy]);
    const oldTemplate = await template();
    await configure([types[1], types[0]]);
    const dto = { ...header(), submit: false, requestKey: randomUUID(), dossier: { revision: oldTemplate.revision, rows: [] } };
    const before = await ds.query('SELECT id FROM purchase_requisitions ORDER BY id');
    await post(endpoint + '/save-new', dto).expect(409);
    expect(await ds.query('SELECT id FROM purchase_requisitions ORDER BY id')).toEqual(before);
    dto.dossier.revision = (await template()).revision;
    const { id } = (await post(endpoint + '/save-new', dto).expect(201)).body;
    await post(endpoint + '/save-new', dto).expect(201);
    await http().patch('/dossier-types/' + types[1]).auth(admin, { type: 'bearer' })
      .send({ code: 'PD-B', name: 'Renamed' }).expect(200);
    expect((await template()).revision).not.toBe(dto.dossier.revision);
    expect((await get(dossier(id)).expect(200)).body.rows.map(({ code, name }: { code: string; name: string }) => [code, name]))
      .toEqual([['PD-B', 'Fixture B'], ['PD-A', 'Fixture A']]);
    for (const old of [legacy, empty]) {
      const doc = (await get(endpoint + '/' + old).expect(200)).body;
      await http().patch(endpoint + '/' + old).auth(admin, { type: 'bearer' })
        .send({ ...header(), salesContractId: undefined, version: doc.version }).expect(204);
      expect((await get(dossier(old)).expect(200)).body.rows).toEqual([]);
    }
    const markers = await ds.query("SELECT document_id FROM document_dossier_snapshots WHERE document_type = 'PR' AND document_id IN ($1,$2)", [legacy, empty]);
    expect(markers).toEqual([{ document_id: empty }]);
  });

  it('stages and claims files atomically, supports four paper/electronic combinations and preserves history', async () => {
    await configure(types);
    const { revision } = await template();
    const session = randomUUID();
    const staged = `${endpoint}/dossier-staging/${session}`;
    const uploadedA = (await upload(staged + '/' + types[0]).expect(201)).body;
    const uploadedB = (await upload(staged + '/' + types[1], pdf, 'B.pdf').expect(201)).body;
    await upload(staged + '/' + types[0], Buffer.from('plain text')).expect(400);
    await upload(staged + '/' + types[0], Buffer.alloc(20 * 1024 * 1024 + 1)).expect(413);
    await get(staged + '/' + uploadedA.id, manager).expect(404);
    await get(staged + '/' + uploadedA.id).expect(200);
    await get(`${endpoint}/dossier-staging/${randomUUID()}/${uploadedA.id}`).expect(404);
    const rows = [row(types[0], 0, { hasPaper: true, issuedOn: '2026-11-25', issuer: 'VN', note: 'Paper', fileId: uploadedA.id }),
      row(types[1], 0, { fileId: uploadedB.id }), row(types[2], 0, { hasPaper: true })];
    const dto = { ...header(), submit: true, requestKey: randomUUID(), dossier: { revision, sessionKey: session, rows } };
    await post(endpoint + '/save-new', dto).expect(422);
    expect((await ds.query('SELECT committed_at FROM document_dossier_files WHERE id IN ($1,$2) ORDER BY id', [uploadedA.id, uploadedB.id])))
      .toEqual([{ committed_at: null }, { committed_at: null }]);
    const { approverId, receiverId } = await prSubmission(ds, await create());
    const { id } = (await post(endpoint + '/save-new', { ...dto, approverId, receiverId }).expect(201)).body;
    const current = (await get(dossier(id)).expect(200)).body.rows;
    expect(current.map((entry: { hasPaper: boolean; file: object | null }) => [entry.hasPaper, Boolean(entry.file)]))
      .toEqual([[true, true], [false, true], [true, false], [false, false]]);
    await get(dossier(id) + '/files/' + uploadedA.id, reader).expect(200).expect('Content-Type', /application\/pdf/);
    await get(dossier(id) + '/files/' + uploadedA.id, scopedReader).expect(403);
    await get(staged + '/' + uploadedA.id).expect(404);
    await put(dossier(id), { rows: [row(types[0], current[0].version)] }, reader).expect(403);
    const editSession = randomUUID();
    const suffix = '?session=' + editSession;
    const replacement = (await upload(dossier(id) + '/files/' + types[0] + suffix, pdf, 'A2.pdf').expect(201)).body;
    await get(dossier(id) + '/files/' + replacement.id).expect(404);
    await get(dossier(id) + '/files/' + replacement.id + suffix).expect(200);
    const patch = row(types[0], current[0].version, { issuedOn: '2026-11-25', issuer: 'VN', note: 'Paper', fileId: replacement.id });
    await put(dossier(id), { rows: [patch] }).expect(404);
    await put(dossier(id), { sessionKey: editSession, rows: [patch, row(types[1], 0)] }).expect(409);
    expect((await get(dossier(id)).expect(200)).body.rows).toEqual(current);
    const before = await prContext(ds, id);
    const [winner, concurrent] = await Promise.all([put(dossier(id), { sessionKey: editSession, rows: [patch] }),
      put(dossier(id), { sessionKey: editSession, rows: [patch] })]);
    expect([winner.status, concurrent.status].sort()).toEqual([200, 409]);
    expect(await prContext(ds, id)).toEqual(before);
    const detail = (await get(endpoint + '/' + id).expect(200)).body;
    expect(detail.history.filter((entry: { action: string }) => entry.action === 'DOSSIER_UPDATE')).toHaveLength(4);
    expect(detail.history[0].metadata).toMatchObject({ fileAction: 'REPLACE', before: { file: uploadedA },
      after: { hasPaper: false, issuer: 'VN', note: 'Paper', file: replacement } });
    const head = await login(app, 'sales-head', 'role-users-test');
    await post(`${endpoint}/${id}/approve`, await prContext(ds, id), head).expect(204);
    await post(`${endpoint}/${id}/receive`, await prContext(ds, id), reader).expect(204);
    const done = await prContext(ds, id);
    await put(dossier(id), { rows: [row(types[1], current[1].version, { fileId: null })] }).expect(200);
    expect(await prContext(ds, id)).toEqual(done);
    const abandoned = (await upload(dossier(id) + '/files/' + types[0] + suffix, pdf, 'unused.pdf').expect(201)).body;
    await ds.query("UPDATE document_dossier_files SET expires_at = now() - interval '1 hour' WHERE id = $1", [abandoned.id]);
    const count = (await readdir(storage)).length;
    await app.get(DossierStorage).cleanup();
    expect((await readdir(storage)).length).toBe(count - 1);
    for (const file of [uploadedA, uploadedB, replacement]) await get(dossier(id) + '/files/' + file.id).expect(200);
    await post(`${endpoint}/${id}/cancel`, { ...await prContext(ds, id), reason: 'Fixture' }).expect(204);
    expect((await get(dossier(id)).expect(200)).body.canManage).toBe(false);
    await put(dossier(id), { rows: [] }).expect(409);
    await upload(dossier(id) + '/files/' + types[0] + suffix).expect(409);
  });

  it('rolls back Edit dossier, header, lines and history when submitting the edited draft fails', async () => {
    await configure([types[0]]);
    const id = await create();
    const path = endpoint + '/' + id;
    const sessionKey = randomUUID();
    const file = (await upload(dossier(id) + '/files/' + types[0] + '?session=' + sessionKey).expect(201)).body;
    const draft = (await get(path).expect(200)).body;
    const { approverId, receiverId } = await prSubmission(ds, id);
    const changes = {
      name: 'Edited fixture', version: draft.version, approverId, receiverId,
      lines: [{ id: draft.lines[0].id, productId, salesContractLineId, quantity: '2', unitPrice: '0' }],
      dossier: { sessionKey, rows: [row(types[0], 1, { hasPaper: true, issuer: 'Optional', fileId: file.id })] },
    };
    const patch = (url: string, body: object) => http().patch(url).auth(admin, { type: 'bearer' }).send(body);
    await patch(path + '/submit-edited', { ...changes, round: 0, step: 'CREATE' }).expect(422);
    expect((await get(path).expect(200)).body).toEqual(draft);
    expect((await get(dossier(id)).expect(200)).body.rows[0]).toMatchObject({ version: 1, hasPaper: false, file: null });
    await get(dossier(id) + '/files/' + file.id + '?session=' + sessionKey).expect(200);
    await patch(path, changes).expect(204);
    const saved = (await get(path).expect(200)).body;
    expect(saved).toMatchObject({ approvalStatus: 'DRAFT', name: 'Edited fixture', lines: [{ quantity: '2.000' }] });
    expect(saved.history.some((entry: { action: string }) => entry.action === 'DOSSIER_UPDATE')).toBe(true);
    expect((await get(dossier(id)).expect(200)).body.rows[0]).toMatchObject({ version: 2, hasPaper: true, issuer: 'Optional', file });
  });
});
