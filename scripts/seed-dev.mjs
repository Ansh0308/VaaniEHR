// `npm run seed:dev [-- --reset-passwords]`
// Loads the FAKE development data from seed/dev/ as the database owner. Refuses in production mode.
// Random passwords go ONLY to the git-ignored data/dev-credentials.json (never printed).
import { apiEnv, requireEnvFiles } from './docker-lib.mjs';
import { npm } from './lib.mjs';

requireEnvFiles([apiEnv]);
process.loadEnvFile(apiEnv);
const extra = process.argv.slice(2).filter((a) => a === '--reset-passwords');
const { status } = npm(
  ['exec', '-w', 'apps/api-node', '--', 'tsx', 'src/seed/seedDev.ts', ...extra],
  {
    env: process.env,
  },
);
process.exit(status);
