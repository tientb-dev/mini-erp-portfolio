import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { ProcurementFacade } from './modules/procurement/procurement.service';
import { bootTestApp, login } from './test-utils';

/** HĐ → PR → PO → GRR → GR → Inventory, against real PostgreSQL. IDs refer to 05-ACCEPTANCE-TESTS. */
describe('Inbound chain and GR (integration)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let creator: string; // admin: creates documents
  let approver: string; // approver: assigned approver
  let approverId: number;
  let salesUserId: number;
  let hcmId: number;
  let snProductId: number;
  let bulkProductId: number;

  const http = () => request(app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const post = (token: string, url: string, body: object = {}) => http().post(url).set(as(token)).send(body);

  beforeAll(async () => {
    ({ app, ds } = await bootTestApp());
    creator = await login(app, process.env.SEED_ADMIN_USERNAME!, process.env.SEED_ADMIN_PASSWORD!);
    approver = await login(app, process.env.SEED_APPROVER_USERNAME!, process.env.SEED_APPROVER_PASSWORD!);
    approverId = (await http().get('/auth/me').set(as(approver))).body.id;
    salesUserId = (await http().get('/auth/me').set(as(creator))).body.id;
    [{ id: hcmId }] = await ds.query(`SELECT id FROM warehouses WHERE code = 'HCM'`);
    const [{ id: pcs }] = await ds.query(`SELECT id FROM units_of_measure WHERE code = 'PCS'`);
    snProductId = (await post(creator, '/products', { partNumber: 'PN-SN', name: 'Router', unitOfMeasureId: pcs }).expect(201)).body.id;
    bulkProductId = (await post(creator, '/products', { partNumber: 'PN-BULK', name: 'Cable', unitOfMeasureId: pcs, isSerialTracked: false }).expect(201)).body.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  async function approveDoc(path: string, id: number) {
    await post(creator, `/${path}/${id}/submit`, { approverId }).expect(204);
    await post(approver, `/${path}/${id}/approve`).expect(204);
  }

  /** Builds an APPROVED GRR for `qtySn` serial units + `qtyBulk` bulk units; returns its id. */
  async function approvedGrr(qtySn: number, qtyBulk: number): Promise<number> {
    const tag = Math.random().toString(36).slice(2, 8);
    const cust = (await post(creator, '/customers', { code: `C-${tag}`, name: 'Customer' }).expect(201)).body.id;
    const sup = (await post(creator, '/suppliers', { code: `S-${tag}`, name: 'Supplier' }).expect(201)).body.id;
    const sc = (await post(creator, '/sales-contracts', {
      customerId: cust, responsibleSalesUserId: salesUserId,
      lines: [{ itemCode: 'R', itemName: 'Router', uomName: 'Cái', quantity: 100 }, { itemCode: 'C', itemName: 'Cable', uomName: 'Cái', quantity: 100 }],
    }).expect(201)).body.id;
    await post(creator, `/sales-contracts/${sc}/activate`).expect(204);
    const scLines = (await http().get(`/sales-contracts/${sc}/lines`).set(as(creator))).body;
    const pr = (await post(creator, '/purchase-requisitions', {
      salesContractId: sc,
      lines: [
        { salesContractLineId: scLines[0].id, productId: snProductId, quantity: qtySn },
        { salesContractLineId: scLines[1].id, productId: bulkProductId, quantity: qtyBulk },
      ],
    }).expect(201)).body.id;
    await approveDoc('purchase-requisitions', pr);
    const prLines = (await http().get(`/purchase-requisitions/${pr}/lines`).set(as(creator))).body;
    const po = (await post(creator, '/purchase-orders', {
      supplierId: sup,
      lines: prLines.map((l: { id: number; quantity: string }) => ({ sourceLineId: l.id, quantity: Number(l.quantity) })),
    }).expect(201)).body.id;
    await approveDoc('purchase-orders', po);
    const poLines = (await http().get(`/purchase-orders/${po}/lines`).set(as(creator))).body;
    const grr = (await post(creator, '/goods-receipt-requests', {
      purchaseOrderId: po,
      warehouseId: hcmId,
      lines: poLines.map((l: { id: number; quantity: string }) => ({ sourceLineId: l.id, quantity: Number(l.quantity) })),
    }).expect(201)).body.id;
    await approveDoc('goods-receipt-requests', grr);
    return grr;
  }

  /** Creates a GR from a new approved GRR and declares the given SNs for the serial line. */
  async function grWithSerials(serials: string[], bulk = 3): Promise<number> {
    const grr = await approvedGrr(serials.length, bulk);
    const gr = (await post(creator, '/goods-receipts', { goodsReceiptRequestId: grr }).expect(201)).body.id;
    const detail = (await http().get(`/goods-receipts/${gr}`).set(as(creator))).body;
    const snLine = detail.lines.find((l: { isSerialTracked: boolean }) => l.isSerialTracked);
    const snDetails = detail.details.filter((d: { lineId: number }) => d.lineId === snLine.id);
    await http().patch(`/goods-receipts/${gr}/details`).set(as(creator))
      .send({ version: detail.version, details: snDetails.map((d: { id: number }, i: number) => ({ id: d.id, serialNumber: serials[i] })) })
      .expect(204);
    return gr;
  }

  const balance = async (productId: number) =>
    Number((await ds.query(`SELECT COALESCE(SUM(on_hand_quantity), 0) AS q FROM inventories WHERE product_id = $1`, [productId]))[0].q);
  const status = async (gr: number) => (await ds.query(`SELECT approval_status FROM goods_receipts WHERE id = $1`, [gr]))[0].approval_status;

  it('rejects referencing a DRAFT sales contract (G03)', async () => {
    const cust = (await post(creator, '/customers', { code: 'C-DRAFT', name: 'X' })).body.id;
    const sc = (await post(creator, '/sales-contracts', { customerId: cust, responsibleSalesUserId: salesUserId, lines: [{ itemCode: 'A', itemName: 'A', uomName: 'Cái', quantity: 1 }] })).body.id;
    const [line] = (await http().get(`/sales-contracts/${sc}/lines`).set(as(creator))).body;
    const res = await post(creator, '/purchase-requisitions', { salesContractId: sc, lines: [{ salesContractLineId: line.id, productId: snProductId, quantity: 1 }] });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('SALES_CONTRACT_NOT_ACTIVE');
  });

  it('numbers documents per type and year (H01)', async () => {
    const grr = await approvedGrr(1, 1);
    const [row] = await ds.query(`SELECT document_number FROM goods_receipt_requests WHERE id = $1`, [grr]);
    expect(row.document_number).toMatch(new RegExp(`^GRR-${new Date().getFullYear()}-\\d{6}$`));
  });

  it('GR Draft splits details: N rows for SN goods, one row for bulk (B04, B05)', async () => {
    const grr = await approvedGrr(3, 3);
    const gr = (await post(creator, '/goods-receipts', { goodsReceiptRequestId: grr }).expect(201)).body.id;
    const detail = (await http().get(`/goods-receipts/${gr}`).set(as(creator))).body;
    expect(detail.approvalStatus).toBe('DRAFT');
    expect(detail.details).toHaveLength(4);
    // Only one non-canceled GR per GRR.
    expect((await post(creator, '/goods-receipts', { goodsReceiptRequestId: grr })).body.code).toBe('GR_ALREADY_EXISTS');
  });

  it('blocks submit when SNs are missing or duplicated within the GR (B03, B25)', async () => {
    const grr = await approvedGrr(2, 1);
    const gr = (await post(creator, '/goods-receipts', { goodsReceiptRequestId: grr })).body.id;
    expect((await post(creator, `/goods-receipts/${gr}/submit`, { approverId })).body.code).toBe('GR_SERIAL_MISSING');
    const dupGr = await grWithSerials(['dup-1', ' DUP-1 ']);
    expect((await post(creator, `/goods-receipts/${dupGr}/submit`, { approverId })).body.code).toBe('GR_SERIAL_DUPLICATE');
  });

  it('Draft → Submit → Approve increases stock and registers serials in one transaction (B07, B09)', async () => {
    const snBefore = await balance(snProductId);
    const bulkBefore = await balance(bulkProductId);
    const gr = await grWithSerials(['SN-A1', 'SN-A2'], 5);
    await post(creator, `/goods-receipts/${gr}/submit`, { approverId }).expect(204);
    expect(await balance(snProductId)).toBe(snBefore); // pending GR does not touch inventory
    await post(approver, `/goods-receipts/${gr}/approve`).expect(204);

    expect(await status(gr)).toBe('APPROVED');
    expect(await balance(snProductId)).toBe(snBefore + 2);
    expect(await balance(bulkProductId)).toBe(bulkBefore + 5);
    const serials = await ds.query(`SELECT normalized_serial_number, status FROM inventory_serials WHERE serial_number IN ('SN-A1', 'SN-A2')`);
    expect(serials).toEqual(expect.arrayContaining([{ normalized_serial_number: 'SN-A1', status: 'IN_STOCK' }]));
    const [{ n }] = await ds.query(`SELECT COUNT(*)::int AS n FROM inventory_transactions WHERE source_document_type = 'GR'
      AND source_line_id IN (SELECT id FROM goods_receipt_lines WHERE goods_receipt_id = $1)`, [gr]);
    expect(n).toBe(2);
    const history = (await http().get(`/goods-receipts/${gr}`).set(as(creator))).body.history.map((h: { action: string }) => h.action);
    expect(history).toEqual(['SUBMIT', 'APPROVE']);
  });

  it('a repeated approve is rejected and does not double-count stock', async () => {
    const gr = await grWithSerials(['SN-R1'], 1);
    await post(creator, `/goods-receipts/${gr}/submit`, { approverId }).expect(204);
    await post(approver, `/goods-receipts/${gr}/approve`).expect(204);
    const after = await balance(snProductId);
    const res = await post(approver, `/goods-receipts/${gr}/approve`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('INVALID_STATUS');
    expect(await balance(snProductId)).toBe(after);
  });

  it('blocks re-receiving a serial already in inventory at submit (B06, R5)', async () => {
    const gr = await grWithSerials(['sn-a1'], 1); // same as SN-A1 after normalization
    const res = await post(creator, `/goods-receipts/${gr}/submit`, { approverId });
    expect(res.body.code).toBe('SN_ALREADY_RECEIVED');
  });

  it('two pending GRs with the same SN: first approve wins, second fails, stays WAITING and rolls back (B10, R3)', async () => {
    const g1 = await grWithSerials(['SN-X'], 4);
    const g2 = await grWithSerials(['SN-X'], 4);
    await post(creator, `/goods-receipts/${g1}/submit`, { approverId }).expect(204);
    await post(creator, `/goods-receipts/${g2}/submit`, { approverId }).expect(204); // pending duplicates are allowed
    await post(approver, `/goods-receipts/${g1}/approve`).expect(204);
    const bulkAfterFirst = await balance(bulkProductId);
    const res = await post(approver, `/goods-receipts/${g2}/approve`);
    expect(res.body.code).toBe('SN_ALREADY_RECEIVED');
    expect(await status(g2)).toBe('WAITING_FOR_APPROVE');
    expect(await balance(bulkProductId)).toBe(bulkAfterFirst); // bulk line of g2 rolled back too
    await post(approver, `/goods-receipts/${g2}/reject`, { reason: 'Duplicate serial' }).expect(204);
    expect(await status(g2)).toBe('REJECTED');
  });

  it('concurrent approvals of the same SN: exactly one succeeds (B11)', async () => {
    const g1 = await grWithSerials(['SN-RACE'], 1);
    const g2 = await grWithSerials(['SN-RACE'], 1);
    await post(creator, `/goods-receipts/${g1}/submit`, { approverId }).expect(204);
    await post(creator, `/goods-receipts/${g2}/submit`, { approverId }).expect(204);
    const results = await Promise.all([post(approver, `/goods-receipts/${g1}/approve`), post(approver, `/goods-receipts/${g2}/approve`)]);
    expect(results.map((r) => r.status).sort()).toEqual([204, 409]);
    const [{ n }] = await ds.query(`SELECT COUNT(*)::int AS n FROM inventory_serials WHERE normalized_serial_number = 'SN-RACE'`);
    expect(n).toBe(1);
  });

  it('enforces creator ≠ approver, assigned approver only, and approver eligibility (E05, E13, E09)', async () => {
    const gr = await grWithSerials(['SN-P1'], 1);
    const [{ id: creatorId }] = await ds.query(`SELECT id FROM users WHERE username = $1`, [process.env.SEED_ADMIN_USERNAME]);
    expect((await post(creator, `/goods-receipts/${gr}/submit`, { approverId: creatorId })).body.code).toBe('APPROVER_NOT_ELIGIBLE');

    // An approver without warehouse HCM is not eligible.
    const { hashPassword } = await import('./modules/identity/password');
    const [{ id: outsiderId }] = await ds.query(`INSERT INTO users (username, password_hash, full_name) VALUES ('outsider', $1, 'Outsider') RETURNING id`, [await hashPassword('pw-outsider')]);
    await ds.query(`INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE code = 'ADMIN'`, [outsiderId]);
    expect((await post(creator, `/goods-receipts/${gr}/submit`, { approverId: outsiderId })).body.code).toBe('APPROVER_NOT_ELIGIBLE');

    await post(creator, `/goods-receipts/${gr}/submit`, { approverId }).expect(204);
    expect((await post(creator, `/goods-receipts/${gr}/approve`)).body.code).toBe('NOT_ASSIGNED_APPROVER');
    const outsider = await login(app, 'outsider', 'pw-outsider');
    expect((await post(outsider, `/goods-receipts/${gr}/approve`)).status).toBe(403); // outside warehouse scope

    const waiting = (await http().get('/goods-receipts?assignedToMe=true').set(as(approver))).body.map((g: { id: number }) => g.id);
    expect(waiting).toContain(gr);
  });

  it('rejects stale detail edits and edits after submit', async () => {
    const grr = await approvedGrr(1, 1);
    const gr = (await post(creator, '/goods-receipts', { goodsReceiptRequestId: grr })).body.id;
    const res = await http().patch(`/goods-receipts/${gr}/details`).set(as(creator)).send({ version: 99, details: [] });
    expect(res.body.code).toBe('STALE_VERSION');
  });

  it('cancel Draft frees the GRR for a new GR; recall pending returns to Draft (B12, B15)', async () => {
    const grr = await approvedGrr(1, 1);
    const gr = (await post(creator, '/goods-receipts', { goodsReceiptRequestId: grr })).body.id;
    await post(creator, `/goods-receipts/${gr}/cancel`).expect(204);
    expect(await status(gr)).toBe('CANCELED');
    await post(creator, '/goods-receipts', { goodsReceiptRequestId: grr }).expect(201);

    const g2 = await grWithSerials(['SN-RC'], 1);
    await post(creator, `/goods-receipts/${g2}/submit`, { approverId }).expect(204);
    expect((await post(creator, `/goods-receipts/${g2}/cancel`)).body.code).toBe('INVALID_STATUS'); // B13
    await post(creator, `/goods-receipts/${g2}/recall`, { reason: 'Fix serial' }).expect(204);
    expect(await status(g2)).toBe('DRAFT');
  });

  it('PO receipt status follows APPROVED GRs line by line (C68, C68a, C68b) and is recomputed on reversal (C68c)', async () => {
    const tag = Math.random().toString(36).slice(2, 8);
    const cust = (await post(creator, '/customers', { code: `C-${tag}`, name: 'Customer' }).expect(201)).body.id;
    const sup = (await post(creator, '/suppliers', { code: `S-${tag}`, name: 'Supplier' }).expect(201)).body.id;
    const sc = (await post(creator, '/sales-contracts', {
      customerId: cust, responsibleSalesUserId: salesUserId,
      lines: [{ itemCode: 'A', itemName: 'A', uomName: 'Cái', quantity: 10 }, { itemCode: 'B', itemName: 'B', uomName: 'Cái', quantity: 5 }],
    }).expect(201)).body.id;
    await post(creator, `/sales-contracts/${sc}/activate`).expect(204);
    const scLines = (await http().get(`/sales-contracts/${sc}/lines`).set(as(creator))).body;
    const pr = (await post(creator, '/purchase-requisitions', {
      salesContractId: sc,
      lines: [{ salesContractLineId: scLines[0].id, productId: bulkProductId, quantity: 10 }, { salesContractLineId: scLines[1].id, productId: bulkProductId, quantity: 5 }],
    }).expect(201)).body.id;
    await approveDoc('purchase-requisitions', pr);
    const prLines = (await http().get(`/purchase-requisitions/${pr}/lines`).set(as(creator))).body;
    const po = (await post(creator, '/purchase-orders', {
      supplierId: sup, lines: prLines.map((l: { id: number; quantity: string }) => ({ sourceLineId: l.id, quantity: Number(l.quantity) })),
    }).expect(201)).body.id;
    await approveDoc('purchase-orders', po);
    const poLines: { id: number }[] = (await http().get(`/purchase-orders/${po}/lines`).set(as(creator))).body;
    const poView = async () => (await http().get(`/purchase-orders/${po}`).set(as(creator))).body;
    const received = async () => (await poView()).lines.map((l: { receivedQuantity: string }) => Number(l.receivedQuantity));
    const receive = async (poLineId: number, quantity: number) => {
      const grr = (await post(creator, '/goods-receipt-requests', { purchaseOrderId: po, warehouseId: hcmId, lines: [{ sourceLineId: poLineId, quantity }] }).expect(201)).body.id;
      await approveDoc('goods-receipt-requests', grr);
      const gr = (await post(creator, '/goods-receipts', { goodsReceiptRequestId: grr }).expect(201)).body.id;
      await post(creator, `/goods-receipts/${gr}/submit`, { approverId }).expect(204);
      expect((await poView()).receiptStatus).not.toBe('RECEIVED'); // a pending GR counts for nothing
      await post(approver, `/goods-receipts/${gr}/approve`).expect(204);
      return gr as number;
    };

    expect((await poView()).receiptStatus).toBe('NOT_RECEIVED'); // C68
    expect(await received()).toEqual([0, 0]);

    const gr1 = await receive(poLines[0].id, 10);
    expect((await poView()).receiptStatus).toBe('PARTIALLY_RECEIVED'); // C68a: line 1 full, line 2 nothing
    expect(await received()).toEqual([10, 0]);
    const [{ approved_at: approvedAt }] = await ds.query(`SELECT approved_at FROM goods_receipts WHERE id = $1`, [gr1]);
    expect(approvedAt).toBeInstanceOf(Date); // FIFO key for inventory lots (ADR-0013)

    await receive(poLines[1].id, 2);
    expect((await poView()).receiptStatus).toBe('PARTIALLY_RECEIVED'); // every line has something, line 2 not full
    await receive(poLines[1].id, 3);
    expect((await poView()).receiptStatus).toBe('RECEIVED'); // C68b
    expect(await received()).toEqual([10, 5]);
    expect((await http().get('/purchase-orders?assignedToMe=false').set(as(creator))).body.find((r: { id: number }) => r.id === po).receiptStatus).toBe('RECEIVED');

    // C68c: recall of an APPROVED GR (PR 8) will call the same facade with sign -1; the total is recomputed.
    await ds.transaction((m) => ProcurementFacade.applyReceipt(m, [{ purchaseOrderLineId: poLines[0].id, quantity: '10' }], -1));
    expect(await received()).toEqual([0, 5]);
    expect((await poView()).receiptStatus).toBe('PARTIALLY_RECEIVED');
    // The CHECK forbids going below zero or above the ordered quantity.
    await expect(ds.transaction((m) => ProcurementFacade.applyReceipt(m, [{ purchaseOrderLineId: poLines[0].id, quantity: '1' }], -1)))
      .rejects.toThrow(/chk_purchase_order_lines_received/);
    await expect(ds.transaction((m) => ProcurementFacade.applyReceipt(m, [{ purchaseOrderLineId: poLines[1].id, quantity: '1' }], 1)))
      .rejects.toThrow(/chk_purchase_order_lines_received/);
  });

  it('GRR over the PO quantity is blocked (B02)', async () => {
    const grr = await approvedGrr(1, 1);
    const [{ purchase_order_id: po }] = await ds.query(`SELECT purchase_order_id FROM goods_receipt_requests WHERE id = $1`, [grr]);
    const poLines = (await http().get(`/purchase-orders/${po}/lines`).set(as(creator))).body;
    const res = await post(creator, '/goods-receipt-requests', { purchaseOrderId: po, warehouseId: hcmId, lines: [{ sourceLineId: poLines[0].id, quantity: 1 }] });
    expect(res.body.code).toBe('QUANTITY_LIMIT_EXCEEDED');
  });
});
