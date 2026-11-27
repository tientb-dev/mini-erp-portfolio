import { createHash, randomUUID } from 'node:crypto';
import { ForbiddenException, HttpStatus, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DataSource, EntityManager } from 'typeorm';
import { appendActivity } from '../document-records/document-records';
import { BusinessError } from '../workflow/workflow';
import { AttemptLimiter, LIMITS } from './attempt-limiter';
import { activeAdminCount, grantRole, lockAdminGuard } from './authorization';
import { hashPassword, verifyPassword } from './password';

export const MAX_FAILED_LOGINS = 5; // BA-USR-11
export const LOCKOUT_MINUTES = 15;
export const PASSWORD_MIN_LENGTH = 12; // BA-USR-05
export const PASSWORD_MAX_LENGTH = 256; // passphrases; bounds the hashing cost per request

type RevokeReason = 'LOGOUT' | 'PASSWORD_CHANGED' | 'PASSWORD_RESET' | 'ACCOUNT_DISABLED';

/** Security events on the USER target; metadata never carries passwords, hashes, tokens or session ids (BA-SEC-03). */
const audit = (m: EntityManager, userId: number, action: string, actorId: number, metadata?: Record<string, unknown>) =>
  appendActivity(m, 'USER', userId, action, actorId, undefined, metadata ? { metadata } : {});

export async function revokeSessions(m: EntityManager, userId: number, reason: RevokeReason, actorId: number) {
  const [, revoked] = await m.query(`UPDATE user_sessions SET revoked_at = now(), revoke_reason = $2
    WHERE user_id = $1 AND revoked_at IS NULL`, [userId, reason]);
  if (revoked) await audit(m, userId, 'SESSIONS_REVOKED', actorId, { reason, count: revoked });
}

/** Last Admin Protection check; call after `lockAdminGuard` and the change, inside the same transaction. Reused by OA1.3. */
export async function assertAdminRemains(m: EntityManager) {
  if (!(await activeAdminCount(m))) throw new BusinessError('LAST_ADMIN', 'At least one active administrator must remain', HttpStatus.CONFLICT);
}

export function assertPasswordPolicy(password: string) {
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    throw new BusinessError('PASSWORD_POLICY', `Password must be ${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} characters`, HttpStatus.BAD_REQUEST);
  }
}

const invalidLogin = () => new BusinessError('INVALID_CREDENTIALS', 'Invalid username or password', HttpStatus.UNAUTHORIZED);

const tooMany = () => new BusinessError('TOO_MANY_ATTEMPTS', 'Too many attempts. Wait a moment and try again', HttpStatus.TOO_MANY_REQUESTS);
const sessionEnded = () => new UnauthorizedException();

/** The acting session and account as of this transaction (F-OA1.2-03). */
export interface Actor { id: number; sessionId?: string }

@Injectable()
export class AccountSecurityService {
  private dummyHash?: Promise<string>;

  constructor(private readonly ds: DataSource, private readonly jwt: JwtService, private readonly limiter: AttemptLimiter) {}

  /**
   * One transaction per attempt with the user row locked, so lockout counting is exact under concurrency and a
   * reset/disable/password change that commits first is always seen (F-OA0-04). Failures commit their counter and
   * audit, then return the same 401 for every cause (BA-N-10). Every path runs one scrypt verification so the response
   * time does not tell unknown, locked or disabled accounts apart. Rate limits apply before any lookup (F-OA1.2-02).
   */
  async login(username: string, password: string, clientIp = 'unknown'): Promise<{ accessToken: string; mustChangePassword: boolean }> {
    const account = username.trim().toLowerCase();
    if (!this.limiter.take(`login-ip:${clientIp}`, LIMITS.loginPerIp()) || !this.limiter.take(`login:${clientIp}:${account}`, LIMITS.loginPerAccount())) {
      throw tooMany();
    }
    const result = await this.ds.transaction(async m => {
      const [user] = await m.query(`SELECT id, password_hash, is_active, must_change_password,
          (locked_until IS NOT NULL AND locked_until > now()) AS locked,
          (locked_until IS NOT NULL AND locked_until <= now()) AS lock_expired
        FROM users WHERE username = $1 FOR UPDATE`, [username]);
      const matches = await verifyPassword(password, user?.password_hash ?? await (this.dummyHash ??= hashPassword(randomUUID())));
      if (!user) {
        // No USER target: recorded as an authentication event keyed by a digest of the attempted name (F-OA1.2-01).
        await m.query(`INSERT INTO auth_events (event, cause, username_digest, client_ip) VALUES ('LOGIN_FAILED', 'UNKNOWN_USER', $1, $2)`,
          [usernameDigest(account), clientIp.slice(0, 45)]);
        return undefined;
      }
      if (user.locked || !user.is_active) {
        await audit(m, user.id, 'LOGIN_FAILED', user.id, { cause: user.locked ? 'LOCKED' : 'ACCOUNT_INACTIVE' });
        return undefined;
      }
      if (!matches) {
        // An expired lock starts a new run of consecutive failures.
        const [[after]] = await m.query(`UPDATE users SET
            failed_login_count = CASE WHEN $2 THEN 1 ELSE failed_login_count + 1 END,
            locked_until = CASE WHEN $2 THEN NULL ELSE locked_until END
          WHERE id = $1 RETURNING failed_login_count`, [user.id, user.lock_expired]);
        await audit(m, user.id, 'LOGIN_FAILED', user.id, { cause: 'BAD_PASSWORD', failedCount: after.failed_login_count });
        if (after.failed_login_count >= MAX_FAILED_LOGINS) {
          await m.query(`UPDATE users SET failed_login_count = 0, locked_until = now() + make_interval(mins => $2) WHERE id = $1`,
            [user.id, LOCKOUT_MINUTES]);
          await audit(m, user.id, 'ACCOUNT_LOCKED', user.id, { minutes: LOCKOUT_MINUTES });
        }
        return undefined;
      }
      await m.query('UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = $1', [user.id]);
      const sid = randomUUID();
      const accessToken = await this.jwt.signAsync({ sub: user.id, sid });
      const { exp } = this.jwt.decode<{ exp: number }>(accessToken);
      await m.query('INSERT INTO user_sessions (id, user_id, expires_at) VALUES ($1, $2, to_timestamp($3))', [sid, user.id, exp]);
      await audit(m, user.id, 'LOGIN_SUCCEEDED', user.id);
      return { accessToken, mustChangePassword: user.must_change_password as boolean };
    });
    if (!result) throw invalidLogin();
    return result;
  }

  async logout(userId: number, sessionId: string) {
    await this.ds.transaction(async m => {
      const [, revoked] = await m.query(`UPDATE user_sessions SET revoked_at = now(), revoke_reason = 'LOGOUT'
        WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`, [sessionId, userId]);
      if (revoked) await audit(m, userId, 'LOGOUT', userId);
    });
  }

  /**
   * Self-service change: verifies the current password, ends every session including this one, issues no token (F-OA0-01).
   * The caller's session is re-checked under the user row lock, so a concurrent change, reset or disable that committed
   * first wins and this request ends with 401 (F-OA1.2-03).
   */
  async changePassword(actor: Actor, currentPassword: string, newPassword: string) {
    if (!this.limiter.take(`password-check:${actor.id}`, LIMITS.passwordChecks())) throw tooMany();
    assertPasswordPolicy(newPassword);
    const hash = await hashPassword(newPassword);
    await this.ds.transaction(async m => {
      const [user] = await m.query('SELECT password_hash FROM users WHERE id = $1 AND is_active FOR UPDATE', [actor.id]);
      if (!user || !(await sessionOpen(m, actor))) throw sessionEnded();
      if (!(await verifyPassword(currentPassword, user.password_hash))) {
        throw new BusinessError('INVALID_CURRENT_PASSWORD', 'The current password is incorrect');
      }
      if (await verifyPassword(newPassword, user.password_hash)) {
        throw new BusinessError('PASSWORD_REUSED', 'Choose a password different from the current one');
      }
      await m.query(`UPDATE users SET password_hash = $2, must_change_password = false, password_changed_at = now(),
        version = version + 1, updated_at = now() WHERE id = $1`, [actor.id, hash]);
      await audit(m, actor.id, 'PASSWORD_CHANGED', actor.id);
      await revokeSessions(m, actor.id, 'PASSWORD_CHANGED', actor.id);
    });
  }

  /** Admin reset: temporary password, forced change at next sign-in, lockout cleared, every session ended. */
  async resetPassword(actor: Actor, userId: number, temporaryPassword: string) {
    if (actor.id === userId) throw selfChange();
    assertPasswordPolicy(temporaryPassword);
    const hash = await hashPassword(temporaryPassword);
    await this.ds.transaction(async m => {
      await this.lockForAdmin(m, actor, userId);
      await m.query(`UPDATE users SET password_hash = $2, must_change_password = true, password_changed_at = now(),
        failed_login_count = 0, locked_until = NULL, version = version + 1, updated_at = now() WHERE id = $1`, [userId, hash]);
      await audit(m, userId, 'PASSWORD_RESET', actor.id);
      await revokeSessions(m, userId, 'PASSWORD_RESET', actor.id);
    });
  }

  /** Disable ends every session in the same transaction; enabling never revives an old session (BA-USR-13). */
  async setAccountStatus(actor: Actor, userId: number, isActive: boolean) {
    if (actor.id === userId) throw selfChange();
    await this.ds.transaction(async m => {
      await lockAdminGuard(m);
      const user = await this.lockForAdmin(m, actor, userId);
      if (user.is_active === isActive) return;
      await m.query('UPDATE users SET is_active = $2, version = version + 1, updated_at = now() WHERE id = $1', [userId, isActive]);
      if (!isActive) await assertAdminRemains(m);
      await audit(m, userId, isActive ? 'ACCOUNT_ENABLED' : 'ACCOUNT_DISABLED', actor.id);
      if (!isActive) await revokeSessions(m, userId, 'ACCOUNT_DISABLED', actor.id);
    });
  }

  async unlock(actor: Actor, userId: number) {
    await this.ds.transaction(async m => {
      const user = await this.lockForAdmin(m, actor, userId);
      if (!user.locked && !user.failed_login_count) return;
      await m.query('UPDATE users SET failed_login_count = 0, locked_until = NULL, updated_at = now() WHERE id = $1', [userId]);
      await audit(m, userId, 'ACCOUNT_UNLOCKED', actor.id);
    });
  }

  async accountState(userId: number) {
    const [state] = await this.ds.query(`SELECT id, username, full_name AS "fullName", is_active AS "isActive",
        must_change_password AS "mustChangePassword", failed_login_count AS "failedLoginCount",
        CASE WHEN locked_until > now() THEN locked_until END AS "lockedUntil", password_changed_at AS "passwordChangedAt",
        (SELECT count(*)::int FROM user_sessions s WHERE s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > now()) AS "openSessions"
      FROM users u WHERE id = $1`, [userId]);
    if (!state) throw new NotFoundException();
    return state;
  }

  /**
   * Locks actor and target user rows in id order (after admin-guard when the caller took it), then re-checks the actor's
   * session and USER.MANAGE live under FOR SHARE, so a revoke that committed first stops the action (F-OA1.2-03).
   */
  private async lockForAdmin(m: EntityManager, actor: Actor, userId: number) {
    const rows: { id: number; is_active: boolean; failed_login_count: number; locked: boolean }[] = await m.query(`SELECT id, is_active,
        failed_login_count, (locked_until > now()) IS TRUE AS locked
      FROM users WHERE id = ANY($1) ORDER BY id FOR UPDATE`, [[actor.id, userId]]);
    const self = rows.find(r => r.id === actor.id);
    if (!self?.is_active || !(await sessionOpen(m, actor))) throw sessionEnded();
    if (!(await grantRole(m, actor.id, 'USER.MANAGE', true))) throw new ForbiddenException('Missing permission: USER.MANAGE');
    const user = rows.find(r => r.id === userId);
    if (!user) throw new NotFoundException();
    return user;
  }
}

/** HTTP callers carry a session; service-level callers (no session) are trusted callers inside the app. */
async function sessionOpen(m: EntityManager, actor: Actor) {
  if (!actor.sessionId) return true;
  const [open] = await m.query(`SELECT 1 FROM user_sessions WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
    AND expires_at > now() FOR SHARE`, [actor.sessionId, actor.id]);
  return Boolean(open);
}

/** Correlates repeated attempts on one name without storing it: users sometimes type a password into the username field. */
const usernameDigest = (name: string) => createHash('sha256').update(name).digest('hex');

const selfChange = () => new BusinessError('SELF_CHANGE_DENIED', 'Administrators cannot change their own account security', HttpStatus.FORBIDDEN);
