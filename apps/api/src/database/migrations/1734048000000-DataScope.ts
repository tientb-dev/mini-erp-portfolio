import { MigrationInterface, QueryRunner } from 'typeorm';

/** Fixed scope types (BA-SCP-03). Order is the display order. */
export const SCOPE_TYPES = ['ALL', 'CREATOR', 'RESPONSIBLE', 'ASSIGNED', 'ORG_UNIT', 'ORG_UNIT_TREE', 'WAREHOUSE'] as const;

/** Supported scopes per permission (OA0 §7, BA OA3.0). Every other key is unscoped ('{}'): master data, admin, PO and warehouse (D-02). */
export const SUPPORTED_SCOPES: Record<string, string[]> = {
  'SALES_CONTRACT.VIEW': ['ALL', 'CREATOR', 'RESPONSIBLE', 'ORG_UNIT', 'ORG_UNIT_TREE'],
  'SALES_CONTRACT.CREATE': ['ALL', 'CREATOR', 'RESPONSIBLE', 'ORG_UNIT', 'ORG_UNIT_TREE'],
  'PR.VIEW': ['ALL', 'CREATOR', 'RESPONSIBLE', 'ASSIGNED', 'ORG_UNIT', 'ORG_UNIT_TREE'],
  'PR.CREATE': ['CREATOR', 'RESPONSIBLE', 'ORG_UNIT', 'ORG_UNIT_TREE'],
  'PR.APPROVE': ['ALL', 'ASSIGNED', 'ORG_UNIT', 'ORG_UNIT_TREE'],
  'PR.RECEIVE': ['ALL', 'ASSIGNED', 'ORG_UNIT', 'ORG_UNIT_TREE'],
  'PR.REASSIGN': ['ALL', 'CREATOR', 'RESPONSIBLE', 'ASSIGNED', 'ORG_UNIT', 'ORG_UNIT_TREE'],
  'PR.DOSSIER_MANAGE': ['ALL', 'CREATOR', 'RESPONSIBLE', 'ASSIGNED', 'ORG_UNIT', 'ORG_UNIT_TREE'],
};

const OLD_GRANT_NEW_PERMISSION = `CREATE OR REPLACE FUNCTION grant_new_permission_to_system_roles() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        INSERT INTO role_permissions (role_id, permission_id) SELECT id, NEW.id FROM roles WHERE is_system;
        RETURN NEW;
      END $$;`;

/**
 * OA3.1 (ADR-0018 §4.1, §4.4): permission metadata `supported_scopes`, Role–Permission scopes, and the responsible unit of
 * HĐ/PR. Schema only: no business role grant changes (mapping is applied at OA3.5 after dry-run and snapshot), no backfill.
 * The system role gets ALL when supported, otherwise every supported scope (BA OA3.0); triggers keep that fixed.
 */
export class DataScope1734048000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    const types = SCOPE_TYPES.map(t => `'${t}'`).join(', ');
    await q.query(`
      ALTER TABLE permissions ADD COLUMN supported_scopes text[] NOT NULL DEFAULT '{}',
        ADD CONSTRAINT chk_permission_supported_scopes CHECK (supported_scopes <@ ARRAY[${types}]::text[]
          AND array_position(supported_scopes, NULL) IS NULL AND (NOT admin_only OR supported_scopes = '{}'));
    `);
    await q.query(`UPDATE permissions p SET supported_scopes = string_to_array(s.scopes, ',')
      FROM unnest($1::text[], $2::text[]) AS s(code, scopes) WHERE p.code = s.code`,
    [Object.keys(SUPPORTED_SCOPES), Object.values(SUPPORTED_SCOPES).map(s => s.join(','))]);
    await q.query(`
      CREATE TABLE role_permission_scopes (
        role_id int NOT NULL, permission_id int NOT NULL,
        scope_type text NOT NULL CHECK (scope_type IN (${types})),
        PRIMARY KEY (role_id, permission_id, scope_type),
        FOREIGN KEY (role_id, permission_id) REFERENCES role_permissions (role_id, permission_id) ON DELETE CASCADE);

      -- System role: ALL when supported, otherwise every supported scope. Inserted before the guard exists.
      INSERT INTO role_permission_scopes (role_id, permission_id, scope_type)
        SELECT rp.role_id, p.id, s FROM role_permissions rp JOIN roles r ON r.id = rp.role_id AND r.is_system
          JOIN permissions p ON p.id = rp.permission_id
          CROSS JOIN LATERAL unnest(CASE WHEN 'ALL' = ANY(p.supported_scopes) THEN ARRAY['ALL'] ELSE p.supported_scopes END) s;

      -- Scope must be supported by the permission. System role scopes are written only by the catalog triggers below
      -- (new key, supported_scopes change), never directly.
      CREATE FUNCTION guard_role_permission_scope() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF pg_trigger_depth() < 2 AND EXISTS (SELECT 1 FROM roles
            WHERE is_system AND id = CASE WHEN TG_OP = 'INSERT' THEN NEW.role_id ELSE OLD.role_id END) THEN
          RAISE EXCEPTION 'System role scopes are protected' USING ERRCODE = 'P0001';
        END IF;
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        IF TG_OP = 'UPDATE' AND pg_trigger_depth() < 2 AND EXISTS (SELECT 1 FROM roles WHERE id = NEW.role_id AND is_system) THEN
          RAISE EXCEPTION 'System role scopes are protected' USING ERRCODE = 'P0001';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM permissions WHERE id = NEW.permission_id AND NEW.scope_type = ANY(supported_scopes)) THEN
          RAISE EXCEPTION 'Scope % is not supported by the permission', NEW.scope_type USING ERRCODE = 'P0001';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER guard_role_permission_scope_rows BEFORE INSERT OR UPDATE OR DELETE ON role_permission_scopes
        FOR EACH ROW EXECUTE FUNCTION guard_role_permission_scope();
      CREATE TRIGGER forbid_truncate_role_permission_scopes BEFORE TRUNCATE ON role_permission_scopes
        FOR EACH STATEMENT EXECUTE FUNCTION forbid_truncate_grants();

      -- Narrowing supported_scopes must not orphan a business role's scope (the migration reconfigures that role first).
      CREATE FUNCTION guard_supported_scopes() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF EXISTS (SELECT 1 FROM role_permission_scopes s JOIN roles r ON r.id = s.role_id AND NOT r.is_system
            WHERE s.permission_id = NEW.id AND s.scope_type <> ALL(NEW.supported_scopes)) THEN
          RAISE EXCEPTION 'A configured scope is outside the new supported scopes' USING ERRCODE = 'P0001';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER guard_supported_scopes_rows BEFORE UPDATE OF supported_scopes ON permissions
        FOR EACH ROW EXECUTE FUNCTION guard_supported_scopes();

      -- ADMIN invariant (BA-OA3-02) in the same statement as any supported_scopes change: ALL when supported, else every
      -- supported scope. Unscoped → scoped and scoped → unscoped included.
      CREATE FUNCTION sync_system_role_scopes() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        DELETE FROM role_permission_scopes s USING roles r WHERE r.id = s.role_id AND r.is_system AND s.permission_id = NEW.id;
        INSERT INTO role_permission_scopes (role_id, permission_id, scope_type)
          SELECT rp.role_id, NEW.id, x FROM role_permissions rp JOIN roles r ON r.id = rp.role_id AND r.is_system
            CROSS JOIN LATERAL unnest(CASE WHEN 'ALL' = ANY(NEW.supported_scopes) THEN ARRAY['ALL'] ELSE NEW.supported_scopes END) x
           WHERE rp.permission_id = NEW.id;
        RETURN NEW;
      END $$;
      CREATE TRIGGER sync_system_role_scopes_rows AFTER UPDATE OF supported_scopes ON permissions
        FOR EACH ROW WHEN (OLD.supported_scopes IS DISTINCT FROM NEW.supported_scopes) EXECUTE FUNCTION sync_system_role_scopes();

      -- A key added later goes to the system role with its scopes in the same statement (BA-RBAC-06).
      CREATE OR REPLACE FUNCTION grant_new_permission_to_system_roles() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        INSERT INTO role_permissions (role_id, permission_id) SELECT id, NEW.id FROM roles WHERE is_system;
        INSERT INTO role_permission_scopes (role_id, permission_id, scope_type)
          SELECT r.id, NEW.id, s FROM roles r
            CROSS JOIN LATERAL unnest(CASE WHEN 'ALL' = ANY(NEW.supported_scopes) THEN ARRAY['ALL'] ELSE NEW.supported_scopes END) s
           WHERE r.is_system;
        RETURN NEW;
      END $$;

      -- Responsible unit (BA-SCP-08, BA-SCP-18): set at creation from OA3.3; existing documents stay NULL (BA-SCP-12).
      ALTER TABLE sales_contracts ADD COLUMN owner_org_unit_id int NULL REFERENCES org_units(id);
      ALTER TABLE purchase_requisitions ADD COLUMN owner_org_unit_id int NULL REFERENCES org_units(id);
      CREATE INDEX ix_sales_contracts_owner_unit ON sales_contracts (owner_org_unit_id);
      CREATE INDEX ix_purchase_requisitions_owner_unit ON purchase_requisitions (owner_org_unit_id);
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`
      DROP INDEX ix_purchase_requisitions_owner_unit;
      DROP INDEX ix_sales_contracts_owner_unit;
      ALTER TABLE purchase_requisitions DROP COLUMN owner_org_unit_id;
      ALTER TABLE sales_contracts DROP COLUMN owner_org_unit_id;
      ${OLD_GRANT_NEW_PERMISSION}
      DROP TRIGGER sync_system_role_scopes_rows ON permissions;
      DROP FUNCTION sync_system_role_scopes();
      DROP TRIGGER guard_supported_scopes_rows ON permissions;
      DROP FUNCTION guard_supported_scopes();
      DROP TABLE role_permission_scopes;
      DROP FUNCTION guard_role_permission_scope();
      ALTER TABLE permissions DROP COLUMN supported_scopes;
    `);
  }
}
