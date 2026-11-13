import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { CurrentUser, IdentityService } from './modules/identity/auth';
import { hashPassword } from './modules/identity/password';
import { InboundService } from './modules/inbound/inbound.service';
import { ProcurementService } from './modules/procurement/procurement.service';
import { SalesContractsService } from './modules/sales-contracts/sales-contracts.service';
import { bootTestApp, login } from './test-utils';

/** Product lock, HĐ line products, GIR, GI and completion against real PostgreSQL. IDs refer to 05-ACCEPTANCE-TESTS. */
describe('Outbound: GIR → GI (integration)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let pm: string; // admin acts as PM / creator
  let sales: string; // approver acts as Sales / approver
  let manager: string; // warehouse manager for KTH
  let pmUser: CurrentUser;
  let salesUser: CurrentUser;
  let salesId: number;
  let managerId: number;
  let hcm: number;
  let kth: number; // "kho hàng thừa": allowed for AVAILABLE_STOCK
  let pcs: number;
  let router: number;
  let cable: number;
  let snSeq = 0;

  const http = () => request(app.getHttpServer());
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const post = (t: string, url: string, body: object = {}) => http().post(url).set(as(t)).send(body);
  const patch = (t: string, url: string, body: object) => http().patch(url).set(as(t)).send(body);
  const get = async (t: string, url: string) => (await http().get(url).set(as(t))).body;

  beforeAll(async () => {
    ({ app, ds } = await bootTestApp());
    pm = await login(app, process.env.SEED_ADMIN_USERNAME!, process.env.SEED_ADMIN_PASSWORD!);
    sales = await login(app, process.env.SEED_APPROVER_USERNAME!, process.env.SEED_APPROVER_PASSWORD!);
    [{ id: hcm }] = await ds.query(`SELECT id FROM warehouses WHERE code = 'HCM'`);
    [{ id: kth }] = await ds.query(`INSERT INTO warehouses (code, name, allow_available_stock_issue) VALUES ('KTH', 'Kho hàng thừa', true) RETURNING id`);
    [{ id: managerId }] = await ds.query(`INSERT INTO users (username, password_hash, full_name) VALUES ('manager', $1, 'Quản lý KTH') RETURNING id`, [await hashPassword('pw-manager')]);
    await ds.query(`INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE code = 'ADMIN'`, [managerId]);
    await ds.query(`INSERT INTO user_warehouses (user_id, warehouse_id) SELECT u.id, $1 FROM users u WHERE u.username IN ($2, $3, 'manager')`, [
      kth, process.env.SEED_ADMIN_USERNAME, process.env.SEED_APPROVER_USERNAME,
    ]);
    await ds.query(`INSERT INTO user_warehouses (user_id, warehouse_id) VALUES ($1, $2)`, [managerId, hcm]);
    manager = await login(app, 'manager', 'pw-manager');
    const identity = app.get(IdentityService);
    const idOf = async (u: string) => (await ds.query(`SELECT id FROM users WHERE username = $1`, [u]))[0].id;
    pmUser = (await identity.loadCurrentUser(await idOf(process.env.SEED_ADMIN_USERNAME!)))!;
    salesUser = (await identity.loadCurrentUser(await idOf(process.env.SEED_APPROVER_USERNAME!)))!;
    salesId = salesUser.id;
    [{ id: pcs }] = await ds.query(`SELECT id FROM units_of_measure WHERE code = 'PCS'`);
    router = (await post(pm, '/products', { partNumber: 'RT-1', name: 'Router', unitOfMeasureId: pcs }).expect(201)).body.id;
    cable = (await post(pm, '/products', { partNumber: 'CB-1', name: 'Cable', unitOfMeasureId: pcs, isSerialTracked: false }).expect(201)).body.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  /** ACTIVE HĐ with a router line and a cable line; products confirmed by Sales unless `confirm` is false. */
  async function contract(routerQty: number, cableQty: number, confirm = true) {
    const svc = app.get(SalesContractsService);
    const [{ id: cust }] = await ds.query(`INSERT INTO customers (code, name) VALUES ($1, 'C') RETURNING id`, [`C${Math.random()}`]);
    const sc = await svc.create(pmUser, cust, [
      { itemCode: 'R', itemName: 'Router', uomName: 'Cái', quantity: routerQty },
      { itemCode: 'C', itemName: 'Cable', uomName: 'Cái', quantity: cableQty },
    ]);
    await svc.activate(sc.id);
    const [r, c] = await ds.query(`SELECT id FROM sales_contract_lines WHERE sales_contract_id = $1 ORDER BY id`, [sc.id]);
    if (confirm) {
      for (const [line, product] of [[r.id, router], [c.id, cable]]) {
        const p = await svc.propose(pmUser, line, product, 'contract item');
        await svc.decide(salesUser, p.id, true, 'PL-01');
      }
    }
    return { id: sc.id, routerLine: r.id as number, cableLine: c.id as number };
  }

  /** Receives `routerSns` serial routers + `cableQty` cables into `warehouseId` via an approved GR. */
  async function receive(warehouseId: number, routerSns: number, cableQty: number): Promise<number[]> {
    const proc = app.get(ProcurementService);
    const inbound = app.get(InboundService);
    const sc = await contract(routerSns || 1, cableQty || 1, false);
    const lines = [
      ...(routerSns ? [{ salesContractLineId: sc.routerLine, productId: router, quantity: routerSns }] : []),
      ...(cableQty ? [{ salesContractLineId: sc.cableLine, productId: cable, quantity: cableQty }] : []),
    ];
    const pr = await proc.createPurchaseRequisition(pmUser, sc.id, lines);
    await proc.submit('PR', pr.id, pmUser, salesId);
    await proc.approve('PR', pr.id, salesUser);
    const prl = await ds.query(`SELECT id, quantity FROM purchase_requisition_lines WHERE purchase_requisition_id = $1`, [pr.id]);
    const [{ id: sup }] = await ds.query(`INSERT INTO suppliers (code, name) VALUES ($1, 'S') RETURNING id`, [`S${Math.random()}`]);
    const po = await proc.createPurchaseOrder(pmUser, sup, prl.map((l: { id: number; quantity: string }) => ({ sourceLineId: l.id, quantity: Number(l.quantity) })));
    await proc.submit('PO', po.id, pmUser, salesId);
    await proc.approve('PO', po.id, salesUser);
    const pol = await ds.query(`SELECT id, quantity FROM purchase_order_lines WHERE purchase_order_id = $1`, [po.id]);
    const grr = await inbound.createGrr(pmUser, po.id, warehouseId, pol.map((l: { id: number; quantity: string }) => ({ sourceLineId: l.id, quantity: Number(l.quantity) })));
    await inbound.submitGrr(grr.id, pmUser, salesId);
    await inbound.approveGrr(grr.id, salesUser);
    const gr = await inbound.createGr(pmUser, grr.id);
    const details: { id: number }[] = await ds.query(
      `SELECT d.id FROM goods_receipt_details d JOIN goods_receipt_lines l ON l.id = d.goods_receipt_line_id WHERE l.goods_receipt_id = $1 AND l.product_id = $2 ORDER BY d.id`,
      [gr.id, router],
    );
    await inbound.updateGrDetails(gr.id, pmUser, 1, details.map((d) => ({ id: d.id, serialNumber: `SN-${++snSeq}` })));
    await inbound.submitGr(gr.id, pmUser, salesId);
    await inbound.approveGr(gr.id, salesUser);
    return details.map((d) => d.id);
  }

  async function approvedGir(sc: { id: number; routerLine: number; cableLine: number }, routerQty: number, cableQty: number, warehouseId = hcm) {
    const lines = [
      ...(routerQty ? [{ salesContractLineId: sc.routerLine, productId: router, quantity: routerQty }] : []),
      ...(cableQty ? [{ salesContractLineId: sc.cableLine, productId: cable, quantity: cableQty }] : []),
    ];
    const gir = (await post(pm, '/goods-issue-requests', { issueType: 'SALES_CONTRACT', salesContractId: sc.id, warehouseId, lines }).expect(201)).body.id;
    await post(pm, `/goods-issue-requests/${gir}/submit`, { approverId: salesId }).expect(204);
    await post(sales, `/goods-issue-requests/${gir}/approve`).expect(204);
    const girLines = (await get(pm, `/goods-issue-requests/${gir}`)).lines;
    return { id: gir as number, routerLine: girLines.find((l: { productId: number }) => l.productId === router)?.id, cableLine: girLines.find((l: { productId: number }) => l.productId === cable)?.id };
  }

  const balance = async (warehouseId: number, productId: number) => {
    const [r] = await ds.query(`SELECT on_hand_quantity, reserved_quantity FROM inventories WHERE warehouse_id = $1 AND product_id = $2`, [warehouseId, productId]);
    return { onHand: Number(r?.on_hand_quantity ?? 0), reserved: Number(r?.reserved_quantity ?? 0) };
  };
  const serialStatus = async (detailId: number) => (await ds.query(`SELECT status FROM inventory_serials WHERE goods_receipt_detail_id = $1`, [detailId]))[0].status;
  const status = async (table: string, id: number) => (await ds.query(`SELECT approval_status FROM ${table} WHERE id = $1`, [id]))[0].approval_status;

  // ---------- Product lock ----------

  it('locks code, name and UoM once used; description stays editable; pending proposals do not lock (03 §1c, H06–H07, G13)', async () => {
    const fresh = (await post(pm, '/products', { partNumber: 'NEW-1', name: 'New', unitOfMeasureId: pcs })).body.id;
    const sc = await contract(5, 5, false);
    await post(pm, `/sales-contract-lines/${sc.routerLine}/product-proposals`, { productId: fresh, reason: 'substitute' }).expect(201);
    await patch(pm, `/products/${fresh}`, { name: 'Renamed while pending' }).expect(200); // G13

    await receive(hcm, 1, 0); // router is now on PR/GRR/GR
    expect((await patch(pm, `/products/${router}`, { name: 'Other' })).body.code).toBe('PRODUCT_IDENTITY_LOCKED');
    expect((await patch(pm, `/products/${router}`, { partNumber: 'RT-X' })).body.code).toBe('PRODUCT_IDENTITY_LOCKED');
    const [{ id: box }] = await ds.query(`INSERT INTO units_of_measure (code, name) VALUES ('BOX', 'Hộp') RETURNING id`);
    expect((await patch(pm, `/products/${router}`, { unitOfMeasureId: box })).body.code).toBe('PRODUCT_UOM_LOCKED');
    expect((await patch(pm, `/products/${router}`, { isSerialTracked: false })).body.code).toBe('SERIAL_TRACKING_LOCKED');
    await patch(pm, `/products/${router}`, { description: 'Updated description', isActive: true }).expect(200);
  });

  // ---------- HĐ line products + GIR ----------

  it('GIR Draft allows an unconfirmed product but Submit is blocked until Sales confirms (C08, C09, E11)', async () => {
    const sc = await contract(5, 5, false);
    const gir = (await post(pm, '/goods-issue-requests', {
      issueType: 'SALES_CONTRACT', salesContractId: sc.id, warehouseId: hcm, lines: [{ salesContractLineId: sc.routerLine, productId: router, quantity: 1 }],
    }).expect(201)).body.id;
    expect((await post(pm, `/goods-issue-requests/${gir}/submit`, { approverId: salesId })).body.code).toBe('PRODUCT_NOT_CONFIRMED');
    const proposal = (await post(pm, `/sales-contract-lines/${sc.routerLine}/product-proposals`, { productId: router, reason: 'as signed' }).expect(201)).body.id;
    await post(sales, `/product-proposals/${proposal}/approve`, { note: 'PL-02' }).expect(204);
    expect(await status('goods_issue_requests', gir)).toBe('DRAFT'); // never auto-submitted
    await post(pm, `/goods-issue-requests/${gir}/submit`, { approverId: salesId }).expect(204);
  });

  it('quota per HĐ line: blocks overflow, ignores CANCELED, serializes concurrent creates (C04, C05, C06, C07)', async () => {
    const sc = await contract(10, 10);
    const make = (qty: number) => post(pm, '/goods-issue-requests', {
      issueType: 'SALES_CONTRACT', salesContractId: sc.id, warehouseId: hcm, lines: [{ salesContractLineId: sc.routerLine, productId: router, quantity: qty }],
    });
    const results = await Promise.all([make(6), make(6)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 422]);
    expect(results.find((r) => r.status === 422)!.body.code).toBe('SALES_CONTRACT_QUOTA_EXCEEDED');
    const created = results.find((r) => r.status === 201)!.body.id;
    expect((await make(5)).body.code).toBe('SALES_CONTRACT_QUOTA_EXCEEDED'); // 6 + 5 > 10 (DRAFT counts)
    await post(pm, `/goods-issue-requests/${created}/cancel`).expect(204);
    await make(10).expect(201); // canceled GIR freed the quota
    // The cable line has its own quota (C06).
    await post(pm, '/goods-issue-requests', {
      issueType: 'SALES_CONTRACT', salesContractId: sc.id, warehouseId: hcm, lines: [{ salesContractLineId: sc.cableLine, productId: cable, quantity: 10 }],
    }).expect(201);
  });

  it('AVAILABLE_STOCK: allowed warehouse only, ≤ available stock, two sequential approvals (D12–D17)', async () => {
    await receive(kth, 0, 5);
    const sc = await contract(10, 10);
    const body = (warehouseId: number, qty: number) => ({
      issueType: 'AVAILABLE_STOCK', salesContractId: sc.id, warehouseId, lines: [{ salesContractLineId: sc.cableLine, productId: cable, quantity: qty }],
    });
    expect((await post(pm, '/goods-issue-requests', body(hcm, 1))).body.code).toBe('WAREHOUSE_NOT_ALLOWED_FOR_AVAILABLE_STOCK');
    expect((await post(pm, '/goods-issue-requests', body(kth, 6))).body.code).toBe('INSUFFICIENT_AVAILABLE_STOCK');
    const gir = (await post(pm, '/goods-issue-requests', body(kth, 5)).expect(201)).body.id;

    // Sales (step 1) must have GIR.SALES_CONFIRM; warehouse manager (step 2) must have the warehouse.
    await post(pm, `/goods-issue-requests/${gir}/submit`, { approverId: salesId, warehouseApproverId: managerId }).expect(204);
    expect((await post(manager, `/goods-issue-requests/${gir}/approve`)).body.code).toBe('NOT_ASSIGNED_APPROVER'); // D17
    await post(sales, `/goods-issue-requests/${gir}/approve`).expect(204);
    let detail = await get(pm, `/goods-issue-requests/${gir}`);
    expect([detail.approvalStatus, detail.approvalStep]).toEqual(['WAITING_FOR_APPROVE', 2]); // D15
    await post(manager, `/goods-issue-requests/${gir}/approve`).expect(204);
    detail = await get(pm, `/goods-issue-requests/${gir}`);
    expect(detail.approvalStatus).toBe('APPROVED'); // D16
    expect(detail.history.map((h: { action: string }) => h.action)).toEqual(['SUBMIT', 'CONFIRM', 'APPROVE']);
    expect((await balance(kth, cable)).reserved).toBe(0); // D19: GIR reserves nothing

    // D18: recall → Draft, resubmit starts again at Sales.
    await post(pm, `/goods-issue-requests/${gir}/recall`, { reason: 'reduce qty' }).expect(204);
    await post(pm, `/goods-issue-requests/${gir}/submit`, { approverId: salesId, warehouseApproverId: managerId }).expect(204);
    expect((await get(pm, `/goods-issue-requests/${gir}`)).approvalStep).toBe(1);
    // D20: rejection at the Sales step → REJECTED.
    await post(sales, `/goods-issue-requests/${gir}/reject`, { reason: 'not agreed with customer' }).expect(204);
    expect(await status('goods_issue_requests', gir)).toBe('REJECTED');
  });

  it('rejects stock re-check at final approval when available stock dropped (D14)', async () => {
    const [d1] = await receive(kth, 2, 0);
    const sc = await contract(10, 10);
    const avail = (await balance(kth, router)).onHand - (await balance(kth, router)).reserved;
    const gir = (await post(pm, '/goods-issue-requests', {
      issueType: 'AVAILABLE_STOCK', salesContractId: sc.id, warehouseId: kth, lines: [{ salesContractLineId: sc.routerLine, productId: router, quantity: avail }],
    }).expect(201)).body.id;
    await post(pm, `/goods-issue-requests/${gir}/submit`, { approverId: salesId, warehouseApproverId: managerId }).expect(204);
    await post(sales, `/goods-issue-requests/${gir}/approve`).expect(204);
    // Another GI reserves one router meanwhile.
    const other = await approvedGir(await contract(5, 5), 1, 0, kth);
    const gi = (await post(pm, '/goods-issues', { goodsIssueRequestId: other.id, lines: [{ goodsIssueRequestLineId: other.routerLine, quantity: 1, goodsReceiptDetailIds: [d1] }] }).expect(201)).body.id;
    await post(pm, `/goods-issues/${gi}/submit`, { approverId: salesId }).expect(204);
    expect((await post(manager, `/goods-issue-requests/${gir}/approve`)).body.code).toBe('INSUFFICIENT_AVAILABLE_STOCK');
    expect(await status('goods_issue_requests', gir)).toBe('WAITING_FOR_APPROVE');
  });

  // ---------- GI ----------

  it('Submit reserves quantity + SNs, Approve issues them, repeated approve is rejected (D04, D07)', async () => {
    const details = await receive(hcm, 2, 4);
    const before = { r: await balance(hcm, router), c: await balance(hcm, cable) };
    const gir = await approvedGir(await contract(5, 5), 2, 3);
    const gi = (await post(pm, '/goods-issues', {
      goodsIssueRequestId: gir.id,
      lines: [{ goodsIssueRequestLineId: gir.routerLine, quantity: 2, goodsReceiptDetailIds: details }, { goodsIssueRequestLineId: gir.cableLine, quantity: 3 }],
    }).expect(201)).body.id;
    expect((await balance(hcm, router)).reserved).toBe(before.r.reserved); // Draft does not reserve

    await post(pm, `/goods-issues/${gi}/submit`, { approverId: salesId }).expect(204);
    expect(await balance(hcm, router)).toEqual({ onHand: before.r.onHand, reserved: before.r.reserved + 2 });
    expect(await balance(hcm, cable)).toEqual({ onHand: before.c.onHand, reserved: before.c.reserved + 3 });
    expect(await serialStatus(details[0])).toBe('RESERVED');

    await post(sales, `/goods-issues/${gi}/approve`).expect(204);
    expect(await balance(hcm, router)).toEqual({ onHand: before.r.onHand - 2, reserved: before.r.reserved });
    expect(await balance(hcm, cable)).toEqual({ onHand: before.c.onHand - 3, reserved: before.c.reserved });
    expect(await serialStatus(details[0])).toBe('ISSUED');
    expect((await get(pm, `/goods-issue-requests/${gir.id}`)).executionStatus).toBe('IN_PROGRESS');
    const again = await post(sales, `/goods-issues/${gi}/approve`);
    expect([again.status, again.body.code]).toEqual([409, 'INVALID_STATUS']);
    expect((await balance(hcm, cable)).onHand).toBe(before.c.onHand - 3);
  });

  it('SN must match product + warehouse and not be reserved elsewhere (D06, D10)', async () => {
    const [hcmSn] = await receive(hcm, 1, 0);
    const [kthSn] = await receive(kth, 1, 0);
    const gir = await approvedGir(await contract(5, 5), 1, 0);
    const line = (ids: number[]) => ({ goodsIssueRequestId: gir.id, lines: [{ goodsIssueRequestLineId: gir.routerLine, quantity: 1, goodsReceiptDetailIds: ids }] });
    expect((await post(pm, '/goods-issues', line([kthSn]))).body.code).toBe('SN_NOT_AVAILABLE'); // wrong warehouse
    const g1 = (await post(pm, '/goods-issues', line([hcmSn])).expect(201)).body.id;
    const g2 = (await post(pm, '/goods-issues', line([hcmSn])).expect(201)).body.id; // Draft selection does not reserve
    await post(pm, `/goods-issues/${g1}/submit`, { approverId: salesId }).expect(204);
    const res = await post(pm, `/goods-issues/${g2}/submit`, { approverId: salesId });
    expect(res.body.code).toBe('GIR_QUANTITY_EXCEEDED'); // GIR line already fully committed by g1
    expect(await status('goods_issues', g2)).toBe('DRAFT'); // rolled back
  });

  it('two GIs competing for the last stock: exactly one reserves (D08) and failures roll back every line', async () => {
    await receive(kth, 0, 3);
    const avail = (await balance(kth, cable)).onHand - (await balance(kth, cable)).reserved;
    const g1 = await approvedGir(await contract(50, 50), 0, avail, kth);
    const g2 = await approvedGir(await contract(50, 50), 0, avail, kth);
    const gi1 = (await post(pm, '/goods-issues', { goodsIssueRequestId: g1.id, lines: [{ goodsIssueRequestLineId: g1.cableLine, quantity: avail }] })).body.id;
    const gi2 = (await post(pm, '/goods-issues', { goodsIssueRequestId: g2.id, lines: [{ goodsIssueRequestLineId: g2.cableLine, quantity: avail }] })).body.id;
    const before = await balance(kth, cable);
    const results = await Promise.all([post(pm, `/goods-issues/${gi1}/submit`, { approverId: salesId }), post(pm, `/goods-issues/${gi2}/submit`, { approverId: salesId })]);
    expect(results.map((r) => r.status).sort()).toEqual([204, 409]);
    expect(results.find((r) => r.status === 409)!.body.code).toBe('INSUFFICIENT_AVAILABLE_STOCK');
    expect((await balance(kth, cable)).reserved).toBe(before.reserved + avail); // never over-reserved
  });

  it('reject releases the reservation; cancel is only for Draft/Rejected (D07)', async () => {
    const [sn] = await receive(hcm, 1, 0);
    const gir = await approvedGir(await contract(5, 5), 1, 0);
    const gi = (await post(pm, '/goods-issues', { goodsIssueRequestId: gir.id, lines: [{ goodsIssueRequestLineId: gir.routerLine, quantity: 1, goodsReceiptDetailIds: [sn] }] })).body.id;
    const before = await balance(hcm, router);
    await post(pm, `/goods-issues/${gi}/submit`, { approverId: salesId }).expect(204);
    expect((await post(pm, `/goods-issues/${gi}/cancel`)).body.code).toBe('INVALID_STATUS');
    expect((await post(pm, `/goods-issues/${gi}/approve`)).body.code).toBe('NOT_ASSIGNED_APPROVER'); // E05
    await post(sales, `/goods-issues/${gi}/reject`, { reason: 'wrong unit' }).expect(204);
    expect(await balance(hcm, router)).toEqual(before);
    expect(await serialStatus(sn)).toBe('IN_STOCK');
    await post(pm, `/goods-issues/${gi}/cancel`).expect(204);
  });

  // ---------- Completion ----------

  it('completion: blocks open GIs, needs a reason when short, frees unissued quota, blocks new GIs (C11–C13, C16, C19–C21)', async () => {
    await receive(hcm, 0, 10);
    const sc = await contract(10, 10);
    const gir = await approvedGir(sc, 0, 10);
    expect((await get(pm, `/goods-issue-requests/${gir.id}`)).executionStatus).toBe('NOT_STARTED');
    const gi = (await post(pm, '/goods-issues', { goodsIssueRequestId: gir.id, lines: [{ goodsIssueRequestLineId: gir.cableLine, quantity: 4 }] })).body.id;
    await post(pm, `/goods-issues/${gi}/submit`, { approverId: salesId }).expect(204);
    await post(sales, `/goods-issues/${gi}/approve`).expect(204);
    expect((await post(pm, `/goods-issue-requests/${gir.id}/recall`, { reason: 'x' })).body.code).toBe('GIR_HAS_GOODS_ISSUES'); // C16

    const draft = (await post(pm, '/goods-issues', { goodsIssueRequestId: gir.id, lines: [{ goodsIssueRequestLineId: gir.cableLine, quantity: 1 }] })).body.id;
    expect((await post(manager, `/goods-issue-requests/${gir.id}/complete`, { reason: 'x' })).body.code).toBe('GIR_HAS_OPEN_GOODS_ISSUES'); // C11
    await post(pm, `/goods-issues/${draft}/cancel`).expect(204);
    expect((await post(manager, `/goods-issue-requests/${gir.id}/complete`)).body.code).toBe('REASON_REQUIRED'); // C20
    await post(manager, `/goods-issue-requests/${gir.id}/complete`, { reason: 'Customer takes 4 only' }).expect(204);

    const detail = await get(pm, `/goods-issue-requests/${gir.id}`);
    expect([detail.approvalStatus, detail.executionStatus]).toEqual(['APPROVED', 'COMPLETED']); // C12
    const quota = await get(pm, `/sales-contracts/${sc.id}/gir-quota`);
    expect(Number(quota.find((q: { salesContractLineId: number }) => q.salesContractLineId === sc.cableLine).usedQuantity)).toBe(4);
    // 6 units are free again for a new GIR on the same HĐ line.
    await post(pm, '/goods-issue-requests', {
      issueType: 'SALES_CONTRACT', salesContractId: sc.id, warehouseId: hcm, lines: [{ salesContractLineId: sc.cableLine, productId: cable, quantity: 6 }],
    }).expect(201);
    expect((await post(pm, '/goods-issues', { goodsIssueRequestId: gir.id, lines: [{ goodsIssueRequestLineId: gir.cableLine, quantity: 1 }] })).body.code).toBe('GIR_COMPLETED'); // C13
  });
});
