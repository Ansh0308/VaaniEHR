// `npm run medicines:translit -- <approved.csv> [--apply]`
// Loads a Gujarati-spelling -> English-name list into the live search table, ONLY if every row names its reviewer and
// review date. Dry run unless --apply. See apps/api-node/src/medicines/translit.ts.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { apiEnv } from './docker-lib.mjs';
import { npm } from './lib.mjs';

if (existsSync(apiEnv)) process.loadEnvFile(apiEnv);
const { status } = npm(
  [
    'exec',
    '-w',
    'apps/api-node',
    '--',
    'tsx',
    'src/medicines/translitCli.ts',
    ...process.argv.slice(2).map((a) => (a.startsWith('--') ? a : resolve(a))),
  ],
  { env: process.env },
);
process.exit(status);
