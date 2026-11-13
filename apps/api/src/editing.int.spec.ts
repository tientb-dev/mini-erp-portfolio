import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { bootTestApp, login } from './test-utils';

/** Editing HĐ (DRAFT) and PR/PO/GRR (DRAFT/REJECTED): limits, versions, RBAC, warehouse scope, history (IM18). */
describe('Document editing (integration)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let admin: string;
  let approver: string;
  let approverId: number;
  let adminId: number;
  let hcmId: number;
  let p1: number;
  let p2: number;
  let customerId: number;
  let customer2: number;
  let supplierId: number;
  let supplier2: number;

  const http = () => request(app.getHttpServer());
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const post = (t: string, url: string, body: object = {}) => http().post(url).set(as(t)).send(body);
  const patch = (t: string, url: string, body: object) => http().patch(url).set(as(t)).send(body);
  const get = (t: string, url: string) => http().get(url).set(as(t));

  beforeAll(async () => {
    process.env.SEED_ROLE_USERS_PASSWORD = 'role-users-test';
    ({ app, ds } = await bootTestApp());
    admin = await login(app, process.env.SEED_ADMIN_USERNAME!, process.env.SEED_ADMIN_PASSWORD!);
    approver = await login(app, process.env.SEED_APPROVER_USERNAME!, process.env.SEED_APPROVER_PASSWORD!);
    approverId = (await get(approver, '/auth/me')).body.id;
    adminId = (await get(admin, '/auth/me')).body.id;
    [{ id: hcmId }] = await ds.query(`SELECT id FROM warehouses WHERE code = 'HCM'`);
    const [{ id: pcs }] = await ds.query(`SELECT id FROM units_of_measure WHERE code = 'PCS'`);
    const [{ id: box }] = await ds.query(`INSERT INTO units_of_measure (code, name) VALUES ('BOX', 'Hộp') RETURNING id`);
    p1 = (await post(admin, '/products', { partNumber: 'PN-E1', name: 'Switch', unitOfMeasureId: pcs, isSerialTracked: false }).expect(201)).body.id;
    p2 = (await post(admin, '/products', { partNumber: 'PN-E2', name: 'Cable', unitOfMeasureId: box, isSerialTracked: false }).expect(201)).body.id;
    customerId = (await post(admin, '/customers', { code: 'EC1', name: 'Customer 1' }).expect(201)).body.id;
    customer2 = (await post(admin, '/customers', { code: 'EC2', name: 'Customer 2' }).expect(201)).body.id;
    supplierId = (await post(admin, '/suppliers', { code: 'ES1', name: 'Supplier 1' }).expect(201)).body.id;
    supplier2 = (await post(admin, '/suppliers', { code: 'ES2', name: 'Supplier 2' }).expect(201)).body.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  const scLine = (quantity: number, itemCode = 'SW') => ({ itemCode, itemName: `Item ${itemCode}`, uomName: 'Cái', quantity });

  async function activeContract(qty = 10) {
    const sc = (await post(admin, '/sales-contracts', { customerId, lines: [scLine(qty)] }).expect(201)).body.id;
    await post(admin, `/sales-contracts/${sc}/activate`).expect(204);
    const [line] = (await get(admin, `/sales-contracts/${sc}`).expect(200)).body.lines;
    return { sc: sc as number, lineId: line.id as number };
  }

  async function approved(path: string, id: number) {
    await post(admin, `/${path}/${id}/submit`, { approverId }).expect(204);
    await post(approver, `/${path}/${id}/approve`).expect(204);
  }

  /** Approved PR (qty) → its line id. */
  async function approvedPrLine(qty = 10) {
    const { sc, lineId } = await activeContract(qty);
    const pr = (await post(admin, '/purchase-requisitions', { salesContractId: sc, lines: [{ salesContractLineId: lineId, productId: p1, quantity: qty }] }).expect(201)).body.id;
    await approved('purchase-requisitions', pr);
    return (await get(admin, `/purchase-requisitions/${pr}`)).body.lines[0].id as number;
  }

  async function approvedPo(qty = 10) {
    const prLine = await approvedPrLine(qty);
    const po = (await post(admin, '/purchase-orders', { supplierId, lines: [{ sourceLineId: prLine, quantity: qty }] }).expect(201)).body.id;
    await approved('purchase-orders', po);
    return { po: po as number, poLine: (await get(admin, `/purchase-orders/${po}`)).body.lines[0].id as number };
  }

  it('HĐ DRAFT: edit customer and lines in place, keep number and line ids; ACTIVE is locked (03 §9.1, G10)', async () => {
    const sc = (await post(admin, '/sales-contracts', { customerId, lines: [scLine(5, 'A'), scLine(3, 'B')] }).expect(201)).body.id;
    const before = (await get(admin, `/sales-contracts/${sc}`)).body;
    const [a, b] = before.lines;
    const sales = await login(app, 'sales', 'role-users-test');
    const pm = await login(app, 'pm', 'role-users-test');
    await patch(pm, `/sales-contracts/${sc}`, { version: before.version, customerId, lines: [scLine(1)] }).expect(403); // PM cannot edit HĐ (04 §2)

    // A proposal on line B blocks deleting it (its id is referenced).
    await post(pm, `/sales-contract-lines/${b.id}/product-proposals`, { productId: p1, reason: 'x' }).expect(201);
    expect((await patch(sales, `/sales-contracts/${sc}`, { version: before.version, customerId, lines: [{ ...scLine(5, 'A'), id: a.id }] }).expect(409)).body.code)
      .toBe('RECORD_IN_USE');

    await patch(sales, `/sales-contracts/${sc}`, {
      version: before.version, customerId: customer2,
      lines: [{ id: a.id, ...scLine(7, 'A2') }, { id: b.id, ...scLine(3, 'B') }, scLine(2, 'C')],
    }).expect(204);
    const after = (await get(admin, `/sales-contracts/${sc}`)).body;
    expect(after).toMatchObject({ documentNumber: before.documentNumber, customerName: 'Customer 2', version: before.version + 1, updatedByName: 'Nhân viên Sales' });
    expect(after.lines.map((l: { id: number; itemCode: string; quantity: string }) => [l.id === a.id || l.id === b.id, l.itemCode, Number(l.quantity)]))
      .toEqual([[true, 'A2', 7], [true, 'B', 3], [false, 'C', 2]]);
    expect(after.lines[1].products).toHaveLength(1);

    expect((await patch(sales, `/sales-contracts/${sc}`, { version: before.version, customerId, lines: [scLine(1)] }).expect(409)).body.code).toBe('STALE_VERSION');
    expect((await patch(sales, `/sales-contracts/${sc}`, { version: after.version, customerId, lines: [...after.lines.map((l: { id: number }) => ({ id: l.id, ...scLine(1) })), { id: 999999, ...scLine(1) }] }).expect(409)).body.code)
      .toBe('LINE_NOT_EDITABLE');
    await post(sales, `/sales-contracts/${sc}/activate`).expect(204);
    const active = (await get(admin, `/sales-contracts/${sc}`)).body;
    expect((await patch(sales, `/sales-contracts/${sc}`, { version: active.version, customerId, lines: [scLine(1)] }).expect(409)).body.code).toBe('INVALID_STATUS');
  });

  it('PR: creator edits DRAFT (product → UoM snapshot); REJECTED stays REJECTED until resubmitted and approved again', async () => {
    const sc = (await post(admin, '/sales-contracts', { customerId, lines: [scLine(10, 'A'), scLine(10, 'B')] }).expect(201)).body.id;
    await post(admin, `/sales-contracts/${sc}/activate`).expect(204);
    const [lineId, lineB] = (await get(admin, `/sales-contracts/${sc}`)).body.lines.map((l: { id: number }) => l.id);
    const pr = (await post(admin, '/purchase-requisitions', { salesContractId: sc, lines: [{ salesContractLineId: lineId, productId: p1, quantity: 3 }] }).expect(201)).body.id;
    let d = (await get(admin, `/purchase-requisitions/${pr}`)).body;
    await patch(admin, `/purchase-requisitions/${pr}`, {
      version: d.version, lines: [{ id: d.lines[0].id, salesContractLineId: lineId, productId: p2, quantity: 4 }, { salesContractLineId: lineB, productId: p1, quantity: 1 }],
    }).expect(204);
    d = (await get(admin, `/purchase-requisitions/${pr}`)).body;
    expect(d.lines.map((l: { partNumber: string; uom: string; quantity: string }) => [l.partNumber, l.uom, Number(l.quantity)])).toEqual([['PN-E2', 'BOX', 4], ['PN-E1', 'PCS', 1]]);
    expect(d.approvalStatus).toBe('DRAFT');

    // Only the creator edits; the assigned approver never does (E06).
    expect((await patch(approver, `/purchase-requisitions/${pr}`, { version: d.version, lines: [{ salesContractLineId: lineId, productId: p1, quantity: 1 }] }).expect(403)).body.code)
      .toBe('NOT_DOCUMENT_CREATOR');
    await post(admin, `/purchase-requisitions/${pr}/submit`, { approverId }).expect(204);
    d = (await get(admin, `/purchase-requisitions/${pr}`)).body;
    expect((await patch(admin, `/purchase-requisitions/${pr}`, { version: d.version, lines: [{ salesContractLineId: lineId, productId: p1, quantity: 1 }] }).expect(409)).body.code)
      .toBe('INVALID_STATUS'); // C18 equivalent: recall first
    await post(approver, `/purchase-requisitions/${pr}/reject`, { reason: 'Sai mã' }).expect(204);
    d = (await get(admin, `/purchase-requisitions/${pr}`)).body;
    await patch(admin, `/purchase-requisitions/${pr}`, { version: d.version, lines: [{ id: d.lines[0].id, salesContractLineId: lineId, productId: p1, quantity: 4 }] }).expect(204);
    d = (await get(admin, `/purchase-requisitions/${pr}`)).body;
    expect(d.approvalStatus).toBe('REJECTED');
    expect(d.lines).toHaveLength(1);
    await approved('purchase-requisitions', pr);
    d = (await get(admin, `/purchase-requisitions/${pr}`)).body;
    expect(d.history.map((h: { action: string }) => h.action)).toEqual(['EDIT', 'SUBMIT', 'REJECT', 'EDIT', 'SUBMIT', 'APPROVE']);
    expect(d.documentNumber).toMatch(/^PR-\d{4}-\d{6}$/);
  });

  it('PR line referenced by a canceled PO keeps its product; its quantity may change', async () => {
    const { sc, lineId } = await activeContract();
    const pr = (await post(admin, '/purchase-requisitions', { salesContractId: sc, lines: [{ salesContractLineId: lineId, productId: p1, quantity: 5 }] }).expect(201)).body.id;
    await approved('purchase-requisitions', pr);
    const prLine = (await get(admin, `/purchase-requisitions/${pr}`)).body.lines[0].id;
    const po = (await post(admin, '/purchase-orders', { supplierId, lines: [{ sourceLineId: prLine, quantity: 5 }] }).expect(201)).body.id;
    await post(admin, `/purchase-orders/${po}/cancel`).expect(204);
    await post(admin, `/purchase-requisitions/${pr}/recall`, { reason: 'Sửa' }).expect(204);
    const v = (await get(admin, `/purchase-requisitions/${pr}`)).body.version;
    expect((await patch(admin, `/purchase-requisitions/${pr}`, { version: v, lines: [{ id: prLine, salesContractLineId: lineId, productId: p2, quantity: 5 }] }).expect(409)).body.code)
      .toBe('LINE_NOT_EDITABLE');
    expect((await patch(admin, `/purchase-requisitions/${pr}`, { version: v, lines: [{ salesContractLineId: lineId, productId: p1, quantity: 5 }] }).expect(409)).body.code)
      .toBe('RECORD_IN_USE'); // deleting it is blocked too
    await patch(admin, `/purchase-requisitions/${pr}`, { version: v, lines: [{ id: prLine, salesContractLineId: lineId, productId: p1, quantity: 8 }] }).expect(204);
  });

  it('PR: an HĐ line at most once per PR (CM6); other PRs and other HĐ lines with the same product stay separate', async () => {
    const sc = (await post(admin, '/sales-contracts', { customerId, lines: [scLine(5, 'A'), scLine(5, 'B')] }).expect(201)).body.id;
    await post(admin, `/sales-contracts/${sc}/activate`).expect(204);
    const [a, b] = (await get(admin, `/sales-contracts/${sc}`)).body.lines.map((l: { id: number }) => l.id);
    const dup = [{ salesContractLineId: a, productId: p1, quantity: 1 }, { salesContractLineId: a, productId: p2, quantity: 2 }];
    expect((await post(admin, '/purchase-requisitions', { salesContractId: sc, lines: dup }).expect(422)).body.code).toBe('DUPLICATE_SOURCE_LINE');

    // Two HĐ lines with the same product → two PR lines; a second PR may reference the same HĐ line.
    const pr = (await post(admin, '/purchase-requisitions', { salesContractId: sc, lines: [
      { salesContractLineId: a, productId: p1, quantity: 1 }, { salesContractLineId: b, productId: p1, quantity: 2 }] }).expect(201)).body.id;
    await post(admin, '/purchase-requisitions', { salesContractId: sc, lines: [{ salesContractLineId: a, productId: p1, quantity: 3 }] }).expect(201);
    const before = (await get(admin, `/purchase-requisitions/${pr}`)).body;
    expect(before.lines.map((l: { sourceLineId: number }) => l.sourceLineId).sort()).toEqual([a, b].sort());

    // Edit that would point both lines at HĐ line a → rejected, nothing saved.
    const [l1, l2] = before.lines;
    expect((await patch(admin, `/purchase-requisitions/${pr}`, { version: before.version, lines: [
      { id: l1.id, salesContractLineId: a, productId: p1, quantity: 1 }, { id: l2.id, salesContractLineId: a, productId: p1, quantity: 2 }] }).expect(422)).body.code)
      .toBe('DUPLICATE_SOURCE_LINE');
    expect((await get(admin, `/purchase-requisitions/${pr}`)).body).toEqual(before);
  });

  it('PO: a PR line at most once per PO; several POs may share it within the PR quantity', async () => {
    const prLine = await approvedPrLine(10);
    expect((await post(admin, '/purchase-orders', { supplierId, lines: [{ sourceLineId: prLine, quantity: 2 }, { sourceLineId: prLine, quantity: 3 }] }).expect(422)).body.code)
      .toBe('DUPLICATE_SOURCE_LINE');
    const po1 = (await post(admin, '/purchase-orders', { supplierId, lines: [{ sourceLineId: prLine, quantity: 4 }] }).expect(201)).body.id;
    await approved('purchase-orders', po1);
    const po2 = (await post(admin, '/purchase-orders', { supplierId, lines: [{ sourceLineId: prLine, quantity: 6 }] }).expect(201)).body.id;
    const before = (await get(admin, `/purchase-orders/${po2}`)).body;
    expect((await patch(admin, `/purchase-orders/${po2}`, { version: before.version, supplierId, lines: [
      { id: before.lines[0].id, sourceLineId: prLine, quantity: 3 }, { sourceLineId: prLine, quantity: 3 }] }).expect(422)).body.code)
      .toBe('DUPLICATE_SOURCE_LINE');
    expect((await get(admin, `/purchase-orders/${po2}`)).body).toEqual(before);
    await approved('purchase-orders', po2); // 4 + 6 = PR quantity
  });

  it('PO: edit supplier/quantities; Σ PO ≤ PR re-checked; concurrent edits on one version → one wins (03 §1, §2)', async () => {
    const prLine = await approvedPrLine(10);
    const po1 = (await post(admin, '/purchase-orders', { supplierId, lines: [{ sourceLineId: prLine, quantity: 6 }] }).expect(201)).body.id;
    await approved('purchase-orders', po1);
    const po2 = (await post(admin, '/purchase-orders', { supplierId, lines: [{ sourceLineId: prLine, quantity: 4 }] }).expect(201)).body.id;
    let d = (await get(admin, `/purchase-orders/${po2}`)).body;
    const line = d.lines[0];
    expect((await patch(admin, `/purchase-orders/${po2}`, { version: d.version, supplierId, lines: [{ id: line.id, sourceLineId: prLine, quantity: 5 }] }).expect(422)).body.code)
      .toBe('QUANTITY_LIMIT_EXCEEDED');
    expect((await patch(admin, `/purchase-orders/${po2}`, { version: d.version, supplierId, lines: [{ id: line.id, sourceLineId: prLine + 1, quantity: 1 }] }).expect(409)).body.code)
      .toBe('LINE_NOT_EDITABLE'); // the source of an existing line cannot be swapped

    const results = await Promise.all([3, 2].map((q) =>
      patch(admin, `/purchase-orders/${po2}`, { version: d.version, supplierId: supplier2, lines: [{ id: line.id, sourceLineId: prLine, quantity: q }] })));
    expect(results.map((r) => r.status).sort()).toEqual([204, 409]);
    expect(results.find((r) => r.status === 409)!.body.code).toBe('STALE_VERSION');
    d = (await get(admin, `/purchase-orders/${po2}`)).body;
    expect(d).toMatchObject({ supplierName: 'Supplier 2', version: d.version });
    expect(d.lines).toHaveLength(1);
    expect(d.lines[0].id).toBe(line.id);
    await approved('purchase-orders', po2);
  });

  it('PO edit cannot exceed the PR line while another PO edit/submit runs concurrently', async () => {
    const prLine = await approvedPrLine(10);
    const a = (await post(admin, '/purchase-orders', { supplierId, lines: [{ sourceLineId: prLine, quantity: 1 }] }).expect(201)).body.id;
    const b = (await post(admin, '/purchase-orders', { supplierId, lines: [{ sourceLineId: prLine, quantity: 6 }] }).expect(201)).body.id;
    await post(admin, `/purchase-orders/${b}/submit`, { approverId }).expect(204);
    const da = (await get(admin, `/purchase-orders/${a}`)).body;
    // Both race for the PR line lock: editing A to 6 while B (6) is waiting must fail; at most 10 is ever committed.
    const [edit] = await Promise.all([
      patch(admin, `/purchase-orders/${a}`, { version: da.version, supplierId, lines: [{ id: da.lines[0].id, sourceLineId: prLine, quantity: 6 }] }),
      post(approver, `/purchase-orders/${b}/approve`),
    ]);
    expect(edit.body.code).toBe('QUANTITY_LIMIT_EXCEEDED');
    const [{ used }] = await ds.query(
      `SELECT SUM(pol.quantity) AS used FROM purchase_order_lines pol JOIN purchase_orders po ON po.id = pol.purchase_order_id
        WHERE pol.purchase_requisition_line_id = $1 AND po.approval_status <> 'CANCELED'`, [prLine]);
    expect(Number(used)).toBe(7);
  });

  it('GRR: edit within PO limit and warehouse scope, then full inbound flow still updates inventory', async () => {
    const { po, poLine } = await approvedPo(10);
    const grr = (await post(admin, '/goods-receipt-requests', { purchaseOrderId: po, warehouseId: hcmId, lines: [{ sourceLineId: poLine, quantity: 4 }] }).expect(201)).body.id;
    let d = (await get(admin, `/goods-receipt-requests/${grr}`)).body;
    const body = (q: number) => ({ version: d.version, lines: [{ id: d.lines[0].id, sourceLineId: poLine, quantity: q }] });
    expect((await patch(admin, `/goods-receipt-requests/${grr}`, body(11)).expect(422)).body.code).toBe('QUANTITY_LIMIT_EXCEEDED');

    // Data scope: outside the warehouse → 403 even for the creator.
    await ds.query(`DELETE FROM user_warehouses WHERE user_id = $1 AND warehouse_id = $2`, [adminId, hcmId]);
    try {
      await patch(admin, `/goods-receipt-requests/${grr}`, body(5)).expect(403);
    } finally {
      await ds.query(`INSERT INTO user_warehouses (user_id, warehouse_id) VALUES ($1, $2)`, [adminId, hcmId]);
    }

    await post(admin, `/goods-receipt-requests/${grr}/submit`, { approverId }).expect(204);
    await post(approver, `/goods-receipt-requests/${grr}/reject`, { reason: 'Sai số lượng' }).expect(204);
    d = (await get(admin, `/goods-receipt-requests/${grr}`)).body;
    await patch(admin, `/goods-receipt-requests/${grr}`, body(10)).expect(204);
    d = (await get(admin, `/goods-receipt-requests/${grr}`)).body;
    expect(d).toMatchObject({ approvalStatus: 'REJECTED', purchaseOrderId: po });
    expect(Number(d.lines[0].quantity)).toBe(10);
    await approved('goods-receipt-requests', grr);

    const gr = (await post(admin, '/goods-receipts', { goodsReceiptRequestId: grr }).expect(201)).body.id;
    await approved('goods-receipts', gr);
    const [inv] = await ds.query(`SELECT on_hand_quantity FROM inventories WHERE product_id = $1 AND warehouse_id = $2`, [p1, hcmId]);
    expect(Number(inv.on_hand_quantity)).toBeGreaterThanOrEqual(10);
    const history = (await get(admin, `/goods-receipt-requests/${grr}`)).body.history.map((h: { action: string }) => h.action);
    expect(history).toEqual(['SUBMIT', 'REJECT', 'EDIT', 'SUBMIT', 'APPROVE']);
  });

  it('GRR line referenced by a canceled GR cannot be deleted after recall', async () => {
    const { po, poLine } = await approvedPo(2);
    const grr = (await post(admin, '/goods-receipt-requests', { purchaseOrderId: po, warehouseId: hcmId, lines: [{ sourceLineId: poLine, quantity: 2 }] }).expect(201)).body.id;
    await approved('goods-receipt-requests', grr);
    const gr = (await post(admin, '/goods-receipts', { goodsReceiptRequestId: grr }).expect(201)).body.id;
    await post(admin, `/goods-receipts/${gr}/cancel`).expect(204);
    await post(admin, `/goods-receipt-requests/${grr}/recall`, { reason: 'Sửa' }).expect(204);
    const d = (await get(admin, `/goods-receipt-requests/${grr}`)).body;
    expect((await patch(admin, `/goods-receipt-requests/${grr}`, { version: d.version, lines: [{ sourceLineId: poLine, quantity: 1 }] }).expect(409)).body.code).toBe('RECORD_IN_USE');
    await patch(admin, `/goods-receipt-requests/${grr}`, { version: d.version, lines: [{ id: d.lines[0].id, sourceLineId: poLine, quantity: 1 }] }).expect(204);
  });
});
