import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { bootTestApp, login } from './test-utils';

/** HĐ lifecycle, product proposals, PR/PO/GRR workflow actions and role permissions, against real PostgreSQL. */
describe('Sales contracts and procurement documents (integration)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let admin: string;
  let approver: string;
  let approverId: number;
  let hcmId: number;
  let productId: number;
  let customerId: number;
  let supplierId: number;

  const http = () => request(app.getHttpServer());
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const post = (t: string, url: string, body: object = {}) => http().post(url).set(as(t)).send(body);
  const get = (t: string, url: string) => http().get(url).set(as(t));

  beforeAll(async () => {
    process.env.SEED_ROLE_USERS_PASSWORD = 'role-users-test';
    ({ app, ds } = await bootTestApp());
    admin = await login(app, process.env.SEED_ADMIN_USERNAME!, process.env.SEED_ADMIN_PASSWORD!);
    approver = await login(app, process.env.SEED_APPROVER_USERNAME!, process.env.SEED_APPROVER_PASSWORD!);
    approverId = (await get(approver, '/auth/me')).body.id;
    [{ id: hcmId }] = await ds.query(`SELECT id FROM warehouses WHERE code = 'HCM'`);
    const [{ id: pcs }] = await ds.query(`SELECT id FROM units_of_measure WHERE code = 'PCS'`);
    productId = (await post(admin, '/products', { partNumber: 'PN-P1', name: 'Switch', unitOfMeasureId: pcs, isSerialTracked: false }).expect(201)).body.id;
    customerId = (await post(admin, '/customers', { code: 'C1', name: 'Customer 1' }).expect(201)).body.id;
    supplierId = (await post(admin, '/suppliers', { code: 'S1', name: 'Supplier 1' }).expect(201)).body.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  async function activeContract(qty = 10) {
    const sc = (await post(admin, '/sales-contracts', { customerId, responsibleSalesUserId: (await get(admin, '/auth/me')).body.id, lines: [{ itemCode: 'SW', itemName: 'Switch 24 port', uomName: 'Cái', quantity: qty }] }).expect(201)).body.id;
    await post(admin, `/sales-contracts/${sc}/activate`).expect(204);
    const [line] = (await get(admin, `/sales-contracts/${sc}`).expect(200)).body.lines;
    return { sc: sc as number, lineId: line.id as number };
  }

  async function approved(path: string, id: number) {
    await post(admin, `/${path}/${id}/submit`, { approverId }).expect(204);
    await post(approver, `/${path}/${id}/approve`).expect(204);
  }

  it('HĐ: unknown customer is rejected; detail returns lines; cancel blocked while a PR is not canceled (03 §9.1)', async () => {
    expect((await post(admin, '/sales-contracts', { customerId: 999999, lines: [{ itemCode: 'X', itemName: 'X', uomName: 'Cái', quantity: 1 }] })).body.code).toBe('CUSTOMER_NOT_FOUND');
    const { sc, lineId } = await activeContract();
    const detail = (await get(admin, `/sales-contracts/${sc}`).expect(200)).body;
    expect(detail).toMatchObject({ status: 'ACTIVE', customerName: 'Customer 1' });
    const pr = (await post(admin, '/purchase-requisitions', { salesContractId: sc, lines: [{ salesContractLineId: lineId, productId, quantity: 2 }] }).expect(201)).body.id;
    expect((await post(admin, `/sales-contracts/${sc}/cancel`).expect(409)).body.code).toBe('SALES_CONTRACT_IN_USE');
    await post(admin, `/purchase-requisitions/${pr}/cancel`).expect(204);
    await post(admin, `/sales-contracts/${sc}/cancel`).expect(204);
    expect((await post(admin, `/sales-contracts/${sc}/cancel`).expect(409)).body.code).toBe('INVALID_STATUS');
  });

  it('Proposal: PM proposes, Sales confirms; roles cannot act outside their permissions', async () => {
    const pm = await login(app, 'pm', 'role-users-test');
    const sales = await login(app, 'sales', 'role-users-test');
    const { sc, lineId } = await activeContract();
    const proposal = (await post(pm, `/sales-contract-lines/${lineId}/product-proposals`, { productId, reason: 'Hàng thay thế' }).expect(201)).body.id;
    await post(pm, `/product-proposals/${proposal}/approve`).expect(403); // PM cannot confirm in place of Sales (04 §2)
    await post(sales, `/sales-contract-lines/${lineId}/product-proposals`, { productId, reason: 'x' }).expect(403);
    await post(sales, `/product-proposals/${proposal}/approve`, { note: 'PL-01' }).expect(204);
    const [line] = (await get(pm, `/sales-contracts/${sc}`).expect(200)).body.lines;
    expect(line.products[0]).toMatchObject({ status: 'APPROVED', decisionNote: 'PL-01', decidedByName: 'Nhân viên Sales' });
    await post(sales, '/purchase-requisitions', { salesContractId: sc, lines: [] }).expect(403);
  });

  it('PR: list/detail, reject needs a reason, rejected PR can be canceled', async () => {
    const { sc, lineId } = await activeContract();
    const pr = (await post(admin, '/purchase-requisitions', { salesContractId: sc, lines: [{ salesContractLineId: lineId, productId, quantity: 3 }] }).expect(201)).body.id;
    await post(admin, `/purchase-requisitions/${pr}/submit`, { approverId }).expect(204);
    expect((await get(approver, '/purchase-requisitions?assignedToMe=true').expect(200)).body.map((r: { id: number }) => r.id)).toContain(pr);
    await post(approver, `/purchase-requisitions/${pr}/reject`, {}).expect(400);
    await post(approver, `/purchase-requisitions/${pr}/reject`, { reason: 'Sai số lượng' }).expect(204);
    const detail = (await get(admin, `/purchase-requisitions/${pr}`).expect(200)).body;
    expect(detail).toMatchObject({ approvalStatus: 'REJECTED', salesContractNumber: expect.stringMatching(/^SC-/) });
    expect(detail.lines[0]).toMatchObject({ partNumber: 'PN-P1', ref: 'Switch 24 port' });
    expect(detail.history.map((h: { action: string }) => h.action)).toEqual(['SUBMIT', 'REJECT']);
    await post(admin, `/purchase-requisitions/${pr}/cancel`).expect(204);
  });

  it('Approved PR/PO/GRR: recall or cancel only without non-canceled child documents (03 §6)', async () => {
    const { sc, lineId } = await activeContract();
    const pr = (await post(admin, '/purchase-requisitions', { salesContractId: sc, lines: [{ salesContractLineId: lineId, productId, quantity: 5 }] }).expect(201)).body.id;
    await approved('purchase-requisitions', pr);
    const avail = (await get(admin, '/purchase-requisition-lines/available-for-po').expect(200)).body.find((l: { prNumber: string }) => l.prNumber.startsWith('PR-'));
    const prLine = (await get(admin, `/purchase-requisitions/${pr}`)).body.lines[0].id;
    expect(Number((await get(admin, '/purchase-requisition-lines/available-for-po')).body.find((l: { id: number }) => l.id === prLine).remaining)).toBe(5);
    expect(avail).toBeDefined();

    const po = (await post(admin, '/purchase-orders', { supplierId, lines: [{ sourceLineId: prLine, quantity: 5 }] }).expect(201)).body.id;
    expect((await post(admin, `/purchase-requisitions/${pr}/recall`, { reason: 'Đổi nhà cung cấp' }).expect(409)).body.code).toBe('HAS_ACTIVE_CHILD_DOCUMENTS');
    await approved('purchase-orders', po);
    expect((await get(admin, '/purchase-requisition-lines/available-for-po')).body.some((l: { id: number }) => l.id === prLine)).toBe(false);

    const poLine = (await get(admin, `/purchase-orders/${po}/lines-available-for-grr`).expect(200)).body[0];
    expect(Number(poLine.remaining)).toBe(5);
    const grr = (await post(admin, '/goods-receipt-requests', { purchaseOrderId: po, warehouseId: hcmId, lines: [{ sourceLineId: poLine.id, quantity: 5 }] }).expect(201)).body.id;
    await approved('goods-receipt-requests', grr);
    expect((await post(admin, `/purchase-orders/${po}/cancel`, { reason: 'x' }).expect(409)).body.code).toBe('HAS_ACTIVE_CHILD_DOCUMENTS');

    const gr = (await post(admin, '/goods-receipts', { goodsReceiptRequestId: grr }).expect(201)).body.id;
    expect((await post(admin, `/goods-receipt-requests/${grr}/recall`, { reason: 'x' }).expect(409)).body.code).toBe('HAS_ACTIVE_CHILD_DOCUMENTS');
    expect((await get(admin, `/goods-receipt-requests/${grr}`).expect(200)).body.children).toMatchObject([{ id: gr, approvalStatus: 'DRAFT' }]);

    // Unwind bottom-up: GR → GRR → PO → PR, each allowed once its children are canceled.
    await post(admin, `/goods-receipts/${gr}/cancel`).expect(204);
    expect((await post(admin, `/goods-receipt-requests/${grr}/cancel`).expect(422)).body.code).toBe('REASON_REQUIRED'); // APPROVED cancel needs a reason
    await post(admin, `/goods-receipt-requests/${grr}/cancel`, { reason: 'Nhầm kho' }).expect(204);
    await post(admin, `/purchase-orders/${po}/recall`, { reason: 'Sửa giá' }).expect(204);
    expect((await get(admin, `/purchase-orders/${po}`)).body.approvalStatus).toBe('DRAFT');
    await post(admin, `/purchase-orders/${po}/cancel`).expect(204);
    await post(admin, `/purchase-requisitions/${pr}/recall`, { reason: 'Đổi nhà cung cấp' }).expect(204);
    expect((await get(admin, `/purchase-requisitions/${pr}`)).body.history.map((h: { action: string }) => h.action)).toEqual(['SUBMIT', 'APPROVE', 'RECALL']);
  });

  it('GRR list is warehouse-scoped; GRR approve/reject only by the assigned approver', async () => {
    const { sc, lineId } = await activeContract();
    const pr = (await post(admin, '/purchase-requisitions', { salesContractId: sc, lines: [{ salesContractLineId: lineId, productId, quantity: 1 }] }).expect(201)).body.id;
    await approved('purchase-requisitions', pr);
    const prLine = (await get(admin, `/purchase-requisitions/${pr}`)).body.lines[0].id;
    const po = (await post(admin, '/purchase-orders', { supplierId, lines: [{ sourceLineId: prLine, quantity: 1 }] }).expect(201)).body.id;
    await approved('purchase-orders', po);
    const poLine = (await get(admin, `/purchase-orders/${po}/lines-available-for-grr`)).body[0].id;
    const grr = (await post(admin, '/goods-receipt-requests', { purchaseOrderId: po, warehouseId: hcmId, lines: [{ sourceLineId: poLine, quantity: 1 }] }).expect(201)).body.id;
    await post(admin, `/goods-receipt-requests/${grr}/submit`, { approverId }).expect(204);
    const warehouse = await login(app, 'warehouse', 'role-users-test');
    expect((await post(warehouse, `/goods-receipt-requests/${grr}/approve`).expect(403)).body.code).toBe('NOT_ASSIGNED_APPROVER');
    expect((await get(warehouse, '/goods-receipt-requests').expect(200)).body.some((r: { id: number }) => r.id === grr)).toBe(true);
    await post(approver, `/goods-receipt-requests/${grr}/reject`, { reason: 'Thiếu chứng từ' }).expect(204);
    expect((await get(admin, `/goods-receipt-requests/${grr}`)).body.approvalStatus).toBe('REJECTED');
  });
});
