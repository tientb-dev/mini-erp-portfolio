import { MigrationInterface, QueryRunner } from 'typeorm';

const CODE = '^[A-Za-z0-9][A-Za-z0-9_.-]*$';

/**
 * Employee codes of existing users, declared by the operator as JSON `{"<username>": "<employee code>"}` in
 * EMPLOYEE_CODES (BA-USR-10, BA decision at OA2.3a). Never generated: an undeclared user stops the migration.
 */
function declaredCodes(): Map<string, string> {
  const raw = process.env.EMPLOYEE_CODES?.trim();
  if (!raw) return new Map();
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('EMPLOYEE_CODES must be a JSON object {username: code}');
  const codes = new Map<string, string>();
  for (const [username, code] of Object.entries(parsed)) {
    if (typeof code !== 'string' || !new RegExp(CODE).test(code.trim()) || code.trim().length > 50) {
      throw new Error(`EMPLOYEE_CODES: invalid employee code for ${username}`);
    }
    codes.set(username.toLowerCase(), code.trim());
  }
  return codes;
}

/**
 * OA2.3a (ADR-0018 §4.1): employee profile on `users` with an optional account. Employment status is separate from
 * account status (BA-USR-03); an inactive employee cannot hold an active account (BA-USR-04). Usernames become unique
 * case-insensitively (BA-USR-02). Preflight stops on case-insensitive duplicate usernames, missing or duplicate
 * employee codes; nothing is generated or changed silently. Grants are untouched.
 */
export class EmployeeProfiles1733875200000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    const dupUsernames: { username: string }[] = await q.query(`SELECT string_agg(username, ', ' ORDER BY username) AS username
      FROM users GROUP BY lower(username) HAVING count(*) > 1`);
    if (dupUsernames.length) throw new Error(`Preflight: usernames differ only by case: ${dupUsernames.map(d => d.username).join('; ')}`);

    const users: { id: number; username: string }[] = await q.query('SELECT id, username FROM users ORDER BY id');
    const codes = declaredCodes();
    const missing = users.filter(u => !codes.has(u.username.toLowerCase())).map(u => u.username);
    if (missing.length) throw new Error(`Preflight: declare an employee code in EMPLOYEE_CODES for: ${missing.join(', ')}`);
    const assigned = users.map(u => codes.get(u.username.toLowerCase())!);
    const dupCodes = assigned.filter((c, i) => assigned.findIndex(o => o.toLowerCase() === c.toLowerCase()) !== i);
    if (dupCodes.length) throw new Error(`Preflight: duplicate employee codes: ${[...new Set(dupCodes)].join(', ')}`);

    await q.query(`
      ALTER TABLE users
        ADD COLUMN employee_code varchar(50),
        ADD COLUMN email varchar(200),
        ADD COLUMN phone varchar(50),
        ADD COLUMN employment_status text NOT NULL DEFAULT 'ACTIVE' CHECK (employment_status IN ('ACTIVE', 'INACTIVE')),
        ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
        ADD COLUMN created_by int REFERENCES users(id),
        ADD COLUMN updated_by int REFERENCES users(id);
    `);
    await q.query('UPDATE users u SET employee_code = d.code FROM unnest($1::int[], $2::text[]) AS d(id, code) WHERE u.id = d.id',
      [users.map(u => u.id), assigned]);
    await q.query(`
      ALTER TABLE users
        ALTER COLUMN employee_code SET NOT NULL,
        ADD CONSTRAINT chk_users_employee_code CHECK (employee_code ~ '${CODE}'),
        ALTER COLUMN username DROP NOT NULL,
        ALTER COLUMN password_hash DROP NOT NULL,
        DROP CONSTRAINT users_username_key,
        ADD CONSTRAINT chk_users_account_pair CHECK ((username IS NULL) = (password_hash IS NULL)),
        ADD CONSTRAINT chk_users_account_requires_employment CHECK (employment_status = 'ACTIVE' OR NOT is_active),
        ADD CONSTRAINT chk_users_account_requires_username CHECK (username IS NOT NULL OR NOT is_active);
      CREATE UNIQUE INDEX ux_users_employee_code_ci ON users (lower(employee_code));
      CREATE UNIQUE INDEX ux_users_username_ci ON users (lower(username)) WHERE username IS NOT NULL;

      ALTER TABLE user_sessions DROP CONSTRAINT user_sessions_revoke_reason_check;
      ALTER TABLE user_sessions ADD CONSTRAINT user_sessions_revoke_reason_check CHECK
        (revoke_reason IN ('LOGOUT', 'PASSWORD_CHANGED', 'PASSWORD_RESET', 'ACCOUNT_DISABLED', 'EMPLOYMENT_INACTIVE'));
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM users WHERE username IS NULL) THEN
          RAISE EXCEPTION 'Employees without an account exist; the previous schema requires an account per user';
        END IF;
        IF EXISTS (SELECT 1 FROM user_sessions WHERE revoke_reason = 'EMPLOYMENT_INACTIVE') THEN
          RAISE EXCEPTION 'Sessions revoked by EMPLOYMENT_INACTIVE exist; session history cannot be rewritten by a rollback';
        END IF;
      END $$;
      ALTER TABLE user_sessions DROP CONSTRAINT user_sessions_revoke_reason_check;
      ALTER TABLE user_sessions ADD CONSTRAINT user_sessions_revoke_reason_check CHECK
        (revoke_reason IN ('LOGOUT', 'PASSWORD_CHANGED', 'PASSWORD_RESET', 'ACCOUNT_DISABLED'));
      DROP INDEX ux_users_username_ci;
      DROP INDEX ux_users_employee_code_ci;
      ALTER TABLE users
        DROP CONSTRAINT chk_users_account_requires_username,
        DROP CONSTRAINT chk_users_account_requires_employment,
        DROP CONSTRAINT chk_users_account_pair,
        ADD CONSTRAINT users_username_key UNIQUE (username),
        ALTER COLUMN username SET NOT NULL,
        ALTER COLUMN password_hash SET NOT NULL,
        DROP COLUMN employee_code, DROP COLUMN email, DROP COLUMN phone, DROP COLUMN employment_status,
        DROP COLUMN created_at, DROP COLUMN created_by, DROP COLUMN updated_by;
    `);
  }
}
