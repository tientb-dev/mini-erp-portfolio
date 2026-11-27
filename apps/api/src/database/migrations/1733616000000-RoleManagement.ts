import { MigrationInterface, QueryRunner } from 'typeorm';

/** Display order of the catalog for the Role screen (OA1.3); same order as the OA1.1 catalog. Grants are untouched. */
const ORDER = [
  'PRODUCT.VIEW', 'PRODUCT.CREATE', 'PRODUCT.UPDATE', 'PROCUREMENT_CATALOG.MANAGE', 'UOM.MANAGE', 'WAREHOUSE.VIEW', 'WAREHOUSE.CREATE',
  'WAREHOUSE.UPDATE', 'CUSTOMER.VIEW', 'CUSTOMER.CREATE', 'CUSTOMER.UPDATE', 'SUPPLIER.VIEW', 'SUPPLIER.CREATE', 'SUPPLIER.UPDATE',
  'DOSSIER_TYPE.VIEW', 'DOSSIER_TYPE.MANAGE', 'DOSSIER_CONFIG.MANAGE',
  'SALES_CONTRACT.VIEW', 'SALES_CONTRACT.CREATE', 'SALES_CONTRACT.PROPOSE_PRODUCT', 'SALES_CONTRACT.CONFIRM_PRODUCT',
  'PR.VIEW', 'PR.CREATE', 'PR.APPROVE', 'PR.RECEIVE', 'PR.REASSIGN', 'PR.DOSSIER_MANAGE', 'PR.CONFIGURE',
  'PO.VIEW', 'PO.CREATE', 'PO.APPROVE',
  'GRR.VIEW', 'GRR.CREATE', 'GRR.APPROVE', 'GR.VIEW', 'GR.CREATE', 'GR.DECLARE_DETAILS', 'GR.APPROVE',
  'GIR.VIEW', 'GIR.CREATE', 'GIR.SALES_CONFIRM', 'GIR.APPROVE', 'GIR.COMPLETE', 'GI.VIEW', 'GI.CREATE', 'GI.APPROVE',
  'INVENTORY.VIEW', 'USER.VIEW', 'USER.MANAGE', 'ROLE.VIEW', 'ROLE.MANAGE',
];

export class RoleManagement1733616000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE permissions ADD COLUMN sort_order int NOT NULL DEFAULT 0');
    await q.query(`UPDATE permissions p SET sort_order = o.ord * 10 FROM unnest($1::text[]) WITH ORDINALITY AS o(code, ord)
      WHERE p.code = o.code`, [ORDER]);
    await q.query(`
      ALTER TABLE roles ADD COLUMN updated_by int REFERENCES users(id);
      ALTER TABLE approval_histories DROP CONSTRAINT chk_activity_target;
      ALTER TABLE approval_histories ADD CONSTRAINT chk_activity_target CHECK
        (document_type IN ('PR', 'PO', 'GRR', 'GR', 'GIR', 'GI', 'SALES_CONTRACT', 'USER', 'ROLE') AND document_id > 0);
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM approval_histories WHERE document_type = 'ROLE') THEN
          RAISE EXCEPTION 'ROLE activity exists; it is append-only and cannot be removed by a rollback';
        END IF;
      END $$;
      ALTER TABLE approval_histories DROP CONSTRAINT chk_activity_target;
      ALTER TABLE approval_histories ADD CONSTRAINT chk_activity_target CHECK
        (document_type IN ('PR', 'PO', 'GRR', 'GR', 'GIR', 'GI', 'SALES_CONTRACT', 'USER') AND document_id > 0);
      ALTER TABLE roles DROP COLUMN updated_by;
      ALTER TABLE permissions DROP COLUMN sort_order;
    `);
  }
}
