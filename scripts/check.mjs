// `npm run check`: lint, typecheck, tests across all apps, plus repo guards.
// Runs every step, then prints a summary and exits non-zero if any step failed.
import { npm, run } from './lib.mjs';

// `npm run check`      : everything, including the database tests (needs `npm run db:up`).
// `npm run check:unit` : the same minus the database tests (no Docker needed); it says so in the summary.
const unitOnly = process.argv.includes('--unit');
const node = process.execPath;
const steps = [
  ['lint (eslint + prettier)', () => npm(['run', 'lint'])],
  ['typecheck (all workspaces)', () => npm(['run', 'typecheck'])],
  unitOnly
    ? ['unit tests (no-DB only; DB tests NOT run)', () => npm(['run', 'test:unit'])]
    : ['tests (all workspaces, incl. database tests)', () => npm(['run', 'test'])],
  ['guard: no shell scripts', () => run(node, ['scripts/check-no-shell-scripts.mjs'])],
  ['guard: no data/audio files tracked', () => run(node, ['scripts/check-no-data-files.mjs'])],
  [
    'guard: seed source rule (self-test)',
    () => run(node, ['--test', 'scripts/seed-sources.test.mjs']),
  ],
  [
    'guard: dependency audit gate (self-test)',
    () => run(node, ['--test', 'scripts/audit-gate.test.mjs']),
  ],
  ['guard: seed/ rows carry a source', () => run(node, ['scripts/check-seed-sources.mjs'])],
  [
    'guard: Settings-page licence list is up to date',
    () => run(node, ['scripts/web-licences.mjs', '--check']),
  ],
  [
    'guard: dependency reasons (docs/DECISIONS.md)',
    () => run(node, ['scripts/sbom.mjs', '--reasons-only']),
  ],
  [
    'guard: pathways (toy validate, cases, coverage, lint; seed/pathways validate + lock)',
    () => {
      const cli = ['--import', 'tsx', 'packages/rules/src/cli.ts'];
      const toy = 'packages/rules/fixtures/pathways';
      const cases = 'packages/rules/fixtures/cases';
      const steps = [
        ['validate', toy, '--allow-test'],
        ['cases', toy, cases],
        ['coverage', toy, cases, '--fail-under', '100'],
        ['lint', toy],
        // the real, tracked pathways (ADR-D18): must validate and be locked; an empty folder passes
        ['validate', 'seed/pathways'],
      ];
      let last = { status: 0 };
      for (const step of steps) {
        last = run(node, [...cli, ...step]);
        if (last.status !== 0) return last;
      }
      return last;
    },
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
if (unitOnly) {
  console.log('\nNOTE: check:unit skipped the database tests. Run `npm run check` before pushing.');
}
console.log(failed === 0 ? '\nAll checks passed.' : `\n${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
