// Database helper: up | down | migrate | reset. Uses Docker Compose + node-pg-migrate. Local development only.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { npm, run, ROOT } from './lib.mjs';

const infraEnv = join(ROOT, 'infra', '.env');
const apiEnv = join(ROOT, 'apps', 'api-node', '.env');
const compose = [
  'compose',
  '--env-file',
  infraEnv,
  '-f',
  join(ROOT, 'infra', 'docker-compose.yml'),
];

function requireEnvFiles() {
  for (const file of [infraEnv, apiEnv]) {
    if (!existsSync(file)) {
      console.error(`Missing ${file}. Run: npm run setup:env`);
      process.exit(1);
    }
  }
}

function up() {
  requireEnvFiles();
  const { status } = run('docker', [...compose, 'up', '-d', '--wait', 'db']);
  if (status !== 0) {
    console.error('docker compose failed. Is Docker Desktop running (WSL2 engine started)?');
  }
  return status;
}

function migrate(direction = 'up') {
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

const [cmd = ''] = process.argv.slice(2);
let status;
if (cmd === 'up') {
  status = up();
} else if (cmd === 'down') {
  requireEnvFiles();
  status = run('docker', [...compose, 'down']).status;
} else if (cmd === 'migrate') {
  status = migrate('up');
} else if (cmd === 'reset') {
  requireEnvFiles();
  process.loadEnvFile(apiEnv);
  const host = new URL(process.env.DATABASE_URL ?? 'postgres://invalid').hostname;
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
    console.error(`Refusing to reset a non-local database (host "${host}").`);
    process.exit(1);
  }
  console.warn('db:reset - destroying the LOCAL dev database volume and recreating it.');
  status = run('docker', [...compose, 'down', '-v']).status;
  if (status === 0) status = up();
  if (status === 0) status = migrate('up');
} else {
  console.error('Usage: node scripts/db.mjs <up|down|migrate|reset>');
  status = 2;
}
process.exit(status);
