import { holdLock, waitForBlockedBackend } from './oa3-test-locks';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { bootTestApp, login, PCS_UOM_ID as pcs, pricedPr, prContext } from './test-utils';
import { inScope, loadDataScope, matchesDraft } from './modules/identity/data-scope';
import { PR_SOURCE } from './modules/procurement/procurement.service';

jest.setTimeout(20_000);

const PW = 'initial passphrase 1';
const VIEW = 'PR.VIEW';
const CREATE = 'PR.CREATE';
const APPROVE = 'PR.APPROVE';
const RECEIVE = 'PR.RECEIVE';

/**
 * OA3.3b: PR.VIEW scope on every PR read, action scopes, owner unit, ASSIGNED on the real workflow. Replaces the
 * ADR-0014 suite on purpose: no implicit read through SALES_CONTRACT.VIEW, creator, responsible or assignee any more.
 */
describe('PR data scope OA3.3b (PostgreSQL)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let admin: string;
  let titleId: number;
  let customerId: number;
  let productId: number;
  let seq = 0;
  const http = () => request(app.getHttpServer());
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, url: string) => http().get(url).set(as(t));
  const post = (t: string, url: string, body: object = {}) => http().post(url).set(as(t)).send(body);
  const patch = (t: string, url: string, body: object) => http().patch(url).set(as(t)).send(body);
  const put = (t: string, url: string, body: object) => http().put(url).set(as(t)).send(body);

  const unit = async (parentId?: number) => {
    const i = ++seq;
    return (await post(admin, '/admin/org-units', { code: `P33-${i}`, name: `PR unit ${i}`, parentId }).expect(201)).body.id as number;
  };
  const role = async (permissions: string[], scopes: Record<string, string[]>) => {
    const i = ++seq;
    return (await post(admin, '/admin/roles', { code: `P33_${i}`, name: `PR role ${i}`, permissions, scopes, userIds: [] }).expect(201)).body.id as number;
  };
  const employee = async (roleIds: number[], units: number[] = []) => {
    const i = ++seq;
    const res = await post(admin, '/admin/users', {
      profile: { employeeCode: `P33-${i}`, fullName: `PR employee ${i}` }, account: { username: `p33-${i}`, initialPassword: PW }, roleIds,
      memberships: units.map((orgUnitId, k) => ({ orgUnitId, jobTitleId: titleId, isPrimary: k === 0 })) });
    expect(res.status).toBe(201);
    await ds.query('UPDATE users SET must_change_password = false WHERE id = $1', [res.body.id]);
    return { id: res.body.id as number, token: await login(app, `p33-${i}`, PW) };
  };
  /** PR creator: may be responsible Sales (SALES_CONTRACT.CREATE) and create PRs; VIEW/CREATE scopes as given. */
  const creatorRole = (view: string[], create: string[] = ['CREATOR']) =>
    role(['SALES_CONTRACT.CREATE', 'SALES_CONTRACT.VIEW', VIEW, CREATE], { 'SALES_CONTRACT.CREATE': ['CREATOR'], 'SALES_CONTRACT.VIEW': ['RESPONSIBLE'], [VIEW]: view, [CREATE]: create });
  /** ACTIVE HĐ (created by admin, owner NULL) with `salesId` as responsible Sales. */
  const contract = async (salesId: number) => {
    const sc = (await post(admin, '/sales-contracts', { customerId, responsibleSalesUserId: salesId,
      lines: [{ itemCode: 'A', itemName: 'A', unitOfMeasureId: pcs, quantity: 50 }] }).expect(201)).body.id as number;
    await post(admin, `/sales-contracts/${sc}/activate`).expect(204);
    const lineId = (await get(admin, `/sales-contracts/${sc}`).expect(200)).body.lines[0].id as number;
    return { sc, lineId };
  };
  const prBody = (sc: number, lineId: number, extra: object = {}) =>
    ({ ...pricedPr({ salesContractId: sc, lines: [{ salesContractLineId: lineId, productId, quantity: 1 }] }), ...extra });
  /** PR created by `u` (the responsible Sales of a fresh HĐ). */
  const newPr = async (u: { id: number; token: string }, extra: object = {}) => {
    const { sc, lineId } = await contract(u.id);
    const id = (await post(u.token, '/purchase-requisitions', prBody(sc, lineId, extra)).expect(201)).body.id as number;
    return { id, sc, lineId };
  };
  const owner = async (id: number) => (await ds.query('SELECT owner_org_unit_id AS o FROM purchase_requisitions WHERE id = $1', [id]))[0].o as number | null;
  const editBody = async (id: number) => {
    const d = (await get(admin, `/purchase-requisitions/${id}`).expect(200)).body;
    return { version: d.version, lines: d.lines.map((l: { id: number; productId: number; salesContractLineId: number }) =>
      ({ id: l.id, productId: l.productId, salesContractLineId: l.salesContractLineId, quantity: '1' })) };
  };
  const configure = (pool: string, userIds: number[]) => put(admin, `/pr-workflow/routes/${pool}`, { userIds }).expect(204);
  const pools = async () => Object.fromEntries(['SALES', 'PM', 'RECEIPT'].map(p => [p, [] as number[]]).concat(
    Object.entries((await ds.query('SELECT pool, array_agg(user_id ORDER BY user_id) AS ids FROM pr_candidate_pool_members GROUP BY pool'))
      .reduce((a: Record<string, number[]>, r: { pool: string; ids: number[] }) => ({ ...a, [r.pool]: r.ids }), {}))));
  const submit = async (t: string, id: number, approverId: number, receiverId: number) =>
    post(t, `/purchase-requisitions/${id}/submit`, { ...await prContext(ds, id), approverId, receiverId });

  /** Projected scope state of a stored PR, for the TypeScript twin (`matchesDraft`). */
  const draftOf = async (id: number) => {
    const [r] = await ds.query(`SELECT d.created_by AS "creatorId", s.responsible_sales_user_id AS rs, s.responsible_pm_user_id AS rp,
        d.owner_org_unit_id AS "orgUnitId",
        ARRAY(SELECT n.assignee_id FROM pr_workflow_nodes n WHERE n.pr_id = d.id
          UNION SELECT (h.metadata->'from'->>'id')::int FROM approval_histories h
           WHERE h.document_type = 'PR' AND h.document_id = d.id AND h.action = 'REASSIGN') AS "assigneeIds"
      FROM purchase_requisitions d JOIN sales_contracts s ON s.id = d.sales_contract_id WHERE d.id = $1`, [id]);
    return { creatorId: r.creatorId, responsibleIds: [r.rs, r.rp], orgUnitId: r.orgUnitId, assigneeIds: r.assigneeIds };
  };
  /** SQL predicate (list filter) and its TS twin agree for this user and PR. */
  const parity = async (userId: number, id: number) => {
    const s = await loadDataScope(ds.manager, userId);
    const sql = await inScope(ds.manager, s, VIEW, PR_SOURCE, id);
    expect([userId, id, matchesDraft(s, VIEW, await draftOf(id))]).toEqual([userId, id, sql]);
    return sql;
  };
  /** Every PR read endpoint answers `code` for this user. */
  const reads = async (t: string, id: number, code: number) => {
    const base = `/purchase-requisitions/${id}`;
    for (const url of [base, `${base}/lines`, `${base}/notes`, `${base}/history`, `${base}/dossier`]) {
      expect([url, (await get(t, url)).status]).toEqual([url, code]);
    }
  };
  const listed = async (t: string, ids: number[], query = '') => {
    const paged = (await get(t, `/purchase-requisitions?page=1&size=100${query}`).expect(200)).body;
    expect(paged.total).toBe(paged.items.length);
    const plain = (await get(t, `/purchase-requisitions?x=1${query}`.replace('?x=1&', '?').replace('?x=1', '')).expect(200)).body;
    const mine = (rows: { id: number }[]) => rows.map(r => r.id).filter(id => ids.includes(id)).sort((a, b) => a - b);
    expect(mine(plain)).toEqual(mine(paged.items));
    return mine(paged.items);
  };

  beforeAll(async () => {
    ({ app, ds } = await bootTestApp());
    admin = await login(app, process.env.SEED_ADMIN_USERNAME!, process.env.SEED_ADMIN_PASSWORD!);
    titleId = (await post(admin, '/admin/job-titles', { code: 'TP33', name: 'Title P33' }).expect(201)).body.id;
    customerId = (await post(admin, '/customers', { code: 'CP33', name: 'PR scope customer' }).expect(201)).body.id;
    productId = (await post(admin, '/products', { brandId: 1, partNumber: 'PN-P33', name: 'Switch', unitOfMeasureId: pcs, isSerialTracked: false }).expect(201)).body.id;
  }, 120_000);
  afterAll(async () => app?.close());

  it('OA3.3c retains an opaque saved HĐ line after VIEW revocation and blocks a new link', async () => {
    const roleId = await creatorRole(['CREATOR']);
    const creator = await employee([roleId]);
    const { id, lineId } = await newPr(creator);
    await ds.query(`DELETE FROM role_permissions WHERE role_id = $1
      AND permission_id = (SELECT id FROM permissions WHERE code = 'SALES_CONTRACT.VIEW')`, [roleId]);
    const path = `/purchase-requisitions/${id}`;
    const view = (await get(creator.token, path).expect(200)).body;
    expect(view).toMatchObject({ salesContractId: null, canEdit: true, lines: [{ salesContractLineId: null, sourceLineId: null }] });
    const payload = await editBody(id);
    const retained = payload.lines.map(({ salesContractLineId, ...line }: { salesContractLineId: number }) => line);
    await patch(creator.token, path, { ...payload, lines: retained }).expect(204);
    const [saved] = await ds.query('SELECT sales_contract_line_id FROM purchase_requisition_lines WHERE purchase_requisition_id = $1', [id]);
    expect(saved.sales_contract_line_id).toBe(lineId);
    const after = await editBody(id);
    await patch(creator.token, path, { ...after, lines: [...after.lines, { productId, salesContractLineId: lineId, quantity: '1' }] }).expect(403);
  });

  it('owner unit: primary by default, another ACTIVE membership on request, NULL without membership; not inherited, immutable', async () => {
    const [a, b, c] = [await unit(), await unit(), await unit()];
    const r = await creatorRole(['CREATOR']);
    const multi = await employee([r], [a, b]);
    const none = await employee([r]);
    const primary = await newPr(multi);
    expect(await owner(primary.id)).toBe(a); // the HĐ (created by admin) has owner NULL: nothing inherited
    expect((await ds.query('SELECT owner_org_unit_id AS o FROM sales_contracts WHERE id = $1', [primary.sc]))[0].o).toBeNull();
    const chosen = (await post(multi.token, '/purchase-requisitions', prBody(primary.sc, primary.lineId, { ownerOrgUnitId: b })).expect(201)).body.id;
    expect(await owner(chosen)).toBe(b);
    expect((await get(multi.token, `/purchase-requisitions/${chosen}`).expect(200)).body.ownerOrgUnitId).toBe(b);
    for (const ownerOrgUnitId of [c, null]) {
      expect((await post(multi.token, '/purchase-requisitions', prBody(primary.sc, primary.lineId, { ownerOrgUnitId })).expect(422)).body.code)
        .toBe('OWNER_ORG_UNIT_INVALID');
    }
    // save-new takes the same field (and the request fingerprint includes it).
    const saved = (await post(multi.token, '/purchase-requisitions/save-new', { ...prBody(primary.sc, primary.lineId, { ownerOrgUnitId: b }),
      requestKey: '7d1c1a52-5b8e-4c43-9d55-2a3c8f9b7e11', submit: false }).expect(201)).body.id;
    expect(await owner(saved)).toBe(b);
    const orphan = await newPr(none);
    expect(await owner(orphan.id)).toBeNull();
    expect((await post(none.token, '/purchase-requisitions', prBody(orphan.sc, orphan.lineId, { ownerOrgUnitId: a })).expect(422)).body.code)
      .toBe('OWNER_ORG_UNIT_INVALID');
    // Immutable: edits reject the field; ending the membership does not move the PR (no backfill).
    await patch(multi.token, `/purchase-requisitions/${primary.id}`, { ...await editBody(primary.id), ownerOrgUnitId: b }).expect(400);
    await patch(multi.token, `/purchase-requisitions/${primary.id}`, await editBody(primary.id)).expect(204);
    expect(await owner(primary.id)).toBe(a);
  });

  it('List/COUNT, Detail, Lines, Notes, History and Dossier agree for every PR.VIEW scope, with SQL/TS parity', async () => {
    const root = await unit();
    const child = await unit(root);
    const other = await unit();
    const writer = await creatorRole(['CREATOR']);
    const inChild = await employee([writer], [child]);
    const inOther = await employee([writer], [other]);
    const noUnit = await employee([writer]);
    const docs = { child: (await newPr(inChild)).id, other: (await newPr(inOther)), orphan: (await newPr(noUnit)).id };
    const all = [docs.child, docs.other.id, docs.orphan];
    // RESPONSIBLE: the responsible PM of the HĐ (assigned through the real endpoint; it needs a PR.CREATE grant).
    const respRole = await role([VIEW, CREATE], { [VIEW]: ['RESPONSIBLE'], [CREATE]: ['CREATOR'] });
    const pmResp = await employee([respRole]);
    await put(admin, `/pr-workflow/contracts/${docs.other.sc}/responsible-pm`, { userId: pmResp.id }).expect(204);
    const viewer = async (scopes: string[], units: number[] = []) => employee([await role([VIEW], { [VIEW]: scopes })], units);
    const unionUser = await employee([await role([VIEW], { [VIEW]: ['ORG_UNIT'] }), await role([VIEW], { [VIEW]: ['ORG_UNIT_TREE'] })], [other, root]);

    const cases: [string, { id: number; token: string }, number[]][] = [
      ['CREATOR', inChild, [docs.child]],
      ['RESPONSIBLE (Sales = creator)', inOther, [docs.other.id]],
      ['RESPONSIBLE (PM)', pmResp, [docs.other.id]],
      ['ORG_UNIT child', await viewer(['ORG_UNIT'], [child]), [docs.child]],
      ['ORG_UNIT root (no descendants)', await viewer(['ORG_UNIT'], [root]), []],
      ['ORG_UNIT_TREE root', await viewer(['ORG_UNIT_TREE'], [root]), [docs.child]],
      ['ORG_UNIT_TREE without membership', await viewer(['ORG_UNIT_TREE']), []],
      ['union of two roles O + T', unionUser, [docs.child, docs.other.id]],
      ['ALL', await viewer(['ALL']), all],
    ];
    for (const [name, u, expected] of cases) {
      expect([name, await listed(u.token, all)]).toEqual([name, [...expected].sort((x, y) => x - y)]);
      for (const id of all) {
        expect([name, id, await parity(u.id, id)]).toEqual([name, id, expected.includes(id)]);
        await reads(u.token, id, expected.includes(id) ? 200 : 404);
      }
    }
    // The HĐ filter only narrows: another contract's PRs are not revealed, and no 403 hints at existence.
    expect(await listed(inChild.token, all, `&salesContractId=${docs.other.sc}`)).toEqual([]);
    const tabReader = await employee([await role([VIEW, 'SALES_CONTRACT.VIEW'], {
      [VIEW]: ['ALL'], 'SALES_CONTRACT.VIEW': ['RESPONSIBLE'],
    })]);
    for (const sc of [docs.other.sc, 999999]) {
      expect((await get(tabReader.token, `/purchase-requisitions?salesContractId=${sc}&page=1`).expect(200)).body)
        .toEqual({ items: [], total: 0 });
    }
    await get(tabReader.token, `/purchase-requisitions/${docs.other.id}`).expect(200);
    expect(await listed(admin, all, `&salesContractId=${docs.other.sc}`)).toEqual([docs.other.id]);
    const contractOnly = await employee([await role(['SALES_CONTRACT.VIEW'], { 'SALES_CONTRACT.VIEW': ['ALL'] })]);
    await get(contractOnly.token, `/purchase-requisitions?salesContractId=${docs.other.sc}`).expect(403);
    const noScopedPr = await employee([await role([VIEW, 'SALES_CONTRACT.VIEW'], {
      [VIEW]: ['CREATOR'], 'SALES_CONTRACT.VIEW': ['ALL'],
    })]);
    expect((await get(noScopedPr.token, `/purchase-requisitions?salesContractId=${docs.other.sc}`).expect(200)).body).toEqual([]);
    // NULL owner never matches O/T (also for a user whose units are all in the tree).
    expect(await parity(unionUser.id, docs.orphan)).toBe(false);

    // Grant without scope rows (SQL fixture): fail-closed — empty list, total 0, 404.
    const bare = await employee([await role([CREATE], { [CREATE]: ['CREATOR'] })]);
    await ds.query(`INSERT INTO role_permissions (role_id, permission_id) SELECT ur.role_id, p.id FROM user_roles ur, permissions p
      WHERE ur.user_id = $1 AND p.code = $2`, [bare.id, VIEW]);
    expect((await get(bare.token, '/purchase-requisitions?page=1').expect(200)).body).toEqual({ items: [], total: 0 });
    await reads(bare.token, docs.child, 404);
    // No PR.VIEW at all: 403 on every read, existing or not; dossier files too.
    const blind = await employee([await role([CREATE], { [CREATE]: ['CREATOR'] })]);
    await get(blind.token, '/purchase-requisitions').expect(403);
    for (const id of [docs.child, 999999]) {
      await reads(blind.token, id, 403);
      await get(blind.token, `/purchase-requisitions/${id}/dossier/files/1`).expect(403);
    }
    // Notifications carry PR data: only PRs within PR.VIEW scope are listed.
    expect((await get(blind.token, '/pr-notifications').expect(200)).body).toEqual([]);
    await ds.query(`INSERT INTO pr_notifications (pr_id, recipient_id, action, round)
      SELECT unnest($1::int[]), $2, 'RECALL', 1`, [[docs.child, docs.other.id], inChild.id]);
    expect((await get(inChild.token, '/pr-notifications').expect(200)).body)
      .toMatchObject([{ prId: docs.child, readAt: null, resolvedAt: null }]);
  });

  describe('workflow', () => {
    let original: Record<string, number[]>;
    beforeAll(async () => { original = await pools(); });
    afterEach(async () => { for (const [p, ids] of Object.entries(original)) await configure(p, ids); });

    it('ASSIGNED follows the real workflow: current, reassigned away, invalidated by recall, several rounds; reading never lets one act', async () => {
      const approverRole = await role([VIEW, APPROVE], { [VIEW]: ['ASSIGNED'], [APPROVE]: ['ASSIGNED'] });
      const receiverRole = await role([VIEW, RECEIVE], { [VIEW]: ['ASSIGNED'], [RECEIVE]: ['ASSIGNED'] });
      const [a, b, c, never] = [await employee([approverRole]), await employee([approverRole]), await employee([approverRole]), await employee([approverRole])];
      const rcv = await employee([receiverRole]);
      await configure('SALES', [a.id, b.id, c.id, never.id]);
      await configure('RECEIPT', [rcv.id]);
      const creator = await employee([await creatorRole(['CREATOR'])]);
      const { id } = await newPr(creator, { approverId: a.id, receiverId: rcv.id });
      const path = `/purchase-requisitions/${id}`;
      const ctx = async () => prContext(ds, id);
      // A draft approver is not an assignment yet (no workflow node).
      await reads(a.token, id, 404);
      expect((await submit(creator.token, id, a.id, rcv.id)).status).toBe(204);
      for (const u of [a, rcv]) await reads(u.token, id, 200);
      await reads(never.token, id, 404);
      expect(await listed(a.token, [id], '&assignedToMe=true')).toEqual([id]);
      await post(never.token, `${path}/approve`, await ctx()).expect(404); // VIEW scope first

      // Reassigned away (REASSIGN overwrites the node): A keeps reading through history, cannot act any more.
      await post(admin, `${path}/reassign`, { ...await ctx(), assigneeId: b.id, reason: 'Handover' }).expect(204);
      for (const u of [a, b]) await reads(u.token, id, 200);
      expect([await parity(a.id, id), await parity(b.id, id)]).toEqual([true, true]);
      await post(a.token, `${path}/approve`, await ctx()).expect(403);
      const dispatcher = await employee([await role([VIEW, 'PR.REASSIGN'], {
        [VIEW]: ['ASSIGNED', 'RESPONSIBLE'], 'PR.REASSIGN': ['ALL'],
      }), await role([CREATE], { [CREATE]: ['CREATOR'] })]);
      await put(admin, `/pr-workflow/contracts/${(await get(admin, path)).body.salesContractId}/responsible-pm`, { userId: dispatcher.id }).expect(204);
      await post(dispatcher.token, `${path}/reassign`, { ...await ctx(), assigneeId: c.id, reason: 'Second handover' }).expect(204);
      expect((await ds.query(`SELECT metadata->'from'->>'id' AS old FROM approval_histories
        WHERE document_type = 'PR' AND document_id = $1 AND action = 'REASSIGN' ORDER BY id`, [id])).map((row: { old: string }) => Number(row.old)))
        .toEqual([a.id, b.id]);
      const nextPm = await employee([await role([CREATE], { [CREATE]: ['CREATOR'] })]);
      await put(admin, `/pr-workflow/contracts/${(await get(admin, path)).body.salesContractId}/responsible-pm`, { userId: nextPm.id }).expect(204);
      await reads(dispatcher.token, id, 404);
      await post(c.token, `${path}/approve`, await ctx()).expect(204);

      // Recall in the receipt step invalidates round 1: everyone assigned so far still reads, nobody acts.
      await post(creator.token, `${path}/recall`, { ...await ctx(), reason: 'Fix lines' }).expect(204);
      for (const u of [a, b, rcv]) await reads(u.token, id, 200);
      expect((await post(rcv.token, `${path}/receive`, await ctx())).status).toBe(409);

      // Round 2 with a new approver: all rounds count for ASSIGNED; only the current assignee acts.
      expect((await submit(creator.token, id, c.id, rcv.id)).status).toBe(204);
      for (const u of [a, b, c, rcv]) await reads(u.token, id, 200);
      await reads(never.token, id, 404);
      await post(b.token, `${path}/approve`, await ctx()).expect(403);
      await post(c.token, `${path}/reject`, { ...await ctx(), reason: 'Fix quantity' }).expect(204);
      for (const u of [a, b, c, rcv]) await reads(u.token, id, 200);
      expect((await submit(creator.token, id, c.id, rcv.id)).status).toBe(204);
      await post(c.token, `${path}/approve`, await ctx()).expect(204);
      await post(rcv.token, `${path}/receive`, await ctx()).expect(204);
      expect((await get(a.token, path).expect(200)).body.approvalStatus).toBe('DONE');
      for (const u of [a, b, c, rcv, never]) await parity(u.id, id);
      const [{ id: sourceLineId }] = (await get(admin, `${path}/lines`).expect(200)).body;
      const { id: poId } = (await post(admin, '/purchase-orders', {
        supplierId: 900001, lines: [{ sourceLineId, quantity: 1 }],
      }).expect(201)).body;
      expect((await get(a.token, path).expect(200)).body.children).toEqual([]);
      expect((await get(admin, path).expect(200)).body.children).toMatchObject([{ id: poId }]);
    });

    it('reassignment requires READ plus the scope of each eligible path on both endpoints', async () => {
      const owner = await unit();
      const elsewhere = await unit();
      const creatorGrant = await creatorRole(['CREATOR'], ['ORG_UNIT']);
      const creator = await employee([creatorGrant], [elsewhere, owner]);
      const approver = await employee([await role([VIEW, APPROVE], { [VIEW]: ['ASSIGNED'], [APPROVE]: ['ASSIGNED'] })]);
      const receiver = await employee([await role([VIEW, RECEIVE], { [VIEW]: ['ALL'], [RECEIVE]: ['ORG_UNIT'] })], [elsewhere]);
      const replacement = await employee([await role([VIEW, RECEIVE], { [VIEW]: ['ASSIGNED'], [RECEIVE]: ['ASSIGNED'] })]);
      const manager = await employee([await role([VIEW, 'PR.REASSIGN'], { [VIEW]: ['ALL'], 'PR.REASSIGN': ['ORG_UNIT'] })], [elsewhere]);
      const blindManager = await employee([await role([VIEW, 'PR.REASSIGN'], { [VIEW]: ['CREATOR'], 'PR.REASSIGN': ['ALL'] })]);
      await configure('SALES', [approver.id]);
      await configure('RECEIPT', [receiver.id, replacement.id]);
      const { id } = await newPr(creator, { ownerOrgUnitId: owner });
      const path = `/purchase-requisitions/${id}`;
      expect((await submit(creator.token, id, approver.id, receiver.id)).status).toBe(204);
      await post(approver.token, `${path}/approve`, await prContext(ds, id)).expect(204);
      await get(creator.token, `${path}/reassignment-candidates`).expect(200);
      const [membership] = await ds.query('SELECT id, version FROM org_memberships WHERE user_id = $1 AND org_unit_id = $2',
        [creator.id, owner]);
      await post(admin, `/admin/memberships/${membership.id}/end`, { version: membership.version }).expect(204);
      const before = await prContext(ds, id);
      for (const [actor, status] of [[creator, 403], [receiver, 403], [manager, 403], [blindManager, 404]] as const) {
        await get(actor.token, `${path}/reassignment-candidates`).expect(status);
        await post(actor.token, `${path}/reassign`, { ...before, assigneeId: replacement.id, reason: 'Handover' }).expect(status);
      }
      expect(await prContext(ds, id)).toEqual(before);
    });

    it('action scope is independent from VIEW scope: permission without matching scope cannot act; ADMIN has no bypass', async () => {
      const u1 = await unit();
      const elsewhere = await unit();
      // Assignable (eligibility = pool + grant, no scope: no circular condition) but PR.APPROVE scope ORG_UNIT elsewhere.
      const wrongScope = await employee([await role([VIEW, APPROVE], { [VIEW]: ['ALL'], [APPROVE]: ['ORG_UNIT'] })], [elsewhere]);
      // Approve scope ALL but VIEW scope CREATOR only: cannot read, so cannot act.
      const blindApprover = await employee([await role([VIEW, APPROVE], { [VIEW]: ['CREATOR'], [APPROVE]: ['ALL'] })]);
      const good = await employee([await role([VIEW, APPROVE], { [VIEW]: ['ASSIGNED'], [APPROVE]: ['ASSIGNED'] })]);
      const rcv = await employee([await role([VIEW, RECEIVE], { [VIEW]: ['ASSIGNED'], [RECEIVE]: ['ASSIGNED'] })]);
      await configure('SALES', [wrongScope.id, blindApprover.id, good.id]);
      await configure('RECEIPT', [rcv.id]);
      const creator = await employee([await creatorRole(['CREATOR'])], [u1]);
      const { id } = await newPr(creator);
      const path = `/purchase-requisitions/${id}`;
      const reassign = async (to: number) => post(admin, `${path}/reassign`, { ...await prContext(ds, id), assigneeId: to, reason: 'Fixture' });

      expect((await submit(creator.token, id, wrongScope.id, rcv.id)).status).toBe(204);
      await get(wrongScope.token, path).expect(200);
      const denied = await post(wrongScope.token, `${path}/approve`, await prContext(ds, id)).expect(403);
      expect(denied.body.detail).toBe(`Missing permission: ${APPROVE}`);
      await post(wrongScope.token, `${path}/reject`, { ...await prContext(ds, id), reason: 'x' }).expect(403);
      expect((await reassign(blindApprover.id)).status).toBe(204);
      await post(blindApprover.token, `${path}/approve`, await prContext(ds, id)).expect(404);
      // Purchasing-like reader (VIEW ALL) with RECEIVE ASSIGNED, not assigned: no reassignment through the receiver path.
      expect((await reassign(good.id)).status).toBe(204);
      await post(good.token, `${path}/approve`, await prContext(ds, id)).expect(204);

      // ADMIN: PR.CREATE C R O T does not cover a PR it neither created nor is responsible for, owned elsewhere.
      const other = await newPr(creator);
      await patch(admin, `/purchase-requisitions/${other.id}`, await editBody(other.id)).expect(403);
      await post(admin, `/purchase-requisitions/${other.id}/cancel`, { ...await prContext(ds, other.id) }).expect(403);
      await get(admin, `/purchase-requisitions/${other.id}/candidates`).expect(403);
      // REASSIGN/DOSSIER ALL let ADMIN manage, Business Rules still apply (canceled dossier → 409).
      await post(creator.token, `/purchase-requisitions/${other.id}/cancel`, { ...await prContext(ds, other.id) }).expect(204);
      expect((await put(admin, `/purchase-requisitions/${other.id}/dossier`, { rows: [] })).status).toBe(409);
      const detail = (await get(admin, `/purchase-requisitions/${other.id}`).expect(200)).body;
      expect(detail).toMatchObject({ canEdit: false, canCancel: false, canReassign: false });
      const covered = await newPr(creator);
      const [{ id: adminId }] = await ds.query('SELECT id FROM users WHERE username = $1', [process.env.SEED_ADMIN_USERNAME]);
      await put(admin, `/pr-workflow/contracts/${covered.sc}/responsible-pm`, { userId: adminId }).expect(204);
      const coveredEdit = await patch(admin, `/purchase-requisitions/${covered.id}`, await editBody(covered.id)).expect(403);
      expect(coveredEdit.body.code).toBe('NOT_DOCUMENT_CREATOR');

      // Prospective scope at CREATE: VIEW ORG_UNIT without membership → owner NULL → the creator would not see it.
      const lost = await employee([await creatorRole(['ORG_UNIT'])]);
      const { sc, lineId } = await contract(lost.id);
      await post(lost.token, '/purchase-requisitions', prBody(sc, lineId)).expect(403);
      expect((await ds.query('SELECT count(*)::int AS n FROM purchase_requisitions WHERE created_by = $1', [lost.id]))[0].n).toBe(0);
      // PR.CREATE scope must also match: CREATE ORG_UNIT elsewhere, VIEW CREATOR → 403 on create.
      const narrow = await employee([await creatorRole(['CREATOR'], ['ORG_UNIT'])]);
      const n = await contract(narrow.id);
      await post(narrow.token, '/purchase-requisitions', prBody(n.sc, n.lineId)).expect(403);
    });
  });

  describe('concurrency on real PR endpoints: scope writers and PR actions serialize on the grants gate', () => {
    const roleVersion = async (id: number) => (await ds.query('SELECT version FROM roles WHERE id = $1', [id]))[0].version as number;
    /** Real role writer (role-admin.update: gate exclusive before lockActor). VIEW ASSIGNED revokes: the actor is never assigned. */
    const setScope = async (roleId: number, userId: number, view: string) => put(admin, `/admin/roles/${roleId}`, {
      name: 'Scoped', permissions: ['SALES_CONTRACT.CREATE', 'SALES_CONTRACT.VIEW', VIEW, CREATE], userIds: [userId], version: await roleVersion(roleId),
      scopes: { 'SALES_CONTRACT.CREATE': ['CREATOR'], 'SALES_CONTRACT.VIEW': ['RESPONSIBLE'], [VIEW]: [view], [CREATE]: ['ORG_UNIT'] } });
    const version = async (id: number) => (await prContext(ds, id)).version;
    let original: Record<string, number[]>;
    beforeAll(async () => { original = await pools(); });
    afterEach(async () => { for (const [p, ids] of Object.entries(original)) await configure(p, ids); });

    it('role revocation first: pending approval loses action scope after commit without changing the PR', async () => {
      const u = await unit();
      const child = await unit(u);
      const roleId = await role([VIEW, APPROVE], { [VIEW]: ['ALL'], [APPROVE]: ['ORG_UNIT_TREE'] });
      const [{ id: purchaser }] = await ds.query("SELECT id FROM users WHERE username = 'purchaser'");
      const [{ id: head }] = await ds.query("SELECT id FROM users WHERE username = 'sales-head'");
      await configure('RECEIPT', [purchaser]);
      const approver = await employee([roleId], [u]);
      await configure('SALES', [head, approver.id]);
      const creator = await employee([await creatorRole(['CREATOR'])], [child]);
      const { id } = await newPr(creator);
      expect((await submit(creator.token, id, approver.id, purchaser)).status).toBe(204);
      const path = `/purchase-requisitions/${id}`;
      const before = await prContext(ds, id);
      const v = await roleVersion(roleId);
      const held = await holdLock(ds, "SELECT pg_advisory_xact_lock_shared(hashtext('grants'))");
      const writer = put(admin, `/admin/roles/${roleId}`, {
        name: 'Narrowed approval scope', permissions: [VIEW, APPROVE], scopes: { [VIEW]: ['ALL'], [APPROVE]: ['ORG_UNIT'] },
        userIds: [approver.id], version: v,
      }).then(r => r);
      let action: PromiseLike<request.Response>;
      try {
        const writerPid = await waitForBlockedBackend(ds, held.pid, 'grant-write');
        action = post(approver.token, `${path}/approve`, before).then(r => r);
        await waitForBlockedBackend(ds, writerPid, 'grant-read');
      } finally {
        await held.release();
      }
      expect((await writer).status).toBe(204);
      expect((await action).status).toBe(403);
      expect(await prContext(ds, id)).toEqual(before);
      await get(approver.token, path).expect(200);
      await post(approver.token, `${path}/approve`, before).expect(403);
    });

    it('receipt first: ending membership waits, then blocks another pending receipt', async () => {
      const u = await unit();
      const roleId = await role([VIEW, RECEIVE], { [VIEW]: ['ALL'], [RECEIVE]: ['ORG_UNIT'] });
      const receiver = await employee([roleId], [await unit(), u]);
      const [{ id: head }] = await ds.query("SELECT id FROM users WHERE username = 'sales-head'");
      const headToken = await login(app, 'sales-head', process.env.SEED_ROLE_USERS_PASSWORD!);
      await configure('SALES', [head]);
      await configure('RECEIPT', [receiver.id]);
      const creator = await employee([await creatorRole(['CREATOR'])], [u]);
      const first = await newPr(creator);
      const second = await newPr(creator);
      for (const { id } of [first, second]) {
        expect((await submit(creator.token, id, head, receiver.id)).status).toBe(204);
        await post(headToken, `/purchase-requisitions/${id}/approve`, await prContext(ds, id)).expect(204);
      }
      const [membership] = await ds.query('SELECT id, version FROM org_memberships WHERE user_id = $1 AND org_unit_id = $2',
        [receiver.id, u]);
      const before = await prContext(ds, first.id);
      const held = await holdLock(ds, 'SELECT id FROM purchase_requisitions WHERE id = $1 FOR UPDATE', [first.id]);
      const action = post(receiver.token, `/purchase-requisitions/${first.id}/receive`, before).then(r => r);
      let writer: PromiseLike<request.Response>;
      try {
        const actionPid = await waitForBlockedBackend(ds, held.pid, 'purchase_requisitions');
        writer = post(admin, `/admin/memberships/${membership.id}/end`, { version: membership.version }).then(r => r);
        await waitForBlockedBackend(ds, actionPid, 'grant-write');
      } finally {
        await held.release();
      }
      expect((await action).status).toBe(204);
      expect((await writer).status).toBe(204);
      expect(await version(first.id)).toBe(before.version + 1);
      expect((await get(receiver.token, `/purchase-requisitions/${first.id}`).expect(200)).body.approvalStatus).toBe('DONE');
      const secondBefore = await prContext(ds, second.id);
      await post(receiver.token, `/purchase-requisitions/${second.id}/receive`, secondBefore).expect(403);
      expect(await prContext(ds, second.id)).toEqual(secondBefore);
    });
    /** Creator with VIEW/CREATE ORG_UNIT on unit `u` (second membership) owning its PR. */
    const setup = async () => {
      const u = await unit();
      const roleId = await creatorRole(['ORG_UNIT'], ['ORG_UNIT']);
      const actor = await employee([roleId], [await unit(), u]);
      const { id } = await newPr(actor, { ownerOrgUnitId: u });
      return { u, roleId, actor, id };
    };

    it('revocation first: the PR edit queues behind the role writer and, after its commit, writes nothing (404)', async () => {
      const { roleId, actor, id } = await setup();
      const before = await version(id);
      const body = await editBody(id);
      // An in-flight reader holds the gate shared, so the writer queues (exclusive) and the action queues behind it.
      const held = await holdLock(ds, `SELECT pg_advisory_xact_lock_shared(hashtext('grants'))`);
      const writer = setScope(roleId, actor.id, 'ASSIGNED').then(r => r);
      let action: PromiseLike<request.Response>;
      try {
        const writerPid = await waitForBlockedBackend(ds, held.pid, 'grant-write');
        action = patch(actor.token, `/purchase-requisitions/${id}`, body).then(r => r);
        await waitForBlockedBackend(ds, writerPid, 'grant-read');
      } finally {
        await held.release();
      }
      expect((await writer).status).toBe(204);
      expect((await action).status).toBe(404);
      expect(await version(id)).toBe(before);
    });

    it('action first: the membership writer waits for the PR action (gate before row lock); access is gone after commit', async () => {
      const { u, actor, id } = await setup();
      const before = await version(id);
      const held = await holdLock(ds, 'SELECT 1 FROM purchase_requisitions WHERE id = $1 FOR UPDATE', [id]);
      const action = post(actor.token, `/purchase-requisitions/${id}/notes`, { body: 'while holding' }).then(r => r);
      let writer: PromiseLike<request.Response>;
      try {
        const actionPid = await waitForBlockedBackend(ds, held.pid, 'purchase_requisitions');
        const [m] = await ds.query('SELECT id, version FROM org_memberships WHERE user_id = $1 AND org_unit_id = $2', [actor.id, u]);
        writer = post(admin, `/admin/memberships/${m.id}/end`, { version: m.version }).then(r => r);
        await waitForBlockedBackend(ds, actionPid, 'grant-write');
      } finally {
        await held.release();
      }
      expect((await action).status).toBe(204); // checked under the scope still valid
      expect((await writer).status).toBe(204);
      // The creator is also the responsible Sales, but the role grants ORG_UNIT only: the PR is out of scope now.
      await get(actor.token, `/purchase-requisitions/${id}`).expect(404);
      await patch(actor.token, `/purchase-requisitions/${id}`, await editBody(id)).expect(404);
      expect(await version(id)).toBe(before);
    });

    it('parallel rounds of scope toggles and PR actions: no deadlock, no write outside the committed scope', async () => {
      const { roleId, actor, id } = await setup();
      for (let round = 0; round < 3; round++) {
        const results = await Promise.all([
          setScope(roleId, actor.id, round % 2 ? 'ORG_UNIT' : 'ASSIGNED'),
          patch(actor.token, `/purchase-requisitions/${id}`, await editBody(id)),
          post(actor.token, `/purchase-requisitions/${id}/notes`, { body: `round ${round}` }),
          get(actor.token, `/purchase-requisitions/${id}`),
        ]);
        expect(results[0].status).toBe(204);
        for (const r of results.slice(1)) expect([200, 204, 404, 409]).toContain(r.status);
      }
      // After the last committed revocation (VIEW ASSIGNED, never assigned) access is gone.
      expect((await setScope(roleId, actor.id, 'ASSIGNED')).status).toBe(204);
      const v = await version(id);
      await get(actor.token, `/purchase-requisitions/${id}`).expect(404);
      await patch(actor.token, `/purchase-requisitions/${id}`, await editBody(id)).expect(404);
      expect(await version(id)).toBe(v);
    });
  });
});
