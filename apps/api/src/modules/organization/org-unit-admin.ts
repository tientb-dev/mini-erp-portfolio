import {
  Body, Controller, Get, HttpCode, HttpStatus, Injectable, NotFoundException, Param, ParseIntPipe, Patch, Post, Put, Query, Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';
import { DataSource, EntityManager } from 'typeorm';
import { appendActivity, documentPage } from '../document-records/document-records';
import { BusinessError } from '../workflow/workflow';
import { Actor, lockActor } from '../identity/account-security';
import { AuthedRequest, RequirePermissions } from '../identity/auth';
import { lockOrgTree } from './memberships';
import { lockGrantsExclusive } from '../identity/authorization';

class OrgUnitInput {
  @ApiProperty() @IsString() @Matches(/\S/) @MaxLength(200) name!: string;
  /** null or absent: a root unit. */
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) parentId?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) description?: string | null;
}
class CreateOrgUnitInput extends OrgUnitInput {
  @ApiProperty() @IsString() @Matches(/^\s*[A-Za-z0-9][A-Za-z0-9_.-]{0,49}\s*$/) code!: string;
}
class UpdateOrgUnitInput extends OrgUnitInput {
  @ApiProperty() @IsInt() @Min(1) version!: number;
  /** OA2.3b: absent keeps the head, null clears it. The head must be an ACTIVE employee with an ACTIVE membership here (BA-ORG-10). */
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) headUserId?: number | null;
}
class OrgUnitStatusInput {
  @ApiProperty() @IsBoolean() isActive!: boolean;
  @ApiProperty() @IsInt() @Min(1) version!: number;
}

interface OrgUnitRow { id: number; code: string; name: string; parent_id: number | null; head_user_id: number | null; description: string | null; status: string; version: number }
interface UnitRef { id: number; code: string; name: string }

const MANAGE = 'ORGANIZATION.MANAGE';
const ref = (u?: UnitRef | null) => (u ? { id: u.id, code: u.code, name: u.name } : null);

/**
 * Organization units (OA2.2, ADR-0018 §4.3, BA-ORG-01/09, BA-UI-02): a tree of any depth, no hard delete.
 * Lock order: grants exclusive → lockActor/users row → org-tree → org_units rows.
 * Unit writes can change scope evaluation, so the gate is held through commit (BA-ORG-08, OA3.2).
 */
@Injectable()
export class OrgUnitAdminService {
  constructor(private readonly ds: DataSource) {}

  /** The whole tree, flat in code order; the client nests it. Inactive units stay listed (BA-UI-02). */
  tree() {
    return this.ds.query(`SELECT o.id, o.code, o.name, o.parent_id AS "parentId", o.status = 'ACTIVE' AS "isActive", o.version,
        (SELECT count(*)::int FROM org_memberships om WHERE om.org_unit_id = o.id AND om.status = 'ACTIVE') AS "memberCount"
      FROM org_units o ORDER BY lower(o.code), o.id`);
  }

  async get(id: number) {
    const [row] = await this.ds.query(`SELECT o.id, o.code, o.name, o.description, o.status = 'ACTIVE' AS "isActive", o.version,
        o.updated_at AS "updatedAt", o.head_user_id AS "headUserId",
        CASE WHEN h.id IS NULL THEN NULL ELSE json_build_object('id', h.id, 'employeeCode', h.employee_code, 'fullName', h.full_name) END AS head,
        CASE WHEN p.id IS NULL THEN NULL ELSE json_build_object('id', p.id, 'code', p.code, 'name', p.name) END AS parent
      FROM org_units o LEFT JOIN org_units p ON p.id = o.parent_id LEFT JOIN users h ON h.id = o.head_user_id WHERE o.id = $1`, [id]);
    if (!row) throw new NotFoundException();
    return row;
  }

  history(id: number, before?: number) {
    return documentPage(this.ds.manager, 'ORG_UNIT', id, 'history', before);
  }

  create(actor: Actor, input: CreateOrgUnitInput) {
    return this.ds.transaction(async m => {
      await this.lockTree(m, actor);
      const parent = input.parentId ? await this.parent(m, input.parentId) : null;
      const after = { code: input.code.trim(), name: input.name.trim(), description: input.description?.trim() || null, parent: ref(parent) };
      const [{ id }] = await m.query(`INSERT INTO org_units (code, name, parent_id, description, created_by, updated_by)
        VALUES ($1, $2, $3, $4, $5, $5) RETURNING id`, [after.code, after.name, parent?.id ?? null, after.description, actor.id]);
      await appendActivity(m, 'ORG_UNIT', id, 'ORG_UNIT_CREATED', actor.id, undefined, { metadata: { after } });
      return { id: id as number };
    });
  }

  /** Name, description and parent; the code is immutable (reference for imports, reports and data scope). */
  async update(actor: Actor, id: number, input: UpdateOrgUnitInput) {
    await this.ds.transaction(async m => {
      // The new head's users row is locked before org-tree (BA-N-06).
      const lockedUsers = await this.lockTree(m, actor, input.headUserId ? [input.headUserId] : []);
      const row = await this.lock(m, id, input.version);
      const parentId = input.parentId ?? null;
      const after = { name: input.name.trim(), description: input.description?.trim() || null };
      const moved = parentId !== row.parent_id;
      const headId = input.headUserId === undefined ? row.head_user_id : input.headUserId;
      const headChanged = headId !== row.head_user_id;
      if (!moved && !headChanged && after.name === row.name && after.description === row.description) return;
      const before: Record<string, unknown> = { name: row.name, description: row.description };
      const changes: Record<string, unknown> = { ...after };
      if (headChanged) {
        if (headId) {
          const head = lockedUsers.find(u => u.id === headId);
          if (!head) throw new BusinessError('HEAD_NOT_FOUND', 'The head does not exist');
          if (head.employment_status !== 'ACTIVE') throw new BusinessError('HEAD_INACTIVE', 'The head must be an active employee', HttpStatus.CONFLICT);
          const [member] = await m.query(`SELECT 1 FROM org_memberships WHERE user_id = $1 AND org_unit_id = $2 AND status = 'ACTIVE'`, [headId, id]);
          if (!member) throw new BusinessError('HEAD_NOT_MEMBER', 'The head must be an active member of this unit', HttpStatus.CONFLICT);
        }
        before.head = await this.userRef(m, row.head_user_id);
        changes.head = await this.userRef(m, headId);
      }
      if (moved) {
        if (parentId === id) throw new BusinessError('ORG_UNIT_CYCLE', 'A unit cannot be its own parent');
        const parent = parentId ? await this.parent(m, parentId) : null;
        if (parent) {
          const [inside] = await m.query(`WITH RECURSIVE sub AS (SELECT id FROM org_units WHERE parent_id = $1
            UNION SELECT o.id FROM org_units o JOIN sub ON o.parent_id = sub.id) SELECT 1 FROM sub WHERE id = $2`, [id, parent.id]);
          if (inside) throw new BusinessError('ORG_UNIT_CYCLE', 'The new parent is inside this unit\'s subtree');
        }
        const [old] = row.parent_id ? await m.query('SELECT id, code, name FROM org_units WHERE id = $1', [row.parent_id]) : [];
        before.parent = ref(old);
        changes.parent = ref(parent);
      }
      await m.query(`UPDATE org_units SET name = $2, description = $3, parent_id = $4, head_user_id = $6, version = version + 1, updated_at = now(),
        updated_by = $5 WHERE id = $1`, [id, after.name, after.description, parentId, actor.id, headId]);
      await appendActivity(m, 'ORG_UNIT', id, 'ORG_UNIT_UPDATED', actor.id, undefined, { metadata: { before, after: changes } });
    });
  }

  async setStatus(actor: Actor, id: number, input: OrgUnitStatusInput) {
    await this.ds.transaction(async m => {
      await this.lockTree(m, actor);
      const row = await this.lock(m, id, input.version);
      const status = input.isActive ? 'ACTIVE' : 'INACTIVE';
      if (row.status === status) return;
      if (input.isActive) {
        if (row.parent_id) await this.parent(m, row.parent_id);
      } else {
        const [child] = await m.query(`SELECT 1 FROM org_units WHERE parent_id = $1 AND status = 'ACTIVE' LIMIT 1`, [id]);
        if (child) throw new BusinessError('ORG_UNIT_HAS_ACTIVE_CHILDREN', 'Deactivate the active child units first');
        await assertOrgUnitUnused(m, id);
      }
      await m.query(`UPDATE org_units SET status = $2, version = version + 1, updated_at = now(), updated_by = $3 WHERE id = $1`,
        [id, status, actor.id]);
      await appendActivity(m, 'ORG_UNIT', id, input.isActive ? 'ORG_UNIT_ENABLED' : 'ORG_UNIT_DISABLED', actor.id);
    });
  }

  /**
   * ACTIVE members of a unit for its Nhân sự tab (BA-UI-09). Same rows as `GET /admin/users?orgUnitId=`; both read
   * org_memberships directly.
   */
  async members(id: number) {
    await this.get(id);
    return this.ds.query(`SELECT u.id, u.employee_code AS "employeeCode", u.full_name AS "fullName", u.employment_status AS "employmentStatus",
        om.id AS "membershipId", om.version AS "membershipVersion",
        om.is_primary AS "isPrimary", om.started_at AS "startedAt", (o.head_user_id = u.id) IS TRUE AS "isHead",
        json_build_object('id', jt.id, 'code', jt.code, 'name', jt.name) AS "jobTitle",
        CASE WHEN mg.id IS NULL THEN NULL ELSE json_build_object('id', mg.id, 'employeeCode', mg.employee_code, 'fullName', mg.full_name) END AS manager
      FROM org_memberships om JOIN users u ON u.id = om.user_id JOIN org_units o ON o.id = om.org_unit_id
      JOIN job_titles jt ON jt.id = om.job_title_id LEFT JOIN users mg ON mg.id = om.manager_user_id
      WHERE om.org_unit_id = $1 AND om.status = 'ACTIVE' ORDER BY lower(u.employee_code), u.id`, [id]);
  }

  private async lockTree(m: EntityManager, actor: Actor, userIds: number[] = []) {
    // OA3.2 F01: every unit write can change orgTreeIds (a child created under a member's unit, a parent move) or the
    // tree a reader just loaded, so the gate is exclusive before any row; lockActor's shared request is then a no-op.
    await lockGrantsExclusive(m);
    const rows = await lockActor(m, actor, MANAGE, userIds, 'SHARE');
    await lockOrgTree(m);
    return rows;
  }

  private async userRef(m: EntityManager, id: number | null) {
    if (!id) return null;
    const [u] = await m.query('SELECT id, employee_code AS "employeeCode", full_name AS "fullName" FROM users WHERE id = $1', [id]);
    return u ?? null;
  }

  private async lock(m: EntityManager, id: number, version: number): Promise<OrgUnitRow> {
    const [row] = await m.query('SELECT id, code, name, parent_id, head_user_id, description, status, version FROM org_units WHERE id = $1 FOR UPDATE', [id]);
    if (!row) throw new NotFoundException();
    if (row.version !== version) {
      throw new BusinessError('VERSION_CONFLICT', 'The unit was changed by someone else. Reload it and apply your change again', HttpStatus.CONFLICT);
    }
    return row;
  }

  /** An ACTIVE parent keeps the invariant "no active unit under an inactive one" that deactivation relies on. */
  private async parent(m: EntityManager, id: number): Promise<UnitRef> {
    const [row] = await m.query('SELECT id, code, name, status FROM org_units WHERE id = $1', [id]);
    if (!row) throw new BusinessError('ORG_UNIT_PARENT_NOT_FOUND', 'The parent unit does not exist');
    if (row.status !== 'ACTIVE') throw new BusinessError('ORG_UNIT_PARENT_INACTIVE', 'The parent unit is inactive');
    return row;
  }
}

/**
 * §4.3: a unit with ACTIVE memberships cannot be deactivated (ORG_UNIT_IN_USE). Runs under `org-tree` and the unit row lock.
 * Membership writes take `org-tree` too, so a membership cannot be added while this check runs.
 */
export async function assertOrgUnitUnused(m: EntityManager, id: number): Promise<void> {
  const [used] = await m.query(`SELECT 1 FROM org_memberships WHERE org_unit_id = $1 AND status = 'ACTIVE' LIMIT 1`, [id]);
  if (used) throw new BusinessError('ORG_UNIT_IN_USE', 'End the active memberships of this unit first', HttpStatus.CONFLICT);
}

const actorOf = (req: AuthedRequest): Actor => ({ id: req.user.id, sessionId: req.user.sessionId });

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/org-units')
export class OrgUnitAdminController {
  constructor(private readonly units: OrgUnitAdminService) {}

  @Get('tree') @RequirePermissions('ORGANIZATION.VIEW')
  tree() { return this.units.tree(); }

  @Get(':id') @RequirePermissions('ORGANIZATION.VIEW')
  get(@Param('id', ParseIntPipe) id: number) { return this.units.get(id); }

  @Get(':id/members') @RequirePermissions('ORGANIZATION.VIEW')
  members(@Param('id', ParseIntPipe) id: number) { return this.units.members(id); }

  @Get(':id/history') @RequirePermissions('ORGANIZATION.VIEW')
  history(@Param('id', ParseIntPipe) id: number, @Query('before') before?: string) {
    const cursor = Number(before);
    return this.units.history(id, Number.isSafeInteger(cursor) && cursor > 0 ? cursor : undefined);
  }

  @Post() @RequirePermissions(MANAGE)
  create(@Req() req: AuthedRequest, @Body() input: CreateOrgUnitInput) { return this.units.create(actorOf(req), input); }

  @Put(':id') @HttpCode(204) @RequirePermissions(MANAGE)
  update(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number, @Body() input: UpdateOrgUnitInput) {
    return this.units.update(actorOf(req), id, input);
  }

  @Patch(':id/status') @HttpCode(204) @RequirePermissions(MANAGE)
  setStatus(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number, @Body() input: OrgUnitStatusInput) {
    return this.units.setStatus(actorOf(req), id, input);
  }
}
