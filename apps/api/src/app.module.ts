import { Module, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProblemDetailsFilter } from './common/problem-details.filter';
import { dataSourceOptions } from './database/data-source';
import { AuthGuard } from './modules/identity/auth';
import { IdentityModule } from './modules/identity/identity.module';
import { InboundModule } from './modules/inbound/inbound.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { MasterDataModule } from './modules/master-data/master-data.module';
import { OutboundModule } from './modules/outbound/outbound.module';
import { ProcurementModule } from './modules/procurement/procurement.module';
import { SalesContractsModule } from './modules/sales-contracts/sales-contracts.module';

// One Nest module per business module (ADR-0002). Cross-module calls go through static facades that take the
// caller's EntityManager (InventoryFacade, SalesContractFacade, ProductUsage), so they share one transaction.
@Module({
  imports: [
    TypeOrmModule.forRoot(dataSourceOptions()),
    IdentityModule,
    MasterDataModule,
    InventoryModule,
    SalesContractsModule,
    ProcurementModule,
    InboundModule,
    OutboundModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
    { provide: APP_PIPE, useValue: new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }) },
  ],
})
export class AppModule {}
