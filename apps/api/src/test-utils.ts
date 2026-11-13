// Shared bootstrap for integration tests against a real PostgreSQL (TEST_DATABASE_URL). Requires `pnpm db:up`.
import './database/env';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

/** Recreates the schema, runs migrations + seed, boots the app. */
export async function bootTestApp(): Promise<{ app: INestApplication; ds: DataSource }> {
  // Imported after DATABASE_URL points at the test database.
  const { AppModule } = await import('./app.module');
  const { seed } = await import('./database/seed');
  const { dataSourceOptions } = await import('./database/data-source');

  const setup = new DataSource(dataSourceOptions());
  await setup.initialize();
  await setup.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await setup.runMigrations();
  await seed(setup);
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
