import { Controller, Get, Req } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { In, Repository } from 'typeorm';
import { AuthedRequest, RequirePermissions } from '../identity/auth';
import { Inventory } from './inventory.entities';

@ApiTags('inventory')
@ApiBearerAuth()
@Controller('inventories')
export class InventoryController {
  constructor(@InjectRepository(Inventory) private readonly inventories: Repository<Inventory>) {}

  /** Balances limited to the caller's warehouses (data-level scope, 04 §1). Available = on hand − reserved. */
  @Get()
  @RequirePermissions('INVENTORY.VIEW')
  async list(@Req() req: AuthedRequest) {
    const rows = await this.inventories.find({
      where: { warehouseId: In(req.user.warehouseIds) },
      relations: { warehouse: true, product: { unitOfMeasure: true } },
      order: { warehouseId: 'ASC', productId: 'ASC' },
    });
    return rows.map((r) => ({
      id: r.id,
      warehouse: { id: r.warehouse.id, code: r.warehouse.code, name: r.warehouse.name },
      product: { id: r.product.id, partNumber: r.product.partNumber, name: r.product.name, uom: r.product.unitOfMeasure.code },
      onHandQuantity: r.onHandQuantity,
      reservedQuantity: r.reservedQuantity,
      availableQuantity: (Number(r.onHandQuantity) - Number(r.reservedQuantity)).toFixed(3),
    }));
  }
}
