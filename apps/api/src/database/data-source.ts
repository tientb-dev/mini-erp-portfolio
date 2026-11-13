import 'reflect-metadata';
import { DataSource, DataSourceOptions } from 'typeorm';
import { env } from './env';
import { Foundation1731456000000 } from './migrations/1731456000000-Foundation';
import { InboundChain1731542400000 } from './migrations/1731542400000-InboundChain';
import { OutboundChain1731628800000 } from './migrations/1731628800000-OutboundChain';
import { ENTITIES } from './entities';

export function dataSourceOptions(url = env('DATABASE_URL')): DataSourceOptions {
  return {
    type: 'postgres',
    url,
    entities: ENTITIES,
    migrations: [Foundation1731456000000, InboundChain1731542400000, OutboundChain1731628800000],
    synchronize: false,
  };
}

export default new DataSource(dataSourceOptions());
