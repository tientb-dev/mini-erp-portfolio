import { DataSource } from 'typeorm';
import dataSource from './data-source';
import { env } from './env';
import { hashPassword } from '../modules/identity/password';

/**
 * Business roles for trying the flows per role (04 §2). Purchasing (PR/PO) is not named in 04 §2: assumption IM20.
 * Every role also views products and warehouses so forms can load their dropdowns.
 */
const COMMON = ['PRODUCT.VIEW', 'WAREHOUSE.VIEW', 'SALES_CONTRACT.VIEW'];
export const ROLES: Record<string, { name: string; username: string; fullName: string; permissions: string[] }> = {
  SALES: {
    name: 'Sales', username: 'sales', fullName: 'Nhân viên Sales',
    permissions: [...COMMON, 'CUSTOMER.VIEW', 'CUSTOMER.CREATE', 'SALES_CONTRACT.CREATE', 'SALES_CONTRACT.CONFIRM_PRODUCT', 'GIR.VIEW', 'GIR.SALES_CONFIRM', 'PR.CREATE'],
  },
  PM: {
    name: 'PM', username: 'pm', fullName: 'Quản lý dự án (PM)',
    permissions: [...COMMON, 'SALES_CONTRACT.PROPOSE_PRODUCT', 'GIR.VIEW', 'GIR.CREATE', 'INVENTORY.VIEW', 'PR.CREATE'],
  },
  PURCHASING: {
    name: 'Mua hàng', username: 'purchaser', fullName: 'Nhân viên mua hàng',
    permissions: [...COMMON, 'SUPPLIER.VIEW', 'SUPPLIER.CREATE', 'PRODUCT.CREATE', 'PR.VIEW', 'PR.RECEIVE', 'PO.VIEW', 'PO.CREATE'],
  },
  SALES_HEAD: {
    name: 'Trưởng bộ phận Sales', username: 'sales-head', fullName: 'Trưởng bộ phận Sales',
    permissions: [...COMMON, 'PR.APPROVE'],
  },
  PM_HEAD: {
    name: 'Trưởng bộ phận PM', username: 'pm-head', fullName: 'Trưởng bộ phận PM',
    permissions: [...COMMON, 'PR.APPROVE'],
  },
  WAREHOUSE_MANAGER: {
    name: 'Quản lý kho', username: 'warehouse', fullName: 'Quản lý kho HCM',
    permissions: [...COMMON, 'INVENTORY.VIEW', 'PO.VIEW', 'GRR.VIEW', 'GRR.CREATE', 'GRR.APPROVE', 'GR.VIEW', 'GR.CREATE',
      'GR.DECLARE_DETAILS', 'GR.APPROVE', 'GIR.VIEW', 'GIR.APPROVE', 'GIR.COMPLETE', 'GI.VIEW', 'GI.CREATE', 'GI.APPROVE'],
  },
};

/** Creates a missing user with its role and warehouse; an existing user is left exactly as administered (BA-SEC-06). */
async function upsertUser(ds: DataSource, username: string, password: string, fullName: string, role = 'ADMIN') {
  const hash = await hashPassword(password);
  const [created] = await ds.query(`INSERT INTO users (username, password_hash, full_name) VALUES ($1, $2, $3)
    ON CONFLICT (username) DO NOTHING RETURNING id`, [username, hash, fullName]);
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
  await upsertUser(ds, env('SEED_ADMIN_USERNAME'), env('SEED_ADMIN_PASSWORD'), 'Administrator');
  await upsertUser(ds, env('SEED_APPROVER_USERNAME'), env('SEED_APPROVER_PASSWORD'), 'Quản lý kho');
  for (const [code, r] of Object.entries(ROLES)) {
    const [role] = await ds.query('INSERT INTO roles (code, name) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING id', [code, r.name]);
    if (role) await ds.query('INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE code = ANY($2)', [role.id, r.permissions]);
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
