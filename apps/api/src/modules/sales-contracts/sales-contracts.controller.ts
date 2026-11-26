import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsNotEmpty, IsOptional, IsPositive, IsString, MaxLength, Max, Min, ValidateNested } from 'class-validator';
import { AuthedRequest, RequirePermissions } from '../identity/auth';
import { SalesContractsService } from './sales-contracts.service';

class LineFieldsDto {
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsInt() @Min(1) productId?: number | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsInt() @Min(1) temporaryProductId?: number | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() itemDescription?: string | null;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(100) itemCode!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(300) itemName!: string;
  @ApiProperty({ description: 'units_of_measure.id' }) @IsInt() unitOfMeasureId!: number;
  @ApiProperty() @IsPositive() quantity!: number;
}
class ScLineDto extends LineFieldsDto {
  @ApiPropertyOptional({ description: 'Existing line id when editing; omit for a new line' }) @IsOptional() @IsInt() id?: number;
}
/** One line saved on its own; `version` is the contract version the user saw (stale → 409). */
class SaveLineDto extends LineFieldsDto {
  @ApiProperty() @IsInt() version!: number;
}
class CreateScDto {
  @ApiProperty() @IsInt() customerId!: number;
  @ApiPropertyOptional({ nullable: true, description: 'Responsible sales; required before activation, editable only while DRAFT. On PATCH: omit to keep, null to clear' })
  @IsOptional() @IsInt() responsibleSalesUserId?: number | null;
  @ApiPropertyOptional({ type: [ScLineDto], description: 'Optional: a DRAFT may start without lines. On PATCH: omit to keep the lines' })
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ScLineDto) lines?: ScLineDto[];
}
class UpdateScDto extends CreateScDto {
  @ApiProperty() @IsInt() version!: number;
}
class ScListQueryDto {
  @ApiPropertyOptional({ description: 'Contract number or customer name contains' }) @IsOptional() @IsString() q?: string;
  @ApiPropertyOptional({ enum: ['DRAFT', 'ACTIVE', 'CANCELED'] }) @IsOptional() @IsIn(['DRAFT', 'ACTIVE', 'CANCELED']) status?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() responsibleSalesUserId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() customerId?: number;
  @ApiPropertyOptional({ enum: ['createdAt', 'documentNumber'] }) @IsOptional() @IsIn(['createdAt', 'documentNumber']) sort?: 'createdAt' | 'documentNumber';
  @ApiPropertyOptional({ enum: ['asc', 'desc'] }) @IsOptional() @IsIn(['asc', 'desc']) order?: 'asc' | 'desc';
  @ApiPropertyOptional({ description: 'With page the response is { items, total }' }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
}
class ProposeDto {
  @ApiProperty() @IsInt() productId!: number;
  @ApiProperty() @IsString() @IsNotEmpty() reason!: string;
}
class DecideDto {
  @ApiPropertyOptional({ description: 'Note or appendix number' }) @IsOptional() @IsString() note?: string;
}

@ApiTags('sales-contracts')
@ApiBearerAuth()
@Controller()
export class SalesContractsController {
  constructor(private readonly svc: SalesContractsService) {}

  @Get('sales-contracts')
  @RequirePermissions('SALES_CONTRACT.VIEW')
  list(@Query() query: ScListQueryDto) {
    return this.svc.list(query);
  }

  @Post('sales-contracts')
  @RequirePermissions('SALES_CONTRACT.CREATE')
  create(@Req() req: AuthedRequest, @Body() dto: CreateScDto) {
    return this.svc.create(req.user, dto.customerId, dto.responsibleSalesUserId ?? null, dto.lines ?? []);
  }

  @Post('sales-contracts/:id/lines')
  @RequirePermissions('SALES_CONTRACT.CREATE')
  addLine(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number, @Body() dto: SaveLineDto) {
    return this.svc.addLine(req.user, id, dto.version, dto);
  }

  @Patch('sales-contract-lines/:id')
  @HttpCode(204)
  @RequirePermissions('SALES_CONTRACT.CREATE')
  editLine(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number, @Body() dto: SaveLineDto) {
    return this.svc.editLine(req.user, id, dto.version, dto);
  }

  @Delete('sales-contract-lines/:id')
  @HttpCode(204)
  @RequirePermissions('SALES_CONTRACT.CREATE')
  deleteLine(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number, @Query('version', ParseIntPipe) version: number) {
    return this.svc.deleteLine(req.user, id, version);
  }

  @Get('sales-contracts/responsible-sales-candidates')
  @RequirePermissions('SALES_CONTRACT.CREATE')
  responsibleSalesCandidates() {
    return this.svc.responsibleSalesCandidates();
  }

  @Patch('sales-contracts/:id')
  @HttpCode(204)
  @RequirePermissions('SALES_CONTRACT.CREATE')
  update(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateScDto) {
    return this.svc.update(req.user, id, dto.version, dto.customerId, dto.responsibleSalesUserId, dto.lines);
  }

  @Post('sales-contracts/:id/activate')
  @HttpCode(204)
  @RequirePermissions('SALES_CONTRACT.CREATE')
  activate(@Param('id', ParseIntPipe) id: number) {
    return this.svc.activate(id);
  }

  @Get('sales-contracts/:id')
  @RequirePermissions('SALES_CONTRACT.VIEW')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.svc.get(id);
  }

  @Post('sales-contracts/:id/cancel')
  @HttpCode(204)
  @RequirePermissions('SALES_CONTRACT.CREATE')
  cancel(@Param('id', ParseIntPipe) id: number) {
    return this.svc.cancel(id);
  }

  @Get('sales-contracts/:id/lines')
  @RequirePermissions('SALES_CONTRACT.VIEW')
  lines(@Param('id', ParseIntPipe) id: number) {
    return this.svc.lines(id);
  }

  @Post('sales-contract-lines/:id/product-proposals')
  @RequirePermissions('SALES_CONTRACT.PROPOSE_PRODUCT')
  propose(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number, @Body() dto: ProposeDto) {
    return this.svc.propose(req.user, id, dto.productId, dto.reason);
  }

  @Post('product-proposals/:id/approve')
  @HttpCode(204)
  @RequirePermissions('SALES_CONTRACT.CONFIRM_PRODUCT')
  approve(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number, @Body() dto: DecideDto) {
    return this.svc.decide(req.user, id, true, dto.note);
  }

  @Post('product-proposals/:id/reject')
  @HttpCode(204)
  @RequirePermissions('SALES_CONTRACT.CONFIRM_PRODUCT')
  reject(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number, @Body() dto: DecideDto) {
    return this.svc.decide(req.user, id, false, dto.note);
  }
}
