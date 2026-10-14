// Database helper: up | down | migrate | reset. Uses Docker Compose + node-pg-migrate. Local development only.
import { apiEnv, composeArgs, migrate, requireEnvFiles } from './docker-lib.mjs';
import { run } from './lib.mjs';

function up() {
  requireEnvFiles();
  const { status } = run('docker', [...composeArgs, 'up', '-d', '--wait', 'db']);
  if (status !== 0) {
    console.error('docker compose failed. Is Docker Desktop running (WSL2 engine started)?');
  }
  return status;
}

const [cmd = ''] = process.argv.slice(2);
let status;
if (cmd === 'up') {
  status = up();
} else if (cmd === 'down') {
  requireEnvFiles();
  status = run('docker', [...composeArgs, 'stop', 'db']).status;
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
  // Stop the whole stack first so no app holds the volume, then remove containers and the volume.
  status = run('docker', [...composeArgs, 'down', '-v']).status;
  if (status === 0) status = up();
  if (status === 0) status = migrate('up');
} else {
  console.error('Usage: node scripts/db.mjs <up|down|migrate|reset>');
  status = 2;
}
process.exit(status);
