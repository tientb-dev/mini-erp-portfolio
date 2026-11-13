import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsInt, IsNotEmpty, IsOptional, IsPositive, IsString, ValidateNested } from 'class-validator';
import { AuthedRequest, RequirePermissions } from '../identity/auth';
import { SalesContractsService } from './sales-contracts.service';

class ScLineDto {
  @ApiProperty() @IsString() @IsNotEmpty() itemCode!: string;
  @ApiProperty() @IsString() @IsNotEmpty() itemName!: string;
  @ApiProperty() @IsString() @IsNotEmpty() uomName!: string;
  @ApiProperty() @IsPositive() quantity!: number;
}
class CreateScDto {
  @ApiProperty() @IsInt() customerId!: number;
  @ApiProperty({ type: [ScLineDto] }) @ArrayNotEmpty() @ValidateNested({ each: true }) @Type(() => ScLineDto) lines!: ScLineDto[];
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
  list() {
    return this.svc.list();
  }

  @Post('sales-contracts')
  @RequirePermissions('SALES_CONTRACT.CREATE')
  create(@Req() req: AuthedRequest, @Body() dto: CreateScDto) {
    return this.svc.create(req.user, dto.customerId, dto.lines);
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
