import { DataSource } from 'typeorm';
import dataSource from './data-source';
import { env } from './env';
import { hashPassword } from '../modules/identity/password';
import { OA3_GRANTS } from './oa3-grant-mapping';

/**
 * Business roles for trying the flows per role (04 §2). Purchasing (PR/PO) is not named in 04 §2: assumption IM20.
 * Every role also views products and warehouses so forms can load their dropdowns. HĐ/PR permissions with Data Scope come
 * from the approved matrix (BA OA3.0, §7.1); HĐ access is no longer part of COMMON.
 */
const COMMON = ['PRODUCT.VIEW', 'WAREHOUSE.VIEW'];
const scoped = (code: string) => Object.keys(OA3_GRANTS[code] ?? {});
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
async function upsertUser(ds: DataSource, employeeCode: string, username: string, password: string, fullName: string, role = 'ADMIN') {
  const hash = await hashPassword(password);
  // Username or employee code (both unique case-insensitively) already taken: leave that user as administered.
  const [created] = await ds.query(`INSERT INTO users (employee_code, username, password_hash, full_name, must_change_password)
    VALUES ($1, $2, $3, $4, true) ON CONFLICT DO NOTHING RETURNING id`, [employeeCode, username, hash, fullName]);
  if (!created) return;
  await ds.query('INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE code = $2', [created.id, role]);
  await ds.query(`INSERT INTO user_warehouses (user_id, warehouse_id) SELECT $1, id FROM warehouses WHERE code = 'HCM'`, [created.id]);
}

/**
 * Idempotent seed: business roles, admin + approver users on warehouse HCM, UoM PCS. The permission catalog and the
 * system role ADMIN come from migrations. Roles and users are only created when missing and their grants are never
 * rewritten, so administered configuration survives a re-run (BA-SEC-06).
 * A second user exists because a creator may never approve their own document.
 */
export async function seed(ds = dataSource): Promise<void> {
  await ds.query(`INSERT INTO units_of_measure (code, name) VALUES ('PCS', 'Cái') ON CONFLICT (code) DO NOTHING`);
  await ds.query(`INSERT INTO warehouses (code, name) VALUES ('HCM', 'Kho HCM') ON CONFLICT (code) DO NOTHING`);
  // Employee codes (BA-USR-10, OA2.3a): admin and approver from env with a default; role users use the role code.
  await upsertUser(ds, process.env.SEED_ADMIN_EMPLOYEE_CODE || 'ADMIN', env('SEED_ADMIN_USERNAME'), env('SEED_ADMIN_PASSWORD'), 'Administrator');
  await upsertUser(ds, process.env.SEED_APPROVER_EMPLOYEE_CODE || 'APPROVER', env('SEED_APPROVER_USERNAME'), env('SEED_APPROVER_PASSWORD'), 'Quản lý kho');
  for (const [code, r] of Object.entries(ROLES)) {
    const [role] = await ds.query('INSERT INTO roles (code, name) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING id', [code, r.name]);
    if (role) {
      await ds.query('INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE code = ANY($2)', [role.id, r.permissions]);
      const scopes = Object.entries(OA3_GRANTS[code] ?? {}).flatMap(([permission, list]) => list.map(scope => [permission, scope]));
      await ds.query(`INSERT INTO role_permission_scopes (role_id, permission_id, scope_type)
        SELECT $1, p.id, s.scope FROM unnest($2::text[], $3::text[]) AS s(code, scope) JOIN permissions p ON p.code = s.code`,
      [role.id, scopes.map(s => s[0]), scopes.map(s => s[1])]);
    }
    // Role users only when a password is configured (local demo); never a hard-coded secret.
    if (process.env.SEED_ROLE_USERS_PASSWORD) await upsertUser(ds, code, r.username, process.env.SEED_ROLE_USERS_PASSWORD, r.fullName, code);
  }
}

if (require.main === module) {
  dataSource
    .initialize()
    .then(() => seed())
    .then(() => console.log('Seed completed'))
    .finally(() => dataSource.destroy());
}
