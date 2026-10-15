// CLI: fails if any file under seed/ breaks the source rule (ADR-D18; rules in scripts/seed-sources.mjs).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, run } from './lib.mjs';
import { checkSeed } from './seed-sources.mjs';

const { status, stdout } = run(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '--', 'seed'],
  {
    quiet: true,
    cwd: ROOT,
  },
);
if (status !== 0) {
  console.error('git ls-files failed; cannot run the seed-source guard.');
  process.exit(1);
}
const files = stdout.split(/\r?\n/).filter(Boolean);
const entries = files.map((path) => ({ path, content: readFileSync(join(ROOT, path), 'utf8') }));
const problems = checkSeed(entries);
if (problems.length > 0) {
  console.error('seed/ content must carry a source on every row (ADR-D18):');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`OK: ${files.length} file(s) under seed/ satisfy the source rule`);
