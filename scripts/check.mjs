// `npm run check`: lint, typecheck, tests across all apps, plus repo guards.
// Runs every step, then prints a summary and exits non-zero if any step failed.
import { npm, run } from './lib.mjs';

const node = process.execPath;
const steps = [
  ['lint (eslint + prettier)', () => npm(['run', 'lint'])],
  ['typecheck (all workspaces)', () => npm(['run', 'typecheck'])],
  ['unit tests (all workspaces)', () => npm(['run', 'test'])],
  ['guard: no shell scripts', () => run(node, ['scripts/check-no-shell-scripts.mjs'])],
  [
    'guard: dependency reasons (docs/DECISIONS.md)',
    () => run(node, ['scripts/sbom.mjs', '--reasons-only']),
  ],
  ['python lint (ruff)', () => run(node, ['scripts/py.mjs', 'ruff'])],
  ['python tests (pytest)', () => run(node, ['scripts/py.mjs', 'pytest'])],
];

const results = [];
for (const [name, fn] of steps) {
  console.log(`\n=== ${name} ===`);
  const { status } = fn();
  results.push([name, status === 0]);
}

console.log('\n================ check summary ================');
for (const [name, ok] of results) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
const failed = results.filter(([, ok]) => !ok).length;
console.log(failed === 0 ? '\nAll checks passed.' : `\n${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
