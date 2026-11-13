import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { bootTestApp, login } from './test-utils';

describe('API foundation (integration)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let adminToken: string;

  beforeAll(async () => {
    ({ app, ds } = await bootTestApp());
    adminToken = await login(app, process.env.SEED_ADMIN_USERNAME!, process.env.SEED_ADMIN_PASSWORD!);
  });

  afterAll(async () => {
    await app?.close();
  });

  const auth = () => ({ Authorization: `Bearer ${adminToken}` });

  it('rejects bad credentials and unauthenticated calls with Problem Details', async () => {
    await request(app.getHttpServer()).post('/auth/login').send({ username: 'admin', password: 'nope' }).expect(401);
    const res = await request(app.getHttpServer()).get('/products').expect(401);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body).toMatchObject({ status: 401, code: 'UNAUTHORIZED' });
  });

  it('returns the current user with permissions and warehouse scope', async () => {
    const res = await request(app.getHttpServer()).get('/auth/me').set(auth()).expect(200);
    expect(res.body.permissions).toContain('PRODUCT.CREATE');
    expect(res.body.warehouseIds).toHaveLength(1);
  });

  it('creates a product with is_serial_tracked defaulting to true and rejects duplicate PN', async () => {
    const [uom] = await ds.query(`SELECT id FROM units_of_measure WHERE code = 'PCS'`);
    const body = { partNumber: 'PN-001', name: 'Router X', unitOfMeasureId: uom.id };
    const res = await request(app.getHttpServer()).post('/products').set(auth()).send(body).expect(201);
    expect(res.body.isSerialTracked).toBe(true);
    const dup = await request(app.getHttpServer()).post('/products').set(auth()).send(body).expect(409);
    expect(dup.body.code).toBe('DUPLICATE_VALUE');
  });

  it('rejects unknown fields (whitelist validation)', async () => {
    await request(app.getHttpServer()).post('/warehouses').set(auth()).send({ code: 'X', name: 'X', hacked: 1 }).expect(400);
  });

  it('forbids a user without the permission (RBAC)', async () => {
    const { hashPassword } = await import('./modules/identity/password');
    await ds.query(`INSERT INTO users (username, password_hash, full_name) VALUES ('viewer', $1, 'Viewer')`, [
      await hashPassword('viewer-pass'),
    ]);
    const login = await request(app.getHttpServer()).post('/auth/login').send({ username: 'viewer', password: 'viewer-pass' }).expect(200);
    const res = await request(app.getHttpServer()).get('/products').set({ Authorization: `Bearer ${login.body.accessToken}` }).expect(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('lists inventory only for the caller warehouses', async () => {
    const [product] = await ds.query(`SELECT id FROM products WHERE part_number = 'PN-001'`);
    const [hcm] = await ds.query(`SELECT id FROM warehouses WHERE code = 'HCM'`);
    const [hn] = await ds.query(`INSERT INTO warehouses (code, name) VALUES ('HN', 'Kho HN') RETURNING id`);
    await ds.query(`INSERT INTO inventories (warehouse_id, product_id, on_hand_quantity, reserved_quantity) VALUES ($1, $3, 10, 3), ($2, $3, 5, 0)`, [
      hcm.id, hn.id, product.id,
    ]);
    const res = await request(app.getHttpServer()).get('/inventories').set(auth()).expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ warehouse: { code: 'HCM' }, onHandQuantity: '10.000', availableQuantity: '7.000' });
  });

  it('database constraints block negative stock and over-reservation', async () => {
    await expect(ds.query(`UPDATE inventories SET on_hand_quantity = -1`)).rejects.toThrow(/chk_inventories_on_hand/);
    await expect(ds.query(`UPDATE inventories SET reserved_quantity = on_hand_quantity + 1`)).rejects.toThrow(/chk_inventories_reserved/);
  });
});
