import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryController } from './inventory.controller';
import { Inventory } from './inventory.entities';

@Module({ imports: [TypeOrmModule.forFeature([Inventory])], controllers: [InventoryController] })
export class InventoryModule {}
