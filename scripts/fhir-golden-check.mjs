// The CI check for the FHIR builder (ADR-D40): validates every golden bundle with the real HL7 validator against the ABDM IG.
// good-*.json must have ZERO errors; broken-*.json must have AT LEAST ONE (proving the validator catches what it should).
// Warnings are never suppressed: the counts are printed as the validator gave them. Exit 1 if either rule fails or the
// validator cannot run. `node scripts/fhir-fetch.mjs` must have run first (CI does it, with a cache).
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FHIR_DIR } from './fhir-fetch.mjs';
import { validateFiles } from './fhir-validate.mjs';

const dir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'apps',
  'api-node',
  'fixtures',
  'fhir',
  'golden',
);
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => join(dir, f));

const results = validateFiles(files, join(FHIR_DIR, 'out', 'golden'));
const failures = [];
console.log('\nFHIR golden bundles (validator 7.0.3, ABDM IG ndhm.in 6.5.0):');
for (const r of results) {
  const name = r.file.split(/[\\/]/).pop();
  const good = name.startsWith('good-');
  console.log(
    `  ${name.padEnd(44)} errors ${r.errors}  warnings ${r.warnings}  information ${r.information}`,
  );
  if (good && r.errors > 0) {
    failures.push(`${name}: expected 0 errors, validator reported ${r.errors}`);
    for (const i of r.issues.filter((x) => x.severity === 'error' || x.severity === 'fatal')) {
      failures.push(`    ${i.path} | ${i.message}`);
    }
  }
  if (!good && r.errors === 0)
    failures.push(`${name}: a deliberately broken bundle was reported as error-free`);
}
if (failures.length > 0) {
  console.error(`\nFHIR check FAILED:\n${failures.map((f) => `  - ${f}`).join('\n')}`);
  process.exit(1);
}
console.log('\nFHIR check passed');
