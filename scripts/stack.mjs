// Whole local stack: up | down | status. Node, cross-platform (ADR-D9). Docker Desktop must be running.
import { asrEnv, composeArgs, infraEnv, apiEnv, migrate, requireEnvFiles } from './docker-lib.mjs';
import { run } from './lib.mjs';

const [cmd = ''] = process.argv.slice(2);
let status;

if (cmd === 'up') {
  requireEnvFiles([infraEnv, apiEnv, asrEnv]);
  // --build: always rebuild images from the current sources; --wait: block until every healthcheck passes.
  status = run('docker', [...composeArgs, 'up', '-d', '--build', '--wait']).status;
  if (status !== 0) {
    console.error('stack:up failed. Is Docker Desktop running? See `docker compose logs`.');
  } else {
    console.log('Containers are healthy. Applying migrations (idempotent)...');
    status = migrate('up');
  }
} else if (cmd === 'down') {
  requireEnvFiles([infraEnv]);
  // Removes containers and the network; the named database volume is kept (use `npm run db:reset` to wipe it).
  status = run('docker', [...composeArgs, 'down']).status;
} else if (cmd === 'status') {
  requireEnvFiles([infraEnv]);
  status = run('docker', [...composeArgs, 'ps']).status;
} else {
  console.error('Usage: node scripts/stack.mjs <up|down|status>');
  status = 2;
}
process.exit(status);
