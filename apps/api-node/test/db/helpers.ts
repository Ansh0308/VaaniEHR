// Helpers for tests that run against real PostgreSQL. Each test file gets its own throw-away database cloned from the
// migrated template, with the seed data loaded (cheap bcrypt cost), the real app wiring, and ready-made logins.
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { Express } from 'express';
import pg from 'pg';
import '../../src/db/types.js';
import request from 'supertest';
import { inject } from 'vitest';
import { createApp } from '../../src/app.js';
import { createServices } from '../../src/bootstrap.js';
import type { Config } from '../../src/config/env.js';
import { createPool } from '../../src/db/pool.js';
import { applySeed, loadSeedData, type SeedData } from '../../src/seed/seedDev.js';
import type { Services } from '../../src/services.js';
import { testConfig } from '../helpers.js';

export interface TestDb {
  name: string;
  /** Owner connection: fixtures and deliberate tampering. */
  owner: pg.Pool;
  /** Runtime role connection: what the real API uses. */
  appUrl: string;
  dropDb: () => Promise<void>;
}

function url(base: string, database: string, user?: string, password?: string): string {
  const u = new URL(base);
  u.pathname = `/${database}`;
  if (user) u.username = user;
  if (password) u.password = password;
  return u.toString();
}

export async function createTestDb(): Promise<TestDb> {
  const cfg = inject('dbTest');
  const name = `vaaniehr_test_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Client({ connectionString: cfg.ownerAdminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}" TEMPLATE ${cfg.templateDb}`);
  await admin.end();

  const owner = new pg.Pool({ connectionString: url(cfg.ownerAdminUrl, name), max: 4 });
  const appUrl = url(cfg.ownerAdminUrl, name, 'vaani_app', cfg.appPassword);
  return {
    name,
    owner,
    appUrl,
    dropDb: async () => {
      await owner.end();
      const c = new pg.Client({ connectionString: cfg.ownerAdminUrl });
      await c.connect();
      await c.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await c.end();
    },
  };
}

export interface Harness {
  db: TestDb;
  app: Express;
  config: Config;
  services: Services;
  appPool: pg.Pool;
  seed: SeedData;
  /** email -> password for every seeded user (valid only inside this test database). */
  passwords: Record<string, string>;
  /** Log in through the real endpoint and return the bearer token. */
  tokenFor: (email: string) => Promise<string>;
  close: () => Promise<void>;
}

const TOY_DIR = fileURLToPath(
  new URL('../../../../packages/rules/fixtures/pathways', import.meta.url),
);
/** The fake toy pathways, allowed only because this is a test harness. */
export const TOY_PATHWAYS_ENV = {
  PATHWAYS_DIR: TOY_DIR,
  PATHWAYS_ALLOW_TEST: 'true',
  PATHWAYS_SLOT_MAP: `${TOY_DIR}/_toy/slot-map.json`,
} as const;

export const SEED_EMAIL = {
  admin: 'admin@example.invalid',
  doctor1: 'doctor1@example.invalid',
  doctor2: 'doctor2@example.invalid',
  staff: 'staff@example.invalid',
  researcher: 'researcher@example.invalid',
} as const;

export async function createHarness(
  envOverrides: Record<string, string | undefined> = {},
): Promise<Harness> {
  const db = await createTestDb();
  const seed = loadSeedData();
  const seeded = await applySeed(db.owner, seed, { bcryptCost: 4 });

  const config = testConfig({
    DATABASE_URL: db.appUrl,
    BCRYPT_COST: '4',
    LOGIN_RATE_LIMIT_MAX: '1000', // the rate-limit tests lower this explicitly
    ...TOY_PATHWAYS_ENV, // fake toy pathways (status test); real pathways are never loaded by tests
    ...envOverrides,
  });
  const appPool = createPool(config.databaseUrl);
  const services = await createServices(config, appPool);
  const app = createApp({
    config,
    authProvider: services.auth,
    services,
    checkDb: async () => {
      await appPool.query('SELECT 1');
    },
  });

  const tokenFor = async (email: string): Promise<string> => {
    const password = seeded.credentials[email];
    if (!password) throw new Error(`no seeded password for ${email}`);
    const res = await request(app).post('/api/v1/auth/login').send({ email, password });
    if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status}`);
    return res.body.data.accessToken as string;
  };

  return {
    db,
    app,
    config,
    services,
    appPool,
    seed,
    passwords: seeded.credentials,
    tokenFor,
    close: async () => {
      await appPool.end();
      await db.dropDb();
    },
  };
}

export const bearer = (token: string): [string, string] => ['Authorization', `Bearer ${token}`];
