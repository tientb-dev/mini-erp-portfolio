// Shared bootstrap for integration tests against a real PostgreSQL (TEST_DATABASE_URL). Requires `pnpm db:up`.
import './database/env';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { currentStep } from './modules/procurement/pr-workflow';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
// Fixture: suites sign in far more often than a person; rate-limit tests lower these explicitly.
process.env.AUTH_LOGIN_LIMIT_PER_IP ??= '100000';
process.env.AUTH_LOGIN_LIMIT_PER_ACCOUNT ??= '100000';
process.env.AUTH_PASSWORD_CHECK_LIMIT ??= '100000';

/** Recreates the schema, runs migrations + seed, boots the app. */
export async function bootTestApp(): Promise<{ app: INestApplication; ds: DataSource }> {
  // Imported after DATABASE_URL points at the test database.
  const { AppModule } = await import('./app.module');
  process.env.SEED_ROLE_USERS_PASSWORD = 'role-users-test';
  const { seed } = await import('./database/seed');
  const { dataSourceOptions } = await import('./database/data-source');

  const setup = new DataSource(dataSourceOptions());
  await setup.initialize();
  const [{ database }] = await setup.query('SELECT current_database() AS database');
  if (database !== 'mini_erp_test') {
    await setup.destroy();
    throw new Error('Integration fixtures require the dedicated mini_erp_test database');
  }
  await setup.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await setup.runMigrations();
  await seed(setup);
  await setup.query(`INSERT INTO brands (code, name) VALUES ('TEST', 'Test brand')`);
  await setup.query(`INSERT INTO suppliers (id, code, name) VALUES (900001, 'PR-TEST', 'PR fixture supplier');
    INSERT INTO tax_rates (id, code, name, rate) VALUES (900001, 'PR-TEST', 'Zero tax fixture', 0);
    INSERT INTO brand_suppliers (brand_id, supplier_id) SELECT id, 900001 FROM brands WHERE code = 'TEST'`);
  // Fixture only (BA-N-15): automated tests sign in seeded accounts directly; runtime has no bypass.
  await setup.query('UPDATE users SET must_change_password = false');
  await setup.query(`INSERT INTO pr_candidate_pool_members (pool, user_id)
    SELECT fixture.pool, u.id FROM (VALUES ('SALES','sales-head'), ('PM','pm-head'), ('RECEIPT','purchaser')) fixture(pool, username)
    JOIN users u ON u.username = fixture.username`);
  await setup.destroy();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return { app, ds: app.get(DataSource) };
}

export async function login(app: INestApplication, username: string, password: string): Promise<string> {
  const res = await request(app.getHttpServer()).post('/auth/login').send({ username, password }).expect(200);
  return res.body.accessToken;
}

/** UoM PCS ("Cái"): the seed inserts it first into the freshly recreated schema, so its id is always 1. */
export const PCS_UOM_ID = 1;

export async function prContext(ds: DataSource, id: number) {
  const [doc] = await ds.query('SELECT version, approval_round, approval_status FROM purchase_requisitions WHERE id = $1', [id]);
  return { version: doc.version as number, round: doc.approval_round as number, step: currentStep(doc.approval_status) };
}

export async function prSubmission(ds: DataSource, id: number, route = 'SALES') {
  const users = await ds.query(`SELECT username, id FROM users WHERE username IN ('sales-head', 'pm-head', 'purchaser')`);
  return { ...await prContext(ds, id), approverId: users.find((u: { username: string }) => u.username === (route === 'PM' ? 'pm-head' : 'sales-head')).id as number,
    receiverId: users.find((u: { username: string }) => u.username === 'purchaser').id as number };
}

export const prFixtureHeader = { name: 'Purchase requisition fixture' };
export const prFixturePrice = { supplierId: 900001, taxRateId: 900001, unitPrice: '100' };
export function pricedPr<T extends { lines: object[] }>(body: T) {
  return { ...prFixtureHeader, ...body, lines: body.lines.map(line => ({ ...prFixturePrice, ...line })) };
}
