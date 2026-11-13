import { Body, Controller, Get, HttpCode, Param, ParseBoolPipe, ParseIntPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsInt, IsOptional, IsNotEmpty, IsPositive, IsString, MaxLength, ValidateNested } from 'class-validator';
import { DataSource } from 'typeorm';
import { OptionalReasonDto, ReasonDto, SourceLineDto, SubmitDto } from "../../common/dto";
import { AuthedRequest, RequirePermissions } from '../identity/auth';
import { ProcurementService } from './procurement.service';

class PrLineDto {
  @ApiPropertyOptional({ description: "Existing line id when editing; omit for a new line" }) @IsOptional() @IsInt() id?: number;
  @ApiProperty() @IsInt() salesContractLineId!: number;
  @ApiProperty() @IsInt() productId!: number;
  @ApiProperty() @IsPositive() quantity!: number;
}
class CreatePrDto {
  @ApiProperty() @IsInt() salesContractId!: number;
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

  @Get('purchase-requisitions')
  @RequirePermissions('PR.VIEW')
  listPrs(@Req() req: AuthedRequest, @Query('assignedToMe', new ParseBoolPipe({ optional: true })) mine?: boolean) {
    return this.svc.listPrs(req.user, mine ?? false);
  }

  @Get('purchase-requisitions/:id')
  @RequirePermissions('PR.VIEW')
  getPr(@Param('id', ParseIntPipe) id: number) {
    return this.svc.getPr(id);
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
    return this.svc.createPurchaseRequisition(req.user, dto.salesContractId, dto.lines);
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

  @Get('purchase-requisitions/:id/approvers')
  @RequirePermissions('PR.CREATE')
  prApprovers(@Param('id', ParseIntPipe) id: number) {
    return this.svc.approvers('PR', id);
  }

  @Get('purchase-orders/:id/approvers')
  @RequirePermissions('PO.CREATE')
  poApprovers(@Param('id', ParseIntPipe) id: number) {
    return this.svc.approvers('PO', id);
  }

  @Post('purchase-requisitions/:id/submit')
  @HttpCode(204)
  @RequirePermissions('PR.CREATE')
  submitPr(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number, @Body() dto: SubmitDto) {
    return this.svc.submit('PR', id, req.user, dto.approverId);
  }

  @Post('purchase-requisitions/:id/approve')
  @HttpCode(204)
  @RequirePermissions('PR.APPROVE')
  approvePr(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number) {
    return this.svc.approve('PR', id, req.user);
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
  @RequirePermissions('PR.APPROVE')
  rejectPR(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number, @Body() dto: ReasonDto) {
    return this.svc.decide('PR', 'reject', id, req.user, dto.reason);
  }

  @Post('purchase-requisitions/:id/recall')
  @HttpCode(204)
  @RequirePermissions('PR.CREATE')
  recallPR(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number, @Body() dto: ReasonDto) {
    return this.svc.decide('PR', 'recall', id, req.user, dto.reason);
  }

  @Post('purchase-requisitions/:id/cancel')
  @HttpCode(204)
  @RequirePermissions('PR.CREATE')
  cancelPR(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number, @Body() dto: OptionalReasonDto) {
    return this.svc.decide('PR', 'cancel', id, req.user, dto.reason);
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
