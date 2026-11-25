import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, NotFoundException, Param, ParseIntPipe, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { DataSource, EntityManager } from 'typeorm';
import { AuthedRequest, RequirePermissions } from '../identity/auth';
import { CatalogFacade } from './catalog.facade';
import { CatalogSelectionDto, selectionFilter, selectionParams, StatusDto, updateCatalogStatus } from './catalog-status';
import { BusinessError } from '../workflow/workflow';

class CatalogEntryDto {
  @ApiProperty() @IsString() @Matches(/\S/) @MaxLength(300) name!: string;
}

class BrandDto extends CatalogEntryDto {
  @ApiProperty() @IsString() @Matches(/\S/) @MaxLength(50) code!: string;
}
class UpdateBrandDto extends BrandDto {
  @ApiPropertyOptional() @IsOptional() @IsArray() @ArrayUnique() @IsInt({ each: true }) @Min(1, { each: true })
  supplierIds?: number[];
}
class TemporaryProductDto extends CatalogEntryDto {
  @ApiProperty() @IsString() @Matches(/\S/) @MaxLength(100) code!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
}
class CurrencyDto extends CatalogEntryDto {
  @ApiProperty() @IsString() @Matches(/^[A-Z]{3}$/) code!: string;
  @ApiProperty() @IsString() @Matches(/^\d{1,12}(\.\d{1,8})?$/) exchangeRate!: string;
  @ApiProperty() @IsInt() @Min(0) @Max(8) decimalPlaces!: number;
}
class TaxRateDto extends BrandDto {
  @ApiProperty() @IsString() @Matches(/^\d{1,3}(\.\d{1,4})?$/) rate!: string;
}
class BrandSuppliersDto {
  @ApiProperty() @IsArray() @ArrayUnique() @IsInt({ each: true }) @Min(1, { each: true }) supplierIds!: number[];
}

@ApiTags('master-data')
@ApiBearerAuth()
@Controller()
export class PrCatalogController {
  constructor(private readonly ds: DataSource) {}

  @Get('brands')
  @RequirePermissions('PRODUCT.VIEW')
  listBrand(@Query() query: CatalogSelectionDto) {
    return this.ds.query(`SELECT id, code, name, is_active AS "isActive" FROM brands
      WHERE ${selectionFilter} ORDER BY code`, selectionParams(query));
  }

  @Patch('brands/:id/status')
  @HttpCode(204)
  @RequirePermissions('PROCUREMENT_CATALOG.MANAGE')
  setBrandStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: StatusDto) {
    return updateCatalogStatus(this.ds.manager, 'brands', id, dto.isActive);
  }

  @Post('brands')
  @RequirePermissions('PROCUREMENT_CATALOG.MANAGE')
  createBrand(@Body() dto: BrandDto) {
    return this.saveBrand(dto);
  }

  @Patch('brands/:id')
  @RequirePermissions('PROCUREMENT_CATALOG.MANAGE')
  updateBrand(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateBrandDto, @Req() request: AuthedRequest) {
    if (dto.supplierIds && !request.user.permissions.includes('SUPPLIER.VIEW')) throw new ForbiddenException();
    return this.ds.transaction(async m => {
      const [[brand]] = await m.query('UPDATE brands SET code = $2, name = $3 WHERE id = $1 RETURNING id, code, name',
        [id, dto.code.trim(), dto.name.trim()]);
      if (!brand) throw new NotFoundException();
      if (dto.supplierIds) await this.replaceBrandSuppliers(m, id, dto.supplierIds);
      return brand;
    });
  }

  private async saveBrand(dto: BrandDto) {
    const [row] = await this.ds.query('INSERT INTO brands (code, name) VALUES ($1, $2) RETURNING id, code, name',
      [dto.code.trim(), dto.name.trim()]);
    return row;
  }

  @Get('temporary-products')
  @RequirePermissions('PRODUCT.VIEW')
  listTemporaryProduct(@Query() query: CatalogSelectionDto) {
    return this.ds.query(`SELECT id, code, name, description, is_active AS "isActive" FROM temporary_products
      WHERE ${selectionFilter} ORDER BY code`, selectionParams(query));
  }

  @Patch('temporary-products/:id/status')
  @HttpCode(204)
  @RequirePermissions('PROCUREMENT_CATALOG.MANAGE')
  setTemporaryProductStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: StatusDto) {
    return updateCatalogStatus(this.ds.manager, 'temporary_products', id, dto.isActive);
  }

  @Post('temporary-products')
  @RequirePermissions('PROCUREMENT_CATALOG.MANAGE')
  createTemporaryProduct(@Body() dto: TemporaryProductDto) {
    return this.saveTemporaryProduct(dto);
  }

  @Patch('temporary-products/:id')
  @RequirePermissions('PROCUREMENT_CATALOG.MANAGE')
  updateTemporaryProduct(@Param('id', ParseIntPipe) id: number, @Body() dto: TemporaryProductDto) {
    return this.saveTemporaryProduct(dto, id);
  }

  private async saveTemporaryProduct(dto: TemporaryProductDto, id?: number) {
    const values = [dto.code.trim(), dto.name.trim(), dto.description ?? null];
    if (id === undefined) {
      const [row] = await this.ds.query(`INSERT INTO temporary_products (code, name, description)
        VALUES ($1, $2, $3) RETURNING id, code, name, description`, values);
      return row;
    }
    const [[row]] = await this.ds.query(`UPDATE temporary_products SET code = $1, name = $2, description = $3
      WHERE id = $4 RETURNING id, code, name, description`, [...values, id]);
    if (!row) throw new NotFoundException();
    return row;
  }

  @Get('currencies')
  @RequirePermissions('PRODUCT.VIEW')
  listCurrency(@Query() query: CatalogSelectionDto) {
    return this.ds.query(`SELECT id, code, name, exchange_rate AS "exchangeRate", decimal_places AS "decimalPlaces", is_active AS "isActive" FROM currencies
      WHERE ${selectionFilter} ORDER BY code`, selectionParams(query));
  }

  @Patch('currencies/:id/status')
  @HttpCode(204)
  @RequirePermissions('PROCUREMENT_CATALOG.MANAGE')
  setCurrencyStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: StatusDto) {
    return updateCatalogStatus(this.ds.manager, 'currencies', id, dto.isActive);
  }

  @Post('currencies')
  @RequirePermissions('PROCUREMENT_CATALOG.MANAGE')
  createCurrency(@Body() dto: CurrencyDto) {
    return this.saveCurrency(dto);
  }

  @Patch('currencies/:id')
  @RequirePermissions('PROCUREMENT_CATALOG.MANAGE')
  updateCurrency(@Param('id', ParseIntPipe) id: number, @Body() dto: CurrencyDto) {
    return this.saveCurrency(dto, id);
  }

  private async saveCurrency(dto: CurrencyDto, id?: number) {
    if (Number(dto.exchangeRate) <= 0 || (dto.code === 'VND' && Number(dto.exchangeRate) !== 1)) {
      throw new BusinessError('INVALID_EXCHANGE_RATE', 'Exchange rate must be positive and equal to 1 for VND');
    }
    const values = [dto.code.trim(), dto.name.trim(), dto.exchangeRate, dto.decimalPlaces];
    if (id === undefined) {
      const [row] = await this.ds.query(`INSERT INTO currencies (code, name, exchange_rate, decimal_places)
        VALUES ($1, $2, $3, $4) RETURNING id, code, name, exchange_rate AS "exchangeRate", decimal_places AS "decimalPlaces"`, values);
      return row;
    }
    const [[row]] = await this.ds.query(`UPDATE currencies SET code = $1, name = $2, exchange_rate = $3, decimal_places = $4
      WHERE id = $5 AND (code = 'VND') = ($1 = 'VND') RETURNING id, code, name, exchange_rate AS "exchangeRate", decimal_places AS "decimalPlaces"`, [...values, id]);
    if (!row) throw new NotFoundException();
    return row;
  }

  @Get('tax-rates')
  @RequirePermissions('PRODUCT.VIEW')
  listTaxRate(@Query() query: CatalogSelectionDto) {
    return this.ds.query(`SELECT id, code, name, rate, is_active AS "isActive" FROM tax_rates
      WHERE ${selectionFilter} ORDER BY code`, selectionParams(query));
  }

  @Patch('tax-rates/:id/status')
  @HttpCode(204)
  @RequirePermissions('PROCUREMENT_CATALOG.MANAGE')
  setTaxRateStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: StatusDto) {
    return updateCatalogStatus(this.ds.manager, 'tax_rates', id, dto.isActive);
  }

  @Post('tax-rates')
  @RequirePermissions('PROCUREMENT_CATALOG.MANAGE')
  createTaxRate(@Body() dto: TaxRateDto) {
    return this.saveTaxRate(dto);
  }

  @Patch('tax-rates/:id')
  @RequirePermissions('PROCUREMENT_CATALOG.MANAGE')
  updateTaxRate(@Param('id', ParseIntPipe) id: number, @Body() dto: TaxRateDto) {
    return this.saveTaxRate(dto, id);
  }

  private async saveTaxRate(dto: TaxRateDto, id?: number) {
    if (Number(dto.rate) > 100) throw new BusinessError('INVALID_TAX_RATE', 'Tax rate must be between 0 and 100');
    const values = [dto.code.trim(), dto.name.trim(), dto.rate];
    if (id === undefined) {
      const [row] = await this.ds.query(`INSERT INTO tax_rates (code, name, rate)
        VALUES ($1, $2, $3) RETURNING id, code, name, rate`, values);
      return row;
    }
    const [[row]] = await this.ds.query(`UPDATE tax_rates SET code = $1, name = $2, rate = $3
      WHERE id = $4 RETURNING id, code, name, rate`, [...values, id]);
    if (!row) throw new NotFoundException();
    return row;
  }

  @Delete('brands/:id')
  @HttpCode(204)
  @RequirePermissions('PROCUREMENT_CATALOG.MANAGE')
  async deleteBrands(@Param('id', ParseIntPipe) id: number) {
    const [[item]] = await this.ds.query('DELETE FROM brands WHERE id = $1 RETURNING id', [id]);
    if (!item) throw new NotFoundException();
  }

  @Delete('temporary-products/:id')
  @HttpCode(204)
  @RequirePermissions('PROCUREMENT_CATALOG.MANAGE')
  async deleteTemporaryProducts(@Param('id', ParseIntPipe) id: number) {
    const [[item]] = await this.ds.query('DELETE FROM temporary_products WHERE id = $1 RETURNING id', [id]);
    if (!item) throw new NotFoundException();
  }

  @Delete('currencies/:id')
  @HttpCode(204)
  @RequirePermissions('PROCUREMENT_CATALOG.MANAGE')
  async deleteCurrencies(@Param('id', ParseIntPipe) id: number) {
    const [[item]] = await this.ds.query('DELETE FROM currencies WHERE id = $1 AND code <> \'VND\' RETURNING id', [id]);
    if (!item) throw new NotFoundException();
  }

  @Delete('tax-rates/:id')
  @HttpCode(204)
  @RequirePermissions('PROCUREMENT_CATALOG.MANAGE')
  async deleteTaxRates(@Param('id', ParseIntPipe) id: number) {
    const [[item]] = await this.ds.query('DELETE FROM tax_rates WHERE id = $1 RETURNING id', [id]);
    if (!item) throw new NotFoundException();
  }

  @Get('brands/:id/suppliers')
  @RequirePermissions('SUPPLIER.VIEW')
  listBrandSuppliers(@Param('id', ParseIntPipe) id: number) {
    return this.ds.query(`SELECT s.id, s.code, s.name FROM suppliers s
      JOIN brand_suppliers bs ON bs.supplier_id = s.id WHERE bs.brand_id = $1 ORDER BY s.code`, [id]);
  }

  @Put('brands/:id/suppliers')
  @HttpCode(204)
  @RequirePermissions('PROCUREMENT_CATALOG.MANAGE', 'SUPPLIER.VIEW')
  setBrandSuppliers(@Param('id', ParseIntPipe) id: number, @Body() dto: BrandSuppliersDto) {
    return this.ds.transaction(async m => {
      const [brand] = await m.query('SELECT id FROM brands WHERE id = $1 FOR UPDATE', [id]);
      if (!brand) throw new NotFoundException();
      await this.replaceBrandSuppliers(m, id, dto.supplierIds);
    });
  }

  private async replaceBrandSuppliers(m: EntityManager, id: number, supplierIds: number[]) {
    const linked: { supplier_id: number }[] = await m.query('SELECT supplier_id FROM brand_suppliers WHERE brand_id = $1', [id]);
    const previous = new Set(linked.map(row => row.supplier_id));
    for (const supplierId of [...supplierIds].sort((a, b) => a - b)) {
      if (!previous.has(supplierId)) await CatalogFacade.assertActive(m, 'supplier', supplierId);
    }
    await m.query('DELETE FROM brand_suppliers WHERE brand_id = $1', [id]);
    await m.query('INSERT INTO brand_suppliers (brand_id, supplier_id) SELECT $1, unnest($2::int[])', [id, supplierIds]);
  }
}
