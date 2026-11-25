import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { CommonDocumentRecords1732492800000 } from './database/migrations/1732492800000-CommonDocumentRecords';
import { appendActivity } from './modules/document-records/document-records';
import { bootTestApp, login, PCS_UOM_ID as pcs } from './test-utils';
import { prContext, prSubmission } from './test-utils';

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
    await ds.query(`INSERT INTO user_roles (user_id, role_id)
      SELECT u.id, r.id FROM users u CROSS JOIN roles r WHERE u.username = $1 AND r.code = 'SALES'`, [process.env.SEED_ADMIN_USERNAME]);
    admin = await login(app, process.env.SEED_ADMIN_USERNAME!, process.env.SEED_ADMIN_PASSWORD!);
    approver = await login(app, process.env.SEED_APPROVER_USERNAME!, process.env.SEED_APPROVER_PASSWORD!);
    approverId = (await get(approver, '/auth/me')).body.id;
    [{ id: hcmId }] = await ds.query(`SELECT id FROM warehouses WHERE code = 'HCM'`);
    const [{ id: pcs }] = await ds.query(`SELECT id FROM units_of_measure WHERE code = 'PCS'`);
    productId = (await post(admin, '/products', { brandId: 1, partNumber: 'PN-P1', name: 'Switch', unitOfMeasureId: pcs, isSerialTracked: false }).expect(201)).body.id;
    customerId = (await post(admin, '/customers', { code: 'C1', name: 'Customer 1' }).expect(201)).body.id;
    supplierId = (await post(admin, '/suppliers', { code: 'S1', name: 'Supplier 1' }).expect(201)).body.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  async function activeContract(qty = 10) {
    const sc = (await post(admin, '/sales-contracts', { customerId, responsibleSalesUserId: (await get(admin, '/auth/me')).body.id, lines: [{ itemCode: 'SW', itemName: 'Switch 24 port', unitOfMeasureId: pcs, quantity: qty }] }).expect(201)).body.id;
    await post(admin, `/sales-contracts/${sc}/activate`).expect(204);
    const [line] = (await get(admin, `/sales-contracts/${sc}`).expect(200)).body.lines;
    return { sc: sc as number, lineId: line.id as number };
  }

  async function approved(path: string, id: number) {
    if (path === 'purchase-requisitions') {
      await post(admin, `/${path}/${id}/submit`, await prSubmission(ds, id)).expect(204);
      await post(await login(app, 'sales-head', 'role-users-test'), `/${path}/${id}/approve`, await prContext(ds, id)).expect(204);
      await post(await login(app, 'purchaser', 'role-users-test'), `/${path}/${id}/receive`, await prContext(ds, id)).expect(204);
      return;
    }
    await post(admin, `/${path}/${id}/submit`, { approverId }).expect(204);
    await post(approver, `/${path}/${id}/approve`).expect(204);
  }

  it('atomically submits a new or edited PR and deduplicates concurrent creation', async () => {
    const { sc, lineId } = await activeContract();
    const [{ approverId, receiverId }] = await ds.query(`SELECT
      (SELECT id FROM users WHERE username = 'sales-head') AS "approverId",
      (SELECT id FROM users WHERE username = 'purchaser') AS "receiverId"`);
    const path = '/purchase-requisitions';
    const payload = { salesContractId: sc, requestKey: `a${randomUUID().slice(1)}`, submit: true, approverId, receiverId,
      lines: [{ salesContractLineId: lineId, productId, quantity: 1 }] };
    await ds.query(`CREATE FUNCTION phase41_fail_task() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'phase41 rollback fixture'; END $$;
      CREATE TRIGGER phase41_fail_task BEFORE INSERT ON pr_notifications
      FOR EACH ROW EXECUTE FUNCTION phase41_fail_task()`);
    try {
      await post(admin, `${path}/save-new`, payload).expect(500);
      expect(await ds.query('SELECT id FROM purchase_requisitions WHERE sales_contract_id = $1', [sc])).toEqual([]);
      const draft = (await post(admin, `${path}/save-new`, { ...payload, requestKey: randomUUID(), submit: false }).expect(201)).body;
      const prior = (await get(admin, `${path}/${draft.id}`).expect(200)).body;
      const update = { version: prior.version, round: 0, step: 'CREATE', approverId, receiverId,
        lines: [{ ...payload.lines[0], id: prior.lines[0].id, quantity: 3 }] };
      const save = () => http().patch(`${path}/${draft.id}/submit-edited`).set(as(admin)).send(update);
      await save().expect(500);
      const unchanged = (await get(admin, `${path}/${draft.id}`).expect(200)).body;
      expect(unchanged).toMatchObject({ approvalStatus: 'DRAFT', version: prior.version, lines: prior.lines, history: prior.history });
      await ds.query('DROP TRIGGER phase41_fail_task ON pr_notifications');
      await save().expect(204);
      const submitted = (await get(admin, `${path}/${draft.id}`).expect(200)).body;
      expect(submitted).toMatchObject({ approvalStatus: 'WAITING_FOR_APPROVE', approvalRound: 1, lines: [{ quantity: '3.000' }] });
    } finally {
      await ds.query('DROP TRIGGER IF EXISTS phase41_fail_task ON pr_notifications; DROP FUNCTION phase41_fail_task()');
    }
    const [first, retry] = await Promise.all([
      post(admin, `${path}/save-new`, payload).expect(201),
      post(admin, `${path}/save-new`, { ...payload, requestKey: payload.requestKey.toUpperCase() }).expect(201),
    ]);
    expect(retry.body).toEqual(first.body);
    const created = (await get(admin, `${path}/${first.body.id}`).expect(200)).body;
    expect(created).toMatchObject({ approvalStatus: 'WAITING_FOR_APPROVE', approvalRound: 1 });
    expect(await ds.query('SELECT id FROM pr_notifications WHERE pr_id = $1', [created.id])).toHaveLength(1);
    await post(admin, `${path}/save-new`, { ...payload, submit: false }).expect(409);
  });

  it('Phase 1: migrates legacy PR notes and history without changing their identity', async () => {
    const { sc, lineId } = await activeContract();
    const { id } = (await post(admin, '/purchase-requisitions', { salesContractId: sc, lines: [{ salesContractLineId: lineId, productId, quantity: 1 }] }).expect(201)).body;
    const runner = ds.createQueryRunner();
    await runner.startTransaction();
    try {
      const migration = new CommonDocumentRecords1732492800000();
      await migration.down(runner);
      await runner.query(`INSERT INTO pr_notes (id, pr_id, author_id, body, created_at)
        VALUES (9, $1, $2, 'legacy note', '2026-11-01T00:00:00Z')`, [id, approverId]);
      const history = await runner.query(`INSERT INTO approval_histories (document_type, document_id, action, actor_id)
        VALUES ('PO', 1, 'APPROVE', $1) RETURNING id`, [approverId]);
      await migration.up(runner);
      const [note] = await runner.query('SELECT * FROM document_notes WHERE id = 9');
      expect(note).toMatchObject({ target_type: 'PR', target_id: id, author_id: approverId, body: 'legacy note',
        created_at: new Date('2026-11-01T00:00:00Z') });
      expect(await runner.query('SELECT id FROM approval_histories WHERE id = $1', [history[0].id])).toEqual(history);
      const [next] = await runner.query(`INSERT INTO document_notes (target_type, target_id, author_id, body)
        VALUES ('PR', $1, $2, 'new note') RETURNING id`, [id, approverId]);
      expect(next.id).toBeGreaterThan(9);
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  });

  it('Phase 1: paginates PR records newest first and enforces the PR read scope', async () => {
    const { sc, lineId } = await activeContract();
    const { id } = (await post(admin, '/purchase-requisitions', { salesContractId: sc, lines: [{ salesContractLineId: lineId, productId, quantity: 1 }] }).expect(201)).body;
    const path = `/purchase-requisitions/${id}`;
    const outsider = await login(app, 'sales', 'role-users-test');
    const head = await login(app, 'sales-head', 'role-users-test');
    await get(outsider, `${path}/notes`).expect(403);
    await get(outsider, `${path}/history`).expect(403);
    await post(outsider, `${path}/notes`, { body: 'outside scope' }).expect(403);
    await get(admin, '/purchase-requisitions/999999/history').expect(404);
    await get(admin, '/purchase-requisitions/999999/notes').expect(404);
    await post(admin, '/purchase-requisitions/999999/notes', { body: 'missing' }).expect(404);
    await approved('purchase-requisitions', id);
    await post(head, `${path}/notes`, { body: 'done note' }).expect(204);
    await ds.query(`INSERT INTO document_notes (target_type, target_id, author_id, body)
      SELECT 'PR', $1, $2, 'note ' || n FROM generate_series(1, 25) n`, [id, approverId]);
    await ds.query(`INSERT INTO document_notes (target_type, target_id, author_id, body)
      VALUES ('PO', $1, $2, 'other target')`, [id, approverId]);
    await expect(ds.query(`INSERT INTO document_notes (target_type, target_id, author_id, body)
      VALUES ('UNKNOWN', $1, $2, 'unsupported target')`, [id, approverId])).rejects.toThrow(/check constraint/);
    for (let i = 0; i < 23; i++) {
      await appendActivity(ds.manager, 'PR', id, 'EDIT', approverId, 'fixture reason', { round: 1, metadata: { i } });
    }
    for (const kind of ['notes', 'history']) {
      const first = (await get(head, `${path}/${kind}`).expect(200)).body;
      if (kind === 'notes') await post(head, `${path}/notes`, { body: 'arrived after page one' }).expect(204);
      else await appendActivity(ds.manager, 'PR', id, 'EDIT', approverId);
      const second = (await get(head, `${path}/${kind}?before=${first.nextCursor}`).expect(200)).body;
      expect(first.items).toHaveLength(25);
      expect(second.items).toHaveLength(1);
      expect(second.nextCursor).toBeNull();
      expect(JSON.stringify([first.items, second.items])).not.toMatch(/other target|arrived after page one/);
      const ids = [...first.items, ...second.items].map((item: { id: number }) => item.id);
      expect(ids).toEqual([...new Set(ids)].sort((a, b) => b - a));
      if (kind === 'history') expect(first.items[0]).toMatchObject({ reason: 'fixture reason', metadata: { i: 22 } });
    }
    await expect(ds.query(`UPDATE approval_histories SET reason = 'tampered' WHERE document_type = 'PR' AND document_id = $1`, [id])).rejects.toThrow('append-only');
    await expect(ds.query(`DELETE FROM approval_histories WHERE document_type = 'PR' AND document_id = $1`, [id])).rejects.toThrow('append-only');
    await expect(ds.query('TRUNCATE approval_histories')).rejects.toThrow('append-only');
  });

  it('HĐ: unknown customer is rejected; detail returns lines; cancel blocked while a PR is not canceled (03 §9.1)', async () => {
    expect((await post(admin, '/sales-contracts', { customerId: 999999, lines: [{ itemCode: 'X', itemName: 'X', unitOfMeasureId: pcs, quantity: 1 }] })).body.code).toBe('CUSTOMER_NOT_FOUND');
    const { sc, lineId } = await activeContract();
    const detail = (await get(admin, `/sales-contracts/${sc}`).expect(200)).body;
    expect(detail).toMatchObject({ status: 'ACTIVE', customerName: 'Customer 1' });
    const pr = (await post(admin, '/purchase-requisitions', { salesContractId: sc, lines: [{ salesContractLineId: lineId, productId, quantity: 2 }] }).expect(201)).body.id;
    expect((await post(admin, `/sales-contracts/${sc}/cancel`).expect(409)).body.code).toBe('SALES_CONTRACT_IN_USE');
    await post(admin, `/purchase-requisitions/${pr}/cancel`, await prContext(ds, pr)).expect(204);
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
    await post(sales, '/purchase-requisitions', { salesContractId: sc, lines: [] }).expect(400);
  });

  it('PR: list/detail, reject needs a reason, rejected PR can be canceled', async () => {
    const { sc, lineId } = await activeContract();
    const pr = (await post(admin, '/purchase-requisitions', { salesContractId: sc, lines: [{ salesContractLineId: lineId, productId, quantity: 3 }] }).expect(201)).body.id;
    await post(admin, `/purchase-requisitions/${pr}/submit`, await prSubmission(ds, pr)).expect(204);
    expect((await get(await login(app, 'sales-head', 'role-users-test'), '/purchase-requisitions?assignedToMe=true').expect(200)).body.map((r: { id: number }) => r.id)).toContain(pr);
    await post(await login(app, 'sales-head', 'role-users-test'), `/purchase-requisitions/${pr}/reject`, await prContext(ds, pr)).expect(400);
    await post(await login(app, 'sales-head', 'role-users-test'), `/purchase-requisitions/${pr}/reject`, { ...await prContext(ds, pr), reason: 'Sai số lượng' }).expect(204);
    const detail = (await get(admin, `/purchase-requisitions/${pr}`).expect(200)).body;
    expect(detail).toMatchObject({ approvalStatus: 'REJECTED', salesContractNumber: expect.stringMatching(/^SC-/) });
    expect(detail.lines[0]).toMatchObject({ partNumber: 'PN-P1', ref: 'Switch 24 port' });
    expect(detail.history.map((h: { action: string }) => h.action)).toEqual(['REJECT', 'SUBMIT']);
    await post(admin, `/purchase-requisitions/${pr}/cancel`, await prContext(ds, pr)).expect(204);
  });

  it('PR18: snapshots both assignments, recalls either step, blocks PO until receipt, and preserves rounds', async () => {
    const { sc, lineId } = await activeContract();
    const salesHead = await login(app, 'sales-head', 'role-users-test');
    const receiver = await login(app, 'purchaser', 'role-users-test');
    const detailUrl = '/purchase-requisitions';
    const { id } = (await post(admin, detailUrl, { salesContractId: sc, lines: [{ salesContractLineId: lineId, productId, quantity: 3 }] }).expect(201)).body;
    const path = `${detailUrl}/${id}`;
    const sourceLineId = (await get(admin, path)).body.lines[0].id;
    const purchase = () => post(admin, '/purchase-orders', { supplierId, lines: [{ sourceLineId, quantity: 1 }] });

    await post(admin, `${path}/submit`, await prSubmission(ds, id)).expect(204);
    await post(approver, `${path}/approve`, await prContext(ds, id)).expect(403);
    await post(admin, `${path}/recall`, { ...await prContext(ds, id), reason: 'Sửa vòng 1' }).expect(204);
    await post(admin, `${path}/submit`, await prSubmission(ds, id)).expect(204);
    await post(salesHead, `${path}/approve`, await prContext(ds, id)).expect(204);
    await purchase().expect(422);
    await post(admin, `${path}/recall`, { ...await prContext(ds, id), reason: 'Sửa vòng 2' }).expect(204);
    await post(admin, `${path}/submit`, await prSubmission(ds, id)).expect(204);
    await post(salesHead, `${path}/approve`, await prContext(ds, id)).expect(204);
    await post(receiver, `${path}/reject`, { ...await prContext(ds, id), reason: 'Sai nguồn hàng' }).expect(204);
    await post(admin, `${path}/submit`, await prSubmission(ds, id)).expect(204);
    await post(salesHead, `${path}/approve`, await prContext(ds, id)).expect(204);
    await post(salesHead, `${path}/approve`, await prContext(ds, id)).expect(409);
    await post(receiver, `${path}/receive`, await prContext(ds, id)).expect(204);
    await purchase().expect(201);
    await post(admin, `${path}/recall`, { ...await prContext(ds, id), reason: 'X' }).expect(409);

    await post(receiver, `${path}/notes`, { body: 'Đã tiếp nhận' }).expect(204);
    const detail = (await get(admin, path).expect(200)).body;
    expect(detail.approvalStatus).toBe('DONE');
    expect(detail.notes).toMatchObject([{ body: 'Đã tiếp nhận' }]);
    expect(detail.nodes.filter((node: { invalidatedAt: string | null }) => node.invalidatedAt)).toHaveLength(4);
    expect(detail.history[0]).toMatchObject({ action: 'RECEIVE', round: 4, previousStatus: 'WAITING_FOR_RECEIPT', nextStatus: 'DONE' });
    for (const [actor, round] of [[salesHead, 1], [receiver, 2]] as const) {
      const notifications = (await get(actor, '/pr-notifications').expect(200)).body;
      expect(notifications.filter((n: { prId: number; action: string }) => n.prId === id && n.action === 'RECALL'))
        .toEqual([expect.objectContaining({ round })]);
    }
  });

  it('PR18: admin configures the PM route, and only the assigned PM can submit', async () => {
    const { sc } = await activeContract();
    const pm = await login(app, 'pm', 'role-users-test');
    const pmHead = await login(app, 'pm-head', 'role-users-test');
    const receiver = await login(app, 'purchaser', 'role-users-test');
    const pmId = (await get(pm, '/auth/me')).body.id;
    const approverId = (await get(pmHead, '/auth/me')).body.id;
    const requestBody = { salesContractId: sc, category: 'MATERIAL', lines: [{ productId, quantity: 1 }] };
    await post(pm, '/purchase-requisitions', requestBody).expect(403);
    await post(receiver, '/purchase-requisitions', requestBody).expect(403);
    const pmPath = `/pr-workflow/contracts/${sc}/responsible-pm`;
    await http().put(pmPath).set(as(pm)).send({ userId: pmId }).expect(403);
    await http().put(pmPath).set(as(admin)).send({ userId: pmId }).expect(204);
    const { id } = (await post(pm, '/purchase-requisitions', requestBody).expect(201)).body;
    const path = `/purchase-requisitions/${id}`;

    const candidates = (await get(pm, `${path}/candidates`).expect(200)).body;
    expect(candidates.approvers.map((user: { id: number }) => user.id)).toEqual([approverId]);
    await get(receiver, `${path}/candidates`).expect(403);
    await get(pm, '/pr-workflow/candidates').expect(403);
    const outside = await login(app, 'sales', 'role-users-test');
    await get(outside, `${path}/candidates`).expect(403);
    await get(outside, `/pr-workflow/creator-candidates?salesContractId=${sc}&route=PM`).expect(403);
    await post(pm, `${path}/submit`, await prSubmission(ds, id, 'SALES')).expect(422);
    await ds.query("DELETE FROM pr_candidate_pool_members WHERE pool = 'PM'");
    expect((await post(pm, `${path}/submit`, await prSubmission(ds, id, 'PM')).expect(422)).body.code).toBe('PR_CANDIDATE_NOT_ELIGIBLE');
    await http().put('/pr-workflow/routes/PM').set(as(admin)).send({ userIds: [approverId] }).expect(204);
    await post(pm, `${path}/submit`, await prSubmission(ds, id, 'PM')).expect(204);
    await post(receiver, `${path}/approve`, await prContext(ds, id)).expect(403);
    await post(pmHead, `${path}/approve`, await prContext(ds, id)).expect(204);
    await post(receiver, `${path}/receive`, await prContext(ds, id)).expect(204);
    expect((await get(pm, path).expect(200)).body.approvalStatus).toBe('DONE');
  });

  it('Phase 2: serializes duplicate approval and revalidates the current assignee and grants', async () => {
    const { sc, lineId } = await activeContract();
    const head = await login(app, 'sales-head', 'role-users-test');
    const headId = (await get(head, '/auth/me')).body.id;
    const creatorId = (await get(admin, '/auth/me')).body.id;
    const original = await ds.query(`SELECT user_id FROM pr_candidate_pool_members WHERE pool = 'RECEIPT'`);
    const receiverIds = original.map((row: { user_id: number }) => row.user_id);
    await ds.query(`INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE code = 'PURCHASING'`, [headId]);
    const configure = (pool: string, userIds: number[]) => http().put(`/pr-workflow/routes/${pool}`).set(as(admin)).send({ userIds }).expect(204);
    try {
      await configure('SALES', [headId, creatorId]);
      await configure('RECEIPT', [headId, creatorId]);
      const { id } = (await post(admin, '/purchase-requisitions', { salesContractId: sc,
        lines: [{ salesContractLineId: lineId, productId, quantity: 1 }], approverId: headId, receiverId: headId }).expect(201)).body;
      const path = `/purchase-requisitions/${id}`;
      expect((await get(admin, path)).body).toMatchObject({ draftApproverId: headId, draftReceiverId: headId });
      expect((await get(admin, `${path}/candidates`)).body.approvers.map((u: { id: number }) => u.id)).toEqual([headId]);
      const submitContext = { ...await prContext(ds, id), approverId: headId, receiverId: headId };
      await post(admin, `${path}/submit`, { ...submitContext, approverId: creatorId }).expect(422);
      await post(admin, `${path}/submit`, { ...submitContext, receiverId: creatorId }).expect(422);
      await post(admin, `${path}/submit`, {}).expect(400);
      await post(admin, `${path}/submit`, submitContext).expect(204);
      await post(admin, `${path}/submit`, submitContext).expect(409);
      const approvalContext = await prContext(ds, id);
      for (const stale of [{ version: 1 }, { round: 0 }, { step: 'RECEIPT' }]) {
        const response = await post(head, `${path}/approve`, { ...approvalContext, ...stale }).expect(409);
        expect(response.body.code).toBe('STALE_WORKFLOW_CONTEXT');
      }
      const outcomes = await Promise.all([post(head, `${path}/approve`, approvalContext), post(head, `${path}/approve`, approvalContext)]);
      expect(outcomes.map(result => result.status).sort()).toEqual([204, 409]);
      const receiptContext = await prContext(ds, id);
      await post(head, `${path}/approve`, receiptContext).expect(409);
      await configure('RECEIPT', []);
      await post(head, `${path}/receive`, receiptContext).expect(403);
      expect((await get(admin, path)).body).toMatchObject({ approvalStatus: 'WAITING_FOR_RECEIPT', assignedApproverId: headId });
      await configure('RECEIPT', [headId]);
      await ds.query('UPDATE users SET is_active = false WHERE id = $1', [headId]);
      await post(head, `${path}/receive`, receiptContext).expect(401);
      await ds.query('UPDATE users SET is_active = true WHERE id = $1', [headId]);
      await ds.query(`DELETE FROM user_roles WHERE user_id = $1 AND role_id = (SELECT id FROM roles WHERE code = 'PURCHASING')`, [headId]);
      await post(head, `${path}/receive`, receiptContext).expect(403);
      await ds.query(`INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE code = 'PURCHASING'`, [headId]);

      await ds.query(`CREATE FUNCTION fail_pr_receive_fixture() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'notification fixture failure'; END $$;
        CREATE TRIGGER fail_pr_receive_fixture BEFORE INSERT ON pr_notifications
        FOR EACH ROW WHEN (NEW.action = 'RECEIVE') EXECUTE FUNCTION fail_pr_receive_fixture()`);
      try {
        const before = (await get(admin, path)).body;
        await post(head, `${path}/receive`, receiptContext).expect(500);
        expect((await get(admin, path)).body).toEqual(before);
        expect(await ds.query("SELECT id FROM pr_notifications WHERE pr_id = $1 AND action = 'RECEIVE'", [id])).toEqual([]);
      } finally {
        await ds.query('DROP TRIGGER fail_pr_receive_fixture ON pr_notifications; DROP FUNCTION fail_pr_receive_fixture()');
      }
      await ds.query(`CREATE FUNCTION fail_pr_history_fixture() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'history fixture failure'; END $$;
        CREATE TRIGGER fail_pr_history_fixture BEFORE INSERT ON approval_histories
        FOR EACH ROW WHEN (NEW.document_type = 'PR' AND NEW.action = 'RECEIVE') EXECUTE FUNCTION fail_pr_history_fixture()`);
      try {
        const before = (await get(admin, path)).body;
        await post(head, `${path}/receive`, receiptContext).expect(500);
        expect((await get(admin, path)).body).toEqual(before);
        expect(await ds.query("SELECT id FROM pr_notifications WHERE pr_id = $1 AND action = 'RECEIVE'", [id])).toEqual([]);
      } finally {
        await ds.query('DROP TRIGGER fail_pr_history_fixture ON approval_histories; DROP FUNCTION fail_pr_history_fixture()');
      }
      await post(head, `${path}/receive`, receiptContext).expect(204);
      expect((await get(admin, path)).body.approvalStatus).toBe('DONE');
    } finally {
      await ds.query('UPDATE users SET is_active = true WHERE id = $1', [headId]);
      await configure('SALES', [headId]);
      await configure('RECEIPT', receiverIds);
      await ds.query(`DELETE FROM user_roles WHERE user_id = $1 AND role_id = (SELECT id FROM roles WHERE code = 'PURCHASING')`, [headId]);
    }
  });

  it('Phase 2: draft and submit enforce the PR line invariant', async () => {
    const { sc, lineId } = await activeContract();
    const line = { salesContractLineId: lineId, productId, quantity: 1 };
    await post(admin, '/purchase-requisitions', { salesContractId: sc, lines: [] }).expect(400);
    await post(admin, '/purchase-requisitions', { salesContractId: sc, lines: [line, { ...line, quantity: 0 }] }).expect(400);
    const { id } = (await post(admin, '/purchase-requisitions', { salesContractId: sc, lines: [line] }).expect(201)).body;
    await ds.query('DELETE FROM purchase_requisition_lines WHERE purchase_requisition_id = $1', [id]);
    const response = await post(admin, `/purchase-requisitions/${id}/submit`, await prSubmission(ds, id)).expect(422);
    expect(response.body.code).toBe('PR_LINES_REQUIRED');
  });

  it('Phase 3: enforces the reassignment matrix and preserves the current round and document scope', async () => {
    const { sc, lineId } = await activeContract();
    const head = await login(app, 'sales-head', 'role-users-test');
    const replacement = await login(app, 'pm-head', 'role-users-test');
    const receiver = await login(app, 'purchaser', 'role-users-test');
    const headId = (await get(head, '/auth/me')).body.id;
    const replacementId = (await get(replacement, '/auth/me')).body.id;
    const receiverId = (await get(receiver, '/auth/me')).body.id;
    const creatorId = (await get(admin, '/auth/me')).body.id;
    const configure = (pool: string, userIds: number[]) => http().put(`/pr-workflow/routes/${pool}`).set(as(admin)).send({ userIds }).expect(204);
    await configure('SALES', [headId, replacementId]);
    await configure('RECEIPT', [receiverId, approverId]);
    try {
      const { id } = (await post(admin, '/purchase-requisitions', {
        salesContractId: sc, lines: [{ salesContractLineId: lineId, productId, quantity: 1 }],
      }).expect(201)).body;
      const path = `/purchase-requisitions/${id}`;
      const reassign = async (actor: string, assigneeId: number, reason = 'Handover') =>
        post(actor, `${path}/reassign`, { ...await prContext(ds, id), assigneeId, reason });
      expect((await reassign(admin, replacementId)).status).toBe(409);
      await post(admin, `${path}/submit`, await prSubmission(ds, id)).expect(204);
      expect((await reassign(head, replacementId)).status).toBe(403);
      await get(head, `${path}/reassignment-candidates`).expect(403);
      expect((await reassign(receiver, replacementId)).status).toBe(403);
      const options = (await get(admin, `${path}/reassignment-candidates`).expect(200)).body;
      expect(options.current.id).toBe(headId);
      expect(options.candidates.map((user: { id: number }) => user.id)).toEqual([replacementId]);
      expect((await reassign(admin, headId)).body.code).toBe('PR_SAME_ASSIGNEE');
      expect((await reassign(admin, creatorId)).body.code).toBe('PR_CANDIDATE_NOT_ELIGIBLE');
      expect((await reassign(admin, receiverId)).body.code).toBe('PR_CANDIDATE_NOT_ELIGIBLE');
      expect((await reassign(admin, replacementId, '  ')).body.code).toBe('REASON_REQUIRED');
      const approval = await prContext(ds, id);
      for (const stale of [{ version: 1 }, { round: 0 }, { step: 'RECEIPT' }]) {
        expect((await post(admin, `${path}/reassign`, { ...approval, ...stale, assigneeId: replacementId, reason: 'Handover' })
          .expect(409)).body.code).toBe('STALE_WORKFLOW_CONTEXT');
      }
      expect((await reassign(admin, replacementId)).status).toBe(204);
      const detail = (await get(admin, path)).body;
      expect(detail).toMatchObject({ approvalStatus: 'WAITING_FOR_APPROVE', approvalRound: 1, version: approval.version + 1,
        assignedApproverId: replacementId, history: expect.arrayContaining([expect.objectContaining({
          action: 'REASSIGN', actorId: creatorId, previousStatus: 'WAITING_FOR_APPROVE', nextStatus: 'WAITING_FOR_APPROVE',
          reason: 'Handover', round: 1, createdAt: expect.any(String),
          metadata: { step: 'APPROVAL', from: { id: headId, fullName: expect.any(String) }, to: { id: replacementId, fullName: expect.any(String) } },
        })]) });
      await get(head, path).expect(403);
      await post(head, `${path}/notes`, { body: 'No longer in scope' }).expect(403);
      await post(head, `${path}/approve`, await prContext(ds, id)).expect(403);
      const notifications = async (actor: string) => (await get(actor, '/pr-notifications')).body.filter((n: { prId: number }) => n.prId === id);
      expect(await notifications(head)).toEqual(expect.arrayContaining([
        expect.objectContaining({ action: 'REQUEST_APPROVAL', resolvedAt: expect.any(String) }),
        expect.objectContaining({ action: 'REASSIGNED_AWAY', reason: 'Handover', taskStep: null }),
      ]));
      expect(await notifications(replacement)).toEqual([expect.objectContaining({ action: 'REQUEST_APPROVAL', resolvedAt: null })]);
      const oldTask = (await notifications(head)).find((n: { action: string }) => n.action === 'REQUEST_APPROVAL');
      await http().patch(`/pr-notifications/${oldTask.id}/read`).set(as(head)).expect(204);
      await get(head, path).expect(403);

      // PR.CONFIGURE alone does not grant reassignment. The same actor with PR.REASSIGN and PR.VIEW can reassign.
      await ds.query(`DELETE FROM role_permissions rp USING roles r, permissions p
        WHERE rp.role_id = r.id AND rp.permission_id = p.id AND r.code = 'ADMIN' AND p.code = 'PR.REASSIGN'`);
      try {
        expect((await reassign(approver, headId)).status).toBe(403);
      } finally {
        await ds.query(`INSERT INTO role_permissions (role_id, permission_id)
          SELECT r.id, p.id FROM roles r CROSS JOIN permissions p WHERE r.code = 'ADMIN' AND p.code = 'PR.REASSIGN'`);
      }
      expect((await reassign(approver, headId)).status).toBe(204);
      await post(head, `${path}/approve`, await prContext(ds, id)).expect(204);
      expect(await notifications(admin)).toEqual([expect.objectContaining({ action: 'APPROVE', taskStep: null })]);
      expect(await notifications(receiver)).toEqual([expect.objectContaining({ action: 'REQUEST_RECEIPT', taskStep: 'RECEIPT', resolvedAt: null })]);
      await configure('RECEIPT', [approverId]);
      expect((await reassign(receiver, approverId)).status).toBe(403);
      expect((await get(admin, path)).body.assignedApproverId).toBe(receiverId);
      await configure('RECEIPT', [receiverId, approverId]);
      expect((await reassign(receiver, approverId)).status).toBe(204);
      await post(receiver, `${path}/receive`, await prContext(ds, id)).expect(403);
      expect((await reassign(admin, receiverId)).status).toBe(204);
      expect((await get(admin, path)).body).toMatchObject({ approvalStatus: 'WAITING_FOR_RECEIPT', approvalRound: 1 });
      await post(receiver, `${path}/receive`, await prContext(ds, id)).expect(204);
      expect((await reassign(admin, approverId)).status).toBe(409);
      expect(await notifications(admin)).toEqual(expect.arrayContaining([expect.objectContaining({ action: 'RECEIVE', taskStep: null })]));
      const rejected = (await post(admin, '/purchase-requisitions', { salesContractId: sc,
        lines: [{ salesContractLineId: lineId, productId, quantity: 1 }] }).expect(201)).body.id as number;
      await post(admin, `/purchase-requisitions/${rejected}/submit`, await prSubmission(ds, rejected)).expect(204);
      await post(head, `/purchase-requisitions/${rejected}/reject`, { ...await prContext(ds, rejected), reason: 'Rejected fixture' }).expect(204);
      await post(admin, `/purchase-requisitions/${rejected}/reassign`, {
        ...await prContext(ds, rejected), assigneeId: replacementId, reason: 'Handover',
      }).expect(409);
    } finally {
      await configure('SALES', [headId]);
      await configure('RECEIPT', [receiverId]);
    }
  });

  it('Phase 3: reassignment rolls back on notification failure and serializes with either decision step', async () => {
    const { sc, lineId } = await activeContract();
    const head = await login(app, 'sales-head', 'role-users-test');
    const receiver = await login(app, 'purchaser', 'role-users-test');
    const headId = (await get(head, '/auth/me')).body.id;
    const receiverId = (await get(receiver, '/auth/me')).body.id;
    const configure = (pool: string, userIds: number[]) => http().put(`/pr-workflow/routes/${pool}`).set(as(admin)).send({ userIds }).expect(204);
    await configure('SALES', [headId, approverId]);
    await configure('RECEIPT', [receiverId, approverId]);
    try {
      for (const action of ['approve', 'receive'] as const) {
        const { id } = (await post(admin, '/purchase-requisitions', { salesContractId: sc,
          lines: [{ salesContractLineId: lineId, productId, quantity: 1 }] }).expect(201)).body;
        const path = `/purchase-requisitions/${id}`;
        await post(admin, `${path}/submit`, await prSubmission(ds, id)).expect(204);
        if (action === 'receive') await post(head, `${path}/approve`, await prContext(ds, id)).expect(204);
        const context = await prContext(ds, id);
        const request = { ...context, assigneeId: approverId, reason: 'Concurrent fixture' };
        const notifications = () => ds.query('SELECT * FROM pr_notifications WHERE pr_id = $1 ORDER BY id', [id]);
        if (action === 'approve') {
          await ds.query(`CREATE FUNCTION fail_pr_reassign_fixture() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN RAISE EXCEPTION 'reassign notification fixture failure'; END $$;
            CREATE TRIGGER fail_pr_reassign_fixture BEFORE INSERT ON pr_notifications
            FOR EACH ROW WHEN (NEW.action = 'REASSIGNED_AWAY') EXECUTE FUNCTION fail_pr_reassign_fixture()`);
          try {
            const beforeNotes = await notifications();
            const before = (await get(admin, path)).body;
            await post(admin, `${path}/reassign`, request).expect(500);
            expect((await get(admin, path)).body).toEqual(before);
            expect(await notifications()).toEqual(beforeNotes);
          } finally {
            await ds.query('DROP TRIGGER fail_pr_reassign_fixture ON pr_notifications; DROP FUNCTION fail_pr_reassign_fixture()');
          }
        }
        const [transfer, decision] = await Promise.all([
          post(admin, `${path}/reassign`, request), post(action === 'approve' ? head : receiver, `${path}/${action}`, context),
        ]);
        expect([transfer.status, decision.status].sort()).toEqual([204, 409]);
        const detail = (await get(admin, path)).body;
        expect(detail).toMatchObject({ version: context.version + 1, approvalRound: context.round,
          approvalStatus: transfer.status === 204
            ? (action === 'approve' ? 'WAITING_FOR_APPROVE' : 'WAITING_FOR_RECEIPT')
            : (action === 'approve' ? 'WAITING_FOR_RECEIPT' : 'DONE') });
        await post(admin, `${path}/reassign`, request).expect(409);
        const tasks = (await notifications()).filter((n: { task_step: string | null; resolved_at: Date | null }) => n.task_step && !n.resolved_at);
        if (transfer.status === 204) expect(tasks).toEqual([expect.objectContaining({ recipient_id: approverId })]);
        else if (action === 'approve') expect(tasks).toEqual([expect.objectContaining({ recipient_id: receiverId, task_step: 'RECEIPT' })]);
        else expect(tasks).toEqual([]);
      }
    } finally {
      await configure('SALES', [headId]);
      await configure('RECEIPT', [receiverId]);
    }
  });

  it('Approved PR/PO/GRR: recall or cancel only without non-canceled child documents (03 §6)', async () => {
    const { sc, lineId } = await activeContract();
    const pr = (await post(admin, '/purchase-requisitions', { salesContractId: sc, lines: [{ salesContractLineId: lineId, productId, quantity: 5 }] }).expect(201)).body.id;
    await approved('purchase-requisitions', pr);
    const avail = (await get(admin, '/purchase-requisition-lines/available-for-po').expect(200)).body.find((l: { prNumber: string }) => l.prNumber.startsWith('PR-'));
    const beforePo = (await get(admin, `/purchase-requisitions/${pr}`)).body;
    expect(beforePo).toMatchObject({ canCancel: true, canEdit: false });
    const prLine = beforePo.lines[0].id;
    expect(Number((await get(admin, '/purchase-requisition-lines/available-for-po')).body.find((l: { id: number }) => l.id === prLine).remaining)).toBe(5);
    expect(avail).toBeDefined();

    const po = (await post(admin, '/purchase-orders', { supplierId, lines: [{ sourceLineId: prLine, quantity: 5 }] }).expect(201)).body.id;
    expect((await get(admin, `/purchase-requisitions/${pr}`)).body.canCancel).toBe(false);
    expect((await post(admin, `/purchase-requisitions/${pr}/cancel`, { ...await prContext(ds, pr), reason: 'Đổi nhà cung cấp' }).expect(409)).body.code).toBe('HAS_ACTIVE_CHILD_DOCUMENTS');
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
    expect((await get(admin, `/purchase-requisitions/${pr}`)).body.canCancel).toBe(true);
    await post(admin, `/purchase-requisitions/${pr}/cancel`, { ...await prContext(ds, pr), reason: 'Đổi nhà cung cấp' }).expect(204);
    expect((await get(admin, `/purchase-requisitions/${pr}`)).body.history.map((h: { action: string }) => h.action)).toEqual(['CANCEL', 'RECEIVE', 'APPROVE', 'SUBMIT']);
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
