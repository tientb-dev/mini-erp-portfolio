import { DataSource, EntityManager } from 'typeorm';
import dataSource from './data-source';
import { env } from './env';
import { hashPassword } from '../modules/identity/password';
import { OA3_DEFAULT_SCOPES } from './oa3-default-scopes';
import { lockGrantsExclusive } from '../modules/identity/authorization';

/**
 * Business roles for trying the flows per role (04 §2). Purchasing (PR/PO) is not named in 04 §2: assumption IM20.
 * Every role also views products and warehouses so forms can load their dropdowns. HĐ/PR permissions with Data Scope come
 * from the approved matrix (BA OA3.0, §7.1); HĐ access is no longer part of COMMON.
 */
const COMMON = ['PRODUCT.VIEW', 'WAREHOUSE.VIEW'];
const scoped = (code: string) => Object.keys(OA3_DEFAULT_SCOPES[code] ?? {});
export const ROLES: Record<string, { name: string; username: string; fullName: string; permissions: string[] }> = {
  SALES: {
    name: 'Sales', username: 'sales', fullName: 'Nhân viên Sales',
    permissions: [...COMMON, 'CUSTOMER.VIEW', 'CUSTOMER.CREATE', 'SALES_CONTRACT.CONFIRM_PRODUCT', 'GIR.VIEW', 'GIR.SALES_CONFIRM', ...scoped('SALES')],
  },
  PM: {
    name: 'PM', username: 'pm', fullName: 'Quản lý dự án (PM)',
    permissions: [...COMMON, 'SALES_CONTRACT.PROPOSE_PRODUCT', 'GIR.VIEW', 'GIR.CREATE', 'INVENTORY.VIEW', ...scoped('PM')],
  },
  PURCHASING: {
    name: 'Mua hàng', username: 'purchaser', fullName: 'Nhân viên mua hàng',
    permissions: [...COMMON, 'SUPPLIER.VIEW', 'SUPPLIER.CREATE', 'PRODUCT.CREATE', 'PO.VIEW', 'PO.CREATE', ...scoped('PURCHASING')],
  },
  SALES_HEAD: {
    name: 'Trưởng bộ phận Sales', username: 'sales-head', fullName: 'Trưởng bộ phận Sales',
    permissions: [...COMMON, ...scoped('SALES_HEAD')],
  },
  PM_HEAD: {
    name: 'Trưởng bộ phận PM', username: 'pm-head', fullName: 'Trưởng bộ phận PM',
    permissions: [...COMMON, ...scoped('PM_HEAD')],
  },
  WAREHOUSE_MANAGER: {
    name: 'Quản lý kho', username: 'warehouse', fullName: 'Quản lý kho HCM',
    permissions: [...COMMON, 'INVENTORY.VIEW', 'PO.VIEW', 'GRR.VIEW', 'GRR.CREATE', 'GRR.APPROVE', 'GR.VIEW', 'GR.CREATE',
      'GR.DECLARE_DETAILS', 'GR.APPROVE', 'GIR.VIEW', 'GIR.APPROVE', 'GIR.COMPLETE', 'GI.VIEW', 'GI.CREATE', 'GI.APPROVE'],
  },
};

/**
 * Creates a missing user with its role and warehouse; an existing user is left exactly as administered (BA-SEC-06).
 * A new interactive account must change its password at first sign-in (BA-N-15).
 */
async function upsertUser(m: EntityManager, employeeCode: string, username: string, password: string, fullName: string, role = 'ADMIN') {
  const hash = await hashPassword(password);
  // Username or employee code (both unique case-insensitively) already taken: leave that user as administered.
  const [created] = await m.query(`INSERT INTO users (employee_code, username, password_hash, full_name, must_change_password)
    VALUES ($1, $2, $3, $4, true) ON CONFLICT DO NOTHING RETURNING id`, [employeeCode, username, hash, fullName]);
  if (!created) return;
  await m.query('INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE code = $2', [created.id, role]);
  await m.query(`INSERT INTO user_warehouses (user_id, warehouse_id) SELECT $1, id FROM warehouses WHERE code = 'HCM'`, [created.id]);
}

/** Seeds the minimum local setup. Fixture users are available only on the dedicated test database. */
export async function seed(ds: DataSource = dataSource, fixtureUsers = false): Promise<void> {
  await ds.transaction(async m => {
    if (fixtureUsers) {
      const [{ database }] = await m.query('SELECT current_database() AS database');
      if (database !== 'mini_erp_test') throw new Error('Fixture users require mini_erp_test');
    }
    await lockGrantsExclusive(m);
    await m.query(`INSERT INTO units_of_measure (code, name) VALUES ('PCS', 'Cái') ON CONFLICT (code) DO NOTHING`);
    await m.query(`INSERT INTO warehouses (code, name) VALUES ('HCM', 'Kho HCM') ON CONFLICT (code) DO NOTHING`);
    await upsertUser(m, process.env.SEED_ADMIN_EMPLOYEE_CODE || 'ADMIN', env('SEED_ADMIN_USERNAME'), env('SEED_ADMIN_PASSWORD'), 'Administrator');
    for (const [code, role] of Object.entries(ROLES)) {
      const [created] = await m.query('INSERT INTO roles (code, name) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING id', [code, role.name]);
      if (!created) continue;
      await m.query('INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE code = ANY($2)', [created.id, role.permissions]);
      const scopes = Object.entries(OA3_DEFAULT_SCOPES[code]).flatMap(([permission, list]) => list.map(scope => [permission, scope]));
      await m.query(`INSERT INTO role_permission_scopes (role_id, permission_id, scope_type)
        SELECT $1, p.id, s.scope FROM unnest($2::text[], $3::text[]) AS s(code, scope) JOIN permissions p ON p.code = s.code`,
      [created.id, scopes.map(s => s[0]), scopes.map(s => s[1])]);
    }
    if (fixtureUsers) {
      await upsertUser(m, process.env.SEED_APPROVER_EMPLOYEE_CODE || 'APPROVER', env('SEED_APPROVER_USERNAME'), env('SEED_APPROVER_PASSWORD'), 'Quản lý kho');
      const password = env('SEED_ROLE_USERS_PASSWORD');
      for (const [code, role] of Object.entries(ROLES)) await upsertUser(m, code, role.username, password, role.fullName, code);
    }
  });
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--fixture-users')) {
    throw new Error('Usage: seed.ts [--fixture-users]');
  }
  dataSource
    .initialize()
    .then(() => seed(dataSource, args[0] === '--fixture-users'))
    .then(() => console.log('Seed completed'))
    .finally(() => dataSource.destroy());
}
