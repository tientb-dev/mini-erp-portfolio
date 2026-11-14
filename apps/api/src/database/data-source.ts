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
import { ENTITIES } from './entities';

export function dataSourceOptions(url = env('DATABASE_URL')): DataSourceOptions {
  return {
    type: 'postgres',
    url,
    entities: ENTITIES,
    migrations: [Foundation1731456000000, InboundChain1731542400000, OutboundChain1731628800000, SalesContractEditing1731715200000, ResponsibleSales1731801600000, PoReceiptProgress1731888000000, InventoryLots1731974400000, LotAllocations1732060800000],
    synchronize: false,
  };
}

export default new DataSource(dataSourceOptions());
