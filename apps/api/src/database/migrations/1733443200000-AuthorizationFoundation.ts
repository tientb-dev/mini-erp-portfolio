import { MigrationInterface, QueryRunner } from 'typeorm';

/** [code, module, name, adminOnly]. System catalog (BA-RBAC-04); admin_only per BA-N-02. */
const CATALOG: [string, string, string, boolean][] = [
  ['PRODUCT.VIEW', 'MASTER_DATA', 'Xem hàng hóa và danh mục mua hàng', false],
  ['PRODUCT.CREATE', 'MASTER_DATA', 'Tạo hàng hóa', false],
  ['PRODUCT.UPDATE', 'MASTER_DATA', 'Sửa hàng hóa', false],
  ['PROCUREMENT_CATALOG.MANAGE', 'MASTER_DATA', 'Quản lý hãng, mã tạm, tiền tệ, thuế', false],
  ['UOM.MANAGE', 'MASTER_DATA', 'Quản lý đơn vị tính', false],
  ['WAREHOUSE.VIEW', 'MASTER_DATA', 'Xem kho', false],
  ['WAREHOUSE.CREATE', 'MASTER_DATA', 'Tạo kho', false],
  ['WAREHOUSE.UPDATE', 'MASTER_DATA', 'Sửa kho', false],
  ['CUSTOMER.VIEW', 'MASTER_DATA', 'Xem khách hàng', false],
  ['CUSTOMER.CREATE', 'MASTER_DATA', 'Tạo khách hàng', false],
  ['CUSTOMER.UPDATE', 'MASTER_DATA', 'Sửa khách hàng', false],
  ['SUPPLIER.VIEW', 'MASTER_DATA', 'Xem nhà cung cấp', false],
  ['SUPPLIER.CREATE', 'MASTER_DATA', 'Tạo nhà cung cấp', false],
  ['SUPPLIER.UPDATE', 'MASTER_DATA', 'Sửa nhà cung cấp', false],
  ['DOSSIER_TYPE.VIEW', 'DOSSIER', 'Xem loại hồ sơ', false],
  ['DOSSIER_TYPE.MANAGE', 'DOSSIER', 'Quản lý loại hồ sơ', true],
  ['DOSSIER_CONFIG.MANAGE', 'DOSSIER', 'Cấu hình hồ sơ chứng từ', true],
  ['SALES_CONTRACT.VIEW', 'SALES_CONTRACT', 'Xem hợp đồng bán', false],
  ['SALES_CONTRACT.CREATE', 'SALES_CONTRACT', 'Tạo và cập nhật hợp đồng bán', false],
  ['SALES_CONTRACT.PROPOSE_PRODUCT', 'SALES_CONTRACT', 'Đề xuất mã giao (legacy)', false],
  ['SALES_CONTRACT.CONFIRM_PRODUCT', 'SALES_CONTRACT', 'Xác nhận mã giao (legacy)', false],
  ['PR.VIEW', 'PR', 'Xem đề nghị mua hàng', false],
  ['PR.CREATE', 'PR', 'Tạo đề nghị mua hàng', false],
  ['PR.APPROVE', 'PR', 'Phê duyệt đề nghị mua hàng', false],
  ['PR.RECEIVE', 'PR', 'Tiếp nhận đề nghị mua hàng', false],
  ['PR.REASSIGN', 'PR', 'Phân công lại đề nghị mua hàng', false],
  ['PR.DOSSIER_MANAGE', 'PR', 'Quản lý hồ sơ đề nghị mua hàng', false],
  ['PR.CONFIGURE', 'PR', 'Cấu hình quy trình đề nghị mua hàng', true],
  ['PO.VIEW', 'PO', 'Xem đơn mua hàng', false],
  ['PO.CREATE', 'PO', 'Tạo đơn mua hàng', false],
  ['PO.APPROVE', 'PO', 'Duyệt đơn mua hàng', false],
  ['GRR.VIEW', 'INBOUND', 'Xem đề nghị nhập kho', false],
  ['GRR.CREATE', 'INBOUND', 'Tạo đề nghị nhập kho', false],
  ['GRR.APPROVE', 'INBOUND', 'Duyệt đề nghị nhập kho', false],
  ['GR.VIEW', 'INBOUND', 'Xem phiếu nhập kho', false],
  ['GR.CREATE', 'INBOUND', 'Tạo phiếu nhập kho', false],
  ['GR.DECLARE_DETAILS', 'INBOUND', 'Khai báo chi tiết phiếu nhập', false],
  ['GR.APPROVE', 'INBOUND', 'Duyệt phiếu nhập kho', false],
  ['GIR.VIEW', 'OUTBOUND', 'Xem đề nghị xuất kho', false],
  ['GIR.CREATE', 'OUTBOUND', 'Tạo đề nghị xuất kho', false],
  ['GIR.SALES_CONFIRM', 'OUTBOUND', 'Đồng ý xuất hàng nguồn (Sales)', false],
  ['GIR.APPROVE', 'OUTBOUND', 'Duyệt đề nghị xuất kho', false],
  ['GIR.COMPLETE', 'OUTBOUND', 'Xác nhận hoàn thành xuất', false],
  ['GI.VIEW', 'OUTBOUND', 'Xem phiếu xuất kho', false],
  ['GI.CREATE', 'OUTBOUND', 'Tạo phiếu xuất kho', false],
  ['GI.APPROVE', 'OUTBOUND', 'Duyệt phiếu xuất kho', false],
  ['INVENTORY.VIEW', 'INVENTORY', 'Xem tồn kho', false],
  ['USER.VIEW', 'ADMINISTRATION', 'Xem người dùng', true],
  ['USER.MANAGE', 'ADMINISTRATION', 'Quản trị người dùng', true],
  ['ROLE.VIEW', 'ADMINISTRATION', 'Xem vai trò và phân quyền', true],
  ['ROLE.MANAGE', 'ADMINISTRATION', 'Quản trị vai trò và phân quyền', true],
];
const NEW_KEYS = ['USER.VIEW', 'USER.MANAGE', 'ROLE.VIEW', 'ROLE.MANAGE'];

/**
 * OA1.1 (ADR-0018): permission catalog metadata, role status + protected system role ADMIN, admin_only guard,
 * and the single read view of effective grants. Business grants are not changed.
 */
export class AuthorizationFoundation1733443200000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE permissions ADD COLUMN module varchar(50), ADD COLUMN name varchar(200),
        ADD COLUMN description text, ADD COLUMN admin_only boolean NOT NULL DEFAULT false;
      ALTER TABLE roles ADD COLUMN description text, ADD COLUMN is_active boolean NOT NULL DEFAULT true,
        ADD COLUMN is_system boolean NOT NULL DEFAULT false, ADD COLUMN version int NOT NULL DEFAULT 1,
        ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(), ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
    `);
    await q.query(`INSERT INTO permissions (code, module, name, admin_only)
      SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::boolean[])
      ON CONFLICT (code) DO UPDATE SET module = EXCLUDED.module, name = EXCLUDED.name, admin_only = EXCLUDED.admin_only`,
    [CATALOG.map(c => c[0]), CATALOG.map(c => c[1]), CATALOG.map(c => c[2]), CATALOG.map(c => c[3])]);
    await q.query(`
      DO $$ DECLARE unknown text; misgranted text;
      BEGIN
        SELECT string_agg(code, ', ') INTO unknown FROM permissions WHERE module IS NULL;
        IF unknown IS NOT NULL THEN RAISE EXCEPTION 'Permissions outside the system catalog: %', unknown; END IF;
        SELECT string_agg(r.code || ':' || p.code, ', ') INTO misgranted FROM role_permissions rp
          JOIN roles r ON r.id = rp.role_id JOIN permissions p ON p.id = rp.permission_id
          WHERE p.admin_only AND r.code <> 'ADMIN';
        IF misgranted IS NOT NULL THEN RAISE EXCEPTION 'Admin-only permissions granted to business roles: %', misgranted; END IF;
      END $$;
      ALTER TABLE permissions ALTER COLUMN module SET NOT NULL, ALTER COLUMN name SET NOT NULL;
      CREATE UNIQUE INDEX ux_roles_code_ci ON roles (lower(code));

      INSERT INTO roles (code, name) VALUES ('ADMIN', 'Administrator') ON CONFLICT (code) DO NOTHING;
      UPDATE roles SET is_system = true WHERE code = 'ADMIN';
      INSERT INTO role_permissions (role_id, permission_id)
        SELECT r.id, p.id FROM roles r CROSS JOIN permissions p WHERE r.is_system ON CONFLICT DO NOTHING;

      CREATE FUNCTION guard_role_permission() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP IN ('DELETE', 'UPDATE') AND EXISTS (SELECT 1 FROM roles WHERE id = OLD.role_id AND is_system) THEN
          RAISE EXCEPTION 'System role grants are protected' USING ERRCODE = 'P0001';
        END IF;
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        IF EXISTS (SELECT 1 FROM permissions WHERE id = NEW.permission_id AND admin_only)
           AND NOT EXISTS (SELECT 1 FROM roles WHERE id = NEW.role_id AND is_system) THEN
          RAISE EXCEPTION 'Admin-only permission requires the system role' USING ERRCODE = 'P0001';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER guard_role_permission_rows BEFORE INSERT OR UPDATE OR DELETE ON role_permissions
        FOR EACH ROW EXECUTE FUNCTION guard_role_permission();

      CREATE FUNCTION guard_system_role() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          IF OLD.is_system THEN RAISE EXCEPTION 'System role is protected' USING ERRCODE = 'P0001'; END IF;
          RETURN OLD;
        END IF;
        IF TG_OP = 'INSERT' THEN
          IF NEW.is_system THEN RAISE EXCEPTION 'System roles are defined by migrations' USING ERRCODE = 'P0001'; END IF;
          RETURN NEW;
        END IF;
        IF NEW.is_system IS DISTINCT FROM OLD.is_system
           OR (OLD.is_system AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.code IS DISTINCT FROM OLD.code OR NOT NEW.is_active)) THEN
          RAISE EXCEPTION 'System role attributes are protected' USING ERRCODE = 'P0001';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER guard_system_role_rows BEFORE INSERT OR UPDATE OR DELETE ON roles
        FOR EACH ROW EXECUTE FUNCTION guard_system_role();

      CREATE FUNCTION forbid_truncate_grants() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'Grants and roles cannot be truncated' USING ERRCODE = 'P0001';
      END $$;
      CREATE TRIGGER forbid_truncate_role_permissions BEFORE TRUNCATE ON role_permissions
        FOR EACH STATEMENT EXECUTE FUNCTION forbid_truncate_grants();
      CREATE TRIGGER forbid_truncate_roles BEFORE TRUNCATE ON roles
        FOR EACH STATEMENT EXECUTE FUNCTION forbid_truncate_grants();

      -- Reclassifying a key as admin-only must not leave it on a business role.
      CREATE FUNCTION guard_admin_only_flag() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.admin_only AND NOT OLD.admin_only AND EXISTS (SELECT 1 FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
            WHERE rp.permission_id = NEW.id AND NOT r.is_system) THEN
          RAISE EXCEPTION 'Admin-only permission is still granted to a business role' USING ERRCODE = 'P0001';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER guard_admin_only_flag_rows BEFORE UPDATE OF admin_only ON permissions
        FOR EACH ROW EXECUTE FUNCTION guard_admin_only_flag();

      -- BA-RBAC-06: a permission added by a later migration is granted to the system role in the same statement.
      CREATE FUNCTION grant_new_permission_to_system_roles() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        INSERT INTO role_permissions (role_id, permission_id) SELECT id, NEW.id FROM roles WHERE is_system;
        RETURN NEW;
      END $$;
      CREATE TRIGGER grant_new_permission AFTER INSERT ON permissions
        FOR EACH ROW EXECUTE FUNCTION grant_new_permission_to_system_roles();

      -- Effective grants for read paths: active account + active role (BA-RBAC-02, BA-RBAC-09).
      CREATE VIEW v_user_grants AS
        SELECT u.id AS user_id, r.id AS role_id, r.code AS role_code, r.name AS role_name, p.id AS permission_id, p.code AS permission
          FROM users u
          JOIN user_roles ur ON ur.user_id = u.id
          JOIN roles r ON r.id = ur.role_id AND r.is_active
          JOIN role_permissions rp ON rp.role_id = r.id
          JOIN permissions p ON p.id = rp.permission_id
         WHERE u.is_active;
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`
      DROP VIEW v_user_grants;
      DROP TRIGGER guard_admin_only_flag_rows ON permissions;
      DROP FUNCTION guard_admin_only_flag();
      DROP TRIGGER forbid_truncate_roles ON roles;
      DROP TRIGGER forbid_truncate_role_permissions ON role_permissions;
      DROP FUNCTION forbid_truncate_grants();
      DROP TRIGGER grant_new_permission ON permissions;
      DROP FUNCTION grant_new_permission_to_system_roles();
      DROP TRIGGER guard_system_role_rows ON roles;
      DROP FUNCTION guard_system_role();
      DROP TRIGGER guard_role_permission_rows ON role_permissions;
      DROP FUNCTION guard_role_permission();
      DROP INDEX ux_roles_code_ci;
    `);
    await q.query('DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE code = ANY($1))', [NEW_KEYS]);
    await q.query('DELETE FROM permissions WHERE code = ANY($1)', [NEW_KEYS]);
    await q.query(`
      ALTER TABLE roles DROP COLUMN description, DROP COLUMN is_active, DROP COLUMN is_system, DROP COLUMN version,
        DROP COLUMN created_at, DROP COLUMN updated_at;
      ALTER TABLE permissions DROP COLUMN module, DROP COLUMN name, DROP COLUMN description, DROP COLUMN admin_only;
    `);
  }
}
