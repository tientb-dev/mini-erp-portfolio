import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * OA2.2 (ADR-0018 §4.3, BA-ORG-01/09): organization unit tree and the ORG_UNIT activity target.
 * `head_user_id` exists for OA2.3; it stays NULL until memberships exist (BA-ORG-10: the head must be a member).
 */
export class OrgUnits1733788800000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE org_units (
        id serial PRIMARY KEY,
        code varchar(50) NOT NULL CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9_.-]*$'),
        name varchar(200) NOT NULL CHECK (btrim(name) <> ''),
        parent_id int REFERENCES org_units(id) CHECK (parent_id <> id),
        head_user_id int REFERENCES users(id),
        description text,
        status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
        version int NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(),
        created_by int REFERENCES users(id),
        updated_at timestamptz NOT NULL DEFAULT now(),
        updated_by int REFERENCES users(id));
      CREATE UNIQUE INDEX ux_org_units_code_ci ON org_units (lower(code));
      CREATE INDEX ix_org_units_parent ON org_units (parent_id);
      ALTER TABLE approval_histories DROP CONSTRAINT chk_activity_target;
      ALTER TABLE approval_histories ADD CONSTRAINT chk_activity_target CHECK
        (document_type IN ('PR', 'PO', 'GRR', 'GR', 'GIR', 'GI', 'SALES_CONTRACT', 'USER', 'ROLE', 'JOB_TITLE', 'ORG_UNIT') AND document_id > 0);
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM approval_histories WHERE document_type = 'ORG_UNIT') THEN
          RAISE EXCEPTION 'ORG_UNIT activity exists; it is append-only and cannot be removed by a rollback';
        END IF;
      END $$;
      ALTER TABLE approval_histories DROP CONSTRAINT chk_activity_target;
      ALTER TABLE approval_histories ADD CONSTRAINT chk_activity_target CHECK
        (document_type IN ('PR', 'PO', 'GRR', 'GR', 'GIR', 'GI', 'SALES_CONTRACT', 'USER', 'ROLE', 'JOB_TITLE') AND document_id > 0);
      DROP TABLE org_units;
    `);
  }
}
