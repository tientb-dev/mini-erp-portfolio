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
   * Lot traceability (C71, read only): warehouse, product, source HĐ, source sales, GR, approval time, received / on hand /
   * reserved / available per lot and, for serial goods, how many serials are in stock / reserved / issued.
   * Limited to the caller's warehouses (04 §1): a lot outside them is never returned.
   */
  @Get('lots')
  @RequirePermissions('INVENTORY.VIEW')
  lots(@Req() req: AuthedRequest) {
    return this.ds.query(
      `SELECT l.id, l.warehouse_id AS "warehouseId", w.code AS "warehouseCode", l.product_id AS "productId", p.part_number AS "partNumber",
              l.source_sales_contract_id AS "sourceSalesContractId", sc.document_number AS "sourceSalesContractNumber",
              l.owner_user_id AS "ownerUserId", u.full_name AS "ownerName", gr.id AS "goodsReceiptId", gr.document_number AS "goodsReceiptNumber",
              l.goods_receipt_line_id AS "goodsReceiptLineId", l.approved_at AS "approvedAt", l.received_quantity AS "receivedQuantity",
              p.name AS "productName", p.is_serial_tracked AS "isSerialTracked", l.on_hand_quantity AS "onHandQuantity",
              l.reserved_quantity AS "reservedQuantity", l.on_hand_quantity - l.reserved_quantity AS "availableQuantity",
              CASE WHEN p.is_serial_tracked THEN s.in_stock END AS "serialsInStock", CASE WHEN p.is_serial_tracked THEN s.reserved END AS "serialsReserved",
              CASE WHEN p.is_serial_tracked THEN s.issued END AS "serialsIssued"
         FROM inventory_lots l
         LEFT JOIN LATERAL (
           SELECT COUNT(*) FILTER (WHERE x.status = 'IN_STOCK')::int AS in_stock, COUNT(*) FILTER (WHERE x.status = 'RESERVED')::int AS reserved,
                  COUNT(*) FILTER (WHERE x.status = 'ISSUED')::int AS issued
             FROM inventory_serials x JOIN goods_receipt_details d ON d.id = x.goods_receipt_detail_id
            WHERE d.goods_receipt_line_id = l.goods_receipt_line_id) s ON true
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
