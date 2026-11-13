import { Module } from '@nestjs/common';
import { SalesContractsController } from './sales-contracts.controller';
import { SalesContractsService } from './sales-contracts.service';

@Module({ controllers: [SalesContractsController], providers: [SalesContractsService], exports: [SalesContractsService] })
export class SalesContractsModule {}
