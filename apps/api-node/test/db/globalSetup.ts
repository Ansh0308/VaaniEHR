// Global setup for the `db` test project: builds ONE migrated template database; every test file clones it
// (CREATE DATABASE ... TEMPLATE) so files are isolated and fast. Needs a reachable PostgreSQL superuser/owner:
//   - locally: `npm run db:up` (credentials come from apps/api-node/.env, which is git-ignored);
//   - CI: MIGRATION_DATABASE_URL and APP_DB_PASSWORD in the environment (postgres service container).
// Refuses to touch anything that is not a localhost database, and only creates/drops databases named vaaniehr_test_*.
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import type { TestProject } from 'vitest/node';
import { setAppRolePassword } from '../../src/db/provision.js';

export const TEMPLATE_DB = 'vaaniehr_test_template';

export interface DbTestConfig {
  /** Owner URL pointing at the maintenance database (used to create/drop databases). */
  ownerAdminUrl: string;
  appPassword: string;
  templateDb: string;
}

declare module 'vitest' {
  export interface ProvidedContext {
    dbTest: DbTestConfig;
  }
}

function withDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const envFile = resolve(process.cwd(), '.env');
  if (existsSync(envFile) && !process.env.MIGRATION_DATABASE_URL) process.loadEnvFile(envFile);

  const ownerUrl = process.env.MIGRATION_DATABASE_URL;
  const appPassword = process.env.APP_DB_PASSWORD;
  if (!ownerUrl || !appPassword) {
    throw new Error(
      'DB tests need MIGRATION_DATABASE_URL and APP_DB_PASSWORD (run `npm run setup:env`, then `npm run db:up`).',
    );
  }
  const host = new URL(ownerUrl).hostname;
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
    throw new Error(`Refusing to run DB tests against a non-local database (host "${host}").`);
  }

  const adminUrl = withDatabase(ownerUrl, 'postgres');
  const admin = new pg.Client({ connectionString: adminUrl, connectionTimeoutMillis: 4000 });
  try {
    await admin.connect();
  } catch (err) {
    throw new Error(
      'Database is not reachable. Start Docker Desktop, then run `npm run db:up` ' +
        `(${err instanceof Error ? err.message : String(err)}).`,
      { cause: err },
    );
  }
  await admin.query(`DROP DATABASE IF EXISTS ${TEMPLATE_DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${TEMPLATE_DB}`);
  await admin.end();

  await runner({
    databaseUrl: withDatabase(ownerUrl, TEMPLATE_DB),
    dir: join(process.cwd(), 'migrations'),
    direction: 'up',
    migrationsTable: 'pgmigrations',
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: console.error },
    verbose: false,
  });
  await setAppRolePassword(ownerUrl, appPassword);

  project.provide('dbTest', { ownerAdminUrl: adminUrl, appPassword, templateDb: TEMPLATE_DB });

  return async () => {
    const c = new pg.Client({ connectionString: adminUrl });
    await c.connect();
    try {
      const old = await c.query<{ datname: string }>(
        "SELECT datname FROM pg_database WHERE datname LIKE 'vaaniehr_test_%'",
      );
      for (const row of old.rows) {
        await c.query(`DROP DATABASE IF EXISTS "${row.datname}" WITH (FORCE)`);
      }
    } finally {
      await c.end();
    }
  };
}
