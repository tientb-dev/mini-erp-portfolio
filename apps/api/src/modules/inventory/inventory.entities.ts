import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { Product, Warehouse } from '../master-data/master-data.entities';

// Balance per Warehouse + PN (ADR-0004). numeric columns come back from pg as strings.
@Entity('inventories')
@Unique(['warehouseId', 'productId'])
export class Inventory {
  @PrimaryGeneratedColumn() id!: number;
  @Column({ name: 'warehouse_id' }) warehouseId!: number;
  @ManyToOne(() => Warehouse) @JoinColumn({ name: 'warehouse_id' }) warehouse!: Warehouse;
  @Column({ name: 'product_id' }) productId!: number;
  @ManyToOne(() => Product) @JoinColumn({ name: 'product_id' }) product!: Product;
  @Column({ name: 'on_hand_quantity', type: 'numeric', precision: 18, scale: 3, default: 0 }) onHandQuantity!: string;
  @Column({ name: 'reserved_quantity', type: 'numeric', precision: 18, scale: 3, default: 0 }) reservedQuantity!: string;
}

@Entity('inventory_transactions')
export class InventoryTransaction {
  @PrimaryGeneratedColumn() id!: number;
  @Column({ name: 'warehouse_id' }) warehouseId!: number;
  @Column({ name: 'product_id' }) productId!: number;
  @Column({ name: 'movement_type' }) movementType!: 'IN' | 'OUT';
  @Column({ type: 'numeric', precision: 18, scale: 3 }) quantity!: string;
  @Column({ name: 'source_document_type' }) sourceDocumentType!: string;
  @Column({ name: 'source_line_id' }) sourceLineId!: number;
  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' }) createdAt!: Date;
}
