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

  it('PR19: manages catalog entries under permissions and replaces brand suppliers atomically', async () => {
    const admin = await login(app, process.env.SEED_ADMIN_USERNAME!, process.env.SEED_ADMIN_PASSWORD!);
    await post(sales, '/brands', { code: 'B19', name: 'Brand 19' }).expect(403);
    const brand = (await post(admin, '/brands', { code: 'B19', name: 'Brand 19' }).expect(201)).body;
    const secondBrand = (await post(admin, '/brands', { code: 'B20', name: 'Brand 20' }).expect(201)).body;
    await patch(admin, `/brands/${brand.id}`, { code: 'B19', name: 'Brand 19 updated' }).expect(200);
    await post(admin, '/brands', { code: 'B19', name: 'Duplicate' }).expect(409);
    const supplier = (await post(admin, '/suppliers', { code: 'B19-S', name: 'Supplier' }).expect(201)).body;
    for (const id of [brand.id, secondBrand.id]) {
      await http().put(`/brands/${id}/suppliers`).set(as(admin)).send({ supplierIds: [supplier.id] }).expect(204);
      expect((await get(admin, `/brands/${id}/suppliers`).expect(200)).body).toEqual([expect.objectContaining({ id: supplier.id })]);
    }
    await http().put(`/brands/${brand.id}/suppliers`).set(as(admin)).send({ supplierIds: [999999] }).expect(422);
    expect((await get(admin, `/brands/${brand.id}/suppliers`).expect(200)).body).toHaveLength(1);
    await get(sales, `/brands/${brand.id}/suppliers`).expect(403);
    await post(admin, '/products', { partNumber: 'B19-P', name: 'Missing brand', unitOfMeasureId: pcs }).expect(400);
    const product = (await post(admin, '/products', { partNumber: 'B19-P', name: 'Branded', unitOfMeasureId: pcs, brandId: brand.id }).expect(201)).body;
    await patch(admin, `/products/${product.id}`, { brandId: null }).expect(400);
    await patch(admin, `/products/${product.id}`, { brandId: secondBrand.id }).expect(200);
    await del(admin, `/brands/${secondBrand.id}`).expect(404);

    const currencies = (await get(sales, '/currencies').expect(200)).body;
    expect(currencies[0]).toMatchObject({ code: 'VND', exchangeRate: '1.00000000', decimalPlaces: 0 });
    await patch(admin, `/currencies/${currencies[0].id}`, { code: 'VND', name: 'VND', exchangeRate: '2', decimalPlaces: 0 }).expect(422);
    await del(admin, `/currencies/${currencies[0].id}`).expect(404);
    const usd = { code: 'USD', name: 'US dollar', exchangeRate: '0', decimalPlaces: 2 };
    await post(admin, '/currencies', usd).expect(422);
    await post(admin, '/currencies', { ...usd, exchangeRate: '25123.123456789' }).expect(400);
    const currency = (await post(admin, '/currencies', { ...usd, exchangeRate: '25123.12345678' }).expect(201)).body;
    expect(currency.exchangeRate).toBe('25123.12345678');

    await post(admin, '/tax-rates', { code: 'OVER', name: 'Invalid', rate: '100.0001' }).expect(422);
    const tax = (await post(admin, '/tax-rates', { code: 'ZERO', name: 'Zero tax', rate: '0' }).expect(201)).body;
    expect(tax.rate).toBe('0.0000');
    await del(admin, `/tax-rates/${tax.id}`).expect(404);
  });

  it('persists optional descriptions and exposes no physical delete for all ten catalogs', async () => {
    const admin = await login(app, process.env.SEED_ADMIN_USERNAME!, process.env.SEED_ADMIN_PASSWORD!);
    const basic = { code: 'F02', name: 'Description fixture' };
    const catalogs = [
      ['/brands', basic, 200], ['/temporary-products', basic, 200], ['/units-of-measure', basic, 204],
      ['/warehouses', basic, 200], ['/customers', basic, 204], ['/suppliers', basic, 204],
      ['/currencies', { ...basic, code: 'CAD', exchangeRate: '17000', decimalPlaces: 2 }, 200],
      ['/tax-rates', { ...basic, rate: '8' }, 200], ['/dossier-types', basic, 200],
      ['/products', { name: basic.name, partNumber: basic.code, brandId: 1, unitOfMeasureId: pcs }, 200],
    ] as const;
    for (const [route, body, updateStatus] of catalogs) {
      const { id } = (await post(admin, route, body).expect(201)).body;
      const find = async () => (await get(admin, route).expect(200)).body.find((item: { id: number }) => item.id === id);
      expect((await find()).description).toBeNull();
      await patch(admin, route + '/' + id, { ...body, description: 'Mô tả thử nghiệm' }).expect(updateStatus);
      await post(admin, route, { ...body, description: 'Copy using original code' }).expect(409);
      await del(admin, route + '/' + id).expect(404);
      expect(await find()).toMatchObject({ description: 'Mô tả thử nghiệm', isActive: true });
    }
  });

  it('creates a brand and multiple supplier links atomically and retains saved inactive suppliers', async () => {
    const admin = await login(app, process.env.SEED_ADMIN_USERNAME!, process.env.SEED_ADMIN_PASSWORD!);
    const first = (await post(admin, '/suppliers', { code: 'LINK-A', name: 'A' }).expect(201)).body.id;
    const second = (await post(admin, '/suppliers', { code: 'LINK-B', name: 'B' }).expect(201)).body.id;
    const body = { code: 'F06', name: 'Links fixture', description: 'Initial' };
    await post(admin, '/brands', { ...body, supplierIds: [first, first] }).expect(400);
    await post(admin, '/brands', { ...body, supplierIds: [first, 999999] }).expect(422);
    expect((await get(admin, '/brands').expect(200)).body).not.toContainEqual(expect.objectContaining({ code: body.code }));
    const { id } = (await post(admin, '/brands', { ...body, supplierIds: [first, second] }).expect(201)).body;
    const links = async () => (await get(admin, `/brands/${id}/suppliers`).expect(200)).body;
    expect(await links()).toHaveLength(2);
    await patch(admin, `/suppliers/${second}/status`, { isActive: false }).expect(204);
    await patch(admin, `/brands/${id}`, { ...body, supplierIds: [first, second] }).expect(200);
    expect(await links()).toContainEqual(expect.objectContaining({ id: second, isActive: false }));
    await post(admin, '/brands', { ...body, code: 'F06-COPY', supplierIds: [second] }).expect(422);
    await patch(admin, `/brands/${id}`, { ...body, description: 'Rejected', supplierIds: [999999] }).expect(422);
    expect(await links()).toHaveLength(2);
    expect((await get(admin, '/brands').expect(200)).body).toContainEqual(expect.objectContaining({ id, description: 'Initial' }));
  });

  it('PR19: saves three line sources, duplicate codes and historical snapshots without creating delivery approvals', async () => {
    const admin = await login(app, process.env.SEED_ADMIN_USERNAME!, process.env.SEED_ADMIN_PASSWORD!);
    const product = (await post(admin, '/products', { partNumber: 'MIXED', name: 'Main product', description: 'Main snapshot',
      unitOfMeasureId: pcs, brandId: 1 }).expect(201)).body;
    const temporary = (await post(admin, '/temporary-products', { code: 'MIXED', name: 'Temporary product', description: 'Original' }).expect(201)).body;
    const free = { ...line('MIXED'), itemDescription: 'Free snapshot' };
    const sc = (await post(sales, '/sales-contracts', { customerId, lines: [
      { ...line('Ignored'), productId: product.id },
      { ...line('Ignored'), temporaryProductId: temporary.id },
      free,
    ] }).expect(201)).body.id;
    const detailBefore = (await get(sales, `/sales-contracts/${sc}`).expect(200)).body;
    const [mainLine, temporaryLine, freeLine] = detailBefore.lines;
    expect(mainLine).toMatchObject({ itemCode: 'MIXED', itemName: 'Main product', productId: product.id,
      itemDescription: 'Main snapshot', temporaryProductId: null, products: [] });
    expect(temporaryLine).toMatchObject({ itemCode: 'MIXED', itemDescription: 'Original', productId: null, temporaryProductId: temporary.id, products: [] });
    expect(freeLine).toMatchObject({ itemCode: 'MIXED', itemDescription: 'Free snapshot', productId: null, temporaryProductId: null, products: [] });
    expect((await get(sales, '/products').expect(200)).body.filter((p: { partNumber: string }) => p.partNumber === 'MIXED')).toHaveLength(1);
    expect((await get(sales, '/temporary-products').expect(200)).body.filter((p: { code: string }) => p.code === 'MIXED')).toHaveLength(1);

    await patch(admin, `/temporary-products/${temporary.id}`, { code: 'CHANGED', name: 'Changed', description: 'Updated' }).expect(200);
    await patch(admin, `/products/${product.id}`, { description: 'Changed' }).expect(200);
    expect((await get(sales, `/sales-contracts/${sc}`).expect(200)).body.lines).toEqual(detailBefore.lines);
    const bad = { ...free, productId: product.id, temporaryProductId: temporary.id, version: detailBefore.version };
    await post(sales, `/sales-contracts/${sc}/lines`, bad).expect(422);
    await expect(ds.query('UPDATE sales_contract_lines SET product_id=$2 WHERE id=$1',
      [temporaryLine.id, product.id])).rejects.toMatchObject({ code: '23514' });
    await patch(sales, `/sales-contract-lines/${temporaryLine.id}`, { ...line('CHANGED', 2), temporaryProductId: temporary.id, itemDescription: 'Contract requirement',
      version: detailBefore.version }).expect(204);
    const changed = (await get(sales, `/sales-contracts/${sc}`).expect(200)).body.lines[1];
    expect((await get(sales, '/temporary-products').expect(200)).body).toContainEqual(expect.objectContaining({ id: temporary.id, description: 'Updated' }));
    expect(changed).toMatchObject({ id: temporaryLine.id, itemCode: 'MIXED', itemDescription: 'Contract requirement', quantity: '2.000' });
  });

  it('Phase 1.1: edits catalogs by permission and sets explicit active status', async () => {
    const admin = await login(app, process.env.SEED_ADMIN_USERNAME!, process.env.SEED_ADMIN_PASSWORD!);
    const uom = (await post(admin, '/units-of-measure', { code: 'P11', name: 'Pack' }).expect(201)).body;
    await patch(sales, `/units-of-measure/${uom.id}`, { code: 'P11', name: 'Pack 11' }).expect(403);
    await patch(admin, `/units-of-measure/${uom.id}`, { code: 'P11', name: 'Pack 11' }).expect(204);
    const customer = (await post(admin, '/customers', { code: 'C11', name: 'Customer 11' }).expect(201)).body;
    await patch(sales, `/customers/${customer.id}`, { code: 'C11', name: 'Edited' }).expect(403);
    await patch(admin, `/customers/${customer.id}`, { code: 'C11', name: 'Edited' }).expect(204);
    const supplier = (await post(admin, '/suppliers', { code: 'S11', name: 'Supplier 11' }).expect(201)).body;
    await patch(admin, `/suppliers/${supplier.id}`, { code: 'S11', name: 'Supplier edited' }).expect(204);
    await patch(admin, '/brands/1', { code: 'TEST', name: 'Renamed', supplierIds: [supplier.id] }).expect(200);
    await patch(admin, '/brands/1', { code: 'TEST', name: 'Rolled back', supplierIds: [999999] }).expect(422);
    expect((await get(admin, '/brands').expect(200)).body).toContainEqual(expect.objectContaining({ id: 1, code: 'TEST', name: 'Renamed', isActive: true }));
    expect((await get(admin, '/brands/1/suppliers').expect(200)).body).toEqual([expect.objectContaining({ id: supplier.id, code: 'S11', name: 'Supplier edited' })]);
    await patch(admin, '/brands/1', { code: 'TEST', name: 'Renamed', supplierIds: [] }).expect(200);
    expect((await get(admin, '/brands/1/suppliers').expect(200)).body).toEqual([]);
    expect((await get(admin, '/suppliers').expect(200)).body).toContainEqual(expect.objectContaining({ id: supplier.id, code: 'S11', name: 'Supplier edited', isActive: true }));

    const product = (await post(admin, '/products', {
      partNumber: 'P11', name: 'Product 11', unitOfMeasureId: uom.id, brandId: 1,
    }).expect(201)).body;
    await patch(sales, `/products/${product.id}/status`, { isActive: false }).expect(403);
    await patch(admin, `/products/${product.id}/status`, { isActive: 'false' }).expect(400);
    for (const isActive of [false, false, true]) {
      const result = await patch(admin, `/products/${product.id}/status`, { isActive }).expect(200);
      expect(result.body).toMatchObject({ id: product.id, isActive, name: 'Product 11' });
    }
    const warehouse = (await post(admin, '/warehouses', { code: 'W11', name: 'Warehouse 11' }).expect(201)).body;
    await patch(admin, `/warehouses/${warehouse.id}/status`, { isActive: false }).expect(204);
    expect((await get(admin, '/warehouses').expect(200)).body).toContainEqual(expect.objectContaining({ id: warehouse.id, isActive: false }));
  });

  it('maintains active-only selections, status guards and inactive historical references', async () => {
    const admin = await login(app, process.env.SEED_ADMIN_USERNAME!, process.env.SEED_ADMIN_PASSWORD!);
    const add = async (path: string, fields: object) => (await post(admin, path, fields).expect(201)).body.id as number;
    const setStatus = (path: string, id: number, isActive: boolean, status = 204) =>
      patch(admin, `${path}/${id}/status`, { isActive }).expect(status);

    const brand = await add('/brands', { code: 'STATUS-B', name: 'Brand' });
    const uom = await add('/units-of-measure', { code: 'STATUS-U', name: 'Unit' });
    const product = await add('/products', { partNumber: 'STATUS-P', name: 'Main', brandId: brand, unitOfMeasureId: uom });
    const temp = await add('/temporary-products', { code: 'STATUS-T', name: 'Temporary' });
    const customer = await add('/customers', { code: 'STATUS-C', name: 'Customer' });
    const supplier = await add('/suppliers', { code: 'STATUS-S', name: 'Supplier' });
    const rate = await add('/tax-rates', { code: 'STATUS-TAX', name: 'Tax', rate: '0' });
    const currency = await add('/currencies', { code: 'ZUA', name: 'Foreign', exchangeRate: '2', decimalPlaces: 2 });
    const warehouse = await add('/warehouses', { code: 'STATUS-W', name: 'Warehouse' });
    const sc = (await post(sales, '/sales-contracts', { customerId: customer, lines: [
      { ...line('STATUS-P', 1, uom), productId: product },
      { ...line('STATUS-T', 1, uom), temporaryProductId: temp },
    ] }).expect(201)).body.id;
    expect((await setStatus('/brands', brand, false, 422)).body.code).toBe('CATALOG_HAS_ACTIVE_PRODUCTS');
    expect((await setStatus('/units-of-measure', uom, false, 422)).body.code).toBe('CATALOG_HAS_ACTIVE_PRODUCTS');
    const vnd = (await get(admin, '/currencies').expect(200)).body.find((row: { code: string }) => row.code === 'VND');
    expect((await setStatus('/currencies', vnd.id, false, 422)).body.code).toBe('DEFAULT_CURRENCY_REQUIRED');
    await patch(sales, `/temporary-products/${temp}/status`, { isActive: false }).expect(403);

    for (const [path, id, status] of [
      ['/products', product, 200], ['/brands', brand, 204], ['/units-of-measure', uom, 204],
      ['/temporary-products', temp, 204], ['/customers', customer, 204], ['/suppliers', supplier, 204],
      ['/tax-rates', rate, 204], ['/currencies', currency, 204], ['/warehouses', warehouse, 204],
    ] as const) {
      await setStatus(path, id, false, status);
      expect((await get(admin, path).expect(200)).body).toContainEqual(expect.objectContaining({ id, isActive: false }));
      expect((await get(admin, path + '?activeOnly=true').expect(200)).body).not.toContainEqual(expect.objectContaining({ id }));
      expect((await get(admin, path + '?activeOnly=true&includeId=' + id).expect(200)).body).toContainEqual(expect.objectContaining({ id, isActive: false }));
    }

    await setStatus('/products', product, true, 422);
    await setStatus('/brands', brand, true);
    await setStatus('/products', product, true, 422);
    await setStatus('/units-of-measure', uom, true);
    await setStatus('/products', product, true, 200);
    await setStatus('/products', product, false, 200);
    expect((await post(sales, '/sales-contracts', { customerId: customer }).expect(422)).body.code).toBe('CUSTOMER_NOT_FOUND');
    await patch(sales, `/sales-contracts/${sc}`, { customerId: customer, version: await version(sc) }).expect(204);
    const detail = (await get(sales, `/sales-contracts/${sc}`).expect(200)).body;
    expect(detail.lines).toHaveLength(2);
    await patch(sales, `/sales-contract-lines/${detail.lines[0].id}`, {
      ...line('STATUS-P', 2, uom), productId: product, version: detail.version,
    }).expect(204);
    await post(sales, `/sales-contracts/${sc}/lines`, {
      ...line('STATUS-T', 1, uom), temporaryProductId: temp, version: await version(sc),
    }).expect(422);
    await post(sales, `/sales-contracts/${sc}/lines`, {
      ...line('STATUS-P', 1, uom), productId: product, version: await version(sc),
    }).expect(422);
  });

  it('serializes assigning a brand with deactivating that brand', async () => {
    const admin = await login(app, process.env.SEED_ADMIN_USERNAME!, process.env.SEED_ADMIN_PASSWORD!);
    const brand = (await post(admin, '/brands', { code: 'CONCURRENT-B', name: 'Concurrent brand' }).expect(201)).body.id;
    const [create, deactivate] = await Promise.all([
      post(admin, '/products', { partNumber: 'CONCURRENT-P', name: 'Concurrent product', brandId: brand, unitOfMeasureId: pcs }),
      patch(admin, `/brands/${brand}/status`, { isActive: false }),
    ]);
    expect([[201, 422], [422, 204]]).toContainEqual([create.status, deactivate.status]);
    const [[current], [product]] = await Promise.all([
      ds.query('SELECT is_active FROM brands WHERE id = $1', [brand]),
      ds.query("SELECT is_active FROM products WHERE part_number = 'CONCURRENT-P'"),
    ]);
    expect(Boolean(product?.is_active) && !current.is_active).toBe(false);
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
      `INSERT INTO products (part_number, name, unit_of_measure_id, is_serial_tracked, brand_id) VALUES ('PN-L1', 'P', $1, false, 1) RETURNING id`, [pcs]);
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
    const pr = (await post(sales, '/purchase-requisitions', { salesContractId: sc, lines: [{ salesContractLineId: lineId, productId, quantity: 3 }] }).expect(201)).body.id;
    expect((await get(admin, `/purchase-requisitions?salesContractId=${sc}`).expect(200)).body.map((r: { id: number }) => r.id)).toEqual([pr]);
    expect((await get(admin, '/purchase-requisitions').expect(200)).body.length).toBeGreaterThanOrEqual(1);
  });
});
