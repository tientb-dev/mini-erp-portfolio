import { Body, Controller, Get, HttpCode, Param, ParseBoolPipe, ParseIntPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { AuthedRequest, RequirePermissions } from '../identity/auth';
import { OptionalReasonDto, ReasonDto, SourceLineDto, SubmitDto } from "../../common/dto";
import { InboundService } from './inbound.service';

class CreateGrrDto {
  @ApiProperty() @IsInt() purchaseOrderId!: number;
  @ApiProperty() @IsInt() warehouseId!: number;
  @ApiProperty({ type: [SourceLineDto] }) @ArrayNotEmpty() @ValidateNested({ each: true }) @Type(() => SourceLineDto) lines!: SourceLineDto[];
}
class CreateGrDto {
  @ApiProperty() @IsInt() goodsReceiptRequestId!: number;
}
class DetailDto {
  @ApiProperty() @IsInt() id!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) serialNumber?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) location?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) warrantyInfo?: string | null;
}
class UpdateDetailsDto {
  @ApiProperty() @IsInt() version!: number;
  @ApiProperty({ type: [DetailDto] }) @ValidateNested({ each: true }) @Type(() => DetailDto) details!: DetailDto[];
}

@ApiTags('inbound')
@ApiBearerAuth()
@Controller()
export class InboundController {
  constructor(private readonly svc: InboundService) {}

  @Post('goods-receipt-requests')
  @RequirePermissions('GRR.CREATE')
  createGrr(@Req() req: AuthedRequest, @Body() dto: CreateGrrDto) {
    return this.svc.createGrr(req.user, dto.purchaseOrderId, dto.warehouseId, dto.lines);
  }

  @Get('goods-receipt-requests')
  @RequirePermissions('GRR.VIEW')
  listGrrs(@Req() req: AuthedRequest, @Query('assignedToMe', new ParseBoolPipe({ optional: true })) mine?: boolean) {
    return this.svc.listGrrs(req.user, mine ?? false);
  }

  @Get('purchase-orders/:id/lines-available-for-grr')
  @RequirePermissions('GRR.CREATE')
  poLinesForGrr(@Param('id', ParseIntPipe) id: number) {
    return this.svc.poLinesAvailableForGrr(id);
  }

  @Get('goods-receipt-requests/available-for-gr')
  @RequirePermissions('GR.CREATE')
  grrsForGr(@Req() req: AuthedRequest) {
    return this.svc.grrsAvailableForGr(req.user);
  }

  @Get('goods-receipt-requests/:id')
  @RequirePermissions('GRR.VIEW')
  getGrr(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number) {
    return this.svc.getGrr(id, req.user);
  }

  @Post('goods-receipt-requests/:id/reject')
  @HttpCode(204)
  @RequirePermissions('GRR.APPROVE')
  rejectGrr(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number, @Body() dto: ReasonDto) {
    return this.svc.decideGrr('reject', id, req.user, dto.reason);
  }

  @Post('goods-receipt-requests/:id/recall')
  @HttpCode(204)
  @RequirePermissions('GRR.CREATE')
  recallGrr(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number, @Body() dto: ReasonDto) {
    return this.svc.decideGrr('recall', id, req.user, dto.reason);
  }

  @Post('goods-receipt-requests/:id/cancel')
  @HttpCode(204)
  @RequirePermissions('GRR.CREATE')
  cancelGrr(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number, @Body() dto: OptionalReasonDto) {
    return this.svc.decideGrr('cancel', id, req.user, dto.reason);
  }

  @Get('goods-receipt-requests/:id/approvers')
  @RequirePermissions('GRR.CREATE')
  grrApprovers(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number) {
    return this.svc.grrApprovers(id, req.user);
  }

  @Post('goods-receipt-requests/:id/submit')
  @HttpCode(204)
  @RequirePermissions('GRR.CREATE')
  submitGrr(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number, @Body() dto: SubmitDto) {
    return this.svc.submitGrr(id, req.user, dto.approverId);
  }

  @Post('goods-receipt-requests/:id/approve')
  @HttpCode(204)
  @RequirePermissions('GRR.APPROVE')
  approveGrr(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number) {
    return this.svc.approveGrr(id, req.user);
  }

  @Get('goods-receipts')
  @RequirePermissions('GR.VIEW')
  listGrs(@Req() req: AuthedRequest, @Query('assignedToMe', new ParseBoolPipe({ optional: true })) assignedToMe?: boolean) {
    return this.svc.listGrs(req.user, assignedToMe ?? false);
  }

  @Get('goods-receipts/:id')
  @RequirePermissions('GR.VIEW')
  getGr(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number) {
    return this.svc.getGr(id, req.user);
  }

  @Post('goods-receipts')
  @RequirePermissions('GR.CREATE')
  createGr(@Req() req: AuthedRequest, @Body() dto: CreateGrDto) {
    return this.svc.createGr(req.user, dto.goodsReceiptRequestId);
  }

  @Patch('goods-receipts/:id/details')
  @HttpCode(204)
  @RequirePermissions('GR.VIEW')
  updateDetails(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateDetailsDto) {
    return this.svc.updateGrDetails(id, req.user, dto.version, dto.details);
  }

  @Get('goods-receipts/:id/approvers')
  @RequirePermissions('GR.CREATE')
  grApprovers(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number) {
    return this.svc.grApprovers(id, req.user);
  }

  @Post('goods-receipts/:id/submit')
  @HttpCode(204)
  @RequirePermissions('GR.CREATE')
  submitGr(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number, @Body() dto: SubmitDto) {
    return this.svc.submitGr(id, req.user, dto.approverId);
  }

  @Post('goods-receipts/:id/approve')
  @HttpCode(204)
  @RequirePermissions('GR.APPROVE')
  approveGr(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number) {
    return this.svc.approveGr(id, req.user);
  }

  @Post('goods-receipts/:id/reject')
  @HttpCode(204)
  @RequirePermissions('GR.APPROVE')
  rejectGr(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number, @Body() dto: ReasonDto) {
    return this.svc.decideGr('reject', id, req.user, dto.reason);
  }

  @Post('goods-receipts/:id/recall')
  @HttpCode(204)
  @RequirePermissions('GR.CREATE')
  recallGr(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number, @Body() dto: ReasonDto) {
    return this.svc.decideGr('recall', id, req.user, dto.reason);
  }

  @Post('goods-receipts/:id/cancel')
  @HttpCode(204)
  @RequirePermissions('GR.CREATE')
  cancelGr(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number) {
    return this.svc.decideGr('cancel', id, req.user);
  }
}
