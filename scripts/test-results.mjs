// Records the latest test results for the traceability matrix (Phase 13A): vitest JSON per workspace and pytest JUnit XML go to
// results/tests/ (git-ignored). The database tests need `npm run db:up`. Then run `npm run trace`.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './srs-lib.mjs';
import { npm, run } from './lib.mjs';

const out = join(ROOT, 'results', 'tests');
mkdirSync(out, { recursive: true });
const steps = [
  [
    'api-node',
    () =>
      npm([
        'exec',
        '-w',
        'apps/api-node',
        '--',
        'vitest',
        'run',
        '--reporter=json',
        `--outputFile=${join(out, 'api-node.json')}`,
      ]),
  ],
  [
    'web',
    () =>
      npm([
        'exec',
        '-w',
        'apps/web',
        '--',
        'vitest',
        'run',
        '--reporter=json',
        `--outputFile=${join(out, 'web.json')}`,
      ]),
  ],
  [
    'rules',
    () =>
      npm([
        'exec',
        '-w',
        'packages/rules',
        '--',
        'vitest',
        'run',
        '--reporter=json',
        `--outputFile=${join(out, 'rules.json')}`,
      ]),
  ],
  [
    'python',
    () =>
      run(process.execPath, [
        'scripts/py.mjs',
        'pytest',
        '-q',
        `--junitxml=${join(out, 'python.xml')}`,
      ]),
  ],
];
let failed = 0;
for (const [name, fn] of steps) {
  const r = fn();
  const code = typeof r === 'number' ? r : (r?.status ?? 0);
  console.log(`${code === 0 ? 'ok  ' : 'FAIL'} ${name}`);
  if (code !== 0) failed++;
}
process.exit(failed ? 1 : 0);
