import { Body, Controller, Get, HttpCode, Param, ParseBoolPipe, ParseIntPipe, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsIn, IsInt, IsOptional, IsNotEmpty, IsPositive, IsString, MaxLength, ValidateNested } from 'class-validator';
import { DataSource } from 'typeorm';
import { OptionalReasonDto, ReasonDto, SourceLineDto, SubmitDto } from "../../common/dto";
import { AuthedRequest, RequirePermissions } from '../identity/auth';
import { ProcurementService } from './procurement.service';

class WorkflowRouteDto {
  @ApiProperty() @IsInt() @IsPositive() approverId!: number;
  @ApiProperty() @IsInt() @IsPositive() receiverId!: number;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(50) receiptRole!: string;
}
class AssignPmDto {
  @ApiProperty() @IsInt() @IsPositive() userId!: number;
}
class PrNoteDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(4000) body!: string;
}
class PrDecisionDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @IsPositive() version?: number;
}
class PrRejectDto extends ReasonDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @IsPositive() version?: number;
}
class PrCancelDto extends OptionalReasonDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @IsPositive() version?: number;
}

class PrLineDto {
  @ApiPropertyOptional({ description: "Existing line id when editing; omit for a new line" }) @IsOptional() @IsInt() id?: number;
  @ApiPropertyOptional({ nullable: true, description: 'Required for sales-goods PRs; optional for material PRs' }) @IsOptional() @IsInt() salesContractLineId?: number | null;
  @ApiProperty() @IsInt() productId!: number;
  @ApiProperty() @IsPositive() quantity!: number;
}
class CreatePrDto {
  @ApiPropertyOptional({ enum: ['SALES', 'PM'] }) @IsOptional() @IsIn(['SALES', 'PM']) route?: 'SALES' | 'PM';
  @ApiProperty() @IsInt() salesContractId!: number;
  @ApiPropertyOptional({ enum: ['SALES_GOODS', 'MATERIAL'], default: 'SALES_GOODS' }) @IsOptional() @IsIn(['SALES_GOODS', 'MATERIAL']) category?: 'SALES_GOODS' | 'MATERIAL';
  @ApiPropertyOptional({ description: 'Purpose of use (materials; reference)' }) @IsOptional() @IsString() purpose?: string;
  @ApiProperty({ type: [PrLineDto] }) @ArrayNotEmpty() @ValidateNested({ each: true }) @Type(() => PrLineDto) lines!: PrLineDto[];
}
class CreatePoDto {
  @ApiProperty() @IsInt() supplierId!: number;
  @ApiProperty({ type: [SourceLineDto] }) @ArrayNotEmpty() @ValidateNested({ each: true }) @Type(() => SourceLineDto) lines!: SourceLineDto[];
}

class UpdatePrDto {
  @ApiProperty() @IsInt() version!: number;
  @ApiProperty({ type: [PrLineDto] }) @ArrayNotEmpty() @ValidateNested({ each: true }) @Type(() => PrLineDto) lines!: PrLineDto[];
}
class UpdatePoDto extends CreatePoDto {
  @ApiProperty() @IsInt() version!: number;
}

/** PR, PO: list, detail, create, workflow actions. */
@ApiTags('procurement')
@ApiBearerAuth()
@Controller()
export class ProcurementController {
  constructor(private readonly svc: ProcurementService, @InjectDataSource() private readonly ds: DataSource) {}

  /** PR.VIEW, or read-only for the responsible sales of `salesContractId` (scope checked in the service). */
  @Get('purchase-requisitions')
  listPrs(
    @Req() req: AuthedRequest,
    @Query('assignedToMe', new ParseBoolPipe({ optional: true })) mine?: boolean,
    @Query('salesContractId', new ParseIntPipe({ optional: true })) salesContractId?: number,
  ) {
    return this.svc.listPrs(req.user, mine ?? false, salesContractId);
  }

  /** PR.VIEW, or read-only for the responsible sales of the PR's contract (scope checked in the service). */
  @Get('purchase-requisitions/:id')
  getPr(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number) {
    return this.svc.getPr(req.user, id);
  }

  @Get('purchase-requisition-lines/available-for-po')
  @RequirePermissions('PO.CREATE')
  prLinesForPo() {
    return this.svc.prLinesAvailableForPo();
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
    return this.svc.createPurchaseRequisition(req.user, dto.salesContractId, dto.lines, dto.category, dto.purpose, dto.route);
  }

  @Patch('purchase-requisitions/:id')
  @HttpCode(204)
  @RequirePermissions('PR.CREATE')
  updatePr(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdatePrDto) {
    return this.svc.updatePurchaseRequisition(req.user, id, dto.version, dto.lines);
  }

  @Get('purchase-requisitions/:id/lines')
  @RequirePermissions('PR.VIEW')
  prLines(@Param('id', ParseIntPipe) id: number) {
    return this.ds.query(`SELECT id, product_id AS "productId", quantity FROM purchase_requisition_lines WHERE purchase_requisition_id = $1 ORDER BY id`, [id]);
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
  configureRoute(@Param('route') route: string, @Body() dto: WorkflowRouteDto) {
    return this.svc.configurePrRoute(route, dto);
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

  @Put('pr-workflow/contracts/:id/responsible-pm')
  @HttpCode(204)
  @RequirePermissions('PR.CONFIGURE')
  assignPm(@Param('id', ParseIntPipe) id: number, @Body() dto: AssignPmDto) {
    return this.svc.assignResponsiblePm(id, dto.userId);
  }

  @Post('purchase-requisitions/:id/notes')
  @HttpCode(204)
  addNote(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number, @Body() dto: PrNoteDto) {
    return this.svc.addPrNote(req.user, id, dto.body);
  }

  @Get('purchase-requisitions/:id/notes')
  listNotes(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number,
    @Query('before', new ParseIntPipe({ optional: true })) before?: number) {
    return this.svc.readPrRecords(req.user, id, 'notes', before);
  }

  @Get('purchase-requisitions/:id/history')
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
  submitPr(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number) {
    return this.svc.submit('PR', id, req.user);
  }

  @Post('purchase-requisitions/:id/approve')
  @HttpCode(204)
  approvePr(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number, @Body() dto: PrDecisionDto) {
    return this.svc.approve('PR', id, req.user, dto?.version);
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
  rejectPR(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number, @Body() dto: PrRejectDto) {
    return this.svc.decide('PR', 'reject', id, req.user, dto.reason, dto.version);
  }

  @Post('purchase-requisitions/:id/recall')
  @HttpCode(204)
  @RequirePermissions('PR.CREATE')
  recallPR(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number, @Body() dto: PrRejectDto) {
    return this.svc.decide('PR', 'recall', id, req.user, dto.reason, dto.version);
  }

  @Post('purchase-requisitions/:id/cancel')
  @HttpCode(204)
  @RequirePermissions('PR.CREATE')
  cancelPR(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number, @Body() dto: PrCancelDto) {
    return this.svc.decide('PR', 'cancel', id, req.user, dto.reason, dto.version);
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
