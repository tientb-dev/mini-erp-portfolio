import { holdLock, waitForBlockedBackend } from './oa3-test-locks';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { bootTestApp, login, PCS_UOM_ID as pcs } from './test-utils';

const PW = 'initial passphrase 1';
const VIEW = 'SALES_CONTRACT.VIEW';
const CREATE = 'SALES_CONTRACT.CREATE';

/** OA3.3a: SALES_CONTRACT.VIEW/CREATE scope on HĐ endpoints, owner unit, H-01, prospective scope, PR source picker. */
describe('Sales contract data scope OA3.3a (PostgreSQL)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let admin: string;
  let titleId: number;
  let customerId: number;
  let seq = 0;
  const http = () => request(app.getHttpServer());
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, url: string) => http().get(url).set(as(t));
  const post = (t: string, url: string, body: object = {}) => http().post(url).set(as(t)).send(body);
  const patch = (t: string, url: string, body: object) => http().patch(url).set(as(t)).send(body);
  const line = { itemCode: 'X', itemName: 'Item', unitOfMeasureId: pcs, quantity: 1 };

  const unit = async (parentId?: number) => {
    const i = ++seq;
    return (await post(admin, '/admin/org-units', { code: `S33-${i}`, name: `Unit ${i}`, parentId }).expect(201)).body.id as number;
  };
  const role = async (permissions: string[], scopes: Record<string, string[]>) => {
    const i = ++seq;
    return (await post(admin, '/admin/roles', { code: `R33_${i}`, name: `Role ${i}`, permissions, scopes, userIds: [] }).expect(201)).body.id as number;
  };
  /** Employee with an account; first unit is primary. Returns id and token. */
  const employee = async (roleIds: number[], units: number[] = []) => {
    const i = ++seq;
    const res = await post(admin, '/admin/users', {
      profile: { employeeCode: `E33-${i}`, fullName: `Employee ${i}` }, account: { username: `u33-${i}`, initialPassword: PW }, roleIds,
      memberships: units.map((orgUnitId, k) => ({ orgUnitId, jobTitleId: titleId, isPrimary: k === 0 })) });
    expect(res.status).toBe(201);
    await ds.query('UPDATE users SET must_change_password = false WHERE id = $1', [res.body.id]);
    return { id: res.body.id as number, token: await login(app, `u33-${i}`, PW) };
  };
  const create = (t: string, body: object = {}) => post(t, '/sales-contracts', { customerId, lines: [line], ...body });
  const detail = async (id: number) => (await get(admin, `/sales-contracts/${id}`).expect(200)).body;
  const owner = async (id: number) => (await ds.query('SELECT owner_org_unit_id AS o FROM sales_contracts WHERE id = $1', [id]))[0].o as number | null;

  beforeAll(async () => {
    ({ app, ds } = await bootTestApp());
    admin = await login(app, process.env.SEED_ADMIN_USERNAME!, process.env.SEED_ADMIN_PASSWORD!);
    titleId = (await post(admin, '/admin/job-titles', { code: 'T33', name: 'Title 33' }).expect(201)).body.id;
    customerId = (await post(admin, '/customers', { code: 'C33', name: 'Scope customer' }).expect(201)).body.id;
  }, 120_000);
  afterAll(async () => app?.close());

  it('sets the owner unit at creation from valid memberships, NULL without membership, immutable afterwards', async () => {
    const [a, b, c] = [await unit(), await unit(), await unit()];
    const creatorRole = await role([VIEW, CREATE], { [VIEW]: ['CREATOR'], [CREATE]: ['CREATOR'] });
    const multi = await employee([creatorRole], [a, b]);
    const none = await employee([creatorRole]);

    const primary = (await create(multi.token).expect(201)).body.id;
    expect(await owner(primary)).toBe(a);
    const chosen = (await create(multi.token, { ownerOrgUnitId: b }).expect(201)).body.id;
    expect(await owner(chosen)).toBe(b);
    expect((await get(multi.token, `/sales-contracts/${chosen}`).expect(200)).body.ownerOrgUnitId).toBe(b);
    for (const ownerOrgUnitId of [c, null]) {
      expect((await create(multi.token, { ownerOrgUnitId }).expect(422)).body.code).toBe('OWNER_ORG_UNIT_INVALID');
    }

    const orphan = (await create(none.token).expect(201)).body.id;
    expect(await owner(orphan)).toBeNull();
    expect((await create(none.token, { ownerOrgUnitId: a }).expect(422)).body.code).toBe('OWNER_ORG_UNIT_INVALID');

    // Immutable: PATCH does not accept the field; membership changes do not move existing contracts (no backfill).
    const d = await detail(primary);
    await patch(multi.token, `/sales-contracts/${primary}`, { version: d.version, customerId, ownerOrgUnitId: b }).expect(400);
    await patch(multi.token, `/sales-contracts/${primary}`, { version: d.version, customerId }).expect(204);
    expect(await owner(primary)).toBe(a);
  });

  it('List/COUNT, Detail and Lines agree for every supported scope; NULL owner never matches O/T; no VIEW → 403, outside → 404', async () => {
    const root = await unit();
    const child = await unit(root);
    const other = await unit();
    const writer = await role([VIEW, CREATE], { [VIEW]: ['CREATOR'], [CREATE]: ['CREATOR'] });
    const inChild = await employee([writer], [child]);
    const inOther = await employee([writer], [other]);
    const noUnit = await employee([writer]);
    const respTarget = await employee([await role([VIEW], { [VIEW]: ['RESPONSIBLE'] })]);
    const docs = {
      child: (await create(inChild.token).expect(201)).body.id as number,
      other: (await create(inOther.token).expect(201)).body.id as number,
      orphan: (await create(noUnit.token).expect(201)).body.id as number,
    };
    // Responsible Sales on a contract created by someone else (set by SQL: fixture only).
    await ds.query('UPDATE sales_contracts SET responsible_sales_user_id = $2 WHERE id = $1', [docs.other, respTarget.id]);
    const mine = [docs.child, docs.other, docs.orphan];

    const viewer = async (scopes: string[], units: number[] = []) => employee([await role([VIEW], { [VIEW]: scopes })], units);
    const cases: [string, { token: string }, number[]][] = [
      ['CREATOR', inChild, [docs.child]],
      ['RESPONSIBLE', respTarget, [docs.other]],
      ['ORG_UNIT child', await viewer(['ORG_UNIT'], [child]), [docs.child]],
      ['ORG_UNIT root (no descendants)', await viewer(['ORG_UNIT'], [root]), []],
      ['ORG_UNIT_TREE root', await viewer(['ORG_UNIT_TREE'], [root]), [docs.child]],
      ['ORG_UNIT_TREE without membership', await viewer(['ORG_UNIT_TREE']), []],
      ['union ORG_UNIT other + RESPONSIBLE', await employee([await role([VIEW], { [VIEW]: ['ORG_UNIT'] }), await role([VIEW], { [VIEW]: ['RESPONSIBLE'] })], [other]), [docs.other]],
      ['ALL', await viewer(['ALL']), mine],
    ];
    for (const [name, u, expected] of cases) {
      const paged = (await get(u.token, '/sales-contracts?page=1&pageSize=100').expect(200)).body;
      const ids = paged.items.map((r: { id: number }) => r.id).filter((id: number) => mine.includes(id)).sort((x: number, y: number) => x - y);
      expect([name, ids]).toEqual([name, [...expected].sort((x, y) => x - y)]);
      expect(paged.total).toBe(paged.items.length);
      const plain = (await get(u.token, '/sales-contracts').expect(200)).body.map((r: { id: number }) => r.id).filter((id: number) => mine.includes(id)).sort((x: number, y: number) => x - y);
      expect([name, plain]).toEqual([name, ids]);
      for (const id of mine) {
        const code = expected.includes(id) ? 200 : 404;
        await get(u.token, `/sales-contracts/${id}`).expect(code);
        await get(u.token, `/sales-contracts/${id}/lines`).expect(code);
      }
    }

    // No VIEW → 403 everywhere; grant without scope rows (fail-closed) → empty list, 404.
    const noView = await employee([await role(['PO.VIEW'], {})]);
    await get(noView.token, '/sales-contracts').expect(403);
    await get(noView.token, `/sales-contracts/${docs.child}`).expect(403);
    await get(noView.token, `/sales-contracts/${docs.child}/lines`).expect(403);
    const emptyRole = await role(['PO.VIEW'], {});
    await ds.query(`INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE code = $2`, [emptyRole, VIEW]);
    const empty = await employee([emptyRole]);
    expect((await get(empty.token, '/sales-contracts?page=1').expect(200)).body).toEqual({ items: [], total: 0 });
    await get(empty.token, `/sales-contracts/${docs.child}`).expect(404);
    await get(empty.token, '/sales-contracts/999999').expect(404);
  });

  it('H-01: DRAFT actions need VIEW + CREATE scope and creator or responsible Sales; ADMIN has no bypass', async () => {
    const u = await unit();
    const elsewhere = await unit();
    const orgWriter = await role([VIEW, CREATE], { [VIEW]: ['ORG_UNIT'], [CREATE]: ['ORG_UNIT'] });
    const creator = await employee([orgWriter], [u]);
    const colleague = await employee([orgWriter], [u]);
    const outsider = await employee([orgWriter], [elsewhere]);
    const viewOnly = await employee([await role([VIEW, CREATE], { [VIEW]: ['ORG_UNIT'], [CREATE]: ['CREATOR'] })], [u]);
    const sc = (await create(creator.token).expect(201)).body.id as number;
    const [lineId] = (await detail(sc)).lines.map((l: { id: number }) => l.id);
    const v = async () => (await detail(sc)).version as number;

    const attempts = async (t: string, status: number, code?: string) => {
      const version = await v();
      const results = [
        await patch(t, `/sales-contracts/${sc}`, { version, customerId }),
        await post(t, `/sales-contracts/${sc}/lines`, { ...line, version }),
        await patch(t, `/sales-contract-lines/${lineId}`, { ...line, version }),
        await http().delete(`/sales-contract-lines/${lineId}?version=${version}`).set(as(t)),
        await post(t, `/sales-contracts/${sc}/activate`),
        await post(t, `/sales-contracts/${sc}/cancel`),
      ];
      for (const r of results) {
        expect(r.status).toBe(status);
        if (code) expect(r.body.code).toBe(code);
      }
    };
    await attempts(outsider.token, 404); // outside VIEW scope: like an unknown id
    await attempts(viewOnly.token, 403); // VIEW ok, CREATE scope does not match
    await attempts(colleague.token, 403, 'SALES_CONTRACT_NOT_OWNER'); // scope ok, Business Rule fails
    await attempts(admin, 403, 'SALES_CONTRACT_NOT_OWNER'); // ADMIN ALL, no Business Rule bypass
    await http().delete(`/sales-contract-lines/999999?version=1`).set(as(colleague.token)).expect(404);
    expect((await detail(sc)).lines).toHaveLength(1);

    // The responsible Sales may act once assigned (same unit, so the colleague keeps scope after the change).
    await patch(creator.token, `/sales-contracts/${sc}`, { version: await v(), customerId, responsibleSalesUserId: colleague.id }).expect(204);
    await post(colleague.token, `/sales-contracts/${sc}/lines`, { ...line, itemCode: 'Y', version: await v() }).expect(201);
    await post(colleague.token, `/sales-contracts/${sc}/activate`).expect(204);
    // ACTIVE: cancel needs scope only (H-01 is a DRAFT rule); outside scope still 404.
    await post(outsider.token, `/sales-contracts/${sc}/cancel`).expect(404);
    await post(viewOnly.token, `/sales-contracts/${sc}/cancel`).expect(403);
    // F01: only the creator/responsible condition is waived; status rules stay (PR/GIR in use: procurement.int.spec).
    await patch(creator.token, `/sales-contracts/${sc}`, { version: await v(), customerId }).expect(409); // ACTIVE stays locked
    await post(admin, `/sales-contracts/${sc}/cancel`).expect(204); // in scope, not owner
    expect((await post(creator.token, `/sales-contracts/${sc}/cancel`).expect(409)).body.code).toBe('INVALID_STATUS');
  });

  it('checks scope on the projected state: CREATE and responsible changes that would lose access are rejected', async () => {
    const respRole = await role([VIEW, CREATE], { [VIEW]: ['RESPONSIBLE'], [CREATE]: ['RESPONSIBLE'] });
    const resp = await employee([respRole]);
    const peer = await employee([respRole]);
    // CREATE: only a contract the creator will be responsible for matches RESPONSIBLE.
    await create(resp.token).expect(403);
    await create(resp.token, { responsibleSalesUserId: peer.id }).expect(403);
    const sc = (await create(resp.token, { responsibleSalesUserId: resp.id }).expect(201)).body.id as number;
    const before = await detail(sc);
    const res = await patch(resp.token, `/sales-contracts/${sc}`, { version: before.version, customerId, responsibleSalesUserId: peer.id }).expect(403);
    expect(res.body.code).toBe('SCOPE_WOULD_BE_LOST');
    expect(await detail(sc)).toMatchObject({ version: before.version, responsibleSalesUserId: resp.id });

    // CREATOR scope keeps access after handing the contract to someone else.
    const creatorScoped = await employee([await role([VIEW, CREATE], { [VIEW]: ['CREATOR'], [CREATE]: ['CREATOR'] })]);
    const own = (await create(creatorScoped.token, { responsibleSalesUserId: creatorScoped.id }).expect(201)).body.id as number;
    await patch(creatorScoped.token, `/sales-contracts/${own}`, { version: (await detail(own)).version, customerId, responsibleSalesUserId: peer.id }).expect(204);
    expect((await detail(own)).responsibleSalesUserId).toBe(peer.id);
  });

  it('PR source picker keeps the responsible invariant and adds SALES_CONTRACT.VIEW scope', async () => {
    const picker = async (t: string) => (await get(t, '/purchase-requisitions/catalog/contracts?q=').expect(200)).body.map((r: { id: number }) => r.id);
    const creatorView = await role([VIEW, 'PR.CREATE'], { [VIEW]: ['CREATOR'], 'PR.CREATE': ['CREATOR'] });
    const respView = await role([VIEW, 'PR.CREATE'], { [VIEW]: ['RESPONSIBLE'], 'PR.CREATE': ['CREATOR'] });
    const narrow = await employee([creatorView, await role([CREATE], { [CREATE]: ['ALL'] })]);
    const wide = await employee([respView, await role([CREATE], { [CREATE]: ['ALL'] })]);
    const scA = (await create(admin, { responsibleSalesUserId: narrow.id }).expect(201)).body.id as number;
    const scB = (await create(admin, { responsibleSalesUserId: wide.id }).expect(201)).body.id as number;
    for (const id of [scA, scB]) await post(admin, `/sales-contracts/${id}/activate`).expect(204); // admin is the creator
    // Responsible but VIEW scope CREATOR only: not offered.
    expect(await picker(narrow.token)).not.toContain(scA);
    expect(await picker(wide.token)).toContain(scB);
    expect(await picker(wide.token)).not.toContain(scA);
  });

  describe('F02 concurrency on real HĐ endpoints: scope writers and HĐ actions serialize on the grants gate', () => {
    const roleVersion = async (id: number) => (await ds.query('SELECT version FROM roles WHERE id = $1', [id]))[0].version as number;
    /** Real role writer (role-admin.update: gate exclusive before lockActor). */
    const setScope = async (roleId: number, userId: number, scope: string) => http().put(`/admin/roles/${roleId}`).set(as(admin))
      .send({ name: 'Scoped', permissions: [VIEW, CREATE], scopes: { [VIEW]: [scope], [CREATE]: [scope] }, userIds: [userId], version: await roleVersion(roleId) });
    const membershipOf = async (userId: number, unitId: number) =>
      (await ds.query('SELECT id, version FROM org_memberships WHERE user_id = $1 AND org_unit_id = $2', [userId, unitId]))[0] as { id: number; version: number };
    /** Actor has ORG_UNIT scope only, membership in a second unit `u` that owns a DRAFT it created (no responsible). */
    const setup = async () => {
      const u = await unit();
      const roleId = await role([VIEW, CREATE], { [VIEW]: ['ORG_UNIT'], [CREATE]: ['ORG_UNIT'] });
      const actor = await employee([roleId], [await unit(), u]);
      const sc = (await create(actor.token, { ownerOrgUnitId: u }).expect(201)).body.id as number;
      return { u, roleId, actor, sc };
    };

    it('revocation first: the HĐ action queues behind the role writer and, after its commit, writes nothing (404)', async () => {
      const { roleId, actor, sc } = await setup();
      const before = await detail(sc);
      // An in-flight reader holds the gate shared, so the writer queues (exclusive) and the action queues behind it.
      const held = await holdLock(ds, `SELECT pg_advisory_xact_lock_shared(hashtext('grants'))`);
      const writer = setScope(roleId, actor.id, 'RESPONSIBLE').then(r => r);
      let action: PromiseLike<request.Response>;
      try {
        const writerPid = await waitForBlockedBackend(ds, held.pid, 'grant-write');
        action = patch(actor.token, `/sales-contracts/${sc}`, { version: before.version, customerId }).then(r => r);
        await waitForBlockedBackend(ds, writerPid, 'grant-read');
      } finally {
        await held.release();
      }
      expect((await writer).status).toBe(204);
      expect((await action).status).toBe(404);
      expect((await detail(sc)).version).toBe(before.version);
    });

    it('action first: the membership writer waits for the action (gate before row lock); access is gone after commit', async () => {
      const { u, actor, sc } = await setup();
      const before = await detail(sc);
      // Hold the HĐ row: the action takes the gate shared, then blocks on FOR UPDATE while holding it.
      const held = await holdLock(ds, 'SELECT 1 FROM sales_contracts WHERE id = $1 FOR UPDATE', [sc]);
      const action = patch(actor.token, `/sales-contracts/${sc}`, { version: before.version, customerId }).then(r => r);
      let writer: PromiseLike<request.Response>;
      try {
        const actionPid = await waitForBlockedBackend(ds, held.pid, 'sales_contracts');
        const m = await membershipOf(actor.id, u);
        writer = post(admin, `/admin/memberships/${m.id}/end`, { version: m.version }).then(r => r);
        await waitForBlockedBackend(ds, actionPid, 'grant-write');
      } finally {
        await held.release();
      }
      expect((await action).status).toBe(204); // checked under a scope that was still valid
      expect((await writer).status).toBe(204);
      expect((await detail(sc)).version).toBe(before.version + 1);
      await patch(actor.token, `/sales-contracts/${sc}`, { version: before.version + 1, customerId }).expect(404);
      await get(actor.token, `/sales-contracts/${sc}`).expect(404);
    });

    it('parallel rounds of scope toggles and HĐ actions: no deadlock, no write outside the committed scope', async () => {
      const { roleId, actor, sc } = await setup();
      for (let round = 0; round < 3; round++) {
        const scope = round % 2 ? 'ORG_UNIT' : 'RESPONSIBLE';
        const results = await Promise.all([
          setScope(roleId, actor.id, scope),
          post(actor.token, `/sales-contracts/${sc}/lines`, { ...line, version: (await detail(sc)).version }),
          get(actor.token, `/sales-contracts/${sc}`),
        ]);
        expect(results[0].status).toBe(204);
        for (const r of results.slice(1)) expect([200, 201, 404, 409]).toContain(r.status);
      }
      // After the last committed revocation (RESPONSIBLE, actor is not responsible) access is gone.
      expect((await setScope(roleId, actor.id, 'RESPONSIBLE')).status).toBe(204);
      await get(actor.token, `/sales-contracts/${sc}`).expect(404);
    });
  });
});
