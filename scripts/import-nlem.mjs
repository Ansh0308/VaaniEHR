// `npm run import:nlem [-- --dry-run] [-- --pdf <path>]`
// Imports the NLEM 2022 medicine list from the private PDF in data/medicines/raw/ (see apps/api-node/src/medicines).
// Prints the report; writes git-ignored CSV files under data/medicines/; loads medicine_master as the database owner.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { apiEnv } from './docker-lib.mjs';
import { npm } from './lib.mjs';

// Locally the values come from the git-ignored apps/api-node/.env; in CI they are already in the environment.
if (existsSync(apiEnv)) process.loadEnvFile(apiEnv);
// a path argument is resolved here, because the command below runs from apps/api-node
const extra = process.argv
  .slice(2)
  .filter(
    (a) => a === '--dry-run' || a === '--retire-stale' || a === '--pdf' || !a.startsWith('--'),
  )
  .map((a) => (a.startsWith('--') ? a : resolve(a)));
const { status } = npm(
  ['exec', '-w', 'apps/api-node', '--', 'tsx', 'src/medicines/importCli.ts', ...extra],
  { env: process.env },
);
process.exit(status);
