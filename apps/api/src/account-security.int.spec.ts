import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { bootTestApp, login } from './test-utils';
import { hashPassword } from './modules/identity/password';
import { assertAdminRemains } from './modules/identity/account-security';
import { lockAdminGuard } from './modules/identity/authorization';

const PW = 'correct horse battery';
const BAD = 'wrong password value';

describe('Account security OA1.2 (PostgreSQL, HTTP)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let admin: string;
  let adminId: number;
  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const signIn = (username: string, password: string) => http().post('/auth/login').send({ username, password });
  const me = (t: string) => http().get('/auth/me').set(bearer(t));
  const reset = (t: string, id: number, temporaryPassword = 'temporary passphrase') =>
    http().post(`/admin/users/${id}/reset-password`).set(bearer(t)).send({ temporaryPassword });
  const setStatus = (t: string, id: number, isActive: boolean) =>
    http().patch(`/admin/users/${id}/account-status`).set(bearer(t)).send({ isActive });
  const change = (t: string, currentPassword: string, newPassword: string) =>
    http().post('/auth/change-password').set(bearer(t)).send({ currentPassword, newPassword });
  const events = async (id: number) => (await ds.query(`SELECT action, metadata FROM approval_histories
    WHERE document_type = 'USER' AND document_id = $1 ORDER BY id`, [id])) as { action: string; metadata: Record<string, unknown> | null }[];
  const actions = async (id: number) => (await events(id)).map(e => e.action);

  let seq = 0;
  async function makeUser(role = 'SALES', password = PW) {
    const username = `oa12-${++seq}`;
    const [{ id }] = await ds.query(`INSERT INTO users (username, password_hash, full_name) VALUES ($1, $2, $3) RETURNING id`,
      [username, await hashPassword(password), `User ${seq}`]);
    await ds.query('INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE code = $2', [id, role]);
    return { id: id as number, username };
  }
  const tokenOf = async (username: string, password = PW) => (await signIn(username, password).expect(200)).body.accessToken as string;

  beforeAll(async () => {
    ({ app, ds } = await bootTestApp());
    admin = await login(app, process.env.SEED_ADMIN_USERNAME!, process.env.SEED_ADMIN_PASSWORD!);
    adminId = (await me(admin).expect(200)).body.id;
  }, 120_000);
  afterAll(async () => app?.close());

  describe('sessions', () => {
    it('keeps sessions independent on logout and ends all of them on reset', async () => {
      const u = await makeUser();
      const [a, b] = [await tokenOf(u.username), await tokenOf(u.username)];
      await me(a).expect(200);
      await me(b).expect(200);
      expect(Object.keys((await me(a)).body)).not.toContain('sessionId');
      await http().post('/auth/logout').set(bearer(a)).expect(204);
      await me(a).expect(401);
      await me(b).expect(200);
      await reset(admin, u.id).expect(204);
      await me(b).expect(401);
      expect(await actions(u.id)).toEqual(['LOGIN_SUCCEEDED', 'LOGIN_SUCCEEDED', 'LOGOUT', 'PASSWORD_RESET', 'SESSIONS_REVOKED']);
      expect((await events(u.id)).at(-1)!.metadata).toEqual({ reason: 'PASSWORD_RESET', count: 1 });
    });

    it('does not revive old tokens when a disabled account is enabled again', async () => {
      const u = await makeUser();
      const t = await tokenOf(u.username);
      await setStatus(admin, u.id, false).expect(204);
      await me(t).expect(401);
      await signIn(u.username, PW).expect(401);
      await setStatus(admin, u.id, true).expect(204);
      await me(t).expect(401);
      await me(await tokenOf(u.username)).expect(200);
      expect(await actions(u.id)).toEqual(['LOGIN_SUCCEEDED', 'ACCOUNT_DISABLED', 'SESSIONS_REVOKED', 'LOGIN_FAILED', 'ACCOUNT_ENABLED', 'LOGIN_SUCCEEDED']);
    });

    it('rejects expired, revoked, unknown, foreign and legacy session tokens', async () => {
      const u = await makeUser();
      const other = await makeUser();
      const jwt = app.get(JwtService);
      const t = await tokenOf(u.username);
      const [{ id: sid }] = await ds.query('SELECT id FROM user_sessions WHERE user_id = $1', [u.id]);
      await ds.query(`UPDATE user_sessions SET created_at = now() - interval '9 hours', expires_at = now() - interval '1 second' WHERE id = $1`, [sid]);
      await me(t).expect(401);
      await me(await jwt.signAsync({ sub: u.id, sid: randomUUID() })).expect(401);
      await me(await jwt.signAsync({ sub: u.id })).expect(401);
      await me(await jwt.signAsync({ sub: u.id, sid: 'not-a-uuid' })).expect(401);
      const otherToken = await tokenOf(other.username);
      const [{ id: otherSid }] = await ds.query('SELECT id FROM user_sessions WHERE user_id = $1', [other.id]);
      await me(await jwt.signAsync({ sub: u.id, sid: otherSid })).expect(401);
      await me(otherToken).expect(200);
      expect(await ds.query('SELECT 1 FROM user_sessions WHERE id::text LIKE $1', ['%.%'])).toEqual([]);
    });
  });

  describe('passwords', () => {
    it('validates the change and ends every session without issuing a token', async () => {
      const u = await makeUser();
      const [a, b] = [await tokenOf(u.username), await tokenOf(u.username)];
      expect((await change(a, PW, 'short').expect(400)).body.code).toBe('PASSWORD_POLICY');
      expect((await change(a, PW, 'x'.repeat(257)).expect(400)).body.code).toBe('BAD_REQUEST');
      await http().post('/auth/change-password').set(bearer(a)).send({ newPassword: 'long enough passphrase' }).expect(400);
      expect((await change(a, BAD, 'long enough passphrase').expect(422)).body.code).toBe('INVALID_CURRENT_PASSWORD');
      expect((await change(a, PW, PW).expect(422)).body.code).toBe('PASSWORD_REUSED');
      const passphrase = 'a long passphrase with spaces and no symbols at all '.repeat(2);
      const res = await change(a, PW, passphrase).expect(204);
      expect(res.body).toEqual({});
      await me(a).expect(401);
      await me(b).expect(401);
      await signIn(u.username, PW).expect(401);
      await me(await tokenOf(u.username, passphrase)).expect(200);
    });

    it('forces a change after reset and blocks business APIs until then', async () => {
      const u = await makeUser('PURCHASING');
      await reset(admin, u.id, 'admin temporary pass').expect(204);
      const login1 = (await signIn(u.username, 'admin temporary pass').expect(200)).body;
      expect(login1).toEqual({ accessToken: expect.any(String), mustChangePassword: true });
      const t = login1.accessToken;
      expect((await http().get('/purchase-requisitions').set(bearer(t)).expect(403)).body.code).toBe('PASSWORD_CHANGE_REQUIRED');
      expect((await http().get('/products').set(bearer(t)).expect(403)).body.code).toBe('PASSWORD_CHANGE_REQUIRED');
      expect((await me(t).expect(200)).body).toMatchObject({ mustChangePassword: true, username: u.username });
      await change(t, 'admin temporary pass', PW).expect(204);
      await me(t).expect(401);
      const fresh = (await signIn(u.username, PW).expect(200)).body;
      expect(fresh.mustChangePassword).toBe(false);
      await http().get('/purchase-requisitions').set(bearer(fresh.accessToken)).expect(200);
      // The logout path stays open while a change is required.
      await reset(admin, u.id, 'admin temporary pass').expect(204);
      const forced = await tokenOf(u.username, 'admin temporary pass');
      await http().post('/auth/logout').set(bearer(forced)).expect(204);
      await me(forced).expect(401);
    });

    it('requires new seeded interactive accounts to change their password', async () => {
      const { seed } = await import('./database/seed');
      await ds.query(`DELETE FROM user_warehouses WHERE user_id = (SELECT id FROM users WHERE username = 'pm-head');
        DELETE FROM user_roles WHERE user_id = (SELECT id FROM users WHERE username = 'pm-head');
        UPDATE users SET username = 'pm-head-retired' WHERE username = 'pm-head'`);
      await seed(ds);
      expect(await ds.query(`SELECT must_change_password FROM users WHERE username = 'pm-head'`)).toEqual([{ must_change_password: true }]);
      const existing = await ds.query(`SELECT username, password_hash, must_change_password FROM users WHERE username <> 'pm-head' ORDER BY id`);
      await seed(ds);
      expect(await ds.query(`SELECT username, password_hash, must_change_password FROM users WHERE username <> 'pm-head' ORDER BY id`)).toEqual(existing);
    });

    it('never exposes passwords, hashes, tokens or session ids', async () => {
      const u = await makeUser();
      const t = await tokenOf(u.username);
      await reset(admin, u.id, 'secret temporary one').expect(204);
      const state = (await http().get(`/admin/users/${u.id}/account`).set(bearer(admin)).expect(200)).body;
      const audit = JSON.stringify(await ds.query(`SELECT * FROM approval_histories WHERE document_type = 'USER' AND document_id = $1`, [u.id]));
      const [{ hash }] = await ds.query('SELECT password_hash AS hash FROM users WHERE id = $1', [u.id]);
      const sids = (await ds.query('SELECT id FROM user_sessions WHERE user_id = $1', [u.id])).map((s: { id: string }) => s.id);
      for (const secret of [PW, 'secret temporary one', hash, t, ...sids]) {
        expect(JSON.stringify(state)).not.toContain(secret);
        expect(audit).not.toContain(secret);
      }
      expect(state).toMatchObject({ id: u.id, isActive: true, mustChangePassword: true, failedLoginCount: 0, lockedUntil: null, openSessions: 0 });
    });
  });

  describe('lockout', () => {
    const failure = (res: request.Response) => ({ status: res.status, body: res.body });

    it('locks on the fifth consecutive failure, resets on success, expires and can be unlocked', async () => {
      const u = await makeUser();
      for (let i = 0; i < 4; i++) await signIn(u.username, BAD).expect(401);
      await signIn(u.username, PW).expect(200);
      expect((await ds.query('SELECT failed_login_count FROM users WHERE id = $1', [u.id]))[0].failed_login_count).toBe(0);
      for (let i = 0; i < 4; i++) await signIn(u.username, BAD).expect(401);
      expect((await ds.query('SELECT locked_until FROM users WHERE id = $1', [u.id]))[0].locked_until).toBeNull();
      await signIn(u.username, BAD).expect(401);
      const [{ minutes }] = await ds.query(`SELECT round(extract(epoch FROM locked_until - now()) / 60) AS minutes FROM users WHERE id = $1`, [u.id]);
      expect(Number(minutes)).toBe(15);
      const lockedResponse = failure(await signIn(u.username, PW));
      expect((await http().get(`/admin/users/${u.id}/account`).set(bearer(admin)).expect(200)).body.lockedUntil).toEqual(expect.any(String));
      await ds.query(`UPDATE users SET locked_until = now() - interval '1 second' WHERE id = $1`, [u.id]);
      await signIn(u.username, PW).expect(200);
      for (let i = 0; i < 5; i++) await signIn(u.username, BAD).expect(401);
      await signIn(u.username, PW).expect(401);
      await http().post(`/admin/users/${u.id}/unlock`).set(bearer(admin)).expect(204);
      await signIn(u.username, PW).expect(200);
      expect((await actions(u.id)).filter(a => a.startsWith('ACCOUNT_'))).toEqual(['ACCOUNT_LOCKED', 'ACCOUNT_LOCKED', 'ACCOUNT_UNLOCKED']);

      // Unknown user, bad password, locked and disabled accounts all fail the same way.
      const disabled = await makeUser();
      await setStatus(admin, disabled.id, false).expect(204);
      const bad = failure(await signIn(u.username, BAD));
      expect(failure(await signIn('no-such-user', PW))).toEqual(bad);
      expect(lockedResponse).toEqual(bad);
      expect(failure(await signIn(disabled.username, PW))).toEqual(bad);
      expect(bad).toMatchObject({ status: 401, body: { code: 'INVALID_CREDENTIALS' } });
      expect(await ds.query(`SELECT 1 FROM approval_histories WHERE document_type = 'USER' AND document_id NOT IN (SELECT id FROM users)`)).toEqual([]);
    });

    it('a reset clears the lockout', async () => {
      const u = await makeUser();
      for (let i = 0; i < 5; i++) await signIn(u.username, BAD).expect(401);
      await reset(admin, u.id, 'fresh temporary pass').expect(204);
      await signIn(u.username, 'fresh temporary pass').expect(200);
    });
  });

  describe('concurrency', () => {
    it('counts every concurrent failure exactly once', async () => {
      const u = await makeUser();
      await Promise.all(Array.from({ length: 8 }, () => signIn(u.username, BAD).expect(401)));
      const log = await events(u.id);
      expect(log.filter(e => e.metadata?.cause === 'BAD_PASSWORD').map(e => e.metadata!.failedCount)).toEqual([1, 2, 3, 4, 5]);
      expect(log.filter(e => e.metadata?.cause === 'LOCKED')).toHaveLength(3);
      expect(log.filter(e => e.action === 'ACCOUNT_LOCKED')).toHaveLength(1);
    });

    it('never leaves a usable session created with credentials that were reset or disabled concurrently', async () => {
      for (let round = 0; round < 4; round++) {
        const u = await makeUser();
        const [signed] = await Promise.all([signIn(u.username, PW), round % 2 ? setStatus(admin, u.id, false).expect(204) : reset(admin, u.id).expect(204)]);
        if (signed.status === 200) {
          await me(signed.body.accessToken).expect(401);
          expect(await actions(u.id)).toEqual(expect.arrayContaining(['LOGIN_SUCCEEDED', 'SESSIONS_REVOKED']));
        } else {
          expect(signed.status).toBe(401);
          expect(await actions(u.id)).not.toContain('LOGIN_SUCCEEDED');
        }
        expect(await ds.query(`SELECT 1 FROM user_sessions WHERE user_id = $1 AND revoked_at IS NULL`, [u.id])).toEqual([]);
      }
    });

    it('serializes concurrent password changes', async () => {
      const u = await makeUser();
      const t = await tokenOf(u.username);
      const results = await Promise.all([change(t, PW, 'first new passphrase'), change(t, PW, 'second new passphrase')]);
      // The second request passed the guard, but its session was revoked by the first change (F-OA1.2-03).
      expect(results.map(r => r.status).sort()).toEqual([204, 401]);
      const winner = results[0].status === 204 ? 'first new passphrase' : 'second new passphrase';
      await signIn(u.username, winner).expect(200);
      expect((await actions(u.id)).filter(a => a === 'PASSWORD_CHANGED')).toHaveLength(1);
    });

    it('Last Admin Protection serializes concurrent transactions and rolls back the one that would remove the last admin', async () => {
      const a = await makeUser('ADMIN');
      const b = await makeUser('ADMIN');
      const others: { id: number }[] = await ds.query(`SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id
        JOIN roles r ON r.id = ur.role_id WHERE r.code = 'ADMIN' AND u.is_active AND u.id <> ALL($1)`, [[a.id, b.id]]);
      await ds.query('UPDATE users SET is_active = false WHERE id = ANY($1)', [others.map(o => o.id)]);
      const first = ds.createQueryRunner();
      const second = ds.createQueryRunner();
      try {
        await first.startTransaction();
        await lockAdminGuard(first.manager);
        await first.query('UPDATE users SET is_active = false WHERE id = $1', [a.id]);
        await assertAdminRemains(first.manager);
        await second.startTransaction();
        const blocked = (async () => {
          await lockAdminGuard(second.manager);
          await second.query('UPDATE users SET is_active = false WHERE id = $1', [b.id]);
          await assertAdminRemains(second.manager);
        })();
        await new Promise(resolve => setTimeout(resolve, 200));
        await first.commitTransaction();
        await expect(blocked).rejects.toMatchObject({ code: 'LAST_ADMIN' });
        await second.rollbackTransaction();
        expect(await ds.query('SELECT id FROM users WHERE id = ANY($1) AND is_active', [[a.id, b.id]])).toEqual([{ id: b.id }]);
      } finally {
        for (const r of [first, second]) {
          if (r.isTransactionActive) await r.rollbackTransaction();
          await r.release();
        }
        await ds.query('UPDATE users SET is_active = true WHERE id = ANY($1)', [[...others.map(o => o.id), a.id]]);
      }
    });

    it('runs reset, unlock, disable and role changes on one account concurrently without deadlock (F-OA1.3-21)', async () => {
      const second = await makeUser('ADMIN');
      const other = await tokenOf(second.username);
      for (let round = 0; round < 4; round++) {
        const u = await makeUser('SALES');
        const [{ id: roleId }] = await ds.query(`SELECT id FROM roles WHERE code = 'SALES'`);
        const role = (await http().get(`/admin/roles/${roleId}`).set(bearer(admin)).expect(200)).body;
        const results = await Promise.all([
          reset(admin, u.id),
          setStatus(other, u.id, false),
          http().post(`/admin/users/${u.id}/unlock`).set(bearer(admin)),
          http().put(`/admin/roles/${roleId}`).set(bearer(other)).send({ name: role.name, description: role.description,
            permissions: role.permissions, userIds: role.users.map((x: { id: number }) => x.id).filter((x: number) => x !== u.id), version: role.version }),
        ]);
        // Never a 500 (deadlock); the role save may only lose to another save of the same role (409).
        expect(results.map(r => r.status)).toEqual([204, 204, 204, expect.any(Number)]);
        expect([204, 409]).toContain(results[3].status);
        expect(await ds.query('SELECT is_active FROM users WHERE id = $1', [u.id])).toEqual([{ is_active: false }]);
      }
    });

    it('keeps one administrator when two admins disable each other at the same time', async () => {
      const a = await makeUser('ADMIN');
      const b = await makeUser('ADMIN');
      const [ta, tb] = [await tokenOf(a.username), await tokenOf(b.username)];
      // Only these two may remain admins for the race to matter.
      const others: { id: number }[] = await ds.query(`SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id
        JOIN roles r ON r.id = ur.role_id WHERE r.code = 'ADMIN' AND u.is_active AND u.id <> ALL($1)`, [[a.id, b.id]]);
      await ds.query('UPDATE users SET is_active = false WHERE id = ANY($1)', [others.map(o => o.id)]);
      try {
        const results = await Promise.all([setStatus(ta, b.id, false), setStatus(tb, a.id, false)]);
        // The loser's own session was revoked by the winner; the live re-check stops it (Last Admin is the backstop below).
        expect(results.map(r => r.status).sort()).toEqual([204, 401]);
        const active = await ds.query('SELECT id FROM users WHERE id = ANY($1) AND is_active', [[a.id, b.id]]);
        expect(active).toHaveLength(1);
        const disabledEvents = [...await actions(a.id), ...await actions(b.id)].filter(x => x === 'ACCOUNT_DISABLED');
        expect(disabledEvents).toHaveLength(1);

        // A temporary lockout does not remove admin standing: the locked last admin may still disable another admin.
        const survivor = active[0].id === a.id ? { id: a.id, t: ta } : { id: b.id, t: tb };
        const c = await makeUser('ADMIN');
        await ds.query(`UPDATE users SET locked_until = now() + interval '15 minutes' WHERE id = $1`, [survivor.id]);
        await setStatus(survivor.t, c.id, false).expect(204);
        expect((await setStatus(survivor.t, survivor.id, false).expect(403)).body.code).toBe('SELF_CHANGE_DENIED');
        expect((await reset(survivor.t, survivor.id).expect(403)).body.code).toBe('SELF_CHANGE_DENIED');
        await ds.query(`UPDATE users SET locked_until = NULL WHERE id = $1`, [survivor.id]);
      } finally {
        await ds.query('UPDATE users SET is_active = true WHERE id = ANY($1)', [others.map(o => o.id)]);
      }
    });
  });

  describe('closure findings', () => {
    it('F-01: records unknown-username failures as append-only events without the attempted name', async () => {
      const typedPassword = 'my secret typed as username';
      await signIn(typedPassword, PW).expect(401);
      const rows = await ds.query(`SELECT event, cause, username_digest, client_ip FROM auth_events ORDER BY id DESC LIMIT 1`);
      expect(rows).toEqual([{ event: 'LOGIN_FAILED', cause: 'UNKNOWN_USER', username_digest: expect.stringMatching(/^[0-9a-f]{64}$/), client_ip: expect.any(String) }]);
      expect(JSON.stringify(await ds.query('SELECT * FROM auth_events'))).not.toContain(typedPassword);
      expect(await ds.query(`SELECT 1 FROM users WHERE username = $1`, [typedPassword])).toEqual([]);
      await expect(ds.query('DELETE FROM auth_events')).rejects.toThrow('append-only');
      await expect(ds.query('UPDATE auth_events SET cause = cause')).rejects.toThrow('append-only');
      await expect(ds.query(`INSERT INTO auth_events (event, cause, username_digest) VALUES ('LOGIN_FAILED', 'UNKNOWN_USER', 'plain-name')`)).rejects.toThrow();
    });

    it('F-02: runs one password verification on every sign-in path', async () => {
      const passwords = await import('./modules/identity/password');
      const locked = await makeUser();
      await ds.query(`UPDATE users SET locked_until = now() + interval '15 minutes' WHERE id = $1`, [locked.id]);
      const disabled = await makeUser();
      await ds.query('UPDATE users SET is_active = false WHERE id = $1', [disabled.id]);
      const ok = await makeUser();
      for (const [username, password, status] of [['nobody-here', PW, 401], [locked.username, PW, 401], [disabled.username, PW, 401],
        [ok.username, BAD, 401], [ok.username, PW, 200]] as const) {
        const spy = jest.spyOn(passwords, 'verifyPassword');
        try {
          await signIn(username, password).expect(status);
          expect(spy).toHaveBeenCalledTimes(1);
        } finally {
          spy.mockRestore();
        }
      }
    });

    it('F-02: rate-limits sign-in per client and account the same way for existing and unknown names, and current-password checks', async () => {
      const saved = { ...process.env };
      try {
        process.env.AUTH_LOGIN_LIMIT_PER_ACCOUNT = '3';
        const u = await makeUser();
        const known = [];
        const unknown = [];
        for (let i = 0; i < 4; i++) known.push(await signIn(u.username, BAD));
        for (let i = 0; i < 4; i++) unknown.push(await signIn(`ghost-${u.username}`, BAD));
        expect(known.map(r => r.status)).toEqual([401, 401, 401, 429]);
        expect(unknown.map(r => r.status)).toEqual([401, 401, 401, 429]);
        expect(known[3]!.body).toEqual(unknown[3]!.body);
        expect(known[3]!.body.code).toBe('TOO_MANY_ATTEMPTS');
        // The limit complements the lockout: limited attempts are not counted as failures.
        expect((await ds.query('SELECT failed_login_count FROM users WHERE id = $1', [u.id]))[0].failed_login_count).toBe(3);
        await signIn(u.username.toUpperCase(), PW).expect(429);

        process.env.AUTH_LOGIN_LIMIT_PER_ACCOUNT = saved.AUTH_LOGIN_LIMIT_PER_ACCOUNT;
        process.env.AUTH_PASSWORD_CHECK_LIMIT = '2';
        const v = await makeUser();
        const t = await tokenOf(v.username);
        await change(t, BAD, 'long enough passphrase').expect(422);
        await change(t, BAD, 'long enough passphrase').expect(422);
        expect((await change(t, PW, 'long enough passphrase').expect(429)).body.code).toBe('TOO_MANY_ATTEMPTS');
        await me(t).expect(200);
      } finally {
        process.env = saved;
      }
    });

    it('F-03: re-checks the acting session and USER.MANAGE inside the transaction', async () => {
      const { AccountSecurityService } = await import('./modules/identity/account-security');
      const service = app.get(AccountSecurityService);
      const target = await makeUser();
      const actor = await makeUser('ADMIN');
      await tokenOf(actor.username);
      const [{ id: sid }] = await ds.query('SELECT id FROM user_sessions WHERE user_id = $1', [actor.id]);
      await ds.query(`UPDATE user_sessions SET revoked_at = now(), revoke_reason = 'LOGOUT' WHERE id = $1`, [sid]);
      for (const call of [() => service.resetPassword({ id: actor.id, sessionId: sid }, target.id, 'temporary passphrase'),
        () => service.setAccountStatus({ id: actor.id, sessionId: sid }, target.id, false),
        () => service.unlock({ id: actor.id, sessionId: sid }, target.id)]) {
        await expect(call()).rejects.toMatchObject({ status: 401 });
      }
      const self = await makeUser();
      await tokenOf(self.username);
      const [{ id: selfSid }] = await ds.query('SELECT id FROM user_sessions WHERE user_id = $1', [self.id]);
      await ds.query(`UPDATE user_sessions SET revoked_at = now(), revoke_reason = 'LOGOUT' WHERE id = $1`, [selfSid]);
      await expect(service.changePassword({ id: self.id, sessionId: selfSid }, PW, 'long enough passphrase')).rejects.toMatchObject({ status: 401 });

      const fresh = await makeUser('ADMIN');
      const token = await tokenOf(fresh.username);
      const [{ id: freshSid }] = await ds.query('SELECT id FROM user_sessions WHERE user_id = $1', [fresh.id]);
      await ds.query(`DELETE FROM user_roles WHERE user_id = $1`, [fresh.id]);
      await expect(service.unlock({ id: fresh.id, sessionId: freshSid }, target.id)).rejects.toMatchObject({ status: 403 });
      await reset(token, target.id).expect(403);
      expect(await actions(target.id)).toEqual([]);
    });

    it('F-03: rolls back hash, status, sessions and audit together', async () => {
      const u = await makeUser();
      const t = await tokenOf(u.username);
      const before = async () => ds.query(`SELECT password_hash, is_active, must_change_password,
        (SELECT count(*)::int FROM user_sessions s WHERE s.user_id = u.id AND s.revoked_at IS NULL) AS open
        FROM users u WHERE id = $1`, [u.id]);
      const initial = await before();
      const initialEvents = await actions(u.id);
      await ds.query(`CREATE FUNCTION oa12_fail_revoke() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN IF NEW.action = 'SESSIONS_REVOKED' THEN RAISE EXCEPTION 'oa12 rollback fixture'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER oa12_fail_revoke BEFORE INSERT ON approval_histories FOR EACH ROW EXECUTE FUNCTION oa12_fail_revoke()`);
      try {
        await reset(admin, u.id).expect(500);
        await setStatus(admin, u.id, false).expect(500);
        await change(t, PW, 'long enough passphrase').expect(500);
      } finally {
        await ds.query('DROP TRIGGER oa12_fail_revoke ON approval_histories; DROP FUNCTION oa12_fail_revoke()');
      }
      expect(await before()).toEqual(initial);
      expect(await actions(u.id)).toEqual(initialEvents);
      await me(t).expect(200);
    });
  });

  it('keeps account administration to the system role', async () => {
    const u = await makeUser();
    const sales = await login(app, 'sales', 'role-users-test');
    for (const res of [
      await http().get(`/admin/users/${u.id}/account`).set(bearer(sales)),
      await reset(sales, u.id),
      await setStatus(sales, u.id, false),
      await http().post(`/admin/users/${u.id}/unlock`).set(bearer(sales)),
    ]) expect(res.status).toBe(403);
    await http().post('/admin/users/999999/unlock').set(bearer(admin)).expect(404);
    expect((await me(admin).expect(200)).body.id).toBe(adminId);
  });
});
