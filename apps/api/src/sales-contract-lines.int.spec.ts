import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { SalesContractLineUom1732320000000 } from './database/migrations/1732320000000-SalesContractLineUom';
import { bootTestApp, login, PCS_UOM_ID as pcs } from './test-utils';

/** PR #16: header-only DRAFT, one line saved per call, UoM from the catalog, list search/filter/paging. */
describe('Sales contract lines (integration)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let sales: string;
  let pm: string;
  let salesId: number;
  let customerId: number;
  let other: number;

  const http = () => request(app.getHttpServer());
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const post = (t: string, url: string, body: object = {}) => http().post(url).set(as(t)).send(body);
  const patch = (t: string, url: string, body: object) => http().patch(url).set(as(t)).send(body);
  const del = (t: string, url: string) => http().delete(url).set(as(t));
  const get = (t: string, url: string) => http().get(url).set(as(t));
  const line = (itemCode: string, quantity = 1, unitOfMeasureId = pcs) => ({ itemCode, itemName: `Item ${itemCode}`, unitOfMeasureId, quantity });
  const version = async (sc: number) => (await get(sales, `/sales-contracts/${sc}`).expect(200)).body.version as number;

  beforeAll(async () => {
    process.env.SEED_ROLE_USERS_PASSWORD = 'role-users-test';
    ({ app, ds } = await bootTestApp());
    sales = await login(app, 'sales', 'role-users-test');
    pm = await login(app, 'pm', 'role-users-test');
    salesId = (await get(sales, '/auth/me')).body.id;
    const admin = await login(app, process.env.SEED_ADMIN_USERNAME!, process.env.SEED_ADMIN_PASSWORD!);
    customerId = (await post(admin, '/customers', { code: 'LC1', name: 'Alpha Corp' }).expect(201)).body.id;
    other = (await post(admin, '/customers', { code: 'LC2', name: 'Beta Ltd' }).expect(201)).body.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('creates a header-only DRAFT; activation needs at least one line', async () => {
    const sc = (await post(sales, '/sales-contracts', { customerId, responsibleSalesUserId: salesId }).expect(201)).body.id;
    const d = (await get(sales, `/sales-contracts/${sc}`)).body;
    expect(d).toMatchObject({ status: 'DRAFT', lines: [] });
    expect((await post(sales, `/sales-contracts/${sc}/activate`).expect(422)).body.code).toBe('SALES_CONTRACT_NO_LINES');
    await post(sales, `/sales-contracts/${sc}/lines`, { ...line('A'), version: d.version }).expect(201);
    await post(sales, `/sales-contracts/${sc}/activate`).expect(204);
  });

  it('adds, edits and deletes lines one at a time; each save bumps the version and is checked against it', async () => {
    const sc = (await post(sales, '/sales-contracts', { customerId }).expect(201)).body.id;
    const v0 = await version(sc);
    const a = (await post(sales, `/sales-contracts/${sc}/lines`, { ...line('A', 2), version: v0 }).expect(201)).body.id;
    // The version the user saw is stale after the first save.
    expect((await post(sales, `/sales-contracts/${sc}/lines`, { ...line('B'), version: v0 }).expect(409)).body.code).toBe('STALE_VERSION');
    const b = (await post(sales, `/sales-contracts/${sc}/lines`, { ...line('B'), version: await version(sc) }).expect(201)).body.id;

    await patch(sales, `/sales-contract-lines/${a}`, { ...line('A2', 5), version: await version(sc) }).expect(204);
    let d = (await get(sales, `/sales-contracts/${sc}`)).body;
    expect(d.lines.map((l: { id: number; itemCode: string; quantity: string; unitOfMeasureId: number; uomName: string; uomCode: string }) =>
      [l.id, l.itemCode, Number(l.quantity), l.unitOfMeasureId, l.uomName, l.uomCode])).toEqual([[a, 'A2', 5, pcs, 'Cái', 'PCS'], [b, 'B', 1, pcs, 'Cái', 'PCS']]);
    expect(d.updatedByName).toBeTruthy();

    await del(sales, `/sales-contract-lines/${b}?version=${d.version}`).expect(204);
    d = (await get(sales, `/sales-contracts/${sc}`)).body;
    expect(d.lines.map((l: { id: number }) => l.id)).toEqual([a]);
    await del(sales, `/sales-contract-lines/${b}?version=${d.version}`).expect(404);
  });

  it('validates UoM and quantity; header PATCH without lines keeps the lines', async () => {
    const sc = (await post(sales, '/sales-contracts', { customerId, lines: [line('A')] }).expect(201)).body.id;
    const v = await version(sc);
    expect((await post(sales, `/sales-contracts/${sc}/lines`, { ...line('X', 1, 999999), version: v }).expect(422)).body.code).toBe('UOM_NOT_FOUND');
    await post(sales, `/sales-contracts/${sc}/lines`, { ...line('X', 0), version: v }).expect(400);
    await post(sales, `/sales-contracts/${sc}/lines`, { itemCode: 'X', itemName: 'X', uomName: 'Cái', quantity: 1, version: v }).expect(400); // free text UoM is rejected
    await patch(sales, `/sales-contracts/${sc}`, { version: v, customerId: other, responsibleSalesUserId: salesId }).expect(204);
    const d = (await get(sales, `/sales-contracts/${sc}`)).body;
    expect(d).toMatchObject({ customerId: other, responsibleSalesUserId: salesId });
    expect(d.lines).toHaveLength(1);
  });

  it('rejects line changes without permission or outside DRAFT, and keeps lines that have product proposals', async () => {
    const sc = (await post(sales, '/sales-contracts', { customerId, responsibleSalesUserId: salesId, lines: [line('A')] }).expect(201)).body.id;
    let d = (await get(sales, `/sales-contracts/${sc}`)).body;
    const lineId = d.lines[0].id;
    await post(pm, `/sales-contracts/${sc}/lines`, { ...line('B'), version: d.version }).expect(403);
    await patch(pm, `/sales-contract-lines/${lineId}`, { ...line('B'), version: d.version }).expect(403);
    await del(pm, `/sales-contract-lines/${lineId}?version=${d.version}`).expect(403);

    // A product proposal references the line: deleting it would cascade business data, so it is refused.
    const [{ id: productId }] = await ds.query(
      `INSERT INTO products (part_number, name, unit_of_measure_id, is_serial_tracked) VALUES ('PN-L1', 'P', $1, false) RETURNING id`, [pcs]);
    await post(pm, `/sales-contract-lines/${lineId}/product-proposals`, { productId, reason: 'r' }).expect(201);
    expect((await del(sales, `/sales-contract-lines/${lineId}?version=${d.version}`).expect(409)).body.code).toBe('RECORD_IN_USE');

    await post(sales, `/sales-contracts/${sc}/activate`).expect(204);
    d = (await get(sales, `/sales-contracts/${sc}`)).body;
    expect((await post(sales, `/sales-contracts/${sc}/lines`, { ...line('B'), version: d.version }).expect(409)).body.code).toBe('INVALID_STATUS');
    expect((await patch(sales, `/sales-contract-lines/${lineId}`, { ...line('B'), version: d.version }).expect(409)).body.code).toBe('INVALID_STATUS');
    expect((await del(sales, `/sales-contract-lines/${lineId}?version=${d.version}`).expect(409)).body.code).toBe('INVALID_STATUS');
  });

  it('lists with search, filters, sorting and paging on the server; without page it stays a plain array', async () => {
    const all = (await get(sales, '/sales-contracts').expect(200)).body;
    expect(Array.isArray(all)).toBe(true);
    const beta = (await get(sales, `/sales-contracts?q=beta&page=1&pageSize=100`).expect(200)).body;
    expect(beta.total).toBe(beta.items.length);
    expect(beta.items.every((r: { customerName: string }) => r.customerName === 'Beta Ltd')).toBe(true);
    expect(beta.total).toBeGreaterThan(0);
    const one = (await get(sales, '/sales-contracts?page=1&pageSize=1&sort=documentNumber&order=asc').expect(200)).body;
    expect(one.items).toHaveLength(1);
    expect(one.total).toBe(all.length);
    expect(one.items[0].documentNumber).toBe([...all].map((r: { documentNumber: string }) => r.documentNumber).sort()[0]);
    const active = (await get(sales, `/sales-contracts?status=ACTIVE&responsibleSalesUserId=${salesId}&customerId=${customerId}`)).body;
    expect(active.length).toBeGreaterThan(0);
    expect(active.every((r: { status: string; responsibleSalesUserId: number; customerId: number }) =>
      r.status === 'ACTIVE' && r.responsibleSalesUserId === salesId && r.customerId === customerId)).toBe(true);
    const byNumber = (await get(sales, `/sales-contracts?q=${encodeURIComponent(all[0].documentNumber.toLowerCase())}`)).body;
    expect(byNumber.map((r: { id: number }) => r.id)).toEqual([all[0].id]);
    await get(sales, '/sales-contracts?status=WHATEVER').expect(400);
    // `%` is matched literally, not as a wildcard.
    expect((await get(sales, '/sales-contracts?q=%25')).body).toEqual([]);
  });

  /** Runs the migration's down() then up() on legacy rows inside a rolled-back transaction. */
  async function migrateLegacy(sc: number, uomNames: string[]) {
    const q = ds.createQueryRunner();
    const migration = new SalesContractLineUom1732320000000();
    try {
      await q.startTransaction();
      await migration.down(q);
      for (const [i, name] of uomNames.entries()) {
        await q.query(`INSERT INTO sales_contract_lines (sales_contract_id, item_code, item_name, uom_name, quantity) VALUES ($1, $2, 'X', $3, 1)`, [sc, `L${i}`, name]);
      }
      await migration.up(q);
      return {
        rows: await q.query(`SELECT item_code, unit_of_measure_id FROM sales_contract_lines WHERE sales_contract_id = $1 ORDER BY item_code`, [sc]),
        columns: (await q.query(`SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = 'sales_contract_lines' AND column_name IN ('uom_name', 'unit_of_measure_id')`)),
      };
    } finally {
      await q.rollbackTransaction();
      await q.release();
    }
  }

  it('migration maps exact catalog names, drops uom_name and makes the FK NOT NULL', async () => {
    const sc = (await post(sales, '/sales-contracts', { customerId }).expect(201)).body.id;
    const { rows, columns } = await migrateLegacy(sc, ['Cái', 'Cái']);
    expect(rows).toEqual([{ item_code: 'L0', unit_of_measure_id: pcs }, { item_code: 'L1', unit_of_measure_id: pcs }]);
    expect(columns).toEqual([{ column_name: 'unit_of_measure_id', is_nullable: 'NO' }]);
  });

  it('migration stops instead of guessing or deleting when a line UoM is not in the catalog', async () => {
    const sc = (await post(sales, '/sales-contracts', { customerId }).expect(201)).body.id;
    await expect(migrateLegacy(sc, ['Cái', 'cái', 'gói'])).rejects.toThrow('"cái" (1), "gói" (1)');
  });

  it('a UoM used by a contract line cannot be deleted', async () => {
    const sc = (await post(sales, '/sales-contracts', { customerId, lines: [line('A')] }).expect(201)).body.id;
    expect(sc).toBeTruthy();
    await expect(ds.query(`DELETE FROM units_of_measure WHERE id = $1`, [pcs])).rejects.toMatchObject({ code: '23503' });
  });

  it('lists the PRs of one contract by sales_contract_id', async () => {
    const admin = await login(app, process.env.SEED_ADMIN_USERNAME!, process.env.SEED_ADMIN_PASSWORD!);
    const sc = (await post(sales, '/sales-contracts', { customerId, responsibleSalesUserId: salesId, lines: [line('A', 3)] }).expect(201)).body.id;
    await post(sales, `/sales-contracts/${sc}/activate`).expect(204);
    const lineId = (await get(sales, `/sales-contracts/${sc}`)).body.lines[0].id;
    const [{ id: productId }] = await ds.query(`SELECT id FROM products WHERE part_number = 'PN-L1'`);
    const pr = (await post(admin, '/purchase-requisitions', { salesContractId: sc, lines: [{ salesContractLineId: lineId, productId, quantity: 3 }] }).expect(201)).body.id;
    expect((await get(admin, `/purchase-requisitions?salesContractId=${sc}`).expect(200)).body.map((r: { id: number }) => r.id)).toEqual([pr]);
    expect((await get(admin, '/purchase-requisitions').expect(200)).body.length).toBeGreaterThanOrEqual(1);
  });
});
