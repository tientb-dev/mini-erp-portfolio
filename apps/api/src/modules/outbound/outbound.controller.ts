import { Body, Controller, Get, HttpCode, Param, ParseBoolPipe, ParseIntPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsIn, IsInt, IsOptional, IsPositive, IsString, ValidateNested } from 'class-validator';
import { ReasonDto, SubmitDto } from "../../common/dto";
import { AuthedRequest, RequirePermissions } from '../identity/auth';
import { GiService } from './gi.service';
import { GirService, IssueType } from './gir.service';

class GirLineDto {
  @ApiPropertyOptional({ description: 'PURCHASE_REQUISITION (A/C): the PR line; product and HĐ line come from it' }) @IsOptional() @IsInt() purchaseRequisitionLineId?: number;
  @ApiPropertyOptional({ description: 'AVAILABLE_STOCK: HĐ line' }) @IsOptional() @IsInt() salesContractLineId?: number;
  @ApiPropertyOptional({ description: 'AVAILABLE_STOCK: product' }) @IsOptional() @IsInt() productId?: number;
  @ApiProperty() @IsPositive() quantity!: number;
}
class CreateGirDto {
  @ApiProperty({ enum: ['PURCHASE_REQUISITION', 'AVAILABLE_STOCK'] }) @IsIn(['PURCHASE_REQUISITION', 'AVAILABLE_STOCK']) issueType!: IssueType;
  @ApiProperty() @IsInt() salesContractId!: number;
  @ApiProperty() @IsInt() warehouseId!: number;
  @ApiProperty({ type: [GirLineDto] }) @ArrayNotEmpty() @ValidateNested({ each: true }) @Type(() => GirLineDto) lines!: GirLineDto[];
}
class UpdateGirDto {
  @ApiProperty() @IsInt() version!: number;
  @ApiProperty({ type: [GirLineDto] }) @ArrayNotEmpty() @ValidateNested({ each: true }) @Type(() => GirLineDto) lines!: GirLineDto[];
}
class SubmitGirDto {
  @ApiProperty({ description: 'PURCHASE_REQUISITION: approver; AVAILABLE_STOCK: Sales confirmer' }) @IsInt() approverId!: number;
  @ApiPropertyOptional({ description: 'AVAILABLE_STOCK only: warehouse manager' }) @IsOptional() @IsInt() warehouseApproverId?: number;
}
class CompleteDto {
  @ApiPropertyOptional({ description: 'Required when issued < requested' }) @IsOptional() @IsString() reason?: string;
}
class GiLineDto {
  @ApiProperty() @IsInt() goodsIssueRequestLineId!: number;
  @ApiProperty() @IsPositive() quantity!: number;
  @ApiPropertyOptional({ type: [Number] }) @IsOptional() @IsArray() @IsInt({ each: true }) goodsReceiptDetailIds?: number[];
}
class CreateGiDto {
  @ApiProperty() @IsInt() goodsIssueRequestId!: number;
  @ApiProperty({ type: [GiLineDto] }) @ArrayNotEmpty() @ValidateNested({ each: true }) @Type(() => GiLineDto) lines!: GiLineDto[];
}
class UpdateGiDto {
  @ApiProperty() @IsInt() version!: number;
  @ApiProperty({ type: [GiLineDto] }) @ArrayNotEmpty() @ValidateNested({ each: true }) @Type(() => GiLineDto) lines!: GiLineDto[];
}

@ApiTags('outbound')
@ApiBearerAuth()
@Controller()
export class OutboundController {
  constructor(private readonly gir: GirService, private readonly gi: GiService) {}

  // ---------- GIR ----------

  @Get('goods-issue-requests')
  @RequirePermissions('GIR.VIEW')
  listGirs(@Req() req: AuthedRequest, @Query('assignedToMe', new ParseBoolPipe({ optional: true })) assignedToMe?: boolean) {
    return this.gir.list(req.user, assignedToMe ?? false);
  }

  @Get('goods-issue-requests/:id')
  @RequirePermissions('GIR.VIEW')
  getGir(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number) {
    return this.gir.get(req.user, id);
  }

  @Get('sales-contracts/:id/gir-quota')
  @RequirePermissions('GIR.VIEW')
  quota(@Param('id', ParseIntPipe) id: number, @Query('excludeGirId') exclude?: string) {
    return this.gir.quota(id, exclude ? Number(exclude) : undefined);
  }

  /** A/C picker: lines of the HĐ's PO-done PRs with PR-line quota left and received quantity (reference). */
  @Get('sales-contracts/:id/gir-pr-lines')
  @RequirePermissions('GIR.CREATE')
  prLineOptions(@Param('id', ParseIntPipe) id: number, @Query('excludeGirId') exclude?: string) {
    return this.gir.prLineOptions(id, exclude ? Number(exclude) : undefined);
  }

  @Post('goods-issue-requests')
  @RequirePermissions('GIR.CREATE')
  createGir(@Req() req: AuthedRequest, @Body() dto: CreateGirDto) {
    return this.gir.create(req.user, dto);
  }

  @Patch('goods-issue-requests/:id')
  @HttpCode(204)
  @RequirePermissions('GIR.CREATE')
  updateGir(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateGirDto) {
    return this.gir.update(req.user, id, dto.version, dto.lines);
  }

  @Get('goods-issue-requests/:id/approvers')
  @RequirePermissions('GIR.CREATE')
  girApprovers(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number) {
    return this.gir.approvers(req.user, id);
  }

  @Post('goods-issue-requests/:id/submit')
  @HttpCode(204)
  @RequirePermissions('GIR.CREATE')
  submitGir(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number, @Body() dto: SubmitGirDto) {
    return this.gir.submit(req.user, id, dto.approverId, dto.warehouseApproverId);
  }

  /** Step permission (GIR.SALES_CONFIRM / GIR.APPROVE) and assigned approver are checked in the service. */
  @Post('goods-issue-requests/:id/approve')
  @HttpCode(204)
  @RequirePermissions('GIR.VIEW')
  approveGir(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number) {
    return this.gir.approve(req.user, id);
  }

  @Post('goods-issue-requests/:id/reject')
  @HttpCode(204)
  @RequirePermissions('GIR.VIEW')
  rejectGir(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number, @Body() dto: ReasonDto) {
    return this.gir.reject(req.user, id, dto.reason);
  }

  @Post('goods-issue-requests/:id/recall')
  @HttpCode(204)
  @RequirePermissions('GIR.CREATE')
  recallGir(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number, @Body() dto: ReasonDto) {
    return this.gir.recall(req.user, id, dto.reason);
  }

  @Post('goods-issue-requests/:id/cancel')
  @HttpCode(204)
  @RequirePermissions('GIR.CREATE')
  cancelGir(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number) {
    return this.gir.cancel(req.user, id);
  }

  @Post('goods-issue-requests/:id/complete')
  @HttpCode(204)
  @RequirePermissions('GIR.COMPLETE')
  complete(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number, @Body() dto: CompleteDto) {
    return this.gir.complete(req.user, id, dto.reason);
  }

  // ---------- GI ----------

  @Get('goods-issues')
  @RequirePermissions('GI.VIEW')
  listGis(@Req() req: AuthedRequest, @Query('assignedToMe', new ParseBoolPipe({ optional: true })) assignedToMe?: boolean) {
    return this.gi.list(req.user, assignedToMe ?? false);
  }

  @Get('goods-issues/:id')
  @RequirePermissions('GI.VIEW')
  getGi(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number) {
    return this.gi.get(req.user, id);
  }

  @Get('goods-issue-request-lines/:id/available-serials')
  @RequirePermissions('GI.CREATE')
  availableSerials(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number) {
    return this.gi.availableSerials(req.user, id);
  }

  @Post('goods-issues')
  @RequirePermissions('GI.CREATE')
  createGi(@Req() req: AuthedRequest, @Body() dto: CreateGiDto) {
    return this.gi.create(req.user, dto.goodsIssueRequestId, dto.lines);
  }

  @Patch('goods-issues/:id')
  @HttpCode(204)
  @RequirePermissions('GI.CREATE')
  updateGi(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateGiDto) {
    return this.gi.update(req.user, id, dto.version, dto.lines);
  }

  @Get('goods-issues/:id/approvers')
  @RequirePermissions('GI.CREATE')
  giApprovers(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number) {
    return this.gi.approvers(req.user, id);
  }

  @Post('goods-issues/:id/submit')
  @HttpCode(204)
  @RequirePermissions('GI.CREATE')
  submitGi(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number, @Body() dto: SubmitDto) {
    return this.gi.submit(req.user, id, dto.approverId);
  }

  @Post('goods-issues/:id/approve')
  @HttpCode(204)
  @RequirePermissions('GI.APPROVE')
  approveGi(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number) {
    return this.gi.approve(req.user, id);
  }

  @Post('goods-issues/:id/reject')
  @HttpCode(204)
  @RequirePermissions('GI.APPROVE')
  rejectGi(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number, @Body() dto: ReasonDto) {
    return this.gi.decide('reject', req.user, id, dto.reason);
  }

  @Post('goods-issues/:id/recall')
  @HttpCode(204)
  @RequirePermissions('GI.CREATE')
  recallGi(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number, @Body() dto: ReasonDto) {
    return this.gi.decide('recall', req.user, id, dto.reason);
  }

  @Post('goods-issues/:id/cancel')
  @HttpCode(204)
  @RequirePermissions('GI.CREATE')
  cancelGi(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number) {
    return this.gi.decide('cancel', req.user, id);
  }
}
