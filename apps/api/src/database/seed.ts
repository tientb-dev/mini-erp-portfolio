import { DataSource } from 'typeorm';
import dataSource from './data-source';
import { env } from './env';
import { hashPassword } from '../modules/identity/password';

export const PERMISSIONS = [
  'PRODUCT.VIEW', 'PRODUCT.CREATE', 'PRODUCT.UPDATE',
  'WAREHOUSE.VIEW', 'WAREHOUSE.CREATE', 'WAREHOUSE.UPDATE',
  'INVENTORY.VIEW',
  'CUSTOMER.VIEW', 'CUSTOMER.CREATE', 'SUPPLIER.VIEW', 'SUPPLIER.CREATE',
  'SALES_CONTRACT.VIEW', 'SALES_CONTRACT.CREATE', 'SALES_CONTRACT.PROPOSE_PRODUCT', 'SALES_CONTRACT.CONFIRM_PRODUCT',
  'PR.VIEW', 'PR.CREATE', 'PR.APPROVE',
  'PO.VIEW', 'PO.CREATE', 'PO.APPROVE',
  'GRR.VIEW', 'GRR.CREATE', 'GRR.APPROVE',
  'GR.VIEW', 'GR.CREATE', 'GR.DECLARE_DETAILS', 'GR.APPROVE',
  'GIR.VIEW', 'GIR.CREATE', 'GIR.SALES_CONFIRM', 'GIR.APPROVE', 'GIR.COMPLETE',
  'GI.VIEW', 'GI.CREATE', 'GI.APPROVE',
];

/**
 * Business roles for trying the flows per role (04 §2). Purchasing (PR/PO) is not named in 04 §2: assumption IM20.
 * Every role also views products and warehouses so forms can load their dropdowns.
 */
const COMMON = ['PRODUCT.VIEW', 'WAREHOUSE.VIEW', 'SALES_CONTRACT.VIEW'];
export const ROLES: Record<string, { name: string; username: string; fullName: string; permissions: string[] }> = {
  SALES: {
    name: 'Sales', username: 'sales', fullName: 'Nhân viên Sales',
    permissions: [...COMMON, 'CUSTOMER.VIEW', 'CUSTOMER.CREATE', 'SALES_CONTRACT.CREATE', 'SALES_CONTRACT.CONFIRM_PRODUCT', 'GIR.VIEW', 'GIR.SALES_CONFIRM'],
  },
  PM: {
    name: 'PM', username: 'pm', fullName: 'Quản lý dự án (PM)',
    permissions: [...COMMON, 'SALES_CONTRACT.PROPOSE_PRODUCT', 'GIR.VIEW', 'GIR.CREATE', 'INVENTORY.VIEW'],
  },
  PURCHASING: {
    name: 'Mua hàng', username: 'purchaser', fullName: 'Nhân viên mua hàng',
    permissions: [...COMMON, 'SUPPLIER.VIEW', 'SUPPLIER.CREATE', 'PRODUCT.CREATE', 'PR.VIEW', 'PR.CREATE', 'PO.VIEW', 'PO.CREATE'],
  },
  WAREHOUSE_MANAGER: {
    name: 'Quản lý kho', username: 'warehouse', fullName: 'Quản lý kho HCM',
    permissions: [...COMMON, 'INVENTORY.VIEW', 'PO.VIEW', 'GRR.VIEW', 'GRR.CREATE', 'GRR.APPROVE', 'GR.VIEW', 'GR.CREATE',
      'GR.DECLARE_DETAILS', 'GR.APPROVE', 'GIR.VIEW', 'GIR.APPROVE', 'GIR.COMPLETE', 'GI.VIEW', 'GI.CREATE', 'GI.APPROVE'],
  },
};

async function upsertUser(ds: DataSource, username: string, password: string, fullName: string, role = 'ADMIN') {
  const hash = await hashPassword(password);
  await ds.query(`INSERT INTO users (username, password_hash, full_name) VALUES ($1, $2, $3) ON CONFLICT (username) DO NOTHING`, [username, hash, fullName]);
  await ds.query(`INSERT INTO user_roles (user_id, role_id)
    SELECT u.id, r.id FROM users u, roles r WHERE u.username = $1 AND r.code = $2 ON CONFLICT DO NOTHING`, [username, role]);
  await ds.query(`INSERT INTO user_warehouses (user_id, warehouse_id)
    SELECT u.id, w.id FROM users u, warehouses w WHERE u.username = $1 AND w.code = 'HCM' ON CONFLICT DO NOTHING`, [username]);
}

/**
 * Idempotent seed: permissions, ADMIN role (all permissions), business roles, admin + approver users on warehouse HCM, UoM PCS.
 * A second user exists because a creator may never approve their own document.
 */
export async function seed(ds = dataSource): Promise<void> {
  for (const code of PERMISSIONS) await ds.query('INSERT INTO permissions (code) VALUES ($1) ON CONFLICT (code) DO NOTHING', [code]);
  await ds.query(`INSERT INTO roles (code, name) VALUES ('ADMIN', 'Administrator') ON CONFLICT (code) DO NOTHING`);
  await ds.query(`INSERT INTO role_permissions (role_id, permission_id)
    SELECT r.id, p.id FROM roles r CROSS JOIN permissions p WHERE r.code = 'ADMIN' ON CONFLICT DO NOTHING`);
  await ds.query(`INSERT INTO units_of_measure (code, name) VALUES ('PCS', 'Cái') ON CONFLICT (code) DO NOTHING`);
  await ds.query(`INSERT INTO warehouses (code, name) VALUES ('HCM', 'Kho HCM') ON CONFLICT (code) DO NOTHING`);
  await upsertUser(ds, env('SEED_ADMIN_USERNAME'), env('SEED_ADMIN_PASSWORD'), 'Administrator');
  await upsertUser(ds, env('SEED_APPROVER_USERNAME'), env('SEED_APPROVER_PASSWORD'), 'Quản lý kho');
  for (const [code, r] of Object.entries(ROLES)) {
    await ds.query(`INSERT INTO roles (code, name) VALUES ($1, $2) ON CONFLICT (code) DO NOTHING`, [code, r.name]);
    await ds.query(`INSERT INTO role_permissions (role_id, permission_id)
      SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = ANY($2) WHERE r.code = $1 ON CONFLICT DO NOTHING`, [code, r.permissions]);
    // Role users only when a password is configured (local demo); never a hard-coded secret.
    if (process.env.SEED_ROLE_USERS_PASSWORD) await upsertUser(ds, r.username, process.env.SEED_ROLE_USERS_PASSWORD, r.fullName, code);
  }
}

if (require.main === module) {
  dataSource
    .initialize()
    .then(() => seed())
    .then(() => console.log('Seed completed'))
    .finally(() => dataSource.destroy());
}
