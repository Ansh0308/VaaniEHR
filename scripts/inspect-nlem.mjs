// `npm run medicines:inspect -- held` / `-- sample [--n 20] [--seed 3] [--docs docs/NLEM_SPOTCHECK.md]`
// Prints the held NLEM rows, or a seeded random sample of loaded rows, with the PDF's own text beside the parsed values.
import { resolve } from 'node:path';
import { npm } from './lib.mjs';

// a --docs path is resolved here, because the command below runs from apps/api-node
const args = process.argv.slice(2).map((a, i, all) => (all[i - 1] === '--docs' ? resolve(a) : a));
const { status } = npm(
  ['exec', '-w', 'apps/api-node', '--', 'tsx', 'src/medicines/inspectCli.ts', ...args],
  { env: process.env },
);
process.exit(status);
