import { Body, Controller, Get, NotFoundException, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { Repository } from 'typeorm';
import { CodeNameDto } from "../../common/dto";
import { RequirePermissions } from '../identity/auth';
import { Product, UnitOfMeasure, Warehouse } from './master-data.entities';
import { ProductUsage } from './product-usage';

class CreateProductDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(100) partNumber!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(300) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiProperty() @IsInt() unitOfMeasureId!: number;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() isSerialTracked?: boolean;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() isActive?: boolean;
}
class UpdateProductDto extends PartialType(CreateProductDto) {}

class CreateWarehouseDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(50) code!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) name!: string;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() allowAvailableStockIssue?: boolean;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() isActive?: boolean;
}
class UpdateWarehouseDto extends PartialType(CreateWarehouseDto) {}

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
  listUoms() {
    return this.uoms.find({ order: { code: 'ASC' } });
  }

  @Get('products')
  @RequirePermissions('PRODUCT.VIEW')
  listProducts() {
    return this.products.find({ relations: { unitOfMeasure: true }, order: { partNumber: 'ASC' } });
  }

  @Post('products')
  @RequirePermissions('PRODUCT.CREATE')
  createProduct(@Body() dto: CreateProductDto) {
    return this.products.save(this.products.create(dto));
  }

  @Patch('products/:id')
  @RequirePermissions('PRODUCT.UPDATE')
  updateProduct(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateProductDto) {
    return this.products.manager.transaction(async (m) => {
      // FOR UPDATE: waits for document transactions holding FOR SHARE via ProductUsage.markUsed.
      const product = await m.getRepository(Product).findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!product) throw new NotFoundException();
      ProductUsage.assertEditable(product, dto);
      return m.getRepository(Product).save(m.getRepository(Product).merge(product, dto));
    });
  }

  @Get('customers')
  @RequirePermissions('CUSTOMER.VIEW')
  listCustomers() {
    return this.products.manager.query(`SELECT id, code, name FROM customers ORDER BY code`);
  }

  @Get('suppliers')
  @RequirePermissions('SUPPLIER.VIEW')
  listSuppliers() {
    return this.products.manager.query(`SELECT id, code, name FROM suppliers ORDER BY code`);
  }

  @Post("customers")
  @RequirePermissions("CUSTOMER.CREATE")
  async createCustomer(@Body() dto: CodeNameDto) {
    const [row] = await this.products.manager.query(`INSERT INTO customers (code, name) VALUES ($1, $2) RETURNING id`, [dto.code, dto.name]);
    return row;
  }

  @Post("suppliers")
  @RequirePermissions("SUPPLIER.CREATE")
  async createSupplier(@Body() dto: CodeNameDto) {
    const [row] = await this.products.manager.query(`INSERT INTO suppliers (code, name) VALUES ($1, $2) RETURNING id`, [dto.code, dto.name]);
    return row;
  }

  @Get('warehouses')
  @RequirePermissions('WAREHOUSE.VIEW')
  listWarehouses() {
    return this.warehouses.find({ order: { code: 'ASC' } });
  }

  @Post('warehouses')
  @RequirePermissions('WAREHOUSE.CREATE')
  createWarehouse(@Body() dto: CreateWarehouseDto) {
    return this.warehouses.save(this.warehouses.create(dto));
  }

  @Patch('warehouses/:id')
  @RequirePermissions('WAREHOUSE.UPDATE')
  async updateWarehouse(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateWarehouseDto) {
    const warehouse = await this.warehouses.findOneBy({ id });
    if (!warehouse) throw new NotFoundException();
    return this.warehouses.save(this.warehouses.merge(warehouse, dto));
  }
}
