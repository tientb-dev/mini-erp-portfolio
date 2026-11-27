import {
  Body, Controller, Get, HttpCode, HttpStatus, Injectable, NotFoundException, Param, ParseIntPipe, Patch, Post, Put, Query, Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, Min, MinLength,
} from 'class-validator';
import { DataSource, EntityManager } from 'typeorm';
import { appendActivity, documentPage } from '../document-records/document-records';
import { BusinessError } from '../workflow/workflow';
import { Actor, assertAdminRemains, lockActor } from './account-security';
import { lockAdminGuard, lockGrantsExclusive } from './authorization';
import { AuthedRequest, RequirePermissions } from './auth';

const CODE = /^[A-Z][A-Z0-9_]{1,49}$/;

class RoleInput {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) description?: string | null;
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(500) @IsString({ each: true }) permissions!: string[];
  @ApiProperty({ type: [Number] }) @IsArray() @ArrayMaxSize(1000) @IsInt({ each: true }) @Min(1, { each: true }) userIds!: number[];
}
class CreateRoleInput extends RoleInput {
  @ApiProperty() @IsString() @Matches(CODE) code!: string;
  /** Source of a copy, recorded in history only (BA-UI-05). */
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) copiedFrom?: number;
}
class UpdateRoleInput extends RoleInput {
  @ApiProperty() @IsInt() @Min(1) version!: number;
}
class RoleStatusInput {
  @ApiProperty() @IsBoolean() isActive!: boolean;
  @ApiProperty() @IsInt() @Min(1) version!: number;
}
class UserOptionsQuery {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsIn(['username', 'fullName', 'isActive']) sort?: string;
  @IsOptional() @IsIn(['asc', 'desc']) direction?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) page?: number;
  @IsOptional() @Type(() => Number) @IsIn([25, 50, 100]) size?: number;
}
class RoleListQuery {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsIn(['true', 'false']) status?: string;
  @IsOptional() @IsIn(['code', 'name', 'userCount', 'permissionCount', 'isActive']) sort?: string;
  @IsOptional() @IsIn(['asc', 'desc']) direction?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) page?: number;
  @IsOptional() @Type(() => Number) @IsIn([25, 50, 100]) size?: number;
}

interface RoleRow { id: number; code: string; name: string; description: string | null; is_active: boolean; is_system: boolean; version: number }

const SORT: Record<string, string> = {
  code: 'r.code', name: 'r.name', userCount: '"userCount"', permissionCount: '"permissionCount"', isActive: 'r.is_active',
};
const selfChange = () => new BusinessError('SELF_CHANGE_DENIED', 'Administrators cannot change their own roles', HttpStatus.FORBIDDEN);
const sorted = (values: Iterable<number>) => [...new Set(values)].sort((a, b) => a - b);

/**
 * Role & Permission administration (OA1.3, ADR-0018). One transaction per save: role row, grants, memberships and audit.
 * Only the system role ADMIN holds ROLE.* (admin_only). DB triggers from OA1.1 stay the last line of defence for ADMIN.
 */
@Injectable()
export class RoleAdminService {
  constructor(private readonly ds: DataSource) {}

  catalog() {
    return this.ds.query(`SELECT code, module, name, description, admin_only AS "adminOnly"
      FROM permissions ORDER BY sort_order, code`);
  }

  async list(query: RoleListQuery) {
    const size = query.size ?? 25;
    const order = `${SORT[query.sort ?? 'code'] ?? 'r.code'} ${query.direction === 'desc' ? 'DESC' : 'ASC'}, r.id`;
    const params = [query.q?.trim() ? `%${query.q.trim()}%` : null, query.status ? query.status === 'true' : null, size, (query.page ?? 0) * size];
    const where = 'WHERE ($1::text IS NULL OR r.code ILIKE $1 OR r.name ILIKE $1) AND ($2::boolean IS NULL OR r.is_active = $2)';
    const [items, [{ total }]] = await Promise.all([
      this.ds.query(`SELECT r.id, r.code, r.name, r.description, r.is_active AS "isActive", r.is_system AS "isSystem",
          (SELECT count(*)::int FROM user_roles ur WHERE ur.role_id = r.id) AS "userCount",
          (SELECT count(*)::int FROM role_permissions rp WHERE rp.role_id = r.id) AS "permissionCount"
        FROM roles r ${where} ORDER BY ${order} LIMIT $3 OFFSET $4`, params),
      this.ds.query(`SELECT count(*)::int AS total FROM roles r ${where}`, params.slice(0, 2)),
    ]);
    return { items, total };
  }

  async get(id: number) {
    const [role] = await this.ds.query(`SELECT id, code, name, description, is_active AS "isActive", is_system AS "isSystem",
        version, updated_at AS "updatedAt" FROM roles WHERE id = $1`, [id]);
    if (!role) throw new NotFoundException();
    const [permissions, users, history] = await Promise.all([
      this.ds.query(`SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
        WHERE rp.role_id = $1 ORDER BY p.sort_order, p.code`, [id]),
      this.ds.query(`SELECT u.id, u.username, u.full_name AS "fullName", u.is_active AS "isActive" FROM user_roles ur
        JOIN users u ON u.id = ur.user_id WHERE ur.role_id = $1 ORDER BY u.username`, [id]),
      documentPage(this.ds.manager, 'ROLE', id, 'history'),
    ]);
    return { ...role, permissions: permissions.map((p: { code: string }) => p.code), users,
      history: history.items, historyCursor: history.nextCursor };
  }

  history(id: number, before?: number) {
    return documentPage(this.ds.manager, 'ROLE', id, 'history', before);
  }

  /** Users for the Role screen's picker, paged server-side; account data only until OA2 adds employee and organization fields. */
  /**
   * The acting admin is excluded in SQL, before COUNT and paging (F-OA1.3-19): they may never change their own roles.
   * Users already in the role stay listed and are locked by the picker (shown, not selectable).
   */
  async userOptions(actorId: number, query: UserOptionsQuery) {
    const size = query.size ?? 25;
    const order = `${query.sort === 'fullName' ? 'full_name' : query.sort === 'isActive' ? 'is_active' : 'username'} ${query.direction === 'desc' ? 'DESC' : 'ASC'}, id`;
    const params = [query.q?.trim() ? `%${query.q.trim()}%` : null, actorId];
    const where = 'WHERE username IS NOT NULL AND id <> $2 AND ($1::text IS NULL OR username ILIKE $1 OR full_name ILIKE $1)';
    const [items, [{ total }]] = await Promise.all([
      this.ds.query(`SELECT id, username, full_name AS "fullName", is_active AS "isActive" FROM users ${where}
        ORDER BY ${order} LIMIT $3 OFFSET $4`, [...params, size, (query.page ?? 0) * size]),
      this.ds.query(`SELECT count(*)::int AS total FROM users ${where}`, params),
    ]);
    return { items, total };
  }

  async create(actor: Actor, input: CreateRoleInput) {
    return this.ds.transaction(async m => {
      const userIds = sorted(input.userIds);
      if (userIds.includes(actor.id)) throw selfChange();
      await lockGrantsExclusive(m);
      await lockActor(m, actor, 'ROLE.MANAGE', userIds, userIds.length ? 'UPDATE' : 'SHARE');
      const source = input.copiedFrom ? await this.copySource(m, input.copiedFrom) : undefined;
      await this.assertUsers(m, userIds);
      const permissions = await this.permissionIds(m, input.permissions, false);
      const [{ id }] = await m.query(`INSERT INTO roles (code, name, description, updated_by) VALUES ($1, $2, $3, $4) RETURNING id`,
        [input.code, input.name.trim(), input.description?.trim() || null, actor.id]);
      await m.query('INSERT INTO role_permissions (role_id, permission_id) SELECT $1, unnest($2::int[])', [id, permissions.map(p => p.id)]);
      await m.query('INSERT INTO user_roles (user_id, role_id) SELECT unnest($2::int[]), $1', [id, userIds]);
      await appendActivity(m, 'ROLE', id, source ? 'ROLE_COPIED' : 'ROLE_CREATED', actor.id, undefined, { metadata: {
        after: { code: input.code, name: input.name.trim(), description: input.description?.trim() || null },
        permissions: permissions.map(p => p.code), users: await this.userRefs(m, userIds),
        ...(source ? { copiedFrom: source } : {}),
      } });
      await recordUserRoleChange(m, actor.id, userIds, { id, code: input.code, name: input.name.trim() }, 'ROLES_ADDED');
      return { id: id as number };
    });
  }

  async update(actor: Actor, id: number, input: UpdateRoleInput) {
    await this.ds.transaction(async m => {
      const before = await this.peek(m, id);
      // Admin standing can only change through the system role's memberships (is_system never changes).
      if (before.is_system) await lockAdminGuard(m);
      await lockGrantsExclusive(m);
      // Memberships are read under the exclusive gate: every writer of user_roles holds it, so the diff is stable.
      const current: number[] = (await m.query('SELECT user_id FROM user_roles WHERE role_id = $1', [id])).map((r: { user_id: number }) => r.user_id);
      const next = sorted(input.userIds);
      const added = next.filter(u => !current.includes(u));
      const removed = current.filter(u => !next.includes(u));
      if ([...added, ...removed].includes(actor.id)) throw selfChange();
      // Users rows of changed members FOR UPDATE (their version moves, acceptance 8); otherwise the actor row only FOR SHARE.
      const changed = sorted([...added, ...removed]);
      await lockActor(m, actor, 'ROLE.MANAGE', changed, changed.length ? 'UPDATE' : 'SHARE');
      const role = await this.lockRole(m, id, input.version);
      await this.assertUsers(m, added);
      const wanted = await this.permissionIds(m, input.permissions, role.is_system);
      const held: { id: number; code: string }[] = await m.query(`SELECT p.id, p.code FROM role_permissions rp
        JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = $1`, [id]);
      const grant = wanted.filter(p => !held.some(h => h.id === p.id));
      const revoke = held.filter(h => !wanted.some(p => p.id === h.id));
      if (role.is_system && (grant.length || revoke.length)) {
        throw new BusinessError('SYSTEM_ROLE_PROTECTED', 'The system role always holds every permission');
      }
      const info = { name: input.name.trim(), description: input.description?.trim() || null };
      await m.query(`UPDATE roles SET name = $2, description = $3, version = version + 1, updated_at = now(), updated_by = $4
        WHERE id = $1`, [id, info.name, info.description, actor.id]);
      if (info.name !== role.name || info.description !== role.description) {
        await appendActivity(m, 'ROLE', id, 'ROLE_UPDATED', actor.id, undefined, { metadata: {
          before: { name: role.name, description: role.description }, after: info } });
      }
      if (revoke.length) {
        await m.query('DELETE FROM role_permissions WHERE role_id = $1 AND permission_id = ANY($2)', [id, revoke.map(p => p.id)]);
        await appendActivity(m, 'ROLE', id, 'PERMISSIONS_REMOVED', actor.id, undefined, { metadata: { permissions: revoke.map(p => p.code).sort() } });
      }
      if (grant.length) {
        await m.query('INSERT INTO role_permissions (role_id, permission_id) SELECT $1, unnest($2::int[])', [id, grant.map(p => p.id)]);
        await appendActivity(m, 'ROLE', id, 'PERMISSIONS_ADDED', actor.id, undefined, { metadata: { permissions: grant.map(p => p.code).sort() } });
      }
      if (removed.length) {
        await m.query('DELETE FROM user_roles WHERE role_id = $1 AND user_id = ANY($2)', [id, removed]);
        await appendActivity(m, 'ROLE', id, 'USERS_REMOVED', actor.id, undefined, { metadata: { users: await this.userRefs(m, removed) } });
      }
      if (added.length) {
        await m.query('INSERT INTO user_roles (user_id, role_id) SELECT unnest($2::int[]), $1', [id, added]);
        await appendActivity(m, 'ROLE', id, 'USERS_ADDED', actor.id, undefined, { metadata: { users: await this.userRefs(m, added) } });
      }
      const roleRef = { id, code: role.code, name: info.name };
      await recordUserRoleChange(m, actor.id, removed, roleRef, 'ROLES_REMOVED');
      await recordUserRoleChange(m, actor.id, added, roleRef, 'ROLES_ADDED');
      if (role.is_system && removed.length) await assertAdminRemains(m);
    });
  }

  /** Deactivation keeps grants and memberships; effective access ends from the next request (BA-RBAC-02, BA-RBAC-09). */
  async setStatus(actor: Actor, id: number, input: RoleStatusInput) {
    await this.ds.transaction(async m => {
      const before = await this.peek(m, id);
      if (before.is_system) throw new BusinessError('SYSTEM_ROLE_PROTECTED', 'The system role cannot be deactivated');
      await lockGrantsExclusive(m);
      await lockActor(m, actor, 'ROLE.MANAGE', [], 'SHARE');
      const role = await this.lockRole(m, id, input.version);
      if (role.is_active === input.isActive) return;
      await m.query(`UPDATE roles SET is_active = $2, version = version + 1, updated_at = now(), updated_by = $3 WHERE id = $1`,
        [id, input.isActive, actor.id]);
      await appendActivity(m, 'ROLE', id, input.isActive ? 'ROLE_ACTIVATED' : 'ROLE_DEACTIVATED', actor.id);
    });
  }

  private async peek(m: EntityManager, id: number): Promise<RoleRow> {
    const [role] = await m.query('SELECT id, code, name, description, is_active, is_system, version FROM roles WHERE id = $1', [id]);
    if (!role) throw new NotFoundException();
    return role;
  }

  /** Role row after the users rows (lock order), with the optimistic version check. */
  private async lockRole(m: EntityManager, id: number, version: number): Promise<RoleRow> {
    const [role] = await m.query('SELECT id, code, name, description, is_active, is_system, version FROM roles WHERE id = $1 FOR UPDATE', [id]);
    if (!role) throw new NotFoundException();
    if (role.version !== version) {
      throw new BusinessError('VERSION_CONFLICT', 'The role was changed by someone else. Reload it and apply your change again', HttpStatus.CONFLICT);
    }
    return role;
  }

  /** Catalog keys only; admin-only keys only on the system role (BA-N-02). */
  private async permissionIds(m: EntityManager, codes: string[], system: boolean): Promise<{ id: number; code: string }[]> {
    const unique = [...new Set(codes)];
    const rows: { id: number; code: string; admin_only: boolean }[] = await m.query(
      'SELECT id, code, admin_only FROM permissions WHERE code = ANY($1)', [unique]);
    const unknown = unique.filter(code => !rows.some(r => r.code === code));
    if (unknown.length) throw new BusinessError('UNKNOWN_PERMISSION', `Unknown permissions: ${unknown.join(', ')}`);
    const adminOnly = rows.filter(r => r.admin_only && !system).map(r => r.code);
    if (adminOnly.length) throw new BusinessError('ADMIN_ONLY_PERMISSION', `Only the system role may hold: ${adminOnly.join(', ')}`);
    return rows.map(({ id, code }) => ({ id, code }));
  }

  private async assertUsers(m: EntityManager, ids: number[]) {
    if (!ids.length) return;
    const [{ found }] = await m.query('SELECT count(*)::int AS found FROM users WHERE id = ANY($1) AND username IS NOT NULL', [ids]);
    if (found !== ids.length) throw new BusinessError('UNKNOWN_USER', 'Select existing user accounts');
  }

  private userRefs(m: EntityManager, ids: number[]): Promise<{ id: number; username: string; fullName: string }[]> {
    return m.query('SELECT id, username, full_name AS "fullName" FROM users WHERE id = ANY($1) ORDER BY username', [ids]);
  }

  /** Copy source read from the database (never from the request): must exist and must not be the system role (F-OA1.3-13). */
  private async copySource(m: EntityManager, id: number): Promise<{ id: number; code: string; name: string }> {
    const [role] = await m.query('SELECT id, code, name, is_system FROM roles WHERE id = $1', [id]);
    if (!role) throw new BusinessError('COPY_SOURCE_NOT_FOUND', 'The role to copy does not exist');
    if (role.is_system) throw new BusinessError('SYSTEM_ROLE_PROTECTED', 'The system role cannot be copied');
    return { id: role.id, code: role.code, name: role.name };
  }
}

/**
 * User side of a role membership change made from the Role screen (acceptance 7, 8): one USER event per changed user
 * and one `users.version` bump. Caller holds those users rows FOR UPDATE.
 */
async function recordUserRoleChange(m: EntityManager, actorId: number, userIds: number[], role: { id: number; code: string; name: string },
  action: 'ROLES_ADDED' | 'ROLES_REMOVED') {
  if (!userIds.length) return;
  await m.query('UPDATE users SET version = version + 1, updated_at = now(), updated_by = $2 WHERE id = ANY($1)', [userIds, actorId]);
  for (const userId of userIds) await appendActivity(m, 'USER', userId, action, actorId, undefined, { metadata: { roles: [role] } });
}

const actorOf = (req: AuthedRequest): Actor => ({ id: req.user.id, sessionId: req.user.sessionId });

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
export class RoleAdminController {
  constructor(private readonly roles: RoleAdminService) {}

  @Get('permissions') @RequirePermissions('ROLE.VIEW')
  catalog() { return this.roles.catalog(); }

  @Get('roles') @RequirePermissions('ROLE.VIEW')
  list(@Query() query: RoleListQuery) { return this.roles.list(query); }

  @Get('roles/user-options') @RequirePermissions('ROLE.MANAGE')
  userOptions(@Req() req: AuthedRequest, @Query() query: UserOptionsQuery) { return this.roles.userOptions(req.user.id, query); }

  @Get('roles/:id') @RequirePermissions('ROLE.VIEW')
  get(@Param('id', ParseIntPipe) id: number) { return this.roles.get(id); }

  @Get('roles/:id/history') @RequirePermissions('ROLE.VIEW')
  history(@Param('id', ParseIntPipe) id: number, @Query('before') before?: string) {
    const cursor = Number(before);
    return this.roles.history(id, Number.isSafeInteger(cursor) && cursor > 0 ? cursor : undefined);
  }

  @Post('roles') @RequirePermissions('ROLE.MANAGE')
  create(@Req() req: AuthedRequest, @Body() input: CreateRoleInput) { return this.roles.create(actorOf(req), input); }

  @Put('roles/:id') @HttpCode(204) @RequirePermissions('ROLE.MANAGE')
  update(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number, @Body() input: UpdateRoleInput) {
    return this.roles.update(actorOf(req), id, input);
  }

  @Patch('roles/:id/status') @HttpCode(204) @RequirePermissions('ROLE.MANAGE')
  setStatus(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number, @Body() input: RoleStatusInput) {
    return this.roles.setStatus(actorOf(req), id, input);
  }
}
