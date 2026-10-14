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

/** Applies pending migrations to the database named by DATABASE_URL in apps/api-node/.env (host side). */
export function migrate(direction = 'up') {
  requireEnvFiles();
  process.loadEnvFile(apiEnv);
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL missing in apps/api-node/.env');
    return 1;
  }
  return npm(
    ['exec', '-w', 'apps/api-node', '--', 'node-pg-migrate', direction, '-m', 'migrations'],
    { cwd: ROOT },
  ).status;
}
