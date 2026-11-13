import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('units_of_measure')
export class UnitOfMeasure {
  @PrimaryGeneratedColumn() id!: number;
  @Column({ unique: true }) code!: string;
  @Column() name!: string;
}

@Entity('warehouses')
export class Warehouse {
  @PrimaryGeneratedColumn() id!: number;
  @Column({ unique: true }) code!: string;
  @Column() name!: string;
  @Column({ name: 'allow_available_stock_issue', default: false }) allowAvailableStockIssue!: boolean;
  @Column({ name: 'is_active', default: true }) isActive!: boolean;
}

@Entity('products')
export class Product {
  @PrimaryGeneratedColumn() id!: number;
  @Column({ name: 'part_number', unique: true }) partNumber!: string;
  @Column() name!: string;
  @Column({ type: 'text', nullable: true }) description!: string | null;
  @Column({ name: 'unit_of_measure_id' }) unitOfMeasureId!: number;
  @ManyToOne(() => UnitOfMeasure) @JoinColumn({ name: 'unit_of_measure_id' }) unitOfMeasure!: UnitOfMeasure;
  @Column({ name: 'is_serial_tracked', default: true }) isSerialTracked!: boolean;
  @Column({ name: 'is_used', default: false, update: false }) isUsed!: boolean;
  @Column({ name: 'is_stock_used', default: false, update: false }) isStockUsed!: boolean;
  @Column({ name: 'is_active', default: true }) isActive!: boolean;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}
