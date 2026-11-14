import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { CurrentUser, IdentityService } from './modules/identity/auth';
import { hashPassword } from './modules/identity/password';
import { InboundFacade, InboundService } from './modules/inbound/inbound.service';
import { InventoryFacade } from './modules/inventory/inventory.service';
import { ProcurementFacade, ProcurementService } from './modules/procurement/procurement.service';
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

  /** B/D request body: borrow from `src` (its responsible Sales is `salesId`, see contract()) for target `sc`. */
  const bdBody = (sc: Contract, src: Contract, warehouseId: number, lines: object[], category: 'SALES_GOODS' | 'MATERIAL' = 'SALES_GOODS', purpose?: string) => ({
    issueType: 'AVAILABLE_STOCK', category, salesContractId: sc.id, warehouseId, sourceSalesContractId: src.id, sourceOwnerUserId: salesId, purpose, lines,
  });
  const cableB = (sc: Contract, qty: number) => [{ salesContractLineId: sc.cableLine, productId: cable, quantity: qty }];
  /** A warehouse allowed for available-stock issues, with the warehouse manager in it. */
  async function surplusWarehouse(code: string) {
    const wh = await isolatedWarehouse(code);
    await ds.query(`UPDATE warehouses SET allow_available_stock_issue = true WHERE id = $1`, [wh]);
    await ds.query(`INSERT INTO user_warehouses (user_id, warehouse_id) VALUES ($1, $2)`, [managerId, wh]);
    return wh;
  }

  it('A and B share the HĐ-line quota; materials never use it (C55, ADR-0012)', async () => {
    const sc = await contract(10, 10);
    const src = await contract(50, 50);
    const wh = await surplusWarehouse('QB1');
    await receive(wh, 0, 20, src); // stock of the source HĐ for the available-stock (B) request
    const a = await approvedGir(sc, 0, 7); // A holds 7 of 10
    expect(a.id).toBeGreaterThan(0);
    const b = (await post(pm, '/goods-issue-requests', bdBody(sc, src, wh, cableB(sc, 4))).expect(201)).body.id; // DRAFT although 7 + 4 > 10
    expect((await post(pm, `/goods-issue-requests/${b}/submit`, { approverId: salesId, warehouseApproverId: managerId })).body.code).toBe('SALES_CONTRACT_QUOTA_EXCEEDED');
    const b3 = (await post(pm, '/goods-issue-requests', bdBody(sc, src, wh, cableB(sc, 3))).expect(201)).body.id;
    await post(pm, `/goods-issue-requests/${b3}/submit`, { approverId: salesId, warehouseApproverId: managerId }).expect(204); // 7 + 3 = 10

    const material = await poDonePr(sc, 0, 50, 'MATERIAL');
    const m = (await post(pm, '/goods-issue-requests', prGirBody(sc, material, 0, 50)).expect(201)).body.id;
    await post(pm, `/goods-issue-requests/${m}/submit`, { approverId: salesId }).expect(204); // HĐ line is full, materials are not counted
    expect(Number((await get(pm, `/sales-contracts/${sc.id}/gir-quota`)).find((q: { salesContractLineId: number }) => q.salesContractLineId === sc.cableLine).usedQuantity))
      .toBe(10);
  });

  it('AVAILABLE_STOCK: allowed warehouse only; DRAFT may lack stock, submit and both steps check the source scope; step 1 is the source Sales (D12–D20, CT13)', async () => {
    const src = await contract(50, 50);
    await receive(kth, 0, 5, src);
    const sc = await contract(10, 10);
    expect((await post(pm, '/goods-issue-requests', bdBody(sc, src, hcm, cableB(sc, 1)))).body.code).toBe('WAREHOUSE_NOT_ALLOWED_FOR_AVAILABLE_STOCK');
    const short = (await post(pm, '/goods-issue-requests', bdBody(sc, src, kth, cableB(sc, 6))).expect(201)).body.id; // CT13: DRAFT saved
    expect((await post(pm, `/goods-issue-requests/${short}/submit`, { approverId: salesId, warehouseApproverId: managerId })).body.code).toBe('INSUFFICIENT_AVAILABLE_STOCK');
    const gir = (await post(pm, '/goods-issue-requests', bdBody(sc, src, kth, cableB(sc, 5))).expect(201)).body.id;

    // D26: step 1 can only go to the source Sales.
    expect((await get(pm, `/goods-issue-requests/${gir}/approvers`)).approvers.map((u: { id: number }) => u.id)).toEqual([salesId]);
    expect((await post(pm, `/goods-issue-requests/${gir}/submit`, { approverId: managerId, warehouseApproverId: managerId })).body.code).toBe('APPROVER_NOT_SOURCE_SALES');
    await post(pm, `/goods-issue-requests/${gir}/submit`, { approverId: salesId, warehouseApproverId: managerId }).expect(204);
    expect((await post(manager, `/goods-issue-requests/${gir}/approve`)).body.code).toBe('NOT_ASSIGNED_APPROVER'); // D17
    await post(sales, `/goods-issue-requests/${gir}/approve`).expect(204);
    let detail = await get(pm, `/goods-issue-requests/${gir}`);
    expect([detail.approvalStatus, detail.approvalStep, detail.sourceSalesContractId, detail.sourceOwnerUserId]).toEqual(['WAITING_FOR_APPROVE', 2, src.id, salesId]); // D15
    await post(manager, `/goods-issue-requests/${gir}/approve`).expect(204);
    detail = await get(pm, `/goods-issue-requests/${gir}`);
    expect(detail.approvalStatus).toBe('APPROVED'); // D16
    expect(detail.history.map((h: { action: string }) => h.action)).toEqual(['SUBMIT', 'CONFIRM', 'APPROVE']);
    expect((await balance(kth, cable)).reserved).toBe(0); // D19: GIR reserves nothing

    // D18: recall → Draft, resubmit starts again at the source Sales.
    await post(pm, `/goods-issue-requests/${gir}/recall`, { reason: 'reduce qty' }).expect(204);
    await post(pm, `/goods-issue-requests/${gir}/submit`, { approverId: salesId, warehouseApproverId: managerId }).expect(204);
    expect((await get(pm, `/goods-issue-requests/${gir}`)).approvalStep).toBe(1);
    // D20: rejection at the Sales step → REJECTED.
    await post(sales, `/goods-issue-requests/${gir}/reject`, { reason: 'not agreed with customer' }).expect(204);
    expect(await status('goods_issue_requests', gir)).toBe('REJECTED');
  });

  it('stock that drops while waiting blocks the Sales step and the final approval; other sources never count (D14, D24, C88)', async () => {
    const wh = await surplusWarehouse('BD1');
    const src = await contract(50, 50);
    const otherSrc = await contract(50, 50);
    await receive(wh, 0, 3, src);
    await receive(wh, 0, 30, otherSrc); // plenty, but another source HĐ
    const sc = await contract(50, 50);
    const gir = (await post(pm, '/goods-issue-requests', bdBody(sc, src, wh, cableB(sc, 3))).expect(201)).body.id;
    await post(pm, `/goods-issue-requests/${gir}/submit`, { approverId: salesId, warehouseApproverId: managerId }).expect(204);
    // A GI of the source HĐ's own A request reserves 1 of its 3 meanwhile.
    const own = await approvedGir(src, 0, 1, wh);
    const gi = (await post(pm, '/goods-issues', { goodsIssueRequestId: own.id, lines: [{ goodsIssueRequestLineId: own.cableLine, quantity: 1 }] }).expect(201)).body.id;
    await post(pm, `/goods-issues/${gi}/submit`, { approverId: salesId }).expect(204);
    expect((await post(sales, `/goods-issue-requests/${gir}/approve`)).body.code).toBe('INSUFFICIENT_AVAILABLE_STOCK'); // step 1
    await post(sales, `/goods-issues/${gi}/reject`, { reason: 'later' }).expect(204);
    await post(sales, `/goods-issue-requests/${gir}/approve`).expect(204); // stock back: Sales confirms
    await post(pm, `/goods-issues/${gi}/submit`, { approverId: salesId }).expect(204); // taken again before the final step
    expect((await post(manager, `/goods-issue-requests/${gir}/approve`)).body.code).toBe('INSUFFICIENT_AVAILABLE_STOCK'); // step 2
    expect([await status('goods_issue_requests', gir), (await get(pm, `/goods-issue-requests/${gir}`)).approvalStep]).toEqual(['WAITING_FOR_APPROVE', 2]);
  });

  it('source rules: source ≠ target, not canceled (completed is fine), source Sales = responsible Sales of the source HĐ (C84, C89–C91)', async () => {
    const wh = await surplusWarehouse('BD2');
    const sc = await contract(10, 10);
    const src = await contract(10, 10);
    await receive(wh, 0, 2, src);
    const create = (body: object) => post(pm, '/goods-issue-requests', body);
    expect((await create(bdBody(sc, sc, wh, cableB(sc, 1)))).body.code).toBe('SOURCE_CONTRACT_INVALID'); // C89: same HĐ → use A/C
    expect((await create({ ...bdBody(sc, src, wh, cableB(sc, 1)), sourceOwnerUserId: managerId })).body.code).toBe('SOURCE_SALES_MISMATCH');
    expect((await create({ ...bdBody(sc, src, wh, cableB(sc, 1)), sourceSalesContractId: undefined })).body.code).toBe('GIR_SOURCE_REQUIRED');
    // C91: a source HĐ whose own needs are done (no open request) still lends its surplus.
    await create(bdBody(sc, src, wh, cableB(sc, 1))).expect(201);
    // C90: a canceled source HĐ is refused.
    const canceled = await contract(10, 10);
    await ds.query(`UPDATE sales_contracts SET status = 'CANCELED' WHERE id = $1`, [canceled.id]);
    expect((await create(bdBody(sc, canceled, wh, cableB(sc, 1)))).body.code).toBe('SOURCE_CONTRACT_INVALID');
    // The picker lists the source with its stock, never the target HĐ nor a canceled one.
    const sources = await get(pm, `/warehouses/${wh}/available-stock-sources?targetSalesContractId=${sc.id}`);
    expect(sources).toEqual([expect.objectContaining({ sourceSalesContractId: src.id, sourceOwnerUserId: salesId, productId: cable, available: 2 })]);
  });

  it('D (materials from available stock): purpose required, no HĐ line, no HĐ quota; never mixed with sales goods (ADR-0012, CM3)', async () => {
    const wh = await surplusWarehouse('BD3');
    const src = await contract(50, 50);
    await receive(wh, 0, 8, src);
    const sc = await contract(1, 1, false); // nothing confirmed, HĐ lines of 1
    const lines = [{ productId: cable, quantity: 5 }];
    expect((await post(pm, '/goods-issue-requests', bdBody(sc, src, wh, lines, 'MATERIAL'))).body.code).toBe('PURPOSE_REQUIRED');
    expect((await post(pm, '/goods-issue-requests', bdBody(sc, src, wh, cableB(sc, 1), 'MATERIAL', 'x'))).body.code).toBe('GIR_LINE_SOURCE_INVALID'); // no HĐ line on D
    expect((await post(pm, '/goods-issue-requests', bdBody(sc, src, wh, lines, 'SALES_GOODS'))).body.code).toBe('GIR_LINE_SOURCE_INVALID'); // B needs an HĐ line
    const d = (await post(pm, '/goods-issue-requests', bdBody(sc, src, wh, lines, 'MATERIAL', 'Lắp đặt tủ rack')).expect(201)).body.id;
    await post(pm, `/goods-issue-requests/${d}/submit`, { approverId: salesId, warehouseApproverId: managerId }).expect(204);
    await post(sales, `/goods-issue-requests/${d}/approve`).expect(204);
    await post(manager, `/goods-issue-requests/${d}/approve`).expect(204);
    const detail = await get(pm, `/goods-issue-requests/${d}`);
    expect([detail.category, detail.purpose, detail.lines[0].salesContractLineId]).toEqual(['MATERIAL', 'Lắp đặt tủ rack', null]);
  });

  it('C: purpose is optional and inherited from the material PRs when left empty (CT9)', async () => {
    const sc = await contract(5, 5);
    const proc = app.get(ProcurementService);
    const pr = await proc.createPurchaseRequisition(pmUser, sc.id, [{ productId: cable, quantity: 3 }], 'MATERIAL', 'Dự phòng bảo trì');
    await proc.submit('PR', pr.id, pmUser, salesId);
    await proc.approve('PR', pr.id, salesUser);
    const [{ id: prLine }] = await ds.query(`SELECT id FROM purchase_requisition_lines WHERE purchase_requisition_id = $1`, [pr.id]);
    const body = { issueType: 'PURCHASE_REQUISITION', salesContractId: sc.id, warehouseId: hcm, lines: [{ purchaseRequisitionLineId: prLine, quantity: 1 }] };
    const inherited = (await post(pm, '/goods-issue-requests', body).expect(201)).body.id;
    expect((await get(pm, `/goods-issue-requests/${inherited}`)).purpose).toBe('Dự phòng bảo trì');
    const own = (await post(pm, '/goods-issue-requests', { ...body, purpose: 'Thay cáp tầng 3' }).expect(201)).body.id;
    expect((await get(pm, `/goods-issue-requests/${own}`)).purpose).toBe('Thay cáp tầng 3');
  });

  it('B end-to-end: GI inherits source HĐ + Sales, FIFO stays inside it, serials outside are refused, shortage blocks (C70)', async () => {
    const wh = await surplusWarehouse('BD4');
    const src = await contract(50, 50);
    const other = await contract(50, 50);
    await receive(wh, 0, 9, other); // older lot, other source HĐ
    const [otherSn] = await receive(wh, 1, 0, other);
    await receive(wh, 0, 2, src);
    await receive(wh, 0, 3, src);
    const [srcSn] = await receive(wh, 1, 0, src);
    const sc = await contract(50, 50);
    const gir = (await post(pm, '/goods-issue-requests', bdBody(sc, src, wh, [
      { salesContractLineId: sc.cableLine, productId: cable, quantity: 4 }, { salesContractLineId: sc.routerLine, productId: router, quantity: 1 },
    ])).expect(201)).body.id;
    await post(pm, `/goods-issue-requests/${gir}/submit`, { approverId: salesId, warehouseApproverId: managerId }).expect(204);
    await post(sales, `/goods-issue-requests/${gir}/approve`).expect(204);
    await post(manager, `/goods-issue-requests/${gir}/approve`).expect(204);
    const lines = (await get(pm, `/goods-issue-requests/${gir}`)).lines;
    const cableLine = lines.find((l: { productId: number }) => l.productId === cable).id;
    const routerLine = lines.find((l: { productId: number }) => l.productId === router).id;

    // Serial picker only offers serials of the source.
    const offered = (await get(pm, `/goods-issue-request-lines/${routerLine}/available-serials`)).map((s: { goodsReceiptDetailId: number }) => s.goodsReceiptDetailId);
    expect(offered).toEqual([srcSn]);
    const foreign = (await post(pm, '/goods-issues', { goodsIssueRequestId: gir, lines: [{ goodsIssueRequestLineId: routerLine, quantity: 1, goodsReceiptDetailIds: [otherSn] }] })
      .expect(201)).body.id;
    expect((await post(pm, `/goods-issues/${foreign}/submit`, { approverId: salesId })).body.code).toBe('STOCK_OUT_OF_SCOPE');
    await post(pm, `/goods-issues/${foreign}/cancel`).expect(204);

    const gi = (await post(pm, '/goods-issues', { goodsIssueRequestId: gir, lines: [
      { goodsIssueRequestLineId: cableLine, quantity: 4 }, { goodsIssueRequestLineId: routerLine, quantity: 1, goodsReceiptDetailIds: [srcSn] },
    ] }).expect(201)).body.id;
    await post(pm, `/goods-issues/${gi}/submit`, { approverId: salesId }).expect(204);
    const sources = await ds.query(
      `SELECT DISTINCT l.source_sales_contract_id AS sc, l.owner_user_id AS owner FROM goods_issue_line_allocations a JOIN inventory_lots l ON l.id = a.inventory_lot_id
         JOIN goods_issue_lines gl ON gl.id = a.goods_issue_line_id WHERE gl.goods_issue_id = $1`, [gi]);
    expect(sources).toEqual([{ sc: src.id, owner: salesId }]); // FIFO 2 + 2 inside the source, the older lot of the other HĐ untouched
    await post(sales, `/goods-issues/${gi}/approve`).expect(204);

    // The source has 1 cable left; asking for more is blocked, never filled from the other HĐ.
    const gir2 = (await post(pm, '/goods-issue-requests', bdBody(sc, src, wh, cableB(sc, 1))).expect(201)).body.id;
    await post(pm, `/goods-issue-requests/${gir2}/submit`, { approverId: salesId, warehouseApproverId: managerId }).expect(204);
    await post(sales, `/goods-issue-requests/${gir2}/approve`).expect(204);
    await post(manager, `/goods-issue-requests/${gir2}/approve`).expect(204);
    const [{ id: l2 }] = await ds.query(`SELECT id FROM goods_issue_request_lines WHERE goods_issue_request_id = $1`, [gir2]);
    await ds.query(`UPDATE goods_issue_request_lines SET quantity = 2 WHERE id = $1`, [l2]); // force a request above the source stock
    const gi2 = (await post(pm, '/goods-issues', { goodsIssueRequestId: gir2, lines: [{ goodsIssueRequestLineId: l2, quantity: 2 }] }).expect(201)).body.id;
    expect((await post(pm, `/goods-issues/${gi2}/submit`, { approverId: salesId })).body.code).toBe('INSUFFICIENT_AVAILABLE_STOCK');
    expect(await ds.query(RECONCILE_SQL)).toEqual([]);
  });

  it('two B requests compete for the same source stock: GIRs reserve nothing, the GI that submits first wins (C79, R5)', async () => {
    const wh = await surplusWarehouse('BD5');
    const src = await contract(50, 50);
    await receive(wh, 0, 3, src);
    const make = async (sc: Contract) => {
      const id = (await post(pm, '/goods-issue-requests', bdBody(sc, src, wh, cableB(sc, 3))).expect(201)).body.id;
      await post(pm, `/goods-issue-requests/${id}/submit`, { approverId: salesId, warehouseApproverId: managerId }).expect(204);
      await post(sales, `/goods-issue-requests/${id}/approve`).expect(204);
      await post(manager, `/goods-issue-requests/${id}/approve`).expect(204);
      const [{ id: line }] = await ds.query(`SELECT id FROM goods_issue_request_lines WHERE goods_issue_request_id = $1`, [id]);
      return (await post(pm, '/goods-issues', { goodsIssueRequestId: id, lines: [{ goodsIssueRequestLineId: line, quantity: 3 }] }).expect(201)).body.id as number;
    };
    const gis = [await make(await contract(50, 50)), await make(await contract(50, 50))]; // both approved: no reservation at GIR level
    const res = await Promise.all(gis.map((g) => post(pm, `/goods-issues/${g}/submit`, { approverId: salesId })));
    expect(res.map((r) => r.status).sort()).toEqual([204, 409]);
    expect(res.find((r) => r.status === 409)!.body.code).toBe('INSUFFICIENT_AVAILABLE_STOCK');
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

  // ---------- First GR and received quantity on GIR A/C lines (PR code #6) ----------

  /** GRR + GR for `qty` of one PO line into `warehouseId`; approved unless `approve` is false. Returns the GR id. */
  async function grFrom(poId: number, poLineId: number, qty: number, warehouseId: number, approve = true) {
    const inbound = app.get(InboundService);
    const grr = await inbound.createGrr(pmUser, poId, warehouseId, [{ sourceLineId: poLineId, quantity: qty }]);
    await inbound.submitGrr(grr.id, pmUser, salesId);
    await inbound.approveGrr(grr.id, salesUser);
    const gr = await inbound.createGr(pmUser, grr.id);
    await inbound.submitGr(gr.id, pmUser, salesId);
    if (approve) await inbound.approveGr(gr.id, salesUser);
    return gr.id as number;
  }
  /** A PR with one cable line of `qty`, ordered on several APPROVED POs (one per entry of `split`). */
  async function prOnPos(sc: Contract, qty: number, split: number[]) {
    const proc = app.get(ProcurementService);
    const pr = await proc.createPurchaseRequisition(pmUser, sc.id, [{ salesContractLineId: sc.cableLine, productId: cable, quantity: qty }]);
    await proc.submit('PR', pr.id, pmUser, salesId);
    await proc.approve('PR', pr.id, salesUser);
    const [{ id: prLine }] = await ds.query(`SELECT id FROM purchase_requisition_lines WHERE purchase_requisition_id = $1`, [pr.id]);
    const pos: { poId: number; poLine: number }[] = [];
    for (const q of split) {
      const [{ id: sup }] = await ds.query(`INSERT INTO suppliers (code, name) VALUES ($1, 'S') RETURNING id`, [`S${Math.random()}`]);
      const po = await proc.createPurchaseOrder(pmUser, sup, [{ sourceLineId: prLine, quantity: q }]);
      await proc.submit('PO', po.id, pmUser, salesId);
      await proc.approve('PO', po.id, salesUser);
      const [{ id: poLine }] = await ds.query(`SELECT id FROM purchase_order_lines WHERE purchase_order_id = $1`, [po.id]);
      pos.push({ poId: po.id, poLine });
    }
    return { prLine: prLine as number, pos };
  }
  const girLine = async (girId: number) => (await get(pm, `/goods-issue-requests/${girId}`)).lines[0];
  const prGir = async (sc: Contract, prLine: number, qty: number, wh = hcm) =>
    (await post(pm, '/goods-issue-requests', { issueType: 'PURCHASE_REQUISITION', salesContractId: sc.id, warehouseId: wh, lines: [{ purchaseRequisitionLineId: prLine, quantity: qty }] })
      .expect(201)).body.id as number;

  it('no GR yet: first GR is empty, received 0, and the GIR is still submitted and approved (C62, C63)', async () => {
    const sc = await contract(10, 10);
    const { prLine } = await prOnPos(sc, 5, [5]);
    const gir = await prGir(sc, prLine, 5);
    expect(await girLine(gir)).toMatchObject({ firstGoodsReceipt: null, receivedQuantity: 0 });
    await post(pm, `/goods-issue-requests/${gir}/submit`, { approverId: salesId }).expect(204);
    await post(sales, `/goods-issue-requests/${gir}/approve`).expect(204);
  });

  it('several POs and GRs: first approved GR wins, received sums approved GRs only, other PR lines of the same product stay apart (C64–C66)', async () => {
    const wh2 = await isolatedWarehouse('FR2');
    const sc = await contract(50, 50);
    const { prLine, pos: [po1, po2] } = await prOnPos(sc, 10, [6, 4]);
    const other = await prOnPos(sc, 7, [7]); // same HĐ line and product, another PR
    await grFrom(other.pos[0].poId, other.pos[0].poLine, 7, hcm); // must not leak into prLine
    const gir = await prGir(sc, prLine, 10);
    await post(pm, `/goods-issue-requests/${gir}/submit`, { approverId: salesId }).expect(204);
    await post(sales, `/goods-issue-requests/${gir}/approve`).expect(204);
    expect(await girLine(gir)).toMatchObject({ firstGoodsReceipt: null, receivedQuantity: 0 });
    const { version, history } = await get(pm, `/goods-issue-requests/${gir}`);

    const gr1 = await grFrom(po1.poId, po1.poLine, 3, hcm); // C64: GIR already APPROVED
    await grFrom(po1.poId, po1.poLine, 3, hcm, false); // pending GR: ignored
    const gr2 = await grFrom(po2.poId, po2.poLine, 4, wh2); // C66: later GR does not replace the first
    const line = await girLine(gir);
    expect(line.firstGoodsReceipt).toMatchObject({ goodsReceiptId: gr1, warehouseCode: 'HCM' });
    expect(line.receivedQuantity).toBe(7);
    const after = await get(pm, `/goods-issue-requests/${gir}`);
    expect([after.approvalStatus, after.version, after.history.length, Number(line.quantity)]).toEqual(['APPROVED', version, history.length, 10]); // GIR untouched

    // Tie on approved_at: the lower GR id is first (stable).
    await ds.query(`UPDATE goods_receipts SET approved_at = (SELECT approved_at FROM goods_receipts WHERE id = $1) WHERE id = $2`, [gr1, gr2]);
    expect((await girLine(gir)).firstGoodsReceipt.goodsReceiptId).toBe(Math.min(gr1, gr2));
  });

  it('a recalled GR no longer counts: the next approved GR becomes first and received drops (PR 8 recall applies the same state)', async () => {
    const sc = await contract(50, 50);
    const { prLine, pos: [po1, po2] } = await prOnPos(sc, 10, [5, 5]);
    const gr1 = await grFrom(po1.poId, po1.poLine, 5, hcm);
    const gr2 = await grFrom(po2.poId, po2.poLine, 2, hcm);
    const result = await ds.transaction(async (m) => {
      // What a valid recall of gr1 leaves behind (03 §2.2, IM25): status back to DRAFT with approved_at cleared, PO progress reversed.
      await m.query(`UPDATE goods_receipts SET approval_status = 'DRAFT', approved_at = NULL WHERE id = $1`, [gr1]);
      await ProcurementFacade.applyReceipt(m, [{ purchaseOrderLineId: po1.poLine, quantity: '5' }], -1);
      const out = { first: (await InboundFacade.firstReceipts(m, [prLine])).get(prLine), received: (await ProcurementFacade.receivedByPrLine(m, [prLine])).get(prLine) };
      throw Object.assign(new Error('rollback'), { out });
    }).catch((e: Error & { out?: unknown }) => { if (e.message !== 'rollback') throw e; return e.out as { first?: { goodsReceiptId: number }; received?: number }; });
    expect(result.first?.goodsReceiptId).toBe(gr2);
    expect(result.received).toBe(2);
    const gir = await prGir(sc, prLine, 1);
    expect(await girLine(gir)).toMatchObject({ firstGoodsReceipt: { goodsReceiptId: gr1 }, receivedQuantity: 7 }); // rolled back: unchanged
  });

  // ---------- Recall of an APPROVED GR (PR code #8) ----------

  /** receive() plus the id of the GR it approved. */
  async function receiveGr(warehouseId: number, routerSns: number, cableQty: number, into?: Contract) {
    const details = await receive(warehouseId, routerSns, cableQty, into);
    const [{ id }] = await ds.query(`SELECT max(id) AS id FROM goods_receipts WHERE approval_status = 'APPROVED'`);
    return { gr: id as number, details };
  }
  const recallGr = (gr: number, as = pm, reason: string | undefined = 'wrong delivery') => post(as, `/goods-receipts/${gr}/recall`, { reason });
  const grState = async (gr: number) => {
    const [g] = await ds.query(`SELECT approval_status, approved_at FROM goods_receipts WHERE id = $1`, [gr]);
    const [{ lots, txs, sns, details }] = await ds.query(
      `SELECT (SELECT count(*)::int FROM inventory_lots WHERE goods_receipt_line_id IN (SELECT id FROM goods_receipt_lines WHERE goods_receipt_id = $1)) AS lots,
              (SELECT count(*)::int FROM inventory_transactions WHERE source_document_type = 'GR' AND source_line_id IN (SELECT id FROM goods_receipt_lines WHERE goods_receipt_id = $1)) AS txs,
              (SELECT count(*)::int FROM inventory_serials s JOIN goods_receipt_details d ON d.id = s.goods_receipt_detail_id
                 JOIN goods_receipt_lines l ON l.id = d.goods_receipt_line_id WHERE l.goods_receipt_id = $1) AS sns,
              (SELECT count(*)::int FROM goods_receipt_details d JOIN goods_receipt_lines l ON l.id = d.goods_receipt_line_id WHERE l.goods_receipt_id = $1) AS details`, [gr]);
    return { status: g.approval_status, approvedAt: g.approved_at, lots, txs, sns, details };
  };

  it('recall undoes the receipt (stock, lots, serials, movements, PO progress) and keeps details + history; re-approval records it once (B16, B21)', async () => {
    const wh = await isolatedWarehouse('RC1');
    const sc = await contract(50, 50);
    const { gr } = await receiveGr(wh, 2, 5, sc);
    const [{ po }] = await ds.query(`SELECT r.purchase_order_id AS po FROM goods_receipts g JOIN goods_receipt_requests r ON r.id = g.goods_receipt_request_id WHERE g.id = $1`, [gr]);
    const poStatus = async () => (await get(pm, `/purchase-orders/${po}`)).receiptStatus;
    expect(await poStatus()).toBe('RECEIVED');
    expect(await grState(gr)).toMatchObject({ status: 'APPROVED', lots: 2, txs: 2, sns: 2, details: 3 });

    expect((await recallGr(gr, pm, '')).status).toBe(400); // reason is mandatory (DTO validation)
    expect((await recallGr(gr, sales)).body.code).toBe('NOT_DOCUMENT_CREATOR');
    await recallGr(gr).expect(204);
    expect(await grState(gr)).toEqual({ status: 'DRAFT', approvedAt: null, lots: 0, txs: 0, sns: 0, details: 3 }); // details kept
    expect(await balance(wh, cable)).toEqual({ onHand: 0, reserved: 0 });
    expect(await balance(wh, router)).toEqual({ onHand: 0, reserved: 0 });
    expect(await poStatus()).toBe('NOT_RECEIVED');
    expect((await get(pm, `/goods-receipts/${gr}`)).history.map((h: { action: string }) => h.action)).toEqual(['SUBMIT', 'APPROVE', 'RECALL']);
    expect(await ds.query(RECONCILE_SQL)).toEqual([]);

    // B21: the same serials are received again once the GR is re-approved.
    await post(pm, `/goods-receipts/${gr}/submit`, { approverId: salesId }).expect(204);
    await post(sales, `/goods-receipts/${gr}/approve`).expect(204);
    expect(await grState(gr)).toMatchObject({ status: 'APPROVED', lots: 2, txs: 2, sns: 2 });
    expect(await balance(wh, cable)).toEqual({ onHand: 5, reserved: 0 });
    expect(await poStatus()).toBe('RECEIVED');
    expect(await ds.query(RECONCILE_SQL)).toEqual([]);
  });

  it('blocked while the lot is reserved or issued by a GI, allowed again once the reservation is released; never re-allocated (C80–C82, CT14)', async () => {
    const wh = await isolatedWarehouse('RC2');
    const sc = await contract(100, 100);
    const { gr } = await receiveGr(wh, 0, 5, sc);
    await receive(wh, 0, 50, sc); // plenty of other stock of the same HĐ and product: still blocked, lots are what count
    const gir = await approvedGir(sc, 0, 2, wh);
    const gi = (await post(pm, '/goods-issues', { goodsIssueRequestId: gir.id, lines: [{ goodsIssueRequestLineId: gir.cableLine, quantity: 1 }] }).expect(201)).body.id;
    await post(pm, `/goods-issues/${gi}/submit`, { approverId: salesId }).expect(204); // FIFO reserves on the GR's lot
    const blocked = await recallGr(gr);
    expect([blocked.status, blocked.body.code]).toEqual([409, 'GR_STOCK_IN_USE']); // C80
    expect((await grState(gr)).status).toBe('APPROVED');
    await post(sales, `/goods-issues/${gi}/reject`, { reason: 'x' }).expect(204); // C82: reservation released
    await recallGr(gr).expect(204);
    expect(await ds.query(RECONCILE_SQL)).toEqual([]);

    // C81: once issued from a lot, its GR can never be recalled, even with stock left elsewhere.
    const { gr: gr2 } = await receiveGr(wh, 0, 5, sc); // newest lot; drain the older one first
    const gir2 = await approvedGir(sc, 0, 45, wh);
    const big = (await post(pm, '/goods-issues', { goodsIssueRequestId: gir2.id, lines: [{ goodsIssueRequestLineId: gir2.cableLine, quantity: 45 }] }).expect(201)).body.id;
    await post(pm, `/goods-issues/${big}/submit`, { approverId: salesId }).expect(204);
    await post(sales, `/goods-issues/${big}/approve`).expect(204); // 50 older + 5 newest: FIFO takes 45 from the older lot only
    await recallGr(gr2).expect(204); // untouched lot: fine
    const { gr: gr3 } = await receiveGr(wh, 0, 5, sc);
    const gir3 = await approvedGir(sc, 0, 7, wh); // 5 left on the older lot + 2 from gr3
    const take = (await post(pm, '/goods-issues', { goodsIssueRequestId: gir3.id, lines: [{ goodsIssueRequestLineId: gir3.cableLine, quantity: 7 }] }).expect(201)).body.id;
    await post(pm, `/goods-issues/${take}/submit`, { approverId: salesId }).expect(204);
    await post(sales, `/goods-issues/${take}/approve`).expect(204);
    expect((await recallGr(gr3)).body.code).toBe('GR_STOCK_IN_USE');
    expect(await ds.query(RECONCILE_SQL)).toEqual([]);
  });

  it('serials on a GI that is not canceled block the recall, even DRAFT/REJECTED; canceled GIs do not (B17, B18, B23, B24)', async () => {
    const wh = await isolatedWarehouse('RC3');
    const sc = await contract(50, 50);
    const { gr, details: [sn] } = await receiveGr(wh, 1, 0, sc);
    const gir = await approvedGir(sc, 1, 0, wh);
    const gi = (await post(pm, '/goods-issues', { goodsIssueRequestId: gir.id, lines: [{ goodsIssueRequestLineId: gir.routerLine, quantity: 1, goodsReceiptDetailIds: [sn] }] })
      .expect(201)).body.id;
    expect((await recallGr(gr)).body.code).toBe('GR_STOCK_IN_USE'); // B23: a DRAFT GI holds the serial
    expect(await serialStatus(sn)).toBe('IN_STOCK'); // never removed from the GI automatically
    await post(pm, `/goods-issues/${gi}/cancel`).expect(204);
    await recallGr(gr).expect(204); // B24
    expect(await ds.query(`SELECT count(*)::int AS n FROM goods_issue_serials WHERE goods_issue_line_id IN (SELECT id FROM goods_issue_lines WHERE goods_issue_id = $1)`, [gi]))
      .toEqual([{ n: 1 }]); // the canceled GI keeps its serial row for the trail
  });

  it('the first GR shown on a live GIR cannot be recalled; once those GIRs are canceled the next GR becomes first, else none (C75, C76, C86, C87)', async () => {
    const wh = await isolatedWarehouse('RC4');
    const sc = await contract(50, 50);
    const { prLine, pos: [po1, po2] } = await prOnPos(sc, 10, [5, 5]);
    const gr1 = await grFrom(po1.poId, po1.poLine, 5, wh);
    const gr2 = await grFrom(po2.poId, po2.poLine, 2, wh);
    const gir = await prGir(sc, prLine, 3, wh);
    const { version, history } = await get(pm, `/goods-issue-requests/${gir}`);
    expect((await recallGr(gr1)).body.code).toBe('GR_REFERENCED_BY_GIR'); // C75 (DRAFT GIR counts)
    await recallGr(gr2).expect(204); // not the first GR: allowed even with the GIR
    expect(await girLine(gir)).toMatchObject({ firstGoodsReceipt: { goodsReceiptId: gr1 }, receivedQuantity: 5 });
    await post(pm, `/goods-issue-requests/${gir}/cancel`).expect(204);
    await post(pm, `/goods-receipts/${gr2}/submit`, { approverId: salesId }).expect(204);
    await post(sales, `/goods-receipts/${gr2}/approve`).expect(204);
    await recallGr(gr1).expect(204); // C76
    const after = await get(pm, `/goods-issue-requests/${gir}`);
    expect([after.version, after.history.length]).toEqual([version + 1, history.length + 1]); // only the cancel above, no change from the recall
    expect(after.lines[0]).toMatchObject({ firstGoodsReceipt: { goodsReceiptId: gr2 }, receivedQuantity: 2 }); // C86
    await recallGr(gr2).expect(204);
    expect((await get(pm, `/goods-issue-requests/${gir}`)).lines[0]).toMatchObject({ firstGoodsReceipt: null, receivedQuantity: 0 }); // C87
    expect(await ds.query(RECONCILE_SQL)).toEqual([]);
  });

  it('recall racing a GI submit on the same lot: exactly one wins, stock never goes negative (B20)', async () => {
    const wh = await isolatedWarehouse('RC5');
    const sc = await contract(50, 50);
    const { gr } = await receiveGr(wh, 0, 3, sc);
    const gir = await approvedGir(sc, 0, 3, wh);
    const gi = (await post(pm, '/goods-issues', { goodsIssueRequestId: gir.id, lines: [{ goodsIssueRequestLineId: gir.cableLine, quantity: 3 }] }).expect(201)).body.id;
    const [r, s] = await Promise.all([recallGr(gr), post(pm, `/goods-issues/${gi}/submit`, { approverId: salesId })]);
    expect([r.status, s.status].sort()).toEqual([204, 409]);
    if (r.status === 409) expect(r.body.code).toBe('GR_STOCK_IN_USE');
    else expect(s.body.code).toBe('INSUFFICIENT_AVAILABLE_STOCK');
    expect(await ds.query(RECONCILE_SQL)).toEqual([]);
  });

  it('final GIR rule: first GR blocked while a live GIR shows it; once the GIR has a live GI every GR of its PR line is blocked; canceled GIs lift it (CT11)', async () => {
    const wh = await isolatedWarehouse('RC6');
    const sc = await contract(50, 50);
    const { prLine, pos: [po1, po2] } = await prOnPos(sc, 10, [6, 4]); // one PR line on two POs
    const gr1 = await grFrom(po1.poId, po1.poLine, 3, wh);
    const gr2 = await grFrom(po2.poId, po2.poLine, 4, wh);
    const gr3 = await grFrom(po1.poId, po1.poLine, 3, wh);
    const girId = await prGir(sc, prLine, 2, wh);
    await post(pm, `/goods-issue-requests/${girId}/submit`, { approverId: salesId }).expect(204);
    await post(sales, `/goods-issue-requests/${girId}/approve`).expect(204);

    // 1. No GI yet: only the first GR is blocked.
    expect((await recallGr(gr1)).body.code).toBe('GR_REFERENCED_BY_GIR');
    await recallGr(gr3).expect(204);
    await post(pm, `/goods-receipts/${gr3}/submit`, { approverId: salesId }).expect(204);
    await post(sales, `/goods-receipts/${gr3}/approve`).expect(204);

    // 2. A GI that is not canceled (even a DRAFT that allocates nothing) blocks every GR of the PR line.
    const [{ id: girLineId }] = await ds.query(`SELECT id FROM goods_issue_request_lines WHERE goods_issue_request_id = $1`, [girId]);
    const gi = (await post(pm, '/goods-issues', { goodsIssueRequestId: girId, lines: [{ goodsIssueRequestLineId: girLineId, quantity: 1 }] }).expect(201)).body.id;
    for (const gr of [gr2, gr3]) {
      const res = await recallGr(gr);
      expect([res.status, res.body.code]).toEqual([409, 'GR_LINKED_TO_GOODS_ISSUE']);
    }
    await post(pm, `/goods-issues/${gi}/submit`, { approverId: salesId }).expect(204);
    await post(sales, `/goods-issues/${gi}/reject`, { reason: 'x' }).expect(204);
    expect((await recallGr(gr2)).body.code).toBe('GR_LINKED_TO_GOODS_ISSUE'); // REJECTED is not canceled

    // 3. All GIs canceled: back to rule 1.
    await post(pm, `/goods-issues/${gi}/cancel`).expect(204);
    await recallGr(gr2).expect(204);
    expect((await recallGr(gr1)).body.code).toBe('GR_REFERENCED_BY_GIR');
    expect(await girLine(girId)).toMatchObject({ firstGoodsReceipt: { goodsReceiptId: gr1 }, receivedQuantity: 6 });
    expect(await ds.query(RECONCILE_SQL)).toEqual([]);
  });

  it('GIRs and GIs on another PR line never block, even with the same product, warehouse and HĐ', async () => {
    const wh = await isolatedWarehouse('RC7');
    const sc = await contract(50, 50);
    const mine = await prOnPos(sc, 5, [5]);
    const other = await prOnPos(sc, 5, [5]); // same HĐ line, product, warehouse; another PR line
    const grMine = await grFrom(mine.pos[0].poId, mine.pos[0].poLine, 5, wh);
    await grFrom(other.pos[0].poId, other.pos[0].poLine, 5, wh);
    const girOther = await prGir(sc, other.prLine, 1, wh);
    await post(pm, `/goods-issue-requests/${girOther}/submit`, { approverId: salesId }).expect(204);
    await post(sales, `/goods-issue-requests/${girOther}/approve`).expect(204);
    const [{ id: l }] = await ds.query(`SELECT id FROM goods_issue_request_lines WHERE goods_issue_request_id = $1`, [girOther]);
    await post(pm, '/goods-issues', { goodsIssueRequestId: girOther, lines: [{ goodsIssueRequestLineId: l, quantity: 1 }] }).expect(201);
    await recallGr(grMine).expect(204); // my PR line has no GIR: nothing to block
    expect(await ds.query(RECONCILE_SQL)).toEqual([]);
  });

  it('a GI being created on the GIR meanwhile is serialized with the recall: the recall waits, then sees it (race)', async () => {
    const wh = await isolatedWarehouse('RC8');
    const sc = await contract(50, 50);
    const { prLine, pos: [po1] } = await prOnPos(sc, 10, [10]);
    await grFrom(po1.poId, po1.poLine, 4, wh);
    const gr2 = await grFrom(po1.poId, po1.poLine, 4, wh); // not the first GR
    const girId = await prGir(sc, prLine, 1, wh);
    await post(pm, `/goods-issue-requests/${girId}/submit`, { approverId: salesId }).expect(204);
    await post(sales, `/goods-issue-requests/${girId}/approve`).expect(204);

    // Hold the GIR row the way GI create does, then add a GI and commit while the recall is waiting on that lock.
    const qr = ds.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    await qr.query(`SELECT id FROM goods_issue_requests WHERE id = $1 FOR UPDATE`, [girId]);
    let settled = false;
    const pending = recallGr(gr2).then((r) => { settled = true; return r; });
    await new Promise((r) => setTimeout(r, 400));
    expect(settled).toBe(false); // blocked on the GIR lock
    await qr.query(`INSERT INTO goods_issues (document_number, goods_issue_request_id, warehouse_id, created_by) VALUES ('GI-RACE-1', $1, $2, $3)`,
      [girId, wh, pmUser.id]);
    await qr.commitTransaction();
    await qr.release();
    const res = await pending;
    expect([res.status, res.body.code]).toEqual([409, 'GR_LINKED_TO_GOODS_ISSUE']);
    await ds.query(`UPDATE goods_issues SET approval_status = 'CANCELED' WHERE document_number = 'GI-RACE-1'`);
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
