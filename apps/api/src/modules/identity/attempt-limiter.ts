import { Injectable } from '@nestjs/common';

/**
 * Fixed-window attempt limits, complementing the DB-backed account lockout (F-OA1.2-02). Keys are taken from request
 * input before any lookup, so a limit never depends on whether an account exists.
 * shortcut: per-process memory, so limits are per API instance and reset on restart; move to a shared store if the
 * API runs as several instances.
 */
@Injectable()
export class AttemptLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  /** Counts one attempt; false once `limit.max` attempts happened in the current window. */
  take(key: string, limit: { max: number; windowMs: number }, now = Date.now()): boolean {
    if (this.windows.size > 10_000) for (const [k, w] of this.windows) if (w.resetAt <= now) this.windows.delete(k);
    const window = this.windows.get(key);
    if (!window || window.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + limit.windowMs });
      return true;
    }
    window.count++;
    return window.count <= limit.max;
  }
}

const read = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
};
const MINUTE = 60_000;

/** Read on every check so operators (and test fixtures) configure them through the environment. */
export const LIMITS = {
  /** Sign-in attempts from one client address, all usernames. */
  loginPerIp: () => ({ max: read('AUTH_LOGIN_LIMIT_PER_IP', 30), windowMs: MINUTE }),
  /** Sign-in attempts from one client address for one username. */
  loginPerAccount: () => ({ max: read('AUTH_LOGIN_LIMIT_PER_ACCOUNT', 10), windowMs: MINUTE }),
  /** Current-password checks when changing a password, per account (not counted by the lockout). */
  passwordChecks: () => ({ max: read('AUTH_PASSWORD_CHECK_LIMIT', 5), windowMs: 15 * MINUTE }),
};
