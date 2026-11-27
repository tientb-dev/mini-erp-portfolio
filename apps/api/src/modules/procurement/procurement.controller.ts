import { BadRequestException, Body, Controller, Get, Header, HttpCode, Param, ParseBoolPipe, ParseEnumPipe, ParseFilePipe, ParseIntPipe, ParseUUIDPipe, Patch, Post, Put, Query, Req, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayNotEmpty, ArrayUnique, IsArray, IsBoolean, Max, IsDateString, Matches, IsIn, IsInt, IsOptional, IsNotEmpty, IsPositive, IsString, IsUUID, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';
import { DataSource } from 'typeorm';
import { OptionalReasonDto, ReasonDto, SourceLineDto, SubmitDto } from "../../common/dto";
import { AuthedRequest, RequirePermissions } from '../identity/auth';
import { ProcurementService, PR_SORT } from './procurement.service';
import { PR_POOLS, PrPool, PrRoute } from './pr-eligibility';
import { WORKFLOW_STEPS, WorkflowStep } from '../workflow/action-context';
import { FileInterceptor } from '@nestjs/platform-express';
import { dossierMaxFileBytes } from '../document-dossier/dossier-file-policy';
import { IncomingDossierFile } from '../document-dossier/dossier-storage';
import { DossierUpdate, MAX_DOSSIER_ID, NewDossierUpdate } from '../document-dossier/dossier-update.dto';

const dossierIdRange = {
  transform(value: number) {
    if (value < 1 || value > MAX_DOSSIER_ID) throw new BadRequestException('Dossier identifiers must be positive 32-bit integers');
    return value;
  },
};

const dossierUpload = FileInterceptor('file', { limits: { fileSize: dossierMaxFileBytes() + 1, files: 1, parts: 2 } });
const dossierUploadBody = { schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' } } } };

class PrListQuery {
  @IsOptional() @IsString() @MaxLength(200) q?: string;
  @IsOptional() @IsIn(['SALES_GOODS', 'MATERIAL']) category?: string;
  @IsOptional() @IsIn(['DRAFT','WAITING_FOR_APPROVE','WAITING_FOR_RECEIPT','DONE','REJECTED','CANCELED']) status?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) @IsDateString({ strict: true }) from?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) @IsDateString({ strict: true }) to?: string;
  @IsOptional() @IsIn(Object.keys(PR_SORT)) sort?: keyof typeof PR_SORT;
  @IsOptional() @IsIn(['asc','desc']) direction?: 'asc' | 'desc';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page?: number;
  @IsOptional() @Type(() => Number) @IsIn([25,50,100]) size?: number;
}
class PickerQuery {
  @IsOptional() @IsString() @MaxLength(200) q?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) brandId?: number;
  @IsOptional() @IsIn(['code','name','brand','uom','description']) sort?: string;
  @IsOptional() @IsIn(['asc','desc']) direction?: 'asc' | 'desc';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page?: number;
  @IsOptional() @Type(() => Number) @IsIn([25,50,100]) size?: number;
}
class PrRequestListQuery extends PrListQuery {
  @IsOptional() @IsIn(['true','false']) assignedToMe?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) salesContractId?: number;
}

class WorkflowRouteDto {
  @ApiProperty({ type: [Number] }) @IsArray() @ArrayUnique() @IsInt({ each: true }) @IsPositive({ each: true }) userIds!: number[];
}
class AssignPmDto {
  @ApiProperty() @IsInt() @IsPositive() userId!: number;
}
class PrNoteDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(4000) body!: string;
}
class PrDecisionDto {
  @ApiProperty() @IsInt() @IsPositive() version!: number;
  @ApiProperty() @IsInt() @Min(0) round!: number;
  @ApiProperty({ enum: WORKFLOW_STEPS }) @IsIn(WORKFLOW_STEPS) step!: WorkflowStep;
}
class PrSubmitDto extends PrDecisionDto {
  @ApiProperty() @IsInt() @IsPositive() approverId!: number;
  @ApiProperty() @IsInt() @IsPositive() receiverId!: number;
}
class PrRejectDto extends PrDecisionDto {
  @ApiProperty() @IsString() @IsNotEmpty() reason!: string;
}
class PrReassignDto extends PrRejectDto {
  @ApiProperty() @IsInt() @IsPositive() assigneeId!: number;
}
class PrCancelDto extends PrDecisionDto {
  @ApiPropertyOptional() @IsOptional() @IsString() reason?: string;
}
class PrPoolParams {
  @ApiProperty({ enum: PR_POOLS }) @IsIn(PR_POOLS) route!: PrPool;
}

class PrLineDto {
  @ApiPropertyOptional({ description: "Existing line id when editing; omit for a new line" }) @IsOptional() @IsInt() id?: number;
  @ApiPropertyOptional({ nullable: true, description: 'Required when submitting sales-goods PRs; optional for material PRs' }) @IsOptional() @IsInt() salesContractLineId?: number | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsInt() @IsPositive() productId?: number | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsInt() @IsPositive() temporaryProductId?: number | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsInt() @IsPositive() brandId?: number | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsInt() @IsPositive() supplierId?: number | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsInt() @IsPositive() unitOfMeasureId?: number | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsInt() @IsPositive() taxRateId?: number | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() requirementDescription?: string | null;
  @ApiPropertyOptional({ type: String }) @IsOptional() @IsString() unitPrice?: string;
  @ApiProperty({ oneOf: [{ type: 'string' }, { type: 'number' }], description: 'Use a decimal string for exact input' })
  @ValidateIf((_, value: unknown) => typeof value !== 'string') @IsPositive() quantity!: number | string;
}
class PrDraftSelection {
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() name?: string | null;
  @ApiPropertyOptional({ nullable: true, format: 'date' }) @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) @IsDateString({ strict: true }) requisitionDate?: string | null;
  @ApiPropertyOptional({ nullable: true, format: 'date' }) @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) @IsDateString({ strict: true }) requiredDate?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() description?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @IsPositive() currencyId?: number;
  @ApiPropertyOptional({ enum: ['CATALOG', 'MANUAL'] }) @IsOptional() @IsIn(['CATALOG', 'MANUAL']) exchangeRateSource?: 'CATALOG' | 'MANUAL';
  @ApiPropertyOptional({ type: String }) @IsOptional() @IsString() exchangeRate?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() refreshCatalogExchangeRate?: boolean;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsInt() @IsPositive() approverId?: number | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsInt() @IsPositive() receiverId?: number | null;
}
class CreatePrDto extends PrDraftSelection {
  @ApiPropertyOptional({ enum: ['SALES', 'PM'] }) @IsOptional() @IsIn(['SALES', 'PM']) route?: 'SALES' | 'PM';
  @ApiProperty() @IsInt() @IsPositive() salesContractId!: number;
  @ApiPropertyOptional({ enum: ['SALES_GOODS', 'MATERIAL'], default: 'SALES_GOODS' }) @IsOptional() @IsIn(['SALES_GOODS', 'MATERIAL']) category?: 'SALES_GOODS' | 'MATERIAL';
  @ApiPropertyOptional({ description: 'Purpose of use (materials; reference)' }) @IsOptional() @IsString() purpose?: string;
  @ApiProperty({ type: [PrLineDto] }) @ArrayNotEmpty() @ValidateNested({ each: true }) @Type(() => PrLineDto) lines!: PrLineDto[];
  @ApiPropertyOptional({ nullable: true, description: 'Owner unit (BA-OA3-06): omitted → primary unit; fixed after creation' })
  @IsOptional() @IsInt() ownerOrgUnitId?: number | null;
}
class CreatePoDto {
  @ApiProperty() @IsInt() supplierId!: number;
  @ApiProperty({ type: [SourceLineDto] }) @ArrayNotEmpty() @ValidateNested({ each: true }) @Type(() => SourceLineDto) lines!: SourceLineDto[];
}
class SaveNewPrDto extends CreatePrDto {
  @ApiProperty() @IsUUID('4') requestKey!: string;
  @ApiProperty() @IsBoolean() submit!: boolean;
  @ApiPropertyOptional({ type: NewDossierUpdate }) @IsOptional() @ValidateNested() @Type(() => NewDossierUpdate) dossier?: NewDossierUpdate;
}

class UpdatePrDto extends PrDraftSelection {
  @ApiProperty() @IsInt() version!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() purpose?: string;
  @ApiProperty({ type: [PrLineDto] }) @ArrayNotEmpty() @ValidateNested({ each: true }) @Type(() => PrLineDto) lines!: PrLineDto[];
  @ApiPropertyOptional({ type: DossierUpdate }) @IsOptional() @ValidateNested() @Type(() => DossierUpdate) dossier?: DossierUpdate;
}
class UpdatePoDto extends CreatePoDto {
  @ApiProperty() @IsInt() version!: number;
}
class SubmitEditedPrDto extends UpdatePrDto {
  @ApiProperty() @IsInt() @Min(0) round!: number;
  @ApiProperty({ enum: ['CREATE'] }) @IsIn(['CREATE']) step!: 'CREATE';
}

/** PR, PO: list, detail, create, workflow actions. */
@ApiTags('procurement')
@ApiBearerAuth()
@Controller()
export class ProcurementController {
  constructor(private readonly svc: ProcurementService, @InjectDataSource() private readonly ds: DataSource) {}

  /** PR.VIEW with its Data Scope (filtered in the service); `salesContractId` only narrows the list. */
  @Get('purchase-requisitions')
  @RequirePermissions('PR.VIEW')
  listPrs(
    @Req() req: AuthedRequest,
    @Query() query: PrRequestListQuery,
  ) {
    const { assignedToMe, salesContractId, ...filters } = query;
    return this.svc.listPrs(req.user, assignedToMe === 'true', salesContractId, filters);
  }

  /** PR.VIEW; outside its scope → 404 (BA-OA3-07). */
  @Get('purchase-requisitions/:id')
  @RequirePermissions('PR.VIEW')
  getPr(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number) {
    return this.svc.getPr(req.user, id);
  }

  @Get('purchase-requisitions/catalog/dossier')
  @RequirePermissions('PR.CREATE')
  prDossierTemplate() { return this.svc.prDossierTemplate(); }

  @Get('purchase-requisitions/:id/dossier')
  @RequirePermissions('PR.VIEW')
  prDossier(@Req() req: AuthedRequest, @Param('id', ParseIntPipe, dossierIdRange) id: number) {
    return this.svc.prDossier(req.user, id);
  }

  @Put('purchase-requisitions/:id/dossier')
  @RequirePermissions('PR.DOSSIER_MANAGE')
  savePrDossier(@Req() req: AuthedRequest, @Param('id', ParseIntPipe, dossierIdRange) id: number, @Body() body: DossierUpdate) {
    return this.svc.savePrDossier(req.user, id, body);
  }

  @Post('purchase-requisitions/dossier-staging/:key/:typeId')
  @RequirePermissions('PR.CREATE', 'PR.DOSSIER_MANAGE')
  @ApiConsumes('multipart/form-data') @ApiBody(dossierUploadBody)
  @UseInterceptors(dossierUpload)
  stageNewDossier(@Req() req: AuthedRequest, @Param('key', new ParseUUIDPipe({ version: '4' })) key: string,
    @Param('typeId', ParseIntPipe, dossierIdRange) typeId: number, @UploadedFile(new ParseFilePipe()) file: IncomingDossierFile) {
    return this.svc.stagePrDossier(req.user, key, typeId, file);
  }

  @Post('purchase-requisitions/:id/dossier/files/:typeId')
  @RequirePermissions('PR.DOSSIER_MANAGE')
  @ApiConsumes('multipart/form-data') @ApiBody(dossierUploadBody)
  @UseInterceptors(dossierUpload)
  stageExistingDossier(@Req() req: AuthedRequest, @Param('id', ParseIntPipe, dossierIdRange) id: number,
    @Param('typeId', ParseIntPipe, dossierIdRange) typeId: number, @Query('session', new ParseUUIDPipe({ version: '4' })) session: string,
    @UploadedFile(new ParseFilePipe()) file: IncomingDossierFile) {
    return this.svc.stagePrDossier(req.user, id, typeId, file, session);
  }

  @Get('purchase-requisitions/dossier-staging/:key/:fileId')
  @RequirePermissions('PR.CREATE', 'PR.DOSSIER_MANAGE')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async downloadStagedDossier(@Req() req: AuthedRequest, @Param('key', new ParseUUIDPipe({ version: '4' })) key: string,
    @Param('fileId', ParseIntPipe, dossierIdRange) fileId: number) {
    return this.dossierDownload(await this.svc.downloadPrDossier(req.user, key, fileId));
  }

  @Get('purchase-requisitions/:id/dossier/files/:fileId')
  @RequirePermissions('PR.VIEW')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async downloadDossier(@Req() req: AuthedRequest, @Param('id', ParseIntPipe, dossierIdRange) id: number,
    @Param('fileId', ParseIntPipe, dossierIdRange) fileId: number, @Query('session', new ParseUUIDPipe({ version: '4', optional: true })) session?: string) {
    return this.dossierDownload(await this.svc.downloadPrDossier(req.user, id, fileId, session));
  }

  private dossierDownload(file: Awaited<ReturnType<ProcurementService['downloadPrDossier']>>) {
    const name = encodeURIComponent(file.name).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16));
    return new StreamableFile(file.stream, { type: file.mediaType, length: file.size,
      disposition: "attachment; filename*=UTF-8''" + name });
  }

  @Get('purchase-requisition-lines/available-for-po')
  @RequirePermissions('PO.CREATE')
  prLinesForPo() {
    return this.svc.prLinesAvailableForPo();
  }

  @Get('purchase-requisitions/catalog/contracts')
  @RequirePermissions('PR.CREATE')
  prContracts(@Req() req: AuthedRequest, @Query() query: PickerQuery) {
    return this.svc.listPrContracts(req.user, query.q ?? '', query.page ?? 1);
  }

  @Get('product-picker/:source')
  @RequirePermissions('PRODUCT.VIEW')
  productPicker(@Param('source', new ParseEnumPipe({ main: 'main', temporary: 'temporary' })) source: 'main' | 'temporary',
    @Query() query: PickerQuery) {
    return this.svc.productPicker(source, query);
  }

  @Get('purchase-requisitions/catalog/suppliers')
  @RequirePermissions('PR.CREATE')
  prSuppliers(@Req() req: AuthedRequest, @Query('salesContractId', ParseIntPipe) contractId: number,
    @Query('brandId', ParseIntPipe) brandId: number,
    @Query('route', new ParseEnumPipe({ SALES: 'SALES', PM: 'PM' }, { optional: true })) route?: PrRoute) {
    return this.svc.listPrSuppliers(req.user, contractId, brandId, route);
  }

  @Get('purchase-orders')
  @RequirePermissions('PO.VIEW')
  listPos(@Req() req: AuthedRequest, @Query('assignedToMe', new ParseBoolPipe({ optional: true })) mine?: boolean) {
    return this.svc.listPos(req.user, mine ?? false);
  }

  @Get('purchase-orders/:id')
  @RequirePermissions('PO.VIEW')
  getPo(@Param('id', ParseIntPipe) id: number) {
    return this.svc.getPo(id);
  }

  @Post('purchase-requisitions')
  @RequirePermissions('PR.CREATE')
  createPr(@Req() req: AuthedRequest, @Body() dto: CreatePrDto) {
    return this.svc.createPurchaseRequisition(req.user, dto.salesContractId, dto.lines, dto.category, dto.purpose, dto.route, dto);
  }

  @Post('purchase-requisitions/save-new')
  @RequirePermissions('PR.CREATE')
  saveNewPr(@Req() req: AuthedRequest, @Body() dto: SaveNewPrDto) {
    return this.svc.saveNewPr(req.user, dto);
  }

  @Patch('purchase-requisitions/:id')
  @HttpCode(204)
  @RequirePermissions('PR.CREATE')
  updatePr(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdatePrDto) {
    return this.svc.updatePurchaseRequisition(req.user, id, dto.version, dto.lines, dto);
  }

  @Patch('purchase-requisitions/:id/submit-edited')
  @HttpCode(204)
  @RequirePermissions('PR.CREATE')
  submitEdited(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number, @Body() dto: SubmitEditedPrDto) {
    return this.svc.submitEditedPr(req.user, id, dto);
  }

  @Get('purchase-requisitions/:id/lines')
  @RequirePermissions('PR.VIEW')
  prLines(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number) {
    return this.svc.prLines(req.user, id);
  }

  @Post('purchase-orders')
  @RequirePermissions('PO.CREATE')
  createPo(@Req() req: AuthedRequest, @Body() dto: CreatePoDto) {
    return this.svc.createPurchaseOrder(req.user, dto.supplierId, dto.lines);
  }

  @Patch('purchase-orders/:id')
  @HttpCode(204)
  @RequirePermissions('PO.CREATE')
  updatePo(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdatePoDto) {
    return this.svc.updatePurchaseOrder(req.user, id, dto.version, dto.supplierId, dto.lines);
  }

  @Get('purchase-orders/:id/lines')
  @RequirePermissions('PO.VIEW')
  poLines(@Param('id', ParseIntPipe) id: number) {
    return this.ds.query(`SELECT id, purchase_requisition_line_id AS "purchaseRequisitionLineId", quantity FROM purchase_order_lines WHERE purchase_order_id = $1 ORDER BY id`, [id]);
  }

  @Put('pr-workflow/routes/:route')
  @HttpCode(204)
  @RequirePermissions('PR.CONFIGURE')
  configureRoute(@Param() params: PrPoolParams, @Body() dto: WorkflowRouteDto) {
    return this.svc.configurePrRoute(params.route, dto.userIds);
  }

  @Get('pr-workflow/routes')
  @RequirePermissions('PR.CONFIGURE')
  listRoutes() {
    return this.svc.listPrRoutes();
  }

  @Get('pr-workflow/candidates')
  @RequirePermissions('PR.CONFIGURE')
  listCandidates() {
    return this.svc.listPrAssignmentCandidates();
  }

  @Get('pr-workflow/creator-candidates')
  @RequirePermissions('PR.CREATE')
  creatorCandidates(@Req() req: AuthedRequest, @Query('salesContractId', ParseIntPipe) contractId: number,
    @Query('route', new ParseEnumPipe({ SALES: 'SALES', PM: 'PM' }, { optional: true })) route?: PrRoute) {
    return this.svc.listCreatorCandidates(req.user, contractId, route);
  }

  @Put('pr-workflow/contracts/:id/responsible-pm')
  @HttpCode(204)
  @RequirePermissions('PR.CONFIGURE')
  assignPm(@Param('id', ParseIntPipe) id: number, @Body() dto: AssignPmDto) {
    return this.svc.assignResponsiblePm(id, dto.userId);
  }

  @Post('purchase-requisitions/:id/notes')
  @HttpCode(204)
  @RequirePermissions('PR.VIEW')
  addNote(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number, @Body() dto: PrNoteDto) {
    return this.svc.addPrNote(req.user, id, dto.body);
  }

  @Get('purchase-requisitions/:id/notes')
  @RequirePermissions('PR.VIEW')
  listNotes(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number,
    @Query('before', new ParseIntPipe({ optional: true })) before?: number) {
    return this.svc.readPrRecords(req.user, id, 'notes', before);
  }

  @Get('purchase-requisitions/:id/history')
  @RequirePermissions('PR.VIEW')
  listHistory(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number,
    @Query('before', new ParseIntPipe({ optional: true })) before?: number) {
    return this.svc.readPrRecords(req.user, id, 'history', before);
  }
  @Get('pr-notifications')
  listNotifications(@Req() req: AuthedRequest) {
    return this.svc.listPrNotifications(req.user.id);
  }

  @Patch('pr-notifications/:id/read')
  @HttpCode(204)
  readNotification(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number) {
    return this.svc.readPrNotification(req.user.id, id);
  }

  @Get('purchase-orders/:id/approvers')
  @RequirePermissions('PO.CREATE')
  poApprovers(@Param('id', ParseIntPipe) id: number) {
    return this.svc.approvers('PO', id);
  }

  @Post('purchase-requisitions/:id/submit')
  @HttpCode(204)
  @RequirePermissions('PR.CREATE')
  submitPr(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number, @Body() dto: PrSubmitDto) {
    return this.svc.submitPr(id, req.user, dto);
  }

  @Get('purchase-requisitions/:id/candidates')
  @RequirePermissions('PR.CREATE')
  listPrCandidates(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number) {
    return this.svc.listPrCandidates(id, req.user);
  }

  @Get('purchase-requisitions/:id/reassignment-candidates')
  @RequirePermissions('PR.VIEW')
  reassignmentCandidates(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number) {
    return this.svc.prReassignmentCandidates(id, req.user);
  }

  @Post('purchase-requisitions/:id/reassign')
  @HttpCode(204)
  @RequirePermissions('PR.VIEW')
  reassignPr(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number, @Body() dto: PrReassignDto) {
    return this.svc.reassignPr(id, req.user, dto);
  }

  @Post('purchase-requisitions/:id/approve')
  @HttpCode(204)
  @RequirePermissions('PR.VIEW')
  approvePr(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number, @Body() dto: PrDecisionDto) {
    return this.svc.actOnPr(id, req.user, 'approve', dto);
  }

  @Post('purchase-requisitions/:id/receive')
  @HttpCode(204)
  @RequirePermissions('PR.VIEW')
  receivePr(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number, @Body() dto: PrDecisionDto) {
    return this.svc.actOnPr(id, req.user, 'receive', dto);
  }

  @Post('purchase-orders/:id/submit')
  @HttpCode(204)
  @RequirePermissions('PO.CREATE')
  submitPo(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number, @Body() dto: SubmitDto) {
    return this.svc.submit('PO', id, req.user, dto.approverId);
  }

  @Post('purchase-orders/:id/approve')
  @HttpCode(204)
  @RequirePermissions('PO.APPROVE')
  approvePo(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number) {
    return this.svc.approve('PO', id, req.user);
  }

  @Post('purchase-requisitions/:id/reject')
  @HttpCode(204)
  @RequirePermissions('PR.VIEW')
  rejectPR(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number, @Body() dto: PrRejectDto) {
    return this.svc.actOnPr(id, req.user, 'reject', dto, dto.reason);
  }

  @Post('purchase-requisitions/:id/recall')
  @HttpCode(204)
  @RequirePermissions('PR.CREATE')
  recallPR(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number, @Body() dto: PrRejectDto) {
    return this.svc.actOnPr(id, req.user, 'recall', dto, dto.reason);
  }

  @Post('purchase-requisitions/:id/cancel')
  @HttpCode(204)
  @RequirePermissions('PR.CREATE')
  cancelPR(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number, @Body() dto: PrCancelDto) {
    return this.svc.actOnPr(id, req.user, 'cancel', dto, dto.reason);
  }

  @Post('purchase-orders/:id/reject')
  @HttpCode(204)
  @RequirePermissions('PO.APPROVE')
  rejectPO(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number, @Body() dto: ReasonDto) {
    return this.svc.decide('PO', 'reject', id, req.user, dto.reason);
  }

  @Post('purchase-orders/:id/recall')
  @HttpCode(204)
  @RequirePermissions('PO.CREATE')
  recallPO(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number, @Body() dto: ReasonDto) {
    return this.svc.decide('PO', 'recall', id, req.user, dto.reason);
  }

  @Post('purchase-orders/:id/cancel')
  @HttpCode(204)
  @RequirePermissions('PO.CREATE')
  cancelPO(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number, @Body() dto: OptionalReasonDto) {
    return this.svc.decide('PO', 'cancel', id, req.user, dto.reason);
  }
}
