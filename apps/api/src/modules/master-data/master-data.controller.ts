import { Body, Controller, Get, HttpCode, NotFoundException, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';
import { FindOptionsWhere, Repository } from 'typeorm';
import { CodeNameDto } from "../../common/dto";
import { RequirePermissions } from '../identity/auth';
import { Product, UnitOfMeasure, Warehouse } from './master-data.entities';
import { CatalogFacade } from './catalog.facade';
import { assertWarehouseCanDeactivate, CatalogSelectionDto, selectionFilter, selectionParams, StatusDto, updateCatalogStatus } from './catalog-status';
import { ProductUsage } from './product-usage';

class UomDto {
  @ApiProperty() @IsString() @Matches(/\S/) @MaxLength(20) code!: string;
  @ApiProperty() @IsString() @Matches(/\S/) @MaxLength(100) name!: string;
}

class CreateProductDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(100) partNumber!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(300) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiProperty() @IsInt() @Min(1) brandId!: number;
  @ApiProperty() @IsInt() unitOfMeasureId!: number;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() isSerialTracked?: boolean;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() isActive?: boolean;
}
class UpdateProductDto extends PartialType(CreateProductDto, { skipNullProperties: false }) {}

class CreateWarehouseDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(50) code!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) name!: string;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() allowAvailableStockIssue?: boolean;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() isActive?: boolean;
}
class UpdateWarehouseDto extends PartialType(CreateWarehouseDto) {}

function selectionWhere<T extends { id: number; isActive: boolean }>(query: CatalogSelectionDto) {
  if (!query.activeOnly) return undefined;
  const where = [{ isActive: true }];
  return (query.includeId ? [...where, { id: query.includeId }] : where) as FindOptionsWhere<T>[];
}

@ApiTags('master-data')
@ApiBearerAuth()
@Controller()
export class MasterDataController {
  constructor(
    @InjectRepository(Product) private readonly products: Repository<Product>,
    @InjectRepository(Warehouse) private readonly warehouses: Repository<Warehouse>,
    @InjectRepository(UnitOfMeasure) private readonly uoms: Repository<UnitOfMeasure>,
  ) {}

  @Get('units-of-measure')
  @RequirePermissions('PRODUCT.VIEW')
  listUoms(@Query() query: CatalogSelectionDto) {
    return this.uoms.find({ where: selectionWhere<UnitOfMeasure>(query), order: { code: 'ASC' } });
  }

  @Post('units-of-measure')
  @RequirePermissions('UOM.MANAGE')
  createUom(@Body() dto: UomDto) {
    return this.uoms.save(this.uoms.create({ code: dto.code.trim(), name: dto.name.trim() }));
  }

  @Patch('units-of-measure/:id')
  @HttpCode(204)
  @RequirePermissions('UOM.MANAGE')
  async updateUom(@Param('id', ParseIntPipe) id: number, @Body() dto: UomDto) {
    const result = await this.uoms.update(id, { code: dto.code.trim(), name: dto.name.trim() });
    if (!result.affected) throw new NotFoundException();
  }

  @Patch('units-of-measure/:id/status')
  @HttpCode(204)
  @RequirePermissions('UOM.MANAGE')
  setUomStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: StatusDto) {
    return updateCatalogStatus(this.uoms.manager, 'units_of_measure', id, dto.isActive);
  }

  @Get('products')
  @RequirePermissions('PRODUCT.VIEW')
  listProducts(@Query() query: CatalogSelectionDto) {
    return this.products.find({ where: selectionWhere<Product>(query), relations: { unitOfMeasure: true }, order: { partNumber: 'ASC' } });
  }

  @Post('products')
  @RequirePermissions('PRODUCT.CREATE')
  createProduct(@Body() dto: CreateProductDto) {
    return this.products.manager.transaction(async m => {
      await CatalogFacade.assertActive(m, 'brand', dto.brandId);
      await CatalogFacade.assertActive(m, 'uom', dto.unitOfMeasureId);
      return m.getRepository(Product).save(m.getRepository(Product).create(dto));
    });
  }

  @Patch('products/:id')
  @RequirePermissions('PRODUCT.UPDATE')
  updateProduct(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateProductDto) {
    return this.products.manager.transaction(async (m) => {
      // Serialize identity edits and status changes with document references.
      const product = await m.getRepository(Product).findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!product) throw new NotFoundException();
      ProductUsage.assertEditable(product, dto);
      const reactivating = dto.isActive === true && !product.isActive;
      if (reactivating || (dto.brandId !== undefined && dto.brandId !== product.brandId)) {
        await CatalogFacade.assertActive(m, 'brand', dto.brandId ?? product.brandId);
      }
      if (reactivating || (dto.unitOfMeasureId !== undefined && dto.unitOfMeasureId !== product.unitOfMeasureId)) {
        await CatalogFacade.assertActive(m, 'uom', dto.unitOfMeasureId ?? product.unitOfMeasureId);
      }
      return m.getRepository(Product).save(m.getRepository(Product).merge(product, dto));
    });
  }

  @Patch('products/:id/status')
  @RequirePermissions('PRODUCT.UPDATE')
  updateProductStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: StatusDto) {
    return this.updateProduct(id, dto);
  }

  @Get('customers')
  @RequirePermissions('CUSTOMER.VIEW')
  listCustomers(@Query() query: CatalogSelectionDto) {
    return this.products.manager.query(`SELECT id, code, name, is_active AS "isActive" FROM customers
      WHERE ${selectionFilter} ORDER BY code`, selectionParams(query));
  }

  @Patch('customers/:id/status')
  @HttpCode(204)
  @RequirePermissions('CUSTOMER.UPDATE')
  setCustomersStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: StatusDto) {
    return updateCatalogStatus(this.products.manager, 'customers', id, dto.isActive);
  }

  @Get('suppliers')
  @RequirePermissions('SUPPLIER.VIEW')
  listSuppliers(@Query() query: CatalogSelectionDto) {
    return this.products.manager.query(`SELECT id, code, name, is_active AS "isActive" FROM suppliers
      WHERE ${selectionFilter} ORDER BY code`, selectionParams(query));
  }

  @Patch('suppliers/:id/status')
  @HttpCode(204)
  @RequirePermissions('SUPPLIER.UPDATE')
  setSuppliersStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: StatusDto) {
    return updateCatalogStatus(this.products.manager, 'suppliers', id, dto.isActive);
  }

  @Post("customers")
  @RequirePermissions("CUSTOMER.CREATE")
  async createCustomer(@Body() dto: CodeNameDto) {
    const [row] = await this.products.manager.query(`INSERT INTO customers (code, name) VALUES ($1, $2) RETURNING id`, [dto.code.trim(), dto.name.trim()]);
    return row;
  }

  @Post("suppliers")
  @RequirePermissions("SUPPLIER.CREATE")
  async createSupplier(@Body() dto: CodeNameDto) {
    const [row] = await this.products.manager.query(`INSERT INTO suppliers (code, name) VALUES ($1, $2) RETURNING id`, [dto.code.trim(), dto.name.trim()]);
    return row;
  }

  @Patch('customers/:id')
  @HttpCode(204)
  @RequirePermissions('CUSTOMER.UPDATE')
  async updateCustomer(@Param('id', ParseIntPipe) id: number, @Body() dto: CodeNameDto) {
    const [, count] = await this.products.manager.query(
      'UPDATE customers SET code = $2, name = $3 WHERE id = $1', [id, dto.code.trim(), dto.name.trim()],
    );
    if (!count) throw new NotFoundException();
  }

  @Patch('suppliers/:id')
  @HttpCode(204)
  @RequirePermissions('SUPPLIER.UPDATE')
  async updateSupplier(@Param('id', ParseIntPipe) id: number, @Body() dto: CodeNameDto) {
    const [, count] = await this.products.manager.query(
      'UPDATE suppliers SET code = $2, name = $3 WHERE id = $1', [id, dto.code.trim(), dto.name.trim()],
    );
    if (!count) throw new NotFoundException();
  }

  @Get('warehouses')
  @RequirePermissions('WAREHOUSE.VIEW')
  listWarehouses(@Query() query: CatalogSelectionDto) {
    return this.warehouses.find({ where: selectionWhere<Warehouse>(query), order: { code: 'ASC' } });
  }

  @Post('warehouses')
  @RequirePermissions('WAREHOUSE.CREATE')
  createWarehouse(@Body() dto: CreateWarehouseDto) {
    return this.warehouses.save(this.warehouses.create(dto));
  }

  @Patch('warehouses/:id')
  @RequirePermissions('WAREHOUSE.UPDATE')
  async updateWarehouse(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateWarehouseDto) {
    return this.warehouses.manager.transaction(async m => {
      const repo = m.getRepository(Warehouse);
      const warehouse = await repo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!warehouse) throw new NotFoundException();
      if (dto.isActive === false && warehouse.isActive) await assertWarehouseCanDeactivate(m, id);
      if (Object.keys(dto).length) await repo.update(id, dto);
      return repo.merge(warehouse, dto);
    });
  }

  @Patch('warehouses/:id/status')
  @HttpCode(204)
  @RequirePermissions('WAREHOUSE.UPDATE')
  async updateWarehouseStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: StatusDto) {
    await this.updateWarehouse(id, dto);
  }
}
