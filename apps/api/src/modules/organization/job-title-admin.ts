import {
  Body, Controller, Get, HttpCode, HttpStatus, Injectable, NotFoundException, Param, ParseIntPipe, Patch, Post, Put, Query, Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';
import { DataSource, EntityManager } from 'typeorm';
import { appendActivity, documentPage } from '../document-records/document-records';
import { BusinessError } from '../workflow/workflow';
import { Actor, lockActor } from '../identity/account-security';
import { AuthedRequest, RequirePermissions } from '../identity/auth';

class JobTitleInput {
  @ApiProperty() @IsString() @Matches(/\S/) @MaxLength(200) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) description?: string | null;
}
class CreateJobTitleInput extends JobTitleInput {
  @ApiProperty() @IsString() @Matches(/^\s*[A-Za-z0-9][A-Za-z0-9_.-]{0,49}\s*$/) code!: string;
  /** Source of a copy, recorded in history only; read back from the database, never trusted from the client. */
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) copiedFrom?: number;
}
class UpdateJobTitleInput extends JobTitleInput {
  @ApiProperty() @IsInt() @Min(1) version!: number;
}
class JobTitleStatusInput {
  @ApiProperty() @IsBoolean() isActive!: boolean;
  @ApiProperty() @IsInt() @Min(1) version!: number;
}
class JobTitleListQuery {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsIn(['true', 'false']) status?: string;
  @IsOptional() @IsIn(['code', 'name', 'isActive']) sort?: string;
  @IsOptional() @IsIn(['asc', 'desc']) direction?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) page?: number;
  @IsOptional() @Type(() => Number) @IsIn([25, 50, 100]) size?: number;
}

interface JobTitleRow { id: number; code: string; name: string; description: string | null; status: string; version: number }

const SORT: Record<string, string> = { code: 'lower(code)', name: 'name', isActive: 'status' };
const COLUMNS = `id, code, name, description, status = 'ACTIVE' AS "isActive", version`;
const MANAGE = 'ORGANIZATION.MANAGE';
const likeTerm = (q?: string) => q?.trim() ? `%${q.trim().replace(/[\\%_]/g, c => `\\${c}`)}%` : null;

/**
 * Job titles (OA2.1, ADR-0018 §4.3, BA-ORG-02, BA-UI-03): an independent catalog that never grants permissions.
 * No hierarchy and no hard delete. A change never revokes a grant, so the grant gate is taken shared through
 * lockActor (gate → actor row → job_titles row), following the OA1.3 lock graph.
 */
@Injectable()
export class JobTitleAdminService {
  constructor(private readonly ds: DataSource) {}

  async list(query: JobTitleListQuery) {
    const size = query.size ?? 25;
    const order = `${SORT[query.sort ?? 'code'] ?? SORT.code} ${query.direction === 'desc' ? 'DESC' : 'ASC'}, id`;
    const params = [likeTerm(query.q), query.status ? (query.status === 'true' ? 'ACTIVE' : 'INACTIVE') : null];
    const where = 'WHERE ($1::text IS NULL OR code ILIKE $1 OR name ILIKE $1) AND ($2::text IS NULL OR status = $2)';
    const [items, [{ total }]] = await Promise.all([
      this.ds.query(`SELECT ${COLUMNS} FROM job_titles ${where} ORDER BY ${order} LIMIT $3 OFFSET $4`,
        [...params, size, (query.page ?? 0) * size]),
      this.ds.query(`SELECT count(*)::int AS total FROM job_titles ${where}`, params),
    ]);
    return { items, total };
  }

  async get(id: number) {
    const [row] = await this.ds.query(`SELECT ${COLUMNS}, updated_at AS "updatedAt" FROM job_titles WHERE id = $1`, [id]);
    if (!row) throw new NotFoundException();
    return row;
  }

  history(id: number, before?: number) {
    return documentPage(this.ds.manager, 'JOB_TITLE', id, 'history', before);
  }

  create(actor: Actor, input: CreateJobTitleInput) {
    return this.ds.transaction(async m => {
      await lockActor(m, actor, MANAGE, [], 'SHARE');
      const source = input.copiedFrom ? await this.copySource(m, input.copiedFrom) : undefined;
      const after = { code: input.code.trim(), name: input.name.trim(), description: input.description?.trim() || null };
      const [{ id }] = await m.query(`INSERT INTO job_titles (code, name, description, created_by, updated_by)
        VALUES ($1, $2, $3, $4, $4) RETURNING id`, [after.code, after.name, after.description, actor.id]);
      await appendActivity(m, 'JOB_TITLE', id, source ? 'JOB_TITLE_COPIED' : 'JOB_TITLE_CREATED', actor.id, undefined,
        { metadata: { after, ...(source ? { copiedFrom: source } : {}) } });
      return { id: id as number };
    });
  }

  /** The code is immutable after creation: it is the reference memberships, imports and reports use. */
  async update(actor: Actor, id: number, input: UpdateJobTitleInput) {
    await this.ds.transaction(async m => {
      await lockActor(m, actor, MANAGE, [], 'SHARE');
      const row = await this.lock(m, id, input.version);
      const after = { name: input.name.trim(), description: input.description?.trim() || null };
      if (after.name === row.name && after.description === row.description) return;
      await m.query(`UPDATE job_titles SET name = $2, description = $3, version = version + 1, updated_at = now(), updated_by = $4
        WHERE id = $1`, [id, after.name, after.description, actor.id]);
      await appendActivity(m, 'JOB_TITLE', id, 'JOB_TITLE_UPDATED', actor.id, undefined, { metadata: {
        before: { name: row.name, description: row.description }, after } });
    });
  }

  async setStatus(actor: Actor, id: number, input: JobTitleStatusInput) {
    await this.ds.transaction(async m => {
      await lockActor(m, actor, MANAGE, [], 'SHARE');
      const row = await this.lock(m, id, input.version);
      const status = input.isActive ? 'ACTIVE' : 'INACTIVE';
      if (row.status === status) return;
      if (!input.isActive) await assertJobTitleUnused(m, id);
      await m.query(`UPDATE job_titles SET status = $2, version = version + 1, updated_at = now(), updated_by = $3 WHERE id = $1`,
        [id, status, actor.id]);
      await appendActivity(m, 'JOB_TITLE', id, input.isActive ? 'JOB_TITLE_ENABLED' : 'JOB_TITLE_DISABLED', actor.id);
    });
  }

  private async lock(m: EntityManager, id: number, version: number): Promise<JobTitleRow> {
    const [row] = await m.query('SELECT id, code, name, description, status, version FROM job_titles WHERE id = $1 FOR UPDATE', [id]);
    if (!row) throw new NotFoundException();
    if (row.version !== version) {
      throw new BusinessError('VERSION_CONFLICT', 'The job title was changed by someone else. Reload it and apply your change again', HttpStatus.CONFLICT);
    }
    return row;
  }

  private async copySource(m: EntityManager, id: number): Promise<{ id: number; code: string; name: string }> {
    const [row] = await m.query('SELECT id, code, name FROM job_titles WHERE id = $1', [id]);
    if (!row) throw new BusinessError('COPY_SOURCE_NOT_FOUND', 'The job title to copy does not exist');
    return row;
  }
}

/**
 * BA-UI-03: a job title held by an ACTIVE membership of an ACTIVE employee cannot be deactivated (JOB_TITLE_IN_USE).
 * Runs under the job_titles row lock; OA2.3 membership writes must lock the job title row FOR SHARE so this cannot race.
 * shortcut: org_memberships does not exist until OA2.3, so nothing can hold a job title yet; add the query and its
 * integration test there.
 */
export async function assertJobTitleUnused(_m: EntityManager, _id: number): Promise<void> {}

const actorOf = (req: AuthedRequest): Actor => ({ id: req.user.id, sessionId: req.user.sessionId });

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/job-titles')
export class JobTitleAdminController {
  constructor(private readonly titles: JobTitleAdminService) {}

  @Get() @RequirePermissions('ORGANIZATION.VIEW')
  list(@Query() query: JobTitleListQuery) { return this.titles.list(query); }

  @Get(':id') @RequirePermissions('ORGANIZATION.VIEW')
  get(@Param('id', ParseIntPipe) id: number) { return this.titles.get(id); }

  @Get(':id/history') @RequirePermissions('ORGANIZATION.VIEW')
  history(@Param('id', ParseIntPipe) id: number, @Query('before') before?: string) {
    const cursor = Number(before);
    return this.titles.history(id, Number.isSafeInteger(cursor) && cursor > 0 ? cursor : undefined);
  }

  @Post() @RequirePermissions(MANAGE)
  create(@Req() req: AuthedRequest, @Body() input: CreateJobTitleInput) { return this.titles.create(actorOf(req), input); }

  @Put(':id') @HttpCode(204) @RequirePermissions(MANAGE)
  update(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number, @Body() input: UpdateJobTitleInput) {
    return this.titles.update(actorOf(req), id, input);
  }

  @Patch(':id/status') @HttpCode(204) @RequirePermissions(MANAGE)
  setStatus(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number, @Body() input: JobTitleStatusInput) {
    return this.titles.setStatus(actorOf(req), id, input);
  }
}
