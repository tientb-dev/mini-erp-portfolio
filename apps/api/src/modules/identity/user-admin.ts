import {
  Body, Controller, Get, HttpCode, HttpStatus, Injectable, NotFoundException, Param, ParseIntPipe, Patch, Post, Put, Query, Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEmail, IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, Min, ValidateNested } from 'class-validator';
import { DataSource, EntityManager } from 'typeorm';
import { appendActivity, documentPage } from '../document-records/document-records';
import { BusinessError } from '../workflow/workflow';
import {
  Actor, LockedUser, assertAdminRemains, assertPasswordPolicy, employmentInactive, lockActor, PASSWORD_MAX_LENGTH, revokeSessions,
} from './account-security';
import { AuthedRequest, RequirePermissions } from './auth';
import { lockAdminGuard, lockGrantsExclusive } from './authorization';
import { hashPassword } from './password';

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
/**
 * Centralized save (BA-UI-04). OA2.3b adds `memberships`, `roleIds` and `warehouseIds` to these bodies and saves them in
 * the same transaction; OA2.3a accepts the profile and, on create, the optional initial account (F-OA0-06).
 */
class CreateUserInput {
  @ApiProperty({ type: NewProfileInput }) @ValidateNested() @Type(() => NewProfileInput) profile!: NewProfileInput;
  @ApiPropertyOptional({ type: AccountInput }) @IsOptional() @ValidateNested() @Type(() => AccountInput) account?: AccountInput;
}
class UpdateUserInput {
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
  u.employment_status AS "employmentStatus", u.username, ${ACCOUNT_STATUS} AS "accountStatus", u.version`;
const MANAGE = 'USER.MANAGE';
const likeTerm = (q?: string) => q?.trim() ? `%${q.trim().replace(/[\\%_]/g, c => `\\${c}`)}%` : null;
const blank = (v?: string | null) => v?.trim() || null;

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
    const params = [likeTerm(query.q), query.employmentStatus ?? null, query.accountStatus ?? null, query.roleId ?? null];
    const where = `WHERE ($1::text IS NULL OR u.employee_code ILIKE $1 OR u.full_name ILIKE $1 OR u.username ILIKE $1
        OR u.email ILIKE $1 OR u.phone ILIKE $1)
      AND ($2::text IS NULL OR u.employment_status = $2) AND ($3::text IS NULL OR ${ACCOUNT_STATUS} = $3)
      AND ($4::int IS NULL OR EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role_id = $4))`;
    const [items, [{ total }]] = await Promise.all([
      this.ds.query(`SELECT ${COLUMNS} FROM users u ${where} ORDER BY ${order} LIMIT $5 OFFSET $6`, [...params, size, (query.page ?? 0) * size]),
      this.ds.query(`SELECT count(*)::int AS total FROM users u ${where}`, params),
    ]);
    return { items, total };
  }

  async get(id: number) {
    const [row] = await this.ds.query(`SELECT ${COLUMNS}, u.is_active AS "accountActive", u.must_change_password AS "mustChangePassword",
        CASE WHEN u.locked_until > now() THEN u.locked_until END AS "lockedUntil", u.updated_at AS "updatedAt",
        COALESCE((SELECT json_agg(json_build_object('id', r.id, 'code', r.code, 'name', r.name, 'isActive', r.is_active) ORDER BY r.code)
          FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id), '[]') AS roles
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
      await lockActor(m, actor, MANAGE, [], 'SHARE');
      const [{ id }] = await m.query(`INSERT INTO users (employee_code, full_name, email, phone, username, password_hash, is_active,
          must_change_password, password_changed_at, created_by, updated_by)
        VALUES ($1, $2, $3, $4, $5::text, $6, $5::text IS NOT NULL, $5::text IS NOT NULL, CASE WHEN $5::text IS NOT NULL THEN now() END, $7, $7)
        RETURNING id`, [after.employeeCode, after.fullName, after.email, after.phone, username, hash, actor.id]).catch(mapUnique);
      await audit(m, id, 'EMPLOYEE_CREATED', actor.id, { after: { ...after, employmentStatus: 'ACTIVE' } });
      if (username) await audit(m, id, 'ACCOUNT_CREATED', actor.id, { username });
      return { id: id as number };
    });
  }

  /** The employee code is immutable (BA decision OA2.3a). Self-service is limited to email and phone (BA-USR-09). */
  async update(actor: Actor, id: number, input: UpdateUserInput) {
    const after: Profile = { fullName: input.profile.fullName.trim(), email: blank(input.profile.email), phone: blank(input.profile.phone) };
    await this.ds.transaction(async m => {
      await this.lockTarget(m, actor, id, input.version);
      const [row] = await m.query('SELECT full_name AS "fullName", email, phone FROM users WHERE id = $1', [id]);
      const changed = (Object.keys(after) as (keyof Profile)[]).filter(k => after[k] !== row[k]);
      if (!changed.length) return;
      if (actor.id === id && changed.includes('fullName')) throw selfChange();
      await m.query(`UPDATE users SET full_name = $2, email = $3, phone = $4, version = version + 1, updated_at = now(), updated_by = $5
        WHERE id = $1`, [id, after.fullName, after.email, after.phone, actor.id]);
      await audit(m, id, 'EMPLOYEE_UPDATED', actor.id, {
        before: Object.fromEntries(changed.map(k => [k, row[k]])), after: Object.fromEntries(changed.map(k => [k, after[k]])) });
    });
  }

  /**
   * BA-USR-04: deactivating the employee disables the account and ends every session (EMPLOYMENT_INACTIVE) in the same
   * transaction; reactivating never enables the account. Can revoke grants, so admin-guard and the exclusive gate first.
   * shortcut: OA2.3b must block deactivating an org unit head or a direct manager (BA-N-06) here, under the same locks.
   */
  async setEmploymentStatus(actor: Actor, id: number, input: EmploymentStatusInput) {
    if (actor.id === id) throw selfChange();
    await this.ds.transaction(async m => {
      await lockAdminGuard(m);
      await lockGrantsExclusive(m);
      const row = await this.lockTarget(m, actor, id, input.version);
      if (row.employment_status === input.status) return;
      const inactive = input.status === 'INACTIVE';
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

  /** lockActor (gate → users rows of actor and target in id order, re-checks session and USER.MANAGE), then the version. */
  private async lockTarget(m: EntityManager, actor: Actor, id: number, version: number): Promise<LockedUser> {
    const row = (await lockActor(m, actor, MANAGE, [id])).find(r => r.id === id);
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
