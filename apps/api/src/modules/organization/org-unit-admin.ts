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
}
class OrgUnitStatusInput {
  @ApiProperty() @IsBoolean() isActive!: boolean;
  @ApiProperty() @IsInt() @Min(1) version!: number;
}

interface OrgUnitRow { id: number; code: string; name: string; parent_id: number | null; description: string | null; status: string; version: number }
interface UnitRef { id: number; code: string; name: string }

const MANAGE = 'ORGANIZATION.MANAGE';
const ref = (u?: UnitRef | null) => (u ? { id: u.id, code: u.code, name: u.name } : null);

/**
 * Organization units (OA2.2, ADR-0018 §4.3, BA-ORG-01/09, BA-UI-02): a tree of any depth, no hard delete.
 * Lock order: lockActor (gate `grants` shared → actor users row) → advisory `org-tree` → org_units rows. Every write takes
 * `org-tree`, so cycle and active-children checks see a stable tree; OA2.3 membership writes take it after users rows too.
 * Units never grant permissions (BA-ORG-08), so no write takes the gate exclusive.
 */
@Injectable()
export class OrgUnitAdminService {
  constructor(private readonly ds: DataSource) {}

  /** The whole tree, flat in code order; the client nests it. Inactive units stay listed (BA-UI-02). */
  tree() {
    return this.ds.query(`SELECT id, code, name, parent_id AS "parentId", status = 'ACTIVE' AS "isActive", version
      FROM org_units ORDER BY lower(code), id`);
  }

  async get(id: number) {
    const [row] = await this.ds.query(`SELECT o.id, o.code, o.name, o.description, o.status = 'ACTIVE' AS "isActive", o.version,
        o.updated_at AS "updatedAt", o.head_user_id AS "headUserId",
        CASE WHEN p.id IS NULL THEN NULL ELSE json_build_object('id', p.id, 'code', p.code, 'name', p.name) END AS parent
      FROM org_units o LEFT JOIN org_units p ON p.id = o.parent_id WHERE o.id = $1`, [id]);
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
      await this.lockTree(m, actor);
      const row = await this.lock(m, id, input.version);
      const parentId = input.parentId ?? null;
      const after = { name: input.name.trim(), description: input.description?.trim() || null };
      const moved = parentId !== row.parent_id;
      if (!moved && after.name === row.name && after.description === row.description) return;
      const before: Record<string, unknown> = { name: row.name, description: row.description };
      const changes: Record<string, unknown> = { ...after };
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
      await m.query(`UPDATE org_units SET name = $2, description = $3, parent_id = $4, version = version + 1, updated_at = now(),
        updated_by = $5 WHERE id = $1`, [id, after.name, after.description, parentId, actor.id]);
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

  private async lockTree(m: EntityManager, actor: Actor) {
    await lockActor(m, actor, MANAGE, [], 'SHARE');
    await m.query(`SELECT pg_advisory_xact_lock(hashtext('org-tree'))`);
  }

  private async lock(m: EntityManager, id: number, version: number): Promise<OrgUnitRow> {
    const [row] = await m.query('SELECT id, code, name, parent_id, description, status, version FROM org_units WHERE id = $1 FOR UPDATE', [id]);
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
 * shortcut: org_memberships does not exist until OA2.3; add the query, the head check and their concurrency test there.
 */
export async function assertOrgUnitUnused(_m: EntityManager, _id: number): Promise<void> {}

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
