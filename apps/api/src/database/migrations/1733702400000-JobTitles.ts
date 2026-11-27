import { MigrationInterface, QueryRunner } from 'typeorm';

const KEYS: [string, string, number][] = [
  ['ORGANIZATION.VIEW', 'Xem cơ cấu tổ chức và chức danh', 520],
  ['ORGANIZATION.MANAGE', 'Quản trị cơ cấu tổ chức và chức danh', 530],
];

/** OA2.1 (ADR-0018 §4.3): job title catalog, ORGANIZATION.* keys (admin_only, auto-granted to ADMIN by the OA1.1 trigger), JOB_TITLE activity. */
export class JobTitles1733702400000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE job_titles (
        id serial PRIMARY KEY,
        code varchar(50) NOT NULL CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9_.-]*$'),
        name varchar(200) NOT NULL CHECK (btrim(name) <> ''),
        description text,
        status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
        version int NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(),
        created_by int REFERENCES users(id),
        updated_at timestamptz NOT NULL DEFAULT now(),
        updated_by int REFERENCES users(id));
      CREATE UNIQUE INDEX ux_job_titles_code_ci ON job_titles (lower(code));
      ALTER TABLE approval_histories DROP CONSTRAINT chk_activity_target;
      ALTER TABLE approval_histories ADD CONSTRAINT chk_activity_target CHECK
        (document_type IN ('PR', 'PO', 'GRR', 'GR', 'GIR', 'GI', 'SALES_CONTRACT', 'USER', 'ROLE', 'JOB_TITLE') AND document_id > 0);
    `);
    await q.query(`INSERT INTO permissions (code, module, name, admin_only, sort_order)
      SELECT k.code, 'ADMINISTRATION', k.name, true, k.ord FROM unnest($1::text[], $2::text[], $3::int[]) AS k(code, name, ord)
      ON CONFLICT (code) DO NOTHING`, [KEYS.map(k => k[0]), KEYS.map(k => k[1]), KEYS.map(k => k[2])]);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM approval_histories WHERE document_type = 'JOB_TITLE') THEN
          RAISE EXCEPTION 'JOB_TITLE activity exists; it is append-only and cannot be removed by a rollback';
        END IF;
      END $$;
      ALTER TABLE approval_histories DROP CONSTRAINT chk_activity_target;
      ALTER TABLE approval_histories ADD CONSTRAINT chk_activity_target CHECK
        (document_type IN ('PR', 'PO', 'GRR', 'GR', 'GIR', 'GI', 'SALES_CONTRACT', 'USER', 'ROLE') AND document_id > 0);
      DROP TABLE job_titles;
      ALTER TABLE role_permissions DISABLE TRIGGER guard_role_permission_rows;
    `);
    // The system-role grant guard is bypassed only to drop the keys this migration added.
    await q.query('DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE code = ANY($1))', [KEYS.map(k => k[0])]);
    await q.query('DELETE FROM permissions WHERE code = ANY($1)', [KEYS.map(k => k[0])]);
    await q.query('ALTER TABLE role_permissions ENABLE TRIGGER guard_role_permission_rows');
  }
}
