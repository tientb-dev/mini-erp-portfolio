import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { bootTestApp, login, PCS_UOM_ID as pcs } from './test-utils';
import { pricedPr, prContext, prSubmission } from './test-utils';

/** PR #17 / ADR-0014: without PR.VIEW, the responsible sales of a contract may read (only read) that contract's PRs. */
describe('PR read scope for the responsible sales (integration)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let admin: string;
  let sales: string;
  let purchaser: string;
  let pm: string;
  let own: { sc: number; pr: number };
  let other: { sc: number; pr: number };

  const http = () => request(app.getHttpServer());
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, url: string) => http().get(url).set(as(t));
  const post = (t: string, url: string, body: object = {}) => http().post(url).set(as(t)).send((url === '/purchase-requisitions' && 'lines' in body && Array.isArray(body.lines) ? pricedPr({ ...body, lines: body.lines }) : body));
  const patch = (t: string, url: string, body: object) => http().patch(url).set(as(t)).send(body);

  beforeAll(async () => {
    process.env.SEED_ROLE_USERS_PASSWORD = 'role-users-test';
    ({ app, ds } = await bootTestApp());
    admin = await login(app, process.env.SEED_ADMIN_USERNAME!, process.env.SEED_ADMIN_PASSWORD!);
    sales = await login(app, 'sales', 'role-users-test');
    purchaser = await login(app, 'purchaser', 'role-users-test');
    pm = await login(app, 'pm', 'role-users-test');
    const salesId = (await get(sales, '/auth/me')).body.id;
    await ds.query(`INSERT INTO user_roles (user_id, role_id)
      SELECT u.id, r.id FROM users u CROSS JOIN roles r WHERE u.username = $1 AND r.code = 'SALES'`, [process.env.SEED_ADMIN_USERNAME]);
    const adminId = (await get(admin, '/auth/me')).body.id;
    const customerId = (await post(admin, '/customers', { code: 'PS1', name: 'Scope Corp' }).expect(201)).body.id;
    const productId = (await post(admin, '/products', { brandId: 1, partNumber: 'PN-PS', name: 'Switch', unitOfMeasureId: pcs, isSerialTracked: false }).expect(201)).body.id;
    const contractWithPr = async (responsibleSalesUserId: number) => {
      const sc = (await post(admin, '/sales-contracts', { customerId, responsibleSalesUserId, lines: [{ itemCode: 'A', itemName: 'A', unitOfMeasureId: pcs, quantity: 5 }] }).expect(201)).body.id;
      await post(admin, `/sales-contracts/${sc}/activate`).expect(204);
      const lineId = (await get(admin, `/sales-contracts/${sc}`)).body.lines[0].id;
      const pr = (await post(responsibleSalesUserId === salesId ? sales : admin, '/purchase-requisitions', { salesContractId: sc, lines: [{ salesContractLineId: lineId, productId, quantity: 5 }] }).expect(201)).body.id;
      return { sc: sc as number, pr: pr as number };
    };
    own = await contractWithPr(salesId);
    other = await contractWithPr(adminId);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('the responsible sales lists and opens the PRs of their contract, without PO numbers', async () => {
    expect((await get(sales, `/purchase-requisitions?salesContractId=${own.sc}`).expect(200)).body.map((r: { id: number }) => r.id)).toEqual([own.pr]);
    const d = (await get(sales, `/purchase-requisitions/${own.pr}`).expect(200)).body;
    expect(d).toMatchObject({ id: own.pr, salesContractId: own.sc, children: [] });
    expect(d.lines).toHaveLength(1);
  });

  it('is refused outside that scope, without revealing whether an id exists', async () => {
    await get(sales, `/purchase-requisitions?salesContractId=${other.sc}`).expect(403);
    expect((await get(sales, '/purchase-requisitions').expect(200)).body.map((r: { id: number }) => r.id)).toEqual([own.pr]);
    await get(sales, '/purchase-requisitions?salesContractId=999999').expect(403);
    await get(sales, `/purchase-requisitions/${other.pr}`).expect(403);
    await get(sales, '/purchase-requisitions/999999').expect(403);
    await get(pm, `/purchase-requisitions?salesContractId=${own.sc}`).expect(403); // not the responsible sales
  });

  it('allows writes only on eligible contracts and never grants PO access', async () => {
    const ownDetail = (await get(sales, `/purchase-requisitions/${own.pr}`).expect(200)).body;
    const line = ownDetail.lines[0];
    await post(sales, '/purchase-requisitions', { salesContractId: other.sc, lines: [{ productId: line.productId, quantity: 1 }], category: 'MATERIAL' }).expect(403);
    await patch(sales, `/purchase-requisitions/${other.pr}`, { version: 1, lines: [{ productId: line.productId, salesContractLineId: line.sourceLineId, quantity: 1 }] }).expect(403);
    await post(sales, `/purchase-requisitions/${own.pr}/approve`, await prContext(ds, own.pr)).expect(409);
    await get(sales, `/purchase-requisitions/${own.pr}/lines`).expect(403);
    await get(sales, '/purchase-orders').expect(403);
  });
  it('roles with PR.VIEW keep seeing every PR as before', async () => {
    const all = (await get(purchaser, '/purchase-requisitions').expect(200)).body.map((r: { id: number }) => r.id);
    expect(all).toEqual(expect.arrayContaining([own.pr, other.pr]));
    await get(purchaser, `/purchase-requisitions/${other.pr}`).expect(200);
    expect((await get(purchaser, '/purchase-requisitions/999999')).status).toBe(404);
    expect(ds).toBeTruthy();
  });

  it('a contract PM without PR.CREATE cannot list PR metadata based on the PM assignment alone', async () => {
    const pmId = (await get(pm, '/auth/me').expect(200)).body.id;
    await http().put(`/pr-workflow/contracts/${other.sc}/responsible-pm`).set(as(admin)).send({ userId: pmId }).expect(204);
    const [grant] = await ds.query(`SELECT r.id AS "roleId", p.id AS "createId", a.id AS "approveId"
      FROM roles r CROSS JOIN permissions p CROSS JOIN permissions a
      WHERE r.code = 'PM' AND p.code = 'PR.CREATE' AND a.code = 'PR.APPROVE'`);
    await ds.query('INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)', [grant.roleId, grant.approveId]);
    await ds.query('DELETE FROM role_permissions WHERE role_id = $1 AND permission_id = $2', [grant.roleId, grant.createId]);
    try {
      expect((await get(pm, '/purchase-requisitions').expect(200)).body.map((r: { id: number }) => r.id)).not.toContain(other.pr);
      await get(pm, `/purchase-requisitions?salesContractId=${other.sc}`).expect(403);
      await get(pm, `/purchase-requisitions/${other.pr}`).expect(403);
    } finally {
      await ds.query('INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)', [grant.roleId, grant.createId]);
      await ds.query('DELETE FROM role_permissions WHERE role_id = $1 AND permission_id = $2', [grant.roleId, grant.approveId]);
    }
  });

  it('assigned approver and receiver can list, read, and act without PR.VIEW', async () => {
    const salesHead = await login(app, 'sales-head', 'role-users-test');
    const [grant] = await ds.query(`SELECT r.id AS "roleId", p.id AS "permissionId"
      FROM roles r JOIN role_permissions rp ON rp.role_id = r.id
      JOIN permissions p ON p.id = rp.permission_id WHERE r.code = 'PURCHASING' AND p.code = 'PR.VIEW'`);
    await ds.query('DELETE FROM role_permissions WHERE role_id = $1 AND permission_id = $2', [grant.roleId, grant.permissionId]);
    try {
      const path = `/purchase-requisitions/${other.pr}`;
      await post(admin, `${path}/submit`, await prSubmission(ds, other.pr)).expect(204);
      for (const [token, action, status] of [
        [salesHead, 'approve', 'WAITING_FOR_APPROVE'],
        [purchaser, 'receive', 'WAITING_FOR_RECEIPT'],
      ]) {
        expect((await get(token, '/auth/me').expect(200)).body.permissions).not.toContain('PR.VIEW');
        const list = await get(token, '/purchase-requisitions?assignedToMe=true').expect(200);
        expect(list.body).toEqual([expect.objectContaining({ id: other.pr, approvalStatus: status })]);
        expect((await get(token, path).expect(200)).body.approvalStatus).toBe(status);
        await post(token, `${path}/${action}`, await prContext(ds, other.pr)).expect(204);
      }
      expect((await get(purchaser, path).expect(200)).body.approvalStatus).toBe('DONE');
    } finally {
      await ds.query('INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)', [grant.roleId, grant.permissionId]);
    }
  });
});
