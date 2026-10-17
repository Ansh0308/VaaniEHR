// `npm run medicines:codes -- <file.csv> [--apply]`
// Maps SNOMED CT and ATC codes onto medicine_master from a file the owner supplies (licensed releases only).
// Dry run unless --apply. Every row needs a licence note. See apps/api-node/src/medicines/codes.ts.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { apiEnv } from './docker-lib.mjs';
import { npm } from './lib.mjs';

if (existsSync(apiEnv)) process.loadEnvFile(apiEnv);
const extra = process.argv.slice(2).map((a) => (a.startsWith('--') ? a : resolve(a)));
const { status } = npm(
  ['exec', '-w', 'apps/api-node', '--', 'tsx', 'src/medicines/codesCli.ts', ...extra],
  { env: process.env },
);
process.exit(status);
