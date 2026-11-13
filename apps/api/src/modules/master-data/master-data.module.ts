import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MasterDataController } from './master-data.controller';
import { Product, UnitOfMeasure, Warehouse } from './master-data.entities';

@Module({ imports: [TypeOrmModule.forFeature([Product, Warehouse, UnitOfMeasure])], controllers: [MasterDataController] })
export class MasterDataModule {}
