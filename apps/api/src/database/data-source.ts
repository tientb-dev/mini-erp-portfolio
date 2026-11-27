import { AuthorizationFoundation1733443200000 } from './migrations/1733443200000-AuthorizationFoundation';
import { MasterDataDescription1733356800000 } from './migrations/1733356800000-MasterDataDescription';
import { PrDossierStaging1733270400000 } from './migrations/1733270400000-PrDossierStaging';
import { DocumentDossier1733184000000 } from './migrations/1733184000000-DocumentDossier';
import { PurchaseRequisitionDetails1733097600000 } from './migrations/1733097600000-PurchaseRequisitionDetails';
import 'reflect-metadata';
import { DataSource, DataSourceOptions } from 'typeorm';
import { env } from './env';
import { Foundation1731456000000 } from './migrations/1731456000000-Foundation';
import { InboundChain1731542400000 } from './migrations/1731542400000-InboundChain';
import { OutboundChain1731628800000 } from './migrations/1731628800000-OutboundChain';
import { SalesContractEditing1731715200000 } from './migrations/1731715200000-SalesContractEditing';
import { ResponsibleSales1731801600000 } from './migrations/1731801600000-ResponsibleSales';
import { PoReceiptProgress1731888000000 } from './migrations/1731888000000-PoReceiptProgress';
import { InventoryLots1731974400000 } from './migrations/1731974400000-InventoryLots';
import { LotAllocations1732060800000 } from './migrations/1732060800000-LotAllocations';
import { GirPurchaseRequisitionLines1732147200000 } from './migrations/1732147200000-GirPurchaseRequisitionLines';
import { GirAvailableStockSource1732233600000 } from './migrations/1732233600000-GirAvailableStockSource';
import { SalesContractLineUom1732320000000 } from './migrations/1732320000000-SalesContractLineUom';
import { PrWorkflow1732406400000 } from './migrations/1732406400000-PrWorkflow';
import { CommonDocumentRecords1732492800000 } from './migrations/1732492800000-CommonDocumentRecords';
import { PrCandidatePools1732579200000 } from './migrations/1732579200000-PrCandidatePools';
import { PrNotificationTasks1732665600000 } from './migrations/1732665600000-PrNotificationTasks';
import { PrCreateRequest1732752000000 } from './migrations/1732752000000-PrCreateRequest';
import { PrMasterData1732838400000 } from './migrations/1732838400000-PrMasterData';
import { RequireProductBrand1732924800000 } from './migrations/1732924800000-RequireProductBrand';
import { MasterDataStatus1733011200000 } from './migrations/1733011200000-MasterDataStatus';
import { ENTITIES } from './entities';

export function dataSourceOptions(url = env('DATABASE_URL')): DataSourceOptions {
  return {
    type: 'postgres',
    url,
    entities: ENTITIES,
    migrations: [Foundation1731456000000, InboundChain1731542400000, OutboundChain1731628800000, SalesContractEditing1731715200000, ResponsibleSales1731801600000, PoReceiptProgress1731888000000, InventoryLots1731974400000, LotAllocations1732060800000, GirPurchaseRequisitionLines1732147200000, GirAvailableStockSource1732233600000, SalesContractLineUom1732320000000, PrWorkflow1732406400000, CommonDocumentRecords1732492800000, PrCandidatePools1732579200000, PrNotificationTasks1732665600000, PrCreateRequest1732752000000, PrMasterData1732838400000, RequireProductBrand1732924800000, MasterDataStatus1733011200000, PurchaseRequisitionDetails1733097600000, DocumentDossier1733184000000, PrDossierStaging1733270400000, MasterDataDescription1733356800000, AuthorizationFoundation1733443200000],
    migrationsTransactionMode: 'each',
    synchronize: false,
  };
}

export default new DataSource(dataSourceOptions());
