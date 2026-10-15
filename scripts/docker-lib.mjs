// Shared Docker Compose / migration helpers for scripts/db.mjs and scripts/stack.mjs.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { npm, ROOT } from './lib.mjs';

export const infraEnv = join(ROOT, 'infra', '.env');
export const apiEnv = join(ROOT, 'apps', 'api-node', '.env');
export const asrEnv = join(ROOT, 'apps', 'asr-py', '.env');

export const composeArgs = [
  'compose',
  '--env-file',
  infraEnv,
  '-f',
  join(ROOT, 'infra', 'docker-compose.yml'),
];

/** Exits with a hint if any required local env file is missing (run `npm run setup:env`). */
export function requireEnvFiles(files = [infraEnv, apiEnv]) {
  for (const file of files) {
    if (!existsSync(file)) {
      console.error(`Missing ${file}. Run: npm run setup:env`);
      process.exit(1);
    }
  }
}

/**
 * Applies pending migrations as the database OWNER (MIGRATION_DATABASE_URL in apps/api-node/.env, host side), then sets
 * the password of the runtime role vaani_app from APP_DB_PASSWORD. The running API never uses the owner role.
 */
export function migrate(direction = 'up') {
  requireEnvFiles();
  process.loadEnvFile(apiEnv);
  const ownerUrl = process.env.MIGRATION_DATABASE_URL;
  if (!ownerUrl || !process.env.APP_DB_PASSWORD) {
    console.error(
      'MIGRATION_DATABASE_URL and APP_DB_PASSWORD are required in apps/api-node/.env. Run: npm run setup:env',
    );
    return 1;
  }
  // node-pg-migrate reads DATABASE_URL, so hand it the owner URL for this child process only.
  const env = { ...process.env, DATABASE_URL: ownerUrl };
  const migrated = npm(
    ['exec', '-w', 'apps/api-node', '--', 'node-pg-migrate', direction, '-m', 'migrations'],
    { cwd: ROOT, env },
  ).status;
  if (migrated !== 0 || direction !== 'up') return migrated;
  return npm(['exec', '-w', 'apps/api-node', '--', 'tsx', 'src/db/provision.ts'], {
    cwd: ROOT,
    env,
  }).status;
}
