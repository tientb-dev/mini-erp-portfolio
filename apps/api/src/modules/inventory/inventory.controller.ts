import { Controller, Get, Req } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { DataSource, In, Repository } from 'typeorm';
import { AuthedRequest, RequirePermissions } from '../identity/auth';
import { Inventory } from './inventory.entities';

@ApiTags('inventory')
@ApiBearerAuth()
@Controller('inventories')
export class InventoryController {
  constructor(@InjectRepository(Inventory) private readonly inventories: Repository<Inventory>, private readonly ds: DataSource) {}

  /**
   * Receipt provenance per lot (C71): warehouse, product, source HĐ, responsible sales, GR, approval time and received
   * quantity, limited to the caller's warehouses. Lot on-hand comes with GI allocation (ADR-0013, PR 4).
   */
  @Get('lots')
  @RequirePermissions('INVENTORY.VIEW')
  lots(@Req() req: AuthedRequest) {
    return this.ds.query(
      `SELECT l.id, l.warehouse_id AS "warehouseId", w.code AS "warehouseCode", l.product_id AS "productId", p.part_number AS "partNumber",
              l.source_sales_contract_id AS "sourceSalesContractId", sc.document_number AS "sourceSalesContractNumber",
              l.owner_user_id AS "ownerUserId", u.full_name AS "ownerName", gr.id AS "goodsReceiptId", gr.document_number AS "goodsReceiptNumber",
              l.goods_receipt_line_id AS "goodsReceiptLineId", l.approved_at AS "approvedAt", l.received_quantity AS "receivedQuantity"
         FROM inventory_lots l
         JOIN warehouses w ON w.id = l.warehouse_id
         JOIN products p ON p.id = l.product_id
         JOIN sales_contracts sc ON sc.id = l.source_sales_contract_id
         JOIN users u ON u.id = l.owner_user_id
         JOIN goods_receipt_lines grl ON grl.id = l.goods_receipt_line_id
         JOIN goods_receipts gr ON gr.id = grl.goods_receipt_id
        WHERE l.warehouse_id = ANY($1)
        ORDER BY l.warehouse_id, l.product_id, l.approved_at, l.id`,
      [req.user.warehouseIds],
    );
  }

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
