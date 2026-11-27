import {
  Body, Controller, Get, HttpCode, HttpStatus, Injectable, NotFoundException, Param, ParseIntPipe, Patch, Post, Put, Query, Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { DataSource, EntityManager } from 'typeorm';
import { appendActivity, documentPage } from '../document-records/document-records';
import { BusinessError } from '../workflow/workflow';
import {
  Actor, LockedUser, assertAdminRemains, assertPasswordPolicy, employmentInactive, lockActor, PASSWORD_MAX_LENGTH, revokeSessions,
} from './account-security';
import { AuthedRequest, RequirePermissions } from './auth';
import { lockAdminGuard, lockGrantsExclusive } from './authorization';
import { hashPassword } from './password';
import {
  activeManagerIds, assertMembershipsValid, assertNotHeadOrManager, currentMemberships, MembershipSpec, saveMemberships,
} from '../organization/memberships';

const CODE = /^\s*[A-Za-z0-9][A-Za-z0-9_.-]{0,49}\s*$/;
const USERNAME = /^\s*[A-Za-z0-9][A-Za-z0-9_.@-]{0,99}\s*$/;

class ProfileInput {
  @ApiProperty() @IsString() @Matches(/\S/) @MaxLength(200) fullName!: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() @MaxLength(200) email?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(/^[0-9+().\s-]*$/) @MaxLength(50) phone?: string | null;
}
class NewProfileInput extends ProfileInput {
  @ApiProperty() @IsString() @Matches(CODE) employeeCode!: string;
}
class AccountInput {
  @ApiProperty() @IsString() @Matches(USERNAME) username!: string;
  /** Length policy is checked by the service, shared with reset and change (BA-USR-05). */
  @ApiProperty() @IsString() @MaxLength(PASSWORD_MAX_LENGTH) initialPassword!: string;
}
class MembershipInput {
  @ApiProperty() @IsInt() @Min(1) orgUnitId!: number;
  @ApiProperty() @IsInt() @Min(1) jobTitleId!: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) managerUserId?: number | null;
  @ApiProperty() @IsBoolean() isPrimary!: boolean;
}
/**
 * Centralized save (BA-UI-04): profile, memberships, roles and warehouses in one transaction with one `users.version`
 * bump. An absent list keeps that part unchanged; a list is the full desired set (memberships: the ACTIVE ones).
 */
class RelationsInput {
  @ApiPropertyOptional({ type: [MembershipInput] }) @IsOptional() @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true })
  @Type(() => MembershipInput) memberships?: MembershipInput[];
  @ApiPropertyOptional({ type: [Number] }) @IsOptional() @IsArray() @ArrayMaxSize(100) @IsInt({ each: true }) @Min(1, { each: true }) roleIds?: number[];
  @ApiPropertyOptional({ type: [Number] }) @IsOptional() @IsArray() @ArrayMaxSize(500) @IsInt({ each: true }) @Min(1, { each: true }) warehouseIds?: number[];
}
class UpdateMembershipInput {
  @ApiProperty() @IsInt() @Min(1) jobTitleId!: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) managerUserId?: number | null;
  @ApiProperty() @IsBoolean() isPrimary!: boolean;
  /** Membership version. */
  @ApiProperty() @IsInt() @Min(1) version!: number;
}
class AddMembershipInput extends MembershipInput {
  @ApiProperty() @IsInt() @Min(1) userId!: number;
  /** Employee version. */
  @ApiProperty() @IsInt() @Min(1) version!: number;
}
/** BA-USR-09: the only fields a user changes on their own profile; any other field is rejected (whitelist, 400). */
class OwnContactInput {
  @ApiPropertyOptional() @IsOptional() @IsEmail() @MaxLength(200) email?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(/^[0-9+().\s-]*$/) @MaxLength(50) phone?: string | null;
  @ApiProperty() @IsInt() @Min(1) version!: number;
}
class VersionInput {
  @ApiProperty() @IsInt() @Min(1) version!: number;
}
class CreateUserInput extends RelationsInput {
  @ApiProperty({ type: NewProfileInput }) @ValidateNested() @Type(() => NewProfileInput) profile!: NewProfileInput;
  @ApiPropertyOptional({ type: AccountInput }) @IsOptional() @ValidateNested() @Type(() => AccountInput) account?: AccountInput;
}
class UpdateUserInput extends RelationsInput {
  @ApiProperty({ type: ProfileInput }) @ValidateNested() @Type(() => ProfileInput) profile!: ProfileInput;
  @ApiProperty() @IsInt() @Min(1) version!: number;
}
class CreateAccountInput extends AccountInput {
  @ApiProperty() @IsInt() @Min(1) version!: number;
}
class EmploymentStatusInput {
  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE'] }) @IsIn(['ACTIVE', 'INACTIVE']) status!: 'ACTIVE' | 'INACTIVE';
  @ApiProperty() @IsInt() @Min(1) version!: number;
}
class UserListQuery {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsIn(['ACTIVE', 'INACTIVE']) employmentStatus?: string;
  @IsOptional() @IsIn(['ACTIVE', 'INACTIVE', 'LOCKED', 'NONE']) accountStatus?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) roleId?: number;
  /** ACTIVE membership in this unit (same rows as the unit's Nhân sự tab, BA-UI-09). */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) orgUnitId?: number;
  @IsOptional() @IsIn(['employeeCode', 'fullName', 'username', 'employmentStatus', 'accountStatus']) sort?: string;
  @IsOptional() @IsIn(['asc', 'desc']) direction?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) page?: number;
  @IsOptional() @Type(() => Number) @IsIn([25, 50, 100]) size?: number;
}

const ACCOUNT_STATUS = `CASE WHEN u.username IS NULL THEN 'NONE' WHEN NOT u.is_active THEN 'INACTIVE'
  WHEN u.locked_until > now() THEN 'LOCKED' ELSE 'ACTIVE' END`;
const SORT: Record<string, string> = {
  employeeCode: 'lower(u.employee_code)', fullName: 'u.full_name', username: 'lower(u.username)',
  employmentStatus: 'u.employment_status', accountStatus: ACCOUNT_STATUS,
};
const COLUMNS = `u.id, u.employee_code AS "employeeCode", u.full_name AS "fullName", u.email, u.phone,
  u.employment_status AS "employmentStatus", u.username, ${ACCOUNT_STATUS} AS "accountStatus", u.version,
  (SELECT json_build_object('id', o.id, 'code', o.code, 'name', o.name) FROM org_memberships om JOIN org_units o ON o.id = om.org_unit_id
    WHERE om.user_id = u.id AND om.status = 'ACTIVE' AND om.is_primary) AS "primaryOrgUnit",
  (SELECT json_build_object('id', jt.id, 'code', jt.code, 'name', jt.name) FROM org_memberships om JOIN job_titles jt ON jt.id = om.job_title_id
    WHERE om.user_id = u.id AND om.status = 'ACTIVE' AND om.is_primary) AS "primaryJobTitle"`;
const MANAGE = 'USER.MANAGE';
const ORG_MANAGE = 'ORGANIZATION.MANAGE';
const likeTerm = (q?: string) => q?.trim() ? `%${q.trim().replace(/[\\%_]/g, c => `\\${c}`)}%` : null;
const blank = (v?: string | null) => v?.trim() || null;
const managerIds = (input: RelationsInput) =>
  (input.memberships ?? []).map(s => s.managerUserId).filter((x): x is number => typeof x === 'number');

type Profile = { fullName: string; email: string | null; phone: string | null };

/** Activity on the USER target; metadata lists profile/account fields only, never a password or hash (BA-SEC-03). */
const audit = (m: EntityManager, id: number, action: string, actorId: number, metadata?: Record<string, unknown>) =>
  appendActivity(m, 'USER', id, action, actorId, undefined, metadata ? { metadata } : {});

const conflict = (code: string, message: string) => new BusinessError(code, message, HttpStatus.CONFLICT);
const selfChange = () => new BusinessError('SELF_CHANGE_DENIED', 'Administrators cannot change their own employment, account or name', HttpStatus.FORBIDDEN);

/** Unique keys are enforced by the case-insensitive indexes; a racing duplicate surfaces as 23505 and is mapped here. */
function mapUnique(e: unknown): never {
  const err = e as { code?: string; constraint?: string; driverError?: { code?: string; constraint?: string } };
  const constraint = err.driverError?.constraint ?? err.constraint;
  if ((err.driverError?.code ?? err.code) === '23505') {
    if (constraint === 'ux_users_employee_code_ci') throw conflict('EMPLOYEE_CODE_TAKEN', 'The employee code is already used');
    if (constraint === 'ux_users_username_ci') throw conflict('USERNAME_TAKEN', 'The username is already used');
  }
  throw e;
}

/**
 * Employee profiles with an optional account (OA2.3a, ADR-0018 §4.1, BA-USR-01…04). Account security (reset, unlock,
 * account status, sessions) stays in AccountSecurityService (OA1.2). Lock graph (§11.0, OA2.2): admin-guard (when admin
 * standing may change) → `grants` gate (exclusive when grants can be revoked, otherwise shared via lockActor) → users
 * rows (actor + target, id order). OA2.3b continues the same order into roles → org-tree → org_units → job_titles →
 * org_memberships.
 */
@Injectable()
export class UserAdminService {
  constructor(private readonly ds: DataSource) {}

  async list(query: UserListQuery) {
    const size = query.size ?? 25;
    const order = `${SORT[query.sort ?? 'employeeCode'] ?? SORT.employeeCode} ${query.direction === 'desc' ? 'DESC' : 'ASC'} NULLS LAST, u.id`;
    const params = [likeTerm(query.q), query.employmentStatus ?? null, query.accountStatus ?? null, query.roleId ?? null, query.orgUnitId ?? null];
    const where = `WHERE ($1::text IS NULL OR u.employee_code ILIKE $1 OR u.full_name ILIKE $1 OR u.username ILIKE $1
        OR u.email ILIKE $1 OR u.phone ILIKE $1)
      AND ($2::text IS NULL OR u.employment_status = $2) AND ($3::text IS NULL OR ${ACCOUNT_STATUS} = $3)
      AND ($4::int IS NULL OR EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role_id = $4))
      AND ($5::int IS NULL OR EXISTS (SELECT 1 FROM org_memberships om WHERE om.user_id = u.id AND om.org_unit_id = $5 AND om.status = 'ACTIVE'))`;
    const [items, [{ total }]] = await Promise.all([
      this.ds.query(`SELECT ${COLUMNS} FROM users u ${where} ORDER BY ${order} LIMIT $6 OFFSET $7`, [...params, size, (query.page ?? 0) * size]),
      this.ds.query(`SELECT count(*)::int AS total FROM users u ${where}`, params),
    ]);
    return { items, total };
  }

  async get(id: number) {
    const [row] = await this.ds.query(`SELECT ${COLUMNS}, u.is_active AS "accountActive", u.must_change_password AS "mustChangePassword",
        CASE WHEN u.locked_until > now() THEN u.locked_until END AS "lockedUntil", u.updated_at AS "updatedAt",
        COALESCE((SELECT json_agg(json_build_object('id', r.id, 'code', r.code, 'name', r.name, 'isActive', r.is_active) ORDER BY r.code)
          FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id), '[]') AS roles,
        COALESCE((SELECT json_agg(json_build_object('id', om.id, 'orgUnit', json_build_object('id', o.id, 'code', o.code, 'name', o.name),
            'jobTitle', json_build_object('id', jt.id, 'code', jt.code, 'name', jt.name), 'isPrimary', om.is_primary,
            'manager', CASE WHEN mg.id IS NULL THEN NULL ELSE json_build_object('id', mg.id, 'employeeCode', mg.employee_code, 'fullName', mg.full_name) END,
            'isHead', o.head_user_id = u.id, 'startedAt', om.started_at, 'version', om.version) ORDER BY NOT om.is_primary, lower(o.code))
          FROM org_memberships om JOIN org_units o ON o.id = om.org_unit_id JOIN job_titles jt ON jt.id = om.job_title_id
          LEFT JOIN users mg ON mg.id = om.manager_user_id WHERE om.user_id = u.id AND om.status = 'ACTIVE'), '[]') AS memberships,
        COALESCE((SELECT json_agg(json_build_object('id', w.id, 'code', w.code, 'name', w.name) ORDER BY w.code)
          FROM user_warehouses uw JOIN warehouses w ON w.id = uw.warehouse_id WHERE uw.user_id = u.id), '[]') AS warehouses
      FROM users u WHERE u.id = $1`, [id]);
    if (!row) throw new NotFoundException();
    return row;
  }

  history(id: number, before?: number) {
    return documentPage(this.ds.manager, 'USER', id, 'history', before);
  }

  /** Employee and, optionally, the initial account in one transaction (F-OA0-06). A new employee is ACTIVE. */
  async create(actor: Actor, input: CreateUserInput) {
    if (input.account) assertPasswordPolicy(input.account.initialPassword);
    const hash = input.account ? await hashPassword(input.account.initialPassword) : null;
    const p = input.profile;
    const after = { employeeCode: p.employeeCode.trim(), fullName: p.fullName.trim(), email: blank(p.email), phone: blank(p.phone) };
    const username = input.account?.username.trim() ?? null;
    return this.ds.transaction(async m => {
      // Rule (1) F-OA1.3: every path that adds roles, warehouses or memberships (ORG scope, OA3.2) takes the gate exclusive.
      if (input.roleIds?.length || input.warehouseIds?.length || input.memberships?.length) await lockGrantsExclusive(m);
      await lockActor(m, actor, MANAGE, managerIds(input), 'SHARE');
      const [{ id }] = await m.query(`INSERT INTO users (employee_code, full_name, email, phone, username, password_hash, is_active,
          must_change_password, password_changed_at, created_by, updated_by)
        VALUES ($1, $2, $3, $4, $5::text, $6, $5::text IS NOT NULL, $5::text IS NOT NULL, CASE WHEN $5::text IS NOT NULL THEN now() END, $7, $7)
        RETURNING id`, [after.employeeCode, after.fullName, after.email, after.phone, username, hash, actor.id]).catch(mapUnique);
      await audit(m, id, 'EMPLOYEE_CREATED', actor.id, { after: { ...after, employmentStatus: 'ACTIVE' } });
      if (username) await audit(m, id, 'ACCOUNT_CREATED', actor.id, { username });
      await this.saveRelations(m, actor, id, input);
      return { id: id as number };
    });
  }

  /** The employee code is immutable (BA decision OA2.3a). Self-service is limited to email and phone (BA-USR-09). */
  async update(actor: Actor, id: number, input: UpdateUserInput) {
    const after: Profile = { fullName: input.profile.fullName.trim(), email: blank(input.profile.email), phone: blank(input.profile.phone) };
    await this.ds.transaction(async m => {
      // Lock graph (§11.0): admin-guard when roles may change → gate exclusive when roles, warehouses or memberships (ORG
      // scope, OA3.2) may change → users rows (actor, employee, managers; id order) → roles → org-tree → org_units →
      // job_titles → org_memberships.
      if (input.roleIds) await lockAdminGuard(m);
      if (input.roleIds || input.warehouseIds || input.memberships) await lockGrantsExclusive(m);
      await this.lockTarget(m, actor, id, input.version, managerIds(input));
      const [row] = await m.query('SELECT full_name AS "fullName", email, phone FROM users WHERE id = $1', [id]);
      const changed = (Object.keys(after) as (keyof Profile)[]).filter(k => after[k] !== row[k]);
      if (actor.id === id && changed.includes('fullName')) throw selfChange();
      if (changed.length) {
        await m.query('UPDATE users SET full_name = $2, email = $3, phone = $4 WHERE id = $1', [id, after.fullName, after.email, after.phone]);
        await audit(m, id, 'EMPLOYEE_UPDATED', actor.id, {
          before: Object.fromEntries(changed.map(k => [k, row[k]])), after: Object.fromEntries(changed.map(k => [k, after[k]])) });
      }
      const related = await this.saveRelations(m, actor, id, input);
      // One version bump per save, whatever parts changed (acceptance 8); nothing changed → no bump, no history.
      if (changed.length || related) {
        await m.query('UPDATE users SET version = version + 1, updated_at = now(), updated_by = $2 WHERE id = $1', [id, actor.id]);
      }
    });
  }

  /**
   * Roles, memberships and warehouses of one save; any failure (including LAST_ADMIN at the very end) rolls back the whole
   * transaction with the profile (acceptance 12). The caller holds the lock prefix up to the users rows. Returns whether
   * anything changed. Organization changes never grant permissions (BA-ORG-08).
   */
  private async saveRelations(m: EntityManager, actor: Actor, userId: number, input: RelationsInput): Promise<boolean> {
    let changed = false;
    let removedAdmin = false;
    const deny = () => { if (actor.id === userId) throw selfChange(); };
    if (input.roleIds) {
      const next = [...new Set(input.roleIds)];
      const current: number[] = (await m.query('SELECT role_id FROM user_roles WHERE user_id = $1', [userId])).map((r: { role_id: number }) => r.role_id);
      const added = next.filter(r => !current.includes(r));
      const removed = current.filter(r => !next.includes(r));
      if (added.length || removed.length) {
        deny();
        const ids = [...added, ...removed];
        const roles: { id: number; code: string; name: string; is_system: boolean }[] = await m.query(
          'SELECT id, code, name, is_system FROM roles WHERE id = ANY($1) ORDER BY id FOR UPDATE', [ids]);
        if (roles.length !== ids.length) throw new BusinessError('UNKNOWN_ROLE', 'Select existing roles');
        if (added.length && !(await m.query('SELECT 1 FROM users WHERE id = $1 AND username IS NOT NULL', [userId])).length) {
          throw new BusinessError('NO_ACCOUNT', 'Roles need an account; create the account first', HttpStatus.CONFLICT);
        }
        await m.query('UPDATE roles SET version = version + 1, updated_at = now(), updated_by = $2 WHERE id = ANY($1)', [ids, actor.id]);
        await m.query('DELETE FROM user_roles WHERE user_id = $1 AND role_id = ANY($2)', [userId, removed]);
        await m.query('INSERT INTO user_roles (user_id, role_id) SELECT $1, unnest($2::int[])', [userId, added]);
        const [user] = await m.query('SELECT id, username, full_name AS "fullName" FROM users WHERE id = $1', [userId]);
        const refs = (list: number[]) => roles.filter(r => list.includes(r.id)).map(({ id, code, name }) => ({ id, code, name }));
        for (const [list, userAction, roleAction] of [[removed, 'ROLES_REMOVED', 'USERS_REMOVED'], [added, 'ROLES_ADDED', 'USERS_ADDED']] as const) {
          if (!list.length) continue;
          await audit(m, userId, userAction, actor.id, { roles: refs(list) });
          for (const r of refs(list)) await appendActivity(m, 'ROLE', r.id, roleAction, actor.id, undefined, { metadata: { users: [user] } });
        }
        removedAdmin = roles.some(r => r.is_system && removed.includes(r.id));
        changed = true;
      }
    }
    if (input.memberships) {
      const changes = await saveMemberships(m, userId, actor.id, input.memberships);
      if (changes) {
        deny();
        await audit(m, userId, 'MEMBERSHIPS_CHANGED', actor.id, { ...changes });
        changed = true;
      }
    }
    if (input.warehouseIds) {
      const next = [...new Set(input.warehouseIds)];
      const current: number[] = (await m.query('SELECT warehouse_id FROM user_warehouses WHERE user_id = $1', [userId]))
        .map((r: { warehouse_id: number }) => r.warehouse_id);
      const added = next.filter(w => !current.includes(w));
      const removed = current.filter(w => !next.includes(w));
      if (added.length || removed.length) {
        deny();
        const found: { id: number; code: string; name: string; is_active: boolean }[] = await m.query(
          'SELECT id, code, name, is_active FROM warehouses WHERE id = ANY($1) ORDER BY code', [[...added, ...removed]]);
        if (added.some(w => !found.some(r => r.id === w))) throw new BusinessError('UNKNOWN_WAREHOUSE', 'Select existing warehouses');
        // Closure F04: no new grant on an inactive warehouse; kept grants stay and can be removed.
        const off = found.filter(r => added.includes(r.id) && !r.is_active);
        if (off.length) throw new BusinessError('WAREHOUSE_INACTIVE', `Inactive warehouses: ${off.map(r => r.code).join(', ')}`, HttpStatus.CONFLICT);
        const rows = found.map(({ id, code, name }) => ({ id, code, name }));
        await m.query('DELETE FROM user_warehouses WHERE user_id = $1 AND warehouse_id = ANY($2)', [userId, removed]);
        await m.query('INSERT INTO user_warehouses (user_id, warehouse_id) SELECT $1, unnest($2::int[])', [userId, added]);
        await audit(m, userId, 'WAREHOUSES_CHANGED', actor.id, {
          added: rows.filter(r => added.includes(r.id)), removed: rows.filter(r => removed.includes(r.id)) });
        changed = true;
      }
    }
    if (removedAdmin) await assertAdminRemains(m);
    return changed;
  }

  /**
   * BA-USR-04: deactivating the employee disables the account and ends every session (EMPLOYMENT_INACTIVE) in the same
   * transaction; reactivating never enables the account. Can revoke grants, so admin-guard and the exclusive gate first.
   * BA-N-06: a unit head or direct manager cannot be deactivated; checked under the employee's row lock.
   */
  async setEmploymentStatus(actor: Actor, id: number, input: EmploymentStatusInput) {
    if (actor.id === id) throw selfChange();
    await this.ds.transaction(async m => {
      await lockAdminGuard(m);
      await lockGrantsExclusive(m);
      // Under the exclusive gate no membership, unit or title write runs, so these manager ids are stable.
      const managers = input.status === 'ACTIVE' ? await activeManagerIds(m, id) : [];
      const row = await this.lockTarget(m, actor, id, input.version, managers);
      if (row.employment_status === input.status) return;
      const inactive = input.status === 'INACTIVE';
      if (inactive) await assertNotHeadOrManager(m, id);
      // Closure F01: reactivation re-validates every ACTIVE membership; nothing is repaired automatically.
      else await assertMembershipsValid(m, id);
      await m.query(`UPDATE users SET employment_status = $2, is_active = is_active AND NOT $3, version = version + 1, updated_at = now(),
        updated_by = $4 WHERE id = $1`, [id, input.status, inactive, actor.id]);
      if (inactive) await assertAdminRemains(m);
      await audit(m, id, inactive ? 'EMPLOYEE_DEACTIVATED' : 'EMPLOYEE_ACTIVATED', actor.id, {
        before: { employmentStatus: row.employment_status, accountActive: row.is_active },
        after: { employmentStatus: input.status, accountActive: row.is_active && !inactive } });
      if (inactive) await revokeSessions(m, id, 'EMPLOYMENT_INACTIVE', actor.id);
    });
  }

  /** Grants an account after creation: initial password, forced change at first sign-in (BA-USR-06). */
  async createAccount(actor: Actor, id: number, input: CreateAccountInput) {
    assertPasswordPolicy(input.initialPassword);
    const hash = await hashPassword(input.initialPassword);
    const username = input.username.trim();
    await this.ds.transaction(async m => {
      const row = await this.lockTarget(m, actor, id, input.version);
      if (row.has_account) throw conflict('ACCOUNT_EXISTS', 'The employee already has an account');
      if (row.employment_status !== 'ACTIVE') throw employmentInactive();
      await m.query(`UPDATE users SET username = $2, password_hash = $3, is_active = true, must_change_password = true,
          password_changed_at = now(), failed_login_count = 0, locked_until = NULL, version = version + 1, updated_at = now(), updated_by = $4
        WHERE id = $1`, [id, username, hash, actor.id]).catch(mapUnique);
      await audit(m, id, 'ACCOUNT_CREATED', actor.id, { username });
    });
  }

  /**
   * OA2.4 Personal Profile (BA-USR-09): the signed-in user changes only their own email and phone, with optimistic locking
   * and the same EMPLOYEE_UPDATED audit as the admin save. Needs an open session, no USER.* permission (lockActor null).
   * An absent field keeps its value; nothing changed → no version bump, no history.
   */
  async updateOwnContact(actor: Actor, input: OwnContactInput) {
    await this.ds.transaction(async m => {
      const [self] = await lockActor(m, actor, null);
      if (self.version !== input.version) throw conflict('VERSION_CONFLICT', 'Your profile was changed meanwhile. Reload it and apply your change again');
      const [row] = await m.query('SELECT email, phone FROM users WHERE id = $1', [actor.id]);
      const after = { email: input.email === undefined ? row.email : blank(input.email), phone: input.phone === undefined ? row.phone : blank(input.phone) };
      const changed = (['email', 'phone'] as const).filter(k => after[k] !== row[k]);
      if (!changed.length) return;
      await m.query('UPDATE users SET email = $2, phone = $3, version = version + 1, updated_at = now(), updated_by = $1 WHERE id = $1',
        [actor.id, after.email, after.phone]);
      await audit(m, actor.id, 'EMPLOYEE_UPDATED', actor.id, {
        before: Object.fromEntries(changed.map(k => [k, row[k]])), after: Object.fromEntries(changed.map(k => [k, after[k]])) });
    });
  }

  /**
   * Membership API (§6, closure F02) for the unit's Nhân sự tab. Each call edits the employee's ACTIVE membership set and
   * saves it through `saveRelations`, so validation, audit, self-change, version bump and lock graph are the User save's.
   * Optimistic locking: add uses the employee version, update/end the membership version (stable under the users row lock
   * every membership writer holds).
   */
  async addMembership(actor: Actor, input: AddMembershipInput) {
    return this.editMemberships(actor, input.userId, input.managerUserId, async (specs, user) => {
      if (user.version !== input.version) throw conflict('VERSION_CONFLICT', 'The employee was changed by someone else. Reload it and apply your change again');
      const added: MembershipSpec = { orgUnitId: input.orgUnitId, jobTitleId: input.jobTitleId, managerUserId: input.managerUserId ?? null, isPrimary: input.isPrimary };
      return [...specs.map(s => (input.isPrimary ? { ...s, isPrimary: false } : s)), added];
    }, input.orgUnitId);
  }

  async updateMembership(actor: Actor, id: number, input: UpdateMembershipInput) {
    const target = await this.membershipOwner(id);
    await this.editMemberships(actor, target.user_id, input.managerUserId, async specs => {
      const own = this.ownActive(specs, id, input.version);
      return specs.map(s => (s === own
        ? { ...s, jobTitleId: input.jobTitleId, managerUserId: input.managerUserId ?? null, isPrimary: input.isPrimary }
        : input.isPrimary ? { ...s, isPrimary: false } : s));
    });
  }

  /** Ends one membership (kept as ENDED). Ending the primary while others remain needs another primary first. */
  async endMembership(actor: Actor, id: number, input: VersionInput) {
    const target = await this.membershipOwner(id);
    await this.editMemberships(actor, target.user_id, undefined, async specs => {
      const own = this.ownActive(specs, id, input.version);
      return specs.filter(s => s !== own);
    });
  }

  private async editMemberships(actor: Actor, userId: number, managerId: number | null | undefined,
    edit: (specs: (MembershipSpec & { id: number; version: number })[], user: LockedUser) => Promise<MembershipSpec[]>, returnUnit?: number) {
    return this.ds.transaction(async m => {
      // Memberships drive ORG_UNIT/ORG_UNIT_TREE scope (OA3.2): gate exclusive → users rows (actor, employee, new manager)
      // FOR UPDATE (lockActor's shared request is a no-op under it), then saveMemberships' order.
      await lockGrantsExclusive(m);
      const user = (await lockActor(m, actor, ORG_MANAGE, [userId, ...(managerId ? [managerId] : [])])).find(r => r.id === userId);
      if (!user) throw new NotFoundException();
      const next = await edit(await currentMemberships(m, userId), user);
      if (await this.saveRelations(m, actor, userId, { memberships: next.map(({ orgUnitId, jobTitleId, managerUserId, isPrimary }) =>
        ({ orgUnitId, jobTitleId, managerUserId, isPrimary })) })) {
        await m.query('UPDATE users SET version = version + 1, updated_at = now(), updated_by = $2 WHERE id = $1', [userId, actor.id]);
      }
      if (!returnUnit) return undefined;
      const [row] = await m.query(`SELECT id FROM org_memberships WHERE user_id = $1 AND org_unit_id = $2 AND status = 'ACTIVE'`, [userId, returnUnit]);
      return { id: row.id as number };
    });
  }

  private async membershipOwner(id: number): Promise<{ user_id: number }> {
    const [row] = await this.ds.query('SELECT user_id FROM org_memberships WHERE id = $1', [id]);
    if (!row) throw new NotFoundException();
    return row;
  }

  private ownActive<T extends { id: number; version: number }>(specs: T[], id: number, version: number): T {
    const own = specs.find(s => s.id === id);
    if (!own) throw conflict('MEMBERSHIP_ENDED', 'The membership has ended; add a new one instead');
    if (own.version !== version) throw conflict('VERSION_CONFLICT', 'The membership was changed by someone else. Reload it and apply your change again');
    return own;
  }

  /** lockActor (gate → users rows of actor and target in id order, re-checks session and USER.MANAGE), then the version. */
  private async lockTarget(m: EntityManager, actor: Actor, id: number, version: number, alsoLock: number[] = []): Promise<LockedUser> {
    const row = (await lockActor(m, actor, MANAGE, [id, ...alsoLock])).find(r => r.id === id);
    if (!row) throw new NotFoundException();
    if (row.version !== version) {
      throw conflict('VERSION_CONFLICT', 'The employee was changed by someone else. Reload it and apply your change again');
    }
    return row;
  }
}

const actorOf = (req: AuthedRequest): Actor => ({ id: req.user.id, sessionId: req.user.sessionId });

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/users')
export class UserAdminController {
  constructor(private readonly users: UserAdminService) {}

  @Get() @RequirePermissions('USER.VIEW')
  list(@Query() query: UserListQuery) { return this.users.list(query); }

  @Get(':id') @RequirePermissions('USER.VIEW')
  get(@Param('id', ParseIntPipe) id: number) { return this.users.get(id); }

  @Get(':id/history') @RequirePermissions('USER.VIEW')
  history(@Param('id', ParseIntPipe) id: number, @Query('before') before?: string) {
    const cursor = Number(before);
    return this.users.history(id, Number.isSafeInteger(cursor) && cursor > 0 ? cursor : undefined);
  }

  @Post() @RequirePermissions(MANAGE)
  create(@Req() req: AuthedRequest, @Body() input: CreateUserInput) { return this.users.create(actorOf(req), input); }

  @Put(':id') @HttpCode(204) @RequirePermissions(MANAGE)
  update(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number, @Body() input: UpdateUserInput) {
    return this.users.update(actorOf(req), id, input);
  }

  @Patch(':id/employment-status') @HttpCode(204) @RequirePermissions(MANAGE)
  setEmploymentStatus(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number, @Body() input: EmploymentStatusInput) {
    return this.users.setEmploymentStatus(actorOf(req), id, input);
  }

  @Post(':id/account') @HttpCode(204) @RequirePermissions(MANAGE)
  createAccount(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number, @Body() input: CreateAccountInput) {
    return this.users.createAccount(actorOf(req), id, input);
  }
}

/** §6 membership API for the unit's Nhân sự tab (BA-UI-09): same service and rules as the User save. */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/memberships')
export class MembershipAdminController {
  constructor(private readonly users: UserAdminService) {}

  @Post() @RequirePermissions(ORG_MANAGE)
  add(@Req() req: AuthedRequest, @Body() input: AddMembershipInput) { return this.users.addMembership(actorOf(req), input); }

  @Put(':id') @HttpCode(204) @RequirePermissions(ORG_MANAGE)
  update(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number, @Body() input: UpdateMembershipInput) {
    return this.users.updateMembership(actorOf(req), id, input);
  }

  @Post(':id/end') @HttpCode(204) @RequirePermissions(ORG_MANAGE)
  end(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number, @Body() input: VersionInput) {
    return this.users.endMembership(actorOf(req), id, input);
  }
}

/** OA2.4 Personal Profile: the signed-in user's own record (read) and contact fields (write), from the account menu. */
@ApiTags('auth')
@ApiBearerAuth()
@Controller('me')
export class MeController {
  constructor(private readonly users: UserAdminService) {}

  /** Same shape as the admin detail (employee, account, memberships, roles, warehouses); never a password or hash. */
  @Get()
  profile(@Req() req: AuthedRequest) { return this.users.get(req.user.id); }

  @Patch() @HttpCode(204)
  updateContact(@Req() req: AuthedRequest, @Body() input: OwnContactInput) { return this.users.updateOwnContact(actorOf(req), input); }
}
