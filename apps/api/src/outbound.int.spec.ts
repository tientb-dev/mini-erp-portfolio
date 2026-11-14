import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { CurrentUser, IdentityService } from './modules/identity/auth';
import { hashPassword } from './modules/identity/password';
import { InboundService } from './modules/inbound/inbound.service';
import { InventoryFacade } from './modules/inventory/inventory.service';
import { ProcurementService } from './modules/procurement/procurement.service';
import { SalesContractsService } from './modules/sales-contracts/sales-contracts.service';
import { RECONCILE_SQL } from './database/migrations/1732060800000-LotAllocations';
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
    const sc = await svc.create(pmUser, cust, salesId, [
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

  type Contract = { id: number; routerLine: number; cableLine: number };
  /**
   * Receives `routerSns` serial routers + `cableQty` cables into `warehouseId` via an approved GR, bought for `into`
   * (the HĐ whose GIRs may issue them, ADR-0013) or for a fresh HĐ of its own.
   */
  async function receive(warehouseId: number, routerSns: number, cableQty: number, into?: Contract): Promise<number[]> {
    const proc = app.get(ProcurementService);
    const inbound = app.get(InboundService);
    const sc = into ?? await contract(routerSns || 1, cableQty || 1, false);
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

  /**
   * An APPROVED PR of `sc` fully ordered on an APPROVED PO (`PO done`, CT1) with a router and/or cable line.
   * Sales goods keep their HĐ line; materials have none.
   */
  async function poDonePr(sc: Contract, routerQty: number, cableQty: number, category: 'SALES_GOODS' | 'MATERIAL' = 'SALES_GOODS') {
    const proc = app.get(ProcurementService);
    const hd = (line: number) => (category === 'SALES_GOODS' ? line : null);
    const pr = await proc.createPurchaseRequisition(pmUser, sc.id, [
      ...(routerQty ? [{ salesContractLineId: hd(sc.routerLine), productId: router, quantity: routerQty }] : []),
      ...(cableQty ? [{ salesContractLineId: hd(sc.cableLine), productId: cable, quantity: cableQty }] : []),
    ], category);
    await proc.submit('PR', pr.id, pmUser, salesId);
    await proc.approve('PR', pr.id, salesUser);
    const prl: { id: number; product_id: number; quantity: string }[] = await ds.query(
      `SELECT id, product_id, quantity FROM purchase_requisition_lines WHERE purchase_requisition_id = $1 ORDER BY id`, [pr.id]);
    const [{ id: sup }] = await ds.query(`INSERT INTO suppliers (code, name) VALUES ($1, 'S') RETURNING id`, [`S${Math.random()}`]);
    const po = await proc.createPurchaseOrder(pmUser, sup, prl.map((l) => ({ sourceLineId: l.id, quantity: Number(l.quantity) })));
    await proc.submit('PO', po.id, pmUser, salesId);
    await proc.approve('PO', po.id, salesUser);
    return { id: pr.id, poId: po.id, routerLine: prl.find((l) => l.product_id === router)?.id as number, cableLine: prl.find((l) => l.product_id === cable)?.id as number };
  }
  type PoDonePr = Awaited<ReturnType<typeof poDonePr>>;

  /** A/C GIR (PURCHASE_REQUISITION) on lines of `pr` (a fresh PO-done PR of `sc` when omitted). */
  const prGirBody = (sc: Contract, pr: PoDonePr, routerQty: number, cableQty: number, warehouseId = hcm) => ({
    issueType: 'PURCHASE_REQUISITION', salesContractId: sc.id, warehouseId,
    lines: [
      ...(routerQty ? [{ purchaseRequisitionLineId: pr.routerLine, quantity: routerQty }] : []),
      ...(cableQty ? [{ purchaseRequisitionLineId: pr.cableLine, quantity: cableQty }] : []),
    ],
  });

  async function approvedGir(sc: Contract, routerQty: number, cableQty: number, warehouseId = hcm, pr?: PoDonePr) {
    const source = pr ?? await poDonePr(sc, routerQty, cableQty);
    const gir = (await post(pm, '/goods-issue-requests', prGirBody(sc, source, routerQty, cableQty, warehouseId)).expect(201)).body.id;
    await post(pm, `/goods-issue-requests/${gir}/submit`, { approverId: salesId }).expect(204);
    await post(sales, `/goods-issue-requests/${gir}/approve`).expect(204);
    const girLines = (await get(pm, `/goods-issue-requests/${gir}`)).lines;
    return {
      id: gir as number, pr: source,
      routerLine: girLines.find((l: { productId: number }) => l.productId === router)?.id, cableLine: girLines.find((l: { productId: number }) => l.productId === cable)?.id,
    };
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
    const gir = (await post(pm, '/goods-issue-requests', prGirBody(sc, await poDonePr(sc, 1, 0), 1, 0)).expect(201)).body.id;
    expect((await post(pm, `/goods-issue-requests/${gir}/submit`, { approverId: salesId })).body.code).toBe('PRODUCT_NOT_CONFIRMED');
    const proposal = (await post(pm, `/sales-contract-lines/${sc.routerLine}/product-proposals`, { productId: router, reason: 'as signed' }).expect(201)).body.id;
    await post(sales, `/product-proposals/${proposal}/approve`, { note: 'PL-02' }).expect(204);
    expect(await status('goods_issue_requests', gir)).toBe('DRAFT'); // never auto-submitted
    await post(pm, `/goods-issue-requests/${gir}/submit`, { approverId: salesId }).expect(204);
  });

  it('HĐ-line quota (CT2): DRAFT may exceed and holds nothing; submit/approve check it; WAITING/REJECTED/APPROVED hold it, CANCELED frees it (C04–C07, C50–C55)', async () => {
    const sc = await contract(10, 10);
    const pr = await poDonePr(sc, 30, 10); // PR lines larger than the HĐ lines: the HĐ quota is what binds here
    const make = async (qty: number) => (await post(pm, '/goods-issue-requests', prGirBody(sc, pr, qty, 0)).expect(201)).body.id as number;
    const submit = (id: number) => post(pm, `/goods-issue-requests/${id}/submit`, { approverId: salesId });
    const used = async () => Number((await get(pm, `/sales-contracts/${sc.id}/gir-quota`)).find((q: { salesContractLineId: number }) => q.salesContractLineId === sc.routerLine).usedQuantity);

    const over = await make(11); // C50: a DRAFT above the whole HĐ line is saved
    const a = await make(6);
    const b = await make(6);
    expect(await used()).toBe(0); // DRAFTs hold nothing
    expect((await submit(over)).body.code).toBe('SALES_CONTRACT_QUOTA_EXCEEDED');
    await submit(a).expect(204);
    expect(await used()).toBe(6); // WAITING holds
    expect((await submit(b)).body.code).toBe('SALES_CONTRACT_QUOTA_EXCEEDED'); // C51: 6 + 6 > 10
    expect(await status('goods_issue_requests', b)).toBe('DRAFT');

    await post(sales, `/goods-issue-requests/${a}/reject`, { reason: 'x' }).expect(204);
    expect(await used()).toBe(6); // C54: REJECTED still holds
    expect((await submit(b)).body.code).toBe('SALES_CONTRACT_QUOTA_EXCEEDED');
    // C52/C53: editing the REJECTED GIR does not count its own old quantity twice.
    const aVersion = (await get(pm, `/goods-issue-requests/${a}`)).version;
    const edit = (qty: number, version: number) => patch(pm, `/goods-issue-requests/${a}`, { version, lines: [{ purchaseRequisitionLineId: pr.routerLine, quantity: qty }] });
    await edit(4, aVersion).expect(204);
    await submit(a).expect(204); // 4 alone ≤ 10
    await post(sales, `/goods-issue-requests/${a}/approve`).expect(204);
    expect(await used()).toBe(4); // APPROVED holds
    await submit(b).expect(204); // 4 + 6 = 10
    await post(sales, `/goods-issue-requests/${b}/reject`, { reason: 'y' }).expect(204);
    await post(pm, `/goods-issue-requests/${b}/cancel`).expect(204);
    expect(await used()).toBe(4); // CANCELED frees

    // The cable line has its own quota (C06).
    const cable10 = (await post(pm, '/goods-issue-requests', prGirBody(sc, pr, 0, 10)).expect(201)).body.id;
    await submit(cable10).expect(204);
  });

  it('HĐ-line quota is re-checked at approve: a GIR submitted when it fit is not approved once others took the quota (C55)', async () => {
    const sc = await contract(10, 10);
    const pr = await poDonePr(sc, 20, 0);
    const g1 = (await post(pm, '/goods-issue-requests', prGirBody(sc, pr, 6, 0)).expect(201)).body.id;
    await post(pm, `/goods-issue-requests/${g1}/submit`, { approverId: salesId }).expect(204);
    // Another GIR slipped in through a direct status change (e.g. legacy data): the approve check must still hold.
    const g2 = (await post(pm, '/goods-issue-requests', prGirBody(sc, pr, 6, 0)).expect(201)).body.id;
    await ds.query(`UPDATE goods_issue_requests SET approval_status = 'APPROVED' WHERE id = $1`, [g2]);
    expect((await post(sales, `/goods-issue-requests/${g1}/approve`)).body.code).toBe('SALES_CONTRACT_QUOTA_EXCEEDED');
    expect(await status('goods_issue_requests', g1)).toBe('WAITING_FOR_APPROVE');
  });

  it('concurrent submits on one HĐ line never exceed it', async () => {
    const sc = await contract(10, 10);
    const pr = await poDonePr(sc, 30, 0);
    const ids: number[] = [];
    for (let i = 0; i < 3; i++) ids.push((await post(pm, '/goods-issue-requests', prGirBody(sc, pr, 4, 0)).expect(201)).body.id);
    const res = await Promise.all(ids.map((id) => post(pm, `/goods-issue-requests/${id}/submit`, { approverId: salesId })));
    expect(res.map((r) => r.status).sort()).toEqual([204, 204, 422]); // 3 × 4 > 10
    expect(res.find((r) => r.status === 422)!.body.code).toBe('SALES_CONTRACT_QUOTA_EXCEEDED');
    expect(Number((await get(pm, `/sales-contracts/${sc.id}/gir-quota`)).find((q: { salesContractLineId: number }) => q.salesContractLineId === sc.routerLine).usedQuantity))
      .toBe(8);
  });

  it('A and B share the HĐ-line quota; materials never use it (C55, ADR-0012)', async () => {
    const sc = await contract(10, 10);
    const wh = await isolatedWarehouse('QB1'); // own warehouse: other tests rely on KTH stock
    await ds.query(`UPDATE warehouses SET allow_available_stock_issue = true WHERE id = $1`, [wh]);
    await ds.query(`INSERT INTO user_warehouses (user_id, warehouse_id) VALUES ($1, $2)`, [managerId, wh]);
    await receive(wh, 0, 20, sc); // stock for the available-stock (B) request
    const a = await approvedGir(sc, 0, 7); // A holds 7 of 10
    expect(a.id).toBeGreaterThan(0);
    const b = (await post(pm, '/goods-issue-requests', {
      issueType: 'AVAILABLE_STOCK', salesContractId: sc.id, warehouseId: wh, lines: [{ salesContractLineId: sc.cableLine, productId: cable, quantity: 4 }],
    }).expect(201)).body.id; // saved as DRAFT although 7 + 4 > 10
    expect((await post(pm, `/goods-issue-requests/${b}/submit`, { approverId: salesId, warehouseApproverId: managerId })).body.code).toBe('SALES_CONTRACT_QUOTA_EXCEEDED');
    const b3 = (await post(pm, '/goods-issue-requests', {
      issueType: 'AVAILABLE_STOCK', salesContractId: sc.id, warehouseId: wh, lines: [{ salesContractLineId: sc.cableLine, productId: cable, quantity: 3 }],
    }).expect(201)).body.id;
    await post(pm, `/goods-issue-requests/${b3}/submit`, { approverId: salesId, warehouseApproverId: managerId }).expect(204); // 7 + 3 = 10

    const material = await poDonePr(sc, 0, 50, 'MATERIAL');
    const m = (await post(pm, '/goods-issue-requests', prGirBody(sc, material, 0, 50)).expect(201)).body.id;
    await post(pm, `/goods-issue-requests/${m}/submit`, { approverId: salesId }).expect(204); // HĐ line is full, materials are not counted
    expect(Number((await get(pm, `/sales-contracts/${sc.id}/gir-quota`)).find((q: { salesContractLineId: number }) => q.salesContractLineId === sc.cableLine).usedQuantity))
      .toBe(10);
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
    const otherSc = await contract(5, 5);
    const [d1] = await receive(kth, 2, 0, otherSc);
    const sc = await contract(10, 10);
    const avail = (await balance(kth, router)).onHand - (await balance(kth, router)).reserved;
    const gir = (await post(pm, '/goods-issue-requests', {
      issueType: 'AVAILABLE_STOCK', salesContractId: sc.id, warehouseId: kth, lines: [{ salesContractLineId: sc.routerLine, productId: router, quantity: avail }],
    }).expect(201)).body.id;
    await post(pm, `/goods-issue-requests/${gir}/submit`, { approverId: salesId, warehouseApproverId: managerId }).expect(204);
    await post(sales, `/goods-issue-requests/${gir}/approve`).expect(204);
    // Another GI reserves one router meanwhile.
    const other = await approvedGir(otherSc, 1, 0, kth);
    const gi = (await post(pm, '/goods-issues', { goodsIssueRequestId: other.id, lines: [{ goodsIssueRequestLineId: other.routerLine, quantity: 1, goodsReceiptDetailIds: [d1] }] }).expect(201)).body.id;
    await post(pm, `/goods-issues/${gi}/submit`, { approverId: salesId }).expect(204);
    expect((await post(manager, `/goods-issue-requests/${gir}/approve`)).body.code).toBe('INSUFFICIENT_AVAILABLE_STOCK');
    expect(await status('goods_issue_requests', gir)).toBe('WAITING_FOR_APPROVE');
  });

  // ---------- GI ----------

  it('Submit reserves quantity + SNs, Approve issues them, repeated approve is rejected (D04, D07)', async () => {
    const sc = await contract(5, 5);
    const details = await receive(hcm, 2, 4, sc);
    const before = { r: await balance(hcm, router), c: await balance(hcm, cable) };
    const gir = await approvedGir(sc, 2, 3);
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
    const sc = await contract(5, 5);
    const [hcmSn] = await receive(hcm, 1, 0, sc);
    const [kthSn] = await receive(kth, 1, 0, sc);
    const gir = await approvedGir(sc, 1, 0);
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
    const sc = await contract(50, 50);
    await receive(kth, 0, 3, sc);
    const avail = 3; // everything this HĐ owns in KTH
    const g1 = await approvedGir(sc, 0, avail, kth);
    const g2 = await approvedGir(sc, 0, avail, kth);
    const gi1 = (await post(pm, '/goods-issues', { goodsIssueRequestId: g1.id, lines: [{ goodsIssueRequestLineId: g1.cableLine, quantity: avail }] })).body.id;
    const gi2 = (await post(pm, '/goods-issues', { goodsIssueRequestId: g2.id, lines: [{ goodsIssueRequestLineId: g2.cableLine, quantity: avail }] })).body.id;
    const before = await balance(kth, cable);
    const results = await Promise.all([post(pm, `/goods-issues/${gi1}/submit`, { approverId: salesId }), post(pm, `/goods-issues/${gi2}/submit`, { approverId: salesId })]);
    expect(results.map((r) => r.status).sort()).toEqual([204, 409]);
    expect(results.find((r) => r.status === 409)!.body.code).toBe('INSUFFICIENT_AVAILABLE_STOCK');
    expect((await balance(kth, cable)).reserved).toBe(before.reserved + avail); // never over-reserved
  });

  it('reject releases the reservation; cancel is only for Draft/Rejected (D07)', async () => {
    const sc = await contract(5, 5);
    const [sn] = await receive(hcm, 1, 0, sc);
    const gir = await approvedGir(sc, 1, 0);
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

  // ---------- Lots: FIFO allocation (ADR-0013, PR 4) ----------

  /** A warehouse of its own so lot order is fully controlled by the test. */
  async function isolatedWarehouse(code: string) {
    const [{ id }] = await ds.query(`INSERT INTO warehouses (code, name) VALUES ($1, $1) RETURNING id`, [code]);
    await ds.query(`INSERT INTO user_warehouses (user_id, warehouse_id) SELECT u.id, $1 FROM users u WHERE u.username IN ($2, $3)`, [
      id, process.env.SEED_ADMIN_USERNAME, process.env.SEED_APPROVER_USERNAME,
    ]);
    const identity = app.get(IdentityService); // service-level users cache their warehouse list
    pmUser = (await identity.loadCurrentUser(pmUser.id))!;
    salesUser = (await identity.loadCurrentUser(salesUser.id))!;
    return id as number;
  }
  const lotsOf = async (warehouseId: number) =>
    (await ds.query(`SELECT id, on_hand_quantity, reserved_quantity FROM inventory_lots WHERE warehouse_id = $1 AND product_id = $2 ORDER BY approved_at, id`, [warehouseId, cable]))
      .map((l: { id: number; on_hand_quantity: string; reserved_quantity: string }) => ({ id: l.id, onHand: Number(l.on_hand_quantity), reserved: Number(l.reserved_quantity) }));
  const allocationsOf = async (giId: number) =>
    (await ds.query(`SELECT a.inventory_lot_id AS lot, a.quantity FROM goods_issue_line_allocations a JOIN goods_issue_lines l ON l.id = a.goods_issue_line_id
                      WHERE l.goods_issue_id = $1 ORDER BY a.inventory_lot_id`, [giId]))
      .map((a: { lot: number; quantity: string }) => [a.lot, Number(a.quantity)]);
  const cableGi = async (wh: number, qty: number, sc: Contract) => {
    const gir = await approvedGir(sc, 0, qty, wh);
    return (await post(pm, '/goods-issues', { goodsIssueRequestId: gir.id, lines: [{ goodsIssueRequestLineId: gir.cableLine, quantity: qty }] }).expect(201)).body.id as number;
  };

  it('FIFO by GR approval time: submit allocates and reserves lots, approve consumes them without recomputing (C73)', async () => {
    const wh = await isolatedWarehouse('FIFO1');
    const sc = await contract(50, 50);
    await receive(wh, 0, 3, sc); // GR1 approved first
    await receive(wh, 0, 5, sc); // GR2 approved later
    const [lot1, lot2] = await lotsOf(wh);

    const gi = await cableGi(wh, 4, sc);
    expect(await allocationsOf(gi)).toEqual([]); // Draft allocates nothing
    await post(pm, `/goods-issues/${gi}/submit`, { approverId: salesId }).expect(204);
    expect(await allocationsOf(gi)).toEqual([[lot1.id, 3], [lot2.id, 1]]); // 3 from GR1, then 1 from GR2
    expect(await lotsOf(wh)).toEqual([{ ...lot1, reserved: 3 }, { ...lot2, reserved: 1 }]);

    // Make GR2 look older: approve must still consume the lots reserved at submit.
    await ds.query(`UPDATE inventory_lots SET approved_at = approved_at - interval '1 day' WHERE id = $1`, [lot2.id]);
    await post(sales, `/goods-issues/${gi}/approve`).expect(204);
    const after = new Map((await lotsOf(wh)).map((l: { id: number }) => [l.id, l]));
    expect(after.get(lot1.id)).toEqual({ id: lot1.id, onHand: 0, reserved: 0 });
    expect(after.get(lot2.id)).toEqual({ id: lot2.id, onHand: 4, reserved: 0 });
    expect(await allocationsOf(gi)).toEqual([[lot1.id, 3], [lot2.id, 1]]); // kept as the issue trail
    expect(await ds.query(RECONCILE_SQL)).toEqual([]);
  });

  it('reject and recall release exactly the allocated lots; a later GI allocates again by FIFO', async () => {
    const wh = await isolatedWarehouse('FIFO2');
    const sc = await contract(50, 50);
    await receive(wh, 0, 2, sc);
    await receive(wh, 0, 4, sc);
    const [lot1, lot2] = await lotsOf(wh);
    const gi = await cableGi(wh, 3, sc);
    await post(pm, `/goods-issues/${gi}/submit`, { approverId: salesId }).expect(204);
    await post(sales, `/goods-issues/${gi}/reject`, { reason: 'x' }).expect(204);
    expect(await allocationsOf(gi)).toEqual([]);
    expect(await lotsOf(wh)).toEqual([lot1, lot2]);

    const gi2 = await cableGi(wh, 5, sc);
    await post(pm, `/goods-issues/${gi2}/submit`, { approverId: salesId }).expect(204);
    expect(await allocationsOf(gi2)).toEqual([[lot1.id, 2], [lot2.id, 3]]);
    await post(pm, `/goods-issues/${gi2}/recall`, { reason: 'y' }).expect(204);
    expect(await lotsOf(wh)).toEqual([lot1, lot2]);
    expect(await ds.query(RECONCILE_SQL)).toEqual([]);
  });

  it('serial lines are allocated to the lots their serials came from, not FIFO', async () => {
    const wh = await isolatedWarehouse('FIFO3');
    const sc = await contract(5, 5);
    await receive(wh, 1, 0, sc); // older router lot
    const [newer] = await receive(wh, 1, 0, sc);
    const gir = await approvedGir(sc, 1, 0, wh);
    const gi = (await post(pm, '/goods-issues', { goodsIssueRequestId: gir.id, lines: [{ goodsIssueRequestLineId: gir.routerLine, quantity: 1, goodsReceiptDetailIds: [newer] }] }).expect(201)).body.id;
    await post(pm, `/goods-issues/${gi}/submit`, { approverId: salesId }).expect(204);
    const [{ lot }] = await ds.query(`SELECT l.id AS lot FROM goods_receipt_details d JOIN inventory_lots l ON l.goods_receipt_line_id = d.goods_receipt_line_id WHERE d.id = $1`, [newer]);
    expect(await allocationsOf(gi)).toEqual([[lot, 1]]);
    expect(await ds.query(RECONCILE_SQL)).toEqual([]);
  });

  it('scope: only lots of the allowed source HĐ / sales are allocated; serials outside the scope are refused (C74)', async () => {
    const wh = await isolatedWarehouse('FIFO4');
    await receive(wh, 0, 3); // HĐ-X, older
    await receive(wh, 1, 4); // HĐ-Y, newer
    const lots: { id: number; source_sales_contract_id: number; product_id: number }[] = await ds.query(
      `SELECT id, source_sales_contract_id, product_id FROM inventory_lots WHERE warehouse_id = $1 ORDER BY approved_at, id`, [wh]);
    const [x, y] = lots.filter((l) => l.product_id === cable);
    const gi = await cableGi(wh, 2, await contract(50, 50));
    const [{ id: lineId }] = await ds.query(`SELECT id FROM goods_issue_lines WHERE goods_issue_id = $1`, [gi]);
    const allocateIn = (scope: { sourceSalesContractId?: number; ownerUserId?: number }, item: { productId: number; quantity: number; serialDetailIds: number[] }) =>
      ds.transaction(async (m) => {
        await InventoryFacade.reserve(m, wh, [{ ...item, sourceLineId: lineId }], scope);
        const rows = await m.query(`SELECT inventory_lot_id AS lot, quantity FROM goods_issue_line_allocations WHERE goods_issue_line_id = $1`, [lineId]);
        throw Object.assign(new Error('rollback'), { rows });
      }).catch((e: Error & { rows?: { lot: number; quantity: string }[] }) => {
        if (e.message !== 'rollback') throw e;
        return e.rows!.map((r) => [r.lot, Number(r.quantity)]);
      });

    expect(await allocateIn({}, { productId: cable, quantity: 2, serialDetailIds: [] })).toEqual([[x.id, 2]]); // FIFO over everything
    expect(await allocateIn({ sourceSalesContractId: y.source_sales_contract_id }, { productId: cable, quantity: 2, serialDetailIds: [] }))
      .toEqual([[y.id, 2]]); // HĐ-X lot is older but out of scope
    await expect(allocateIn({ sourceSalesContractId: x.source_sales_contract_id }, { productId: cable, quantity: 4, serialDetailIds: [] }))
      .rejects.toMatchObject({ code: 'INSUFFICIENT_AVAILABLE_STOCK' }); // 3 in scope, never borrows from HĐ-Y
    await expect(allocateIn({ ownerUserId: -1 }, { productId: cable, quantity: 1, serialDetailIds: [] })).rejects.toMatchObject({ code: 'INSUFFICIENT_AVAILABLE_STOCK' });
    const [ySn] = await ds.query(`SELECT d.id FROM goods_receipt_details d JOIN inventory_lots l ON l.goods_receipt_line_id = d.goods_receipt_line_id
                                   WHERE l.warehouse_id = $1 AND l.product_id = $2`, [wh, router]);
    await expect(allocateIn({ sourceSalesContractId: x.source_sales_contract_id }, { productId: router, quantity: 1, serialDetailIds: [ySn.id] }))
      .rejects.toMatchObject({ code: 'STOCK_OUT_OF_SCOPE' });
    expect(await ds.query(RECONCILE_SQL)).toEqual([]);
  });

  it('concurrent submits on the same lots never over-reserve a lot and allocate disjoint quantities', async () => {
    const wh = await isolatedWarehouse('FIFO5');
    const sc = await contract(50, 50);
    await receive(wh, 0, 3, sc);
    await receive(wh, 0, 3, sc);
    const gis = [await cableGi(wh, 2, sc), await cableGi(wh, 2, sc), await cableGi(wh, 2, sc), await cableGi(wh, 2, sc)];
    const res = await Promise.all(gis.map((g) => post(pm, `/goods-issues/${g}/submit`, { approverId: salesId })));
    expect(res.map((r) => r.status).sort()).toEqual([204, 204, 204, 409]); // 6 in stock, 4 × 2 requested
    const ok = gis.filter((_g, i) => res[i].status === 204);
    const total = (await Promise.all(ok.map(allocationsOf))).flat().reduce((s: number, [, q]: number[]) => s + q, 0);
    expect(total).toBe(6);
    expect((await lotsOf(wh)).map((l: { onHand: number; reserved: number }) => [l.onHand, l.reserved])).toEqual([[3, 3], [3, 3]]);
    // Approve and reject concurrently: lots end consistent.
    await Promise.all([post(sales, `/goods-issues/${ok[0]}/approve`), post(sales, `/goods-issues/${ok[1]}/reject`, { reason: 'x' }), post(sales, `/goods-issues/${ok[2]}/approve`)]);
    expect(await ds.query(RECONCILE_SQL)).toEqual([]);
  });

  it('GI inherits the GIR source: a GIR of HĐ-B never issues stock bought for HĐ-A, even when the warehouse has it (C69)', async () => {
    const wh = await isolatedWarehouse('SRC1');
    const a = await contract(50, 50);
    const b = await contract(50, 50);
    const [snA] = await receive(wh, 1, 5, a); // all stock in the warehouse belongs to HĐ-A
    const bulk = await cableGi(wh, 2, b);
    const res = await post(pm, `/goods-issues/${bulk}/submit`, { approverId: salesId });
    expect([res.status, res.body.code]).toEqual([409, 'INSUFFICIENT_AVAILABLE_STOCK']);
    expect(await status('goods_issues', bulk)).toBe('DRAFT'); // nothing reserved, rolled back
    expect(await allocationsOf(bulk)).toEqual([]);

    const girB = await approvedGir(b, 1, 0, wh);
    const serial = (await post(pm, '/goods-issues', { goodsIssueRequestId: girB.id, lines: [{ goodsIssueRequestLineId: girB.routerLine, quantity: 1, goodsReceiptDetailIds: [snA] }] })
      .expect(201)).body.id;
    const res2 = await post(pm, `/goods-issues/${serial}/submit`, { approverId: salesId });
    expect([res2.status, res2.body.code]).toEqual([409, 'STOCK_OUT_OF_SCOPE']);
    expect(await serialStatus(snA)).toBe('IN_STOCK');

    // Partly in scope: HĐ-B owns 1 of the 3 requested; the 5 of HĐ-A are never used to top it up.
    await receive(wh, 0, 1, b);
    const short = await cableGi(wh, 3, b);
    expect((await post(pm, `/goods-issues/${short}/submit`, { approverId: salesId })).body.code).toBe('INSUFFICIENT_AVAILABLE_STOCK');
    const ok = await cableGi(wh, 1, b);
    await post(pm, `/goods-issues/${ok}/submit`, { approverId: salesId }).expect(204);
    const [{ source }] = await ds.query(
      `SELECT DISTINCT l.source_sales_contract_id AS source FROM goods_issue_line_allocations a JOIN inventory_lots l ON l.id = a.inventory_lot_id
         JOIN goods_issue_lines gl ON gl.id = a.goods_issue_line_id WHERE gl.goods_issue_id = $1`, [ok]);
    expect(source).toBe(b.id);
    expect(await ds.query(RECONCILE_SQL)).toEqual([]);
  });

  it('GIR without a recorded stock source (AVAILABLE_STOCK until PR #7): GI submit is blocked, no fallback to warehouse + product', async () => {
    const sc = await contract(10, 10);
    await receive(kth, 0, 2, sc);
    const gir = (await post(pm, '/goods-issue-requests', {
      issueType: 'AVAILABLE_STOCK', salesContractId: sc.id, warehouseId: kth, lines: [{ salesContractLineId: sc.cableLine, productId: cable, quantity: 1 }],
    }).expect(201)).body.id;
    await post(pm, `/goods-issue-requests/${gir}/submit`, { approverId: salesId, warehouseApproverId: managerId }).expect(204);
    await post(sales, `/goods-issue-requests/${gir}/approve`).expect(204);
    await post(manager, `/goods-issue-requests/${gir}/approve`).expect(204);
    const [{ id: girLine }] = await ds.query(`SELECT id FROM goods_issue_request_lines WHERE goods_issue_request_id = $1`, [gir]);
    const gi = (await post(pm, '/goods-issues', { goodsIssueRequestId: gir, lines: [{ goodsIssueRequestLineId: girLine, quantity: 1 }] }).expect(201)).body.id;
    const before = await balance(kth, cable);
    const res = await post(pm, `/goods-issues/${gi}/submit`, { approverId: salesId });
    expect([res.status, res.body.code]).toEqual([409, 'GIR_SOURCE_SCOPE_MISSING']);
    expect(await status('goods_issues', gi)).toBe('DRAFT');
    expect(await balance(kth, cable)).toEqual(before);
    expect(await allocationsOf(gi)).toEqual([]);
  });

  // ---------- GIR A/C on PR lines (PR code #5) ----------

  it('A/C GIR is created, submitted and approved from PO-done PR lines before any receipt; no stock check (C62)', async () => {
    const wh = await isolatedWarehouse('AC1'); // empty warehouse
    const sc = await contract(5, 5);
    const pr = await poDonePr(sc, 2, 3);
    const options = (await get(pm, `/sales-contracts/${sc.id}/gir-pr-lines`)).filter((o: { purchaseRequisitionId: number }) => o.purchaseRequisitionId === pr.id);
    expect(options.map((o: { id: number; category: string; remainingQuantity: number; receivedQuantity: string }) => [o.id, o.category, o.remainingQuantity, Number(o.receivedQuantity)]))
      .toEqual([[pr.routerLine, 'SALES_GOODS', 2, 0], [pr.cableLine, 'SALES_GOODS', 3, 0]]);
    const gir = await approvedGir(sc, 2, 3, wh, pr);
    const detail = await get(pm, `/goods-issue-requests/${gir.id}`);
    expect([detail.issueType, detail.category, detail.approvalStatus]).toEqual(['PURCHASE_REQUISITION', 'SALES_GOODS', 'APPROVED']);
    expect(detail.lines.map((l: { purchaseRequisitionLineId: number; salesContractLineId: number; productId: number }) => [l.purchaseRequisitionLineId, l.salesContractLineId, l.productId]))
      .toEqual([[pr.routerLine, sc.routerLine, router], [pr.cableLine, sc.cableLine, cable]]); // inherited from the PR line, never picked by product
    expect((await balance(wh, cable)).onHand).toBe(0);
  });

  it('PO done is required at submit, re-checked on resubmit, not retroactive after submit (C58–C61)', async () => {
    const sc = await contract(10, 10);
    const proc = app.get(ProcurementService);
    const pr = await proc.createPurchaseRequisition(pmUser, sc.id, [{ salesContractLineId: sc.cableLine, productId: cable, quantity: 5 }]);
    await proc.submit('PR', pr.id, pmUser, salesId);
    await proc.approve('PR', pr.id, salesUser);
    const [{ id: prLine }] = await ds.query(`SELECT id FROM purchase_requisition_lines WHERE purchase_requisition_id = $1`, [pr.id]);
    const [{ id: sup }] = await ds.query(`INSERT INTO suppliers (code, name) VALUES ($1, 'S') RETURNING id`, [`S${Math.random()}`]);
    const order = async (qty: number) => {
      const po = await proc.createPurchaseOrder(pmUser, sup, [{ sourceLineId: prLine, quantity: qty }]);
      await proc.submit('PO', po.id, pmUser, salesId);
      await proc.approve('PO', po.id, salesUser);
      return po.id;
    };
    await order(3); // only 3 of 5 ordered
    expect((await get(pm, `/sales-contracts/${sc.id}/gir-pr-lines`)).some((o: { id: number }) => o.id === prLine)).toBe(false);
    const body = { issueType: 'PURCHASE_REQUISITION', salesContractId: sc.id, warehouseId: hcm, lines: [{ purchaseRequisitionLineId: prLine, quantity: 2 }] };
    const gir = (await post(pm, '/goods-issue-requests', body).expect(201)).body.id; // Draft may be saved
    expect((await post(pm, `/goods-issue-requests/${gir}/submit`, { approverId: salesId })).body.code).toBe('PR_NOT_PO_DONE'); // C58
    expect(await status('goods_issue_requests', gir)).toBe('DRAFT');
    const last = await order(2); // now PO done
    await post(pm, `/goods-issue-requests/${gir}/submit`, { approverId: salesId }).expect(204); // C61
    await proc.decide('PO', 'recall', last, pmUser, 'supplier change'); // PR loses PO done after submit
    await post(sales, `/goods-issue-requests/${gir}/approve`).expect(204); // C60: not retroactive
    expect(await status('goods_issue_requests', gir)).toBe('APPROVED');
  });

  it('PR-line quota: DRAFT does not hold it, WAITING/REJECTED/APPROVED do, CANCELED frees it; checked at submit and approve (C55, CT2)', async () => {
    const sc = await contract(50, 50);
    const pr = await poDonePr(sc, 0, 5);
    const make = async (qty: number) => (await post(pm, '/goods-issue-requests', prGirBody(sc, pr, 0, qty)).expect(201)).body.id as number;
    const draftBig = await make(5); // DRAFT: holds nothing
    const g1 = await make(4);
    await post(pm, `/goods-issue-requests/${g1}/submit`, { approverId: salesId }).expect(204);
    const g2 = await make(2);
    expect((await post(pm, `/goods-issue-requests/${g2}/submit`, { approverId: salesId })).body.code).toBe('PR_LINE_QUOTA_EXCEEDED'); // 4 + 2 > 5
    await post(sales, `/goods-issue-requests/${g1}/reject`, { reason: 'x' }).expect(204);
    expect((await post(pm, `/goods-issue-requests/${g2}/submit`, { approverId: salesId })).body.code).toBe('PR_LINE_QUOTA_EXCEEDED'); // REJECTED still holds
    await post(pm, `/goods-issue-requests/${g1}/cancel`).expect(204);
    await post(pm, `/goods-issue-requests/${g2}/submit`, { approverId: salesId }).expect(204);
    expect((await get(pm, `/sales-contracts/${sc.id}/gir-pr-lines`)).find((o: { id: number }) => o.id === pr.cableLine).remainingQuantity).toBe(3);
    expect((await post(pm, `/goods-issue-requests/${draftBig}/submit`, { approverId: salesId })).body.code).toBe('PR_LINE_QUOTA_EXCEEDED');
  });

  it('concurrent submits on one PR line never exceed it', async () => {
    const sc = await contract(50, 50);
    const pr = await poDonePr(sc, 0, 5);
    const ids = [];
    for (let i = 0; i < 2; i++) ids.push((await post(pm, '/goods-issue-requests', prGirBody(sc, pr, 0, 3)).expect(201)).body.id);
    const res = await Promise.all(ids.map((id) => post(pm, `/goods-issue-requests/${id}/submit`, { approverId: salesId })));
    expect(res.map((r) => r.status).sort()).toEqual([204, 422]);
    expect(res.find((r) => r.status === 422)!.body.code).toBe('PR_LINE_QUOTA_EXCEEDED');
  });

  it('material GIR (C): no HĐ line, no Sales confirmation, no HĐ quota; never mixed with sales goods (CM3)', async () => {
    const sc = await contract(1, 1, false); // nothing confirmed, HĐ lines of 1
    const material = await poDonePr(sc, 0, 5, 'MATERIAL');
    const gir = (await post(pm, '/goods-issue-requests', prGirBody(sc, material, 0, 5)).expect(201)).body.id;
    await post(pm, `/goods-issue-requests/${gir}/submit`, { approverId: salesId }).expect(204);
    await post(sales, `/goods-issue-requests/${gir}/approve`).expect(204);
    const d = await get(pm, `/goods-issue-requests/${gir}`);
    expect([d.category, d.lines[0].salesContractLineId]).toEqual(['MATERIAL', null]);

    const goods = await poDonePr(sc, 1, 0);
    const mixed = await post(pm, '/goods-issue-requests', {
      issueType: 'PURCHASE_REQUISITION', salesContractId: sc.id, warehouseId: hcm,
      lines: [{ purchaseRequisitionLineId: goods.routerLine, quantity: 1 }, { purchaseRequisitionLineId: material.cableLine, quantity: 1 }],
    });
    expect([mixed.status, mixed.body.code]).toEqual([422, 'GIR_CATEGORY_MIXED']);
    // A sales-goods PR needs HĐ lines; a material PR does not.
    const proc = app.get(ProcurementService);
    await expect(proc.createPurchaseRequisition(pmUser, sc.id, [{ productId: cable, quantity: 1 }])).rejects.toMatchObject({ code: 'SALES_CONTRACT_LINE_REQUIRED' });
  });

  it('A/C lines: PR line of another HĐ, duplicate PR line, product picked by hand and the retired SALES_CONTRACT type are refused', async () => {
    const sc = await contract(10, 10);
    const other = await contract(10, 10);
    const pr = await poDonePr(sc, 0, 5);
    const foreign = await poDonePr(other, 0, 5);
    const create = (body: object) => post(pm, '/goods-issue-requests', body);
    expect((await create(prGirBody(sc, foreign, 0, 1))).body.code).toBe('PR_LINE_NOT_IN_CONTRACT');
    expect((await create({ ...prGirBody(sc, pr, 0, 1), lines: [{ purchaseRequisitionLineId: pr.cableLine, quantity: 1 }, { purchaseRequisitionLineId: pr.cableLine, quantity: 1 }] })).body.code)
      .toBe('DUPLICATE_SOURCE_LINE');
    expect((await create({ ...prGirBody(sc, pr, 0, 1), lines: [{ purchaseRequisitionLineId: pr.cableLine, productId: router, quantity: 1 }] })).body.code)
      .toBe('GIR_LINE_SOURCE_INVALID');
    expect((await create({ issueType: 'SALES_CONTRACT', salesContractId: sc.id, warehouseId: hcm, lines: [{ salesContractLineId: sc.cableLine, productId: cable, quantity: 1 }] })).status)
      .toBe(400);
  });

  it('GI of an A GIR allocates only lots of its own HĐ even when an older lot of another HĐ exists (C74)', async () => {
    const wh = await isolatedWarehouse('AC2');
    const x = await contract(50, 50);
    const y = await contract(50, 50);
    await receive(wh, 0, 5, x); // older, HĐ-X
    await receive(wh, 0, 5, y); // newer, HĐ-Y
    const gir = await approvedGir(y, 0, 3, wh);
    const gi = (await post(pm, '/goods-issues', { goodsIssueRequestId: gir.id, lines: [{ goodsIssueRequestLineId: gir.cableLine, quantity: 3 }] }).expect(201)).body.id;
    await post(pm, `/goods-issues/${gi}/submit`, { approverId: salesId }).expect(204);
    const sources = await ds.query(
      `SELECT DISTINCT l.source_sales_contract_id AS sc FROM goods_issue_line_allocations a JOIN inventory_lots l ON l.id = a.inventory_lot_id
         JOIN goods_issue_lines gl ON gl.id = a.goods_issue_line_id WHERE gl.goods_issue_id = $1`, [gi]);
    expect(sources).toEqual([{ sc: y.id }]);
    await post(sales, `/goods-issues/${gi}/approve`).expect(204);
    expect(await ds.query(RECONCILE_SQL)).toEqual([]);
  });

  // ---------- Completion ----------

  it('completion: blocks open GIs, needs a reason when short, frees unissued quota, blocks new GIs (C11–C13, C16, C19–C21)', async () => {
    const sc = await contract(10, 10);
    await receive(hcm, 0, 10, sc);
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
    await post(pm, '/goods-issue-requests', prGirBody(sc, await poDonePr(sc, 0, 6), 0, 6)).expect(201);
    expect((await post(pm, '/goods-issues', { goodsIssueRequestId: gir.id, lines: [{ goodsIssueRequestLineId: gir.cableLine, quantity: 1 }] })).body.code).toBe('GIR_COMPLETED'); // C13
  });

  it('after all receipts, reservations and issues above, lots reconcile with balances (ADR-0013, no silent drift)', async () => {
    const [{ n }] = await ds.query(`SELECT COUNT(*)::int AS n FROM inventory_transactions WHERE movement_type = 'OUT'`);
    expect(n).toBeGreaterThan(0); // the scenarios above did issue stock
    expect(await ds.query(RECONCILE_SQL)).toEqual([]);
  });

  it('reconciliation flags each kind of drift (corruptions run in a rolled-back transaction)', async () => {
    const flagged = async (corrupt: string, params: unknown[] = []) => {
      let names: string[] = [];
      await ds.transaction(async (m) => {
        await m.query(corrupt, params);
        names = [...new Set((await m.query(RECONCILE_SQL)).map((r: { check_name: string }) => r.check_name))].sort() as string[];
        throw new Error('rollback');
      }).catch((e: Error) => { if (e.message !== 'rollback') throw e; });
      return names;
    };
    const [bulk] = await ds.query(`SELECT i.id FROM inventories i JOIN products p ON p.id = i.product_id WHERE NOT p.is_serial_tracked AND i.on_hand_quantity > i.reserved_quantity LIMIT 1`);
    expect(await flagged(`UPDATE inventories SET on_hand_quantity = on_hand_quantity + 1 WHERE id = $1`, [bulk.id])).toEqual(['ON_HAND']);
    expect(await flagged(`UPDATE inventories SET reserved_quantity = reserved_quantity + 1 WHERE id = $1`, [bulk.id])).toEqual(['RESERVED']);
    expect(await flagged(`UPDATE inventory_serials SET status = 'ISSUED' WHERE id = (SELECT min(id) FROM inventory_serials WHERE status = 'IN_STOCK')`))
      .toEqual(['SERIALS']);
    expect(await flagged(`DELETE FROM inventory_lots WHERE id = (SELECT min(id) FROM inventory_lots WHERE id NOT IN (SELECT inventory_lot_id FROM goods_issue_line_allocations))`))
      .toEqual(['GR_LINE', 'ON_HAND']);
    expect(await flagged(`UPDATE inventory_lots SET on_hand_quantity = on_hand_quantity - 1 WHERE id = (SELECT min(id) FROM inventory_lots WHERE on_hand_quantity > reserved_quantity
      AND product_id IN (SELECT id FROM products WHERE NOT is_serial_tracked))`)).toEqual(['LOT', 'ON_HAND']);
    expect(await flagged(`UPDATE goods_issue_line_allocations SET quantity = quantity + 1 WHERE id = (SELECT min(a.id) FROM goods_issue_line_allocations a
      JOIN goods_issue_lines l ON l.id = a.goods_issue_line_id JOIN products p ON p.id = l.product_id AND NOT p.is_serial_tracked)`)).toEqual(['ALLOCATION', 'LOT']);
    expect(await flagged(`UPDATE inventory_transactions SET quantity = quantity + 1 WHERE id = (SELECT min(id) FROM inventory_transactions WHERE movement_type = 'OUT')`))
      .toEqual(['GI_LINE', 'ON_HAND']);
    expect(await flagged(
      `INSERT INTO inventory_transactions (warehouse_id, product_id, movement_type, quantity, source_document_type, source_line_id)
       SELECT warehouse_id, product_id, 'IN', 1, 'ADJUSTMENT', 1 FROM inventories WHERE id = $1`, [bulk.id])).toEqual(['MOVEMENT_SOURCE']);
    expect(await ds.query(RECONCILE_SQL)).toEqual([]); // untouched after the rollbacks
  });
});
