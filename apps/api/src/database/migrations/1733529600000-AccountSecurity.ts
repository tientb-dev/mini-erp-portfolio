import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * OA1.2 (ADR-0018): sessions, password-change flag and lockout counters, and USER as an Activity History target.
 * Existing accounts keep their password hash and status; no account is reset or forced to change here (BA-USR-10).
 */
export class AccountSecurity1733529600000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE users
        ADD COLUMN must_change_password boolean NOT NULL DEFAULT false,
        ADD COLUMN password_changed_at timestamptz,
        ADD COLUMN failed_login_count int NOT NULL DEFAULT 0 CHECK (failed_login_count >= 0),
        ADD COLUMN locked_until timestamptz,
        ADD COLUMN version int NOT NULL DEFAULT 1,
        ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

      -- The JWT carries only sub/sid/exp; the token itself is never stored.
      CREATE TABLE user_sessions (
        id uuid PRIMARY KEY,
        user_id int NOT NULL REFERENCES users(id),
        created_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL,
        revoked_at timestamptz,
        revoke_reason text CHECK (revoke_reason IN ('LOGOUT', 'PASSWORD_CHANGED', 'PASSWORD_RESET', 'ACCOUNT_DISABLED')),
        CHECK ((revoked_at IS NULL) = (revoke_reason IS NULL)),
        CHECK (expires_at > created_at));
      CREATE INDEX ix_user_sessions_open ON user_sessions (user_id) WHERE revoked_at IS NULL;

      ALTER TABLE approval_histories DROP CONSTRAINT chk_activity_target;
      ALTER TABLE approval_histories ADD CONSTRAINT chk_activity_target CHECK
        (document_type IN ('PR', 'PO', 'GRR', 'GR', 'GIR', 'GI', 'SALES_CONTRACT', 'USER') AND document_id > 0);

      -- Authentication events without a USER target (unknown username). The attempted name is stored only as a
      -- SHA-256 digest because people sometimes type a password into the username field (F-OA1.2-01).
      CREATE TABLE auth_events (
        id bigserial PRIMARY KEY,
        event text NOT NULL CHECK (event IN ('LOGIN_FAILED')),
        cause text NOT NULL CHECK (cause IN ('UNKNOWN_USER')),
        username_digest char(64) NOT NULL CHECK (username_digest ~ '^[0-9a-f]{64}$'),
        client_ip varchar(45),
        created_at timestamptz NOT NULL DEFAULT now());
      CREATE INDEX ix_auth_events_created ON auth_events (created_at DESC);
      CREATE FUNCTION protect_auth_events() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'Authentication events are append-only';
      END $$;
      CREATE TRIGGER protect_auth_events_rows BEFORE UPDATE OR DELETE ON auth_events
        FOR EACH ROW EXECUTE FUNCTION protect_auth_events();
      CREATE TRIGGER protect_auth_events_truncate BEFORE TRUNCATE ON auth_events
        FOR EACH STATEMENT EXECUTE FUNCTION protect_auth_events();
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM approval_histories WHERE document_type = 'USER') OR EXISTS (SELECT 1 FROM auth_events) THEN
          RAISE EXCEPTION 'USER security activity exists; it is append-only and cannot be removed by a rollback';
        END IF;
      END $$;
      ALTER TABLE approval_histories DROP CONSTRAINT chk_activity_target;
      ALTER TABLE approval_histories ADD CONSTRAINT chk_activity_target CHECK
        (document_type IN ('PR', 'PO', 'GRR', 'GR', 'GIR', 'GI', 'SALES_CONTRACT') AND document_id > 0);
      DROP TABLE auth_events;
      DROP FUNCTION protect_auth_events();
      DROP TABLE user_sessions;
      ALTER TABLE users DROP COLUMN must_change_password, DROP COLUMN password_changed_at, DROP COLUMN failed_login_count,
        DROP COLUMN locked_until, DROP COLUMN version, DROP COLUMN updated_at;
    `);
  }
}
