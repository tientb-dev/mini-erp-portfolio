import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * OA2.3b (ADR-0018 §4.3, BA-ORG-04/10/11/13): employee memberships in org units with a job title and an optional direct
 * manager. Ending a membership keeps the row (status ENDED + ended_at). At most one ACTIVE membership per unit and at most
 * one ACTIVE primary per employee are enforced here; "at least one primary" and every cross-row rule (head is a member,
 * no manager cycle, active unit/title) are checked by the service under the shared lock graph. Grants are untouched.
 */
export class OrgMemberships1733961600000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE org_memberships (
        id serial PRIMARY KEY,
        user_id int NOT NULL REFERENCES users(id),
        org_unit_id int NOT NULL REFERENCES org_units(id),
        job_title_id int NOT NULL REFERENCES job_titles(id),
        manager_user_id int REFERENCES users(id),
        is_primary boolean NOT NULL DEFAULT false,
        status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ENDED')),
        started_at timestamptz NOT NULL DEFAULT now(),
        ended_at timestamptz,
        version int NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(),
        created_by int REFERENCES users(id),
        updated_at timestamptz NOT NULL DEFAULT now(),
        updated_by int REFERENCES users(id),
        CONSTRAINT chk_org_memberships_not_self_managed CHECK (manager_user_id <> user_id),
        CONSTRAINT chk_org_memberships_ended CHECK ((status = 'ENDED') = (ended_at IS NOT NULL)));
      CREATE UNIQUE INDEX ux_org_memberships_active_unit ON org_memberships (user_id, org_unit_id) WHERE status = 'ACTIVE';
      CREATE UNIQUE INDEX ux_org_memberships_primary ON org_memberships (user_id) WHERE status = 'ACTIVE' AND is_primary;
      CREATE INDEX ix_org_memberships_unit ON org_memberships (org_unit_id) WHERE status = 'ACTIVE';
      CREATE INDEX ix_org_memberships_manager ON org_memberships (manager_user_id) WHERE status = 'ACTIVE';
      CREATE INDEX ix_org_units_head ON org_units (head_user_id);
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM org_memberships) OR EXISTS (SELECT 1 FROM org_units WHERE head_user_id IS NOT NULL) THEN
          RAISE EXCEPTION 'Memberships or unit heads exist; organization history cannot be removed by a rollback';
        END IF;
      END $$;
      DROP INDEX ix_org_units_head;
      DROP TABLE org_memberships;
    `);
  }
}
