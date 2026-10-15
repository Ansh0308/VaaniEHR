// `npm run verify:audit [-- --expect-head <hash> --expect-count <n>]`
// Verifies the audit hash chain in the local database and reports the first broken row (NFR-REL-01).
import { npm } from './lib.mjs';
import { apiEnv, requireEnvFiles } from './docker-lib.mjs';

requireEnvFiles([apiEnv]);
process.loadEnvFile(apiEnv);
const extra = process.argv.slice(2).filter((a) => /^[\w./:=-]+$/.test(a));
const { status } = npm(
  ['exec', '-w', 'apps/api-node', '--', 'tsx', 'src/audit/verifyCli.ts', ...extra],
  { env: process.env },
);
process.exit(status);
