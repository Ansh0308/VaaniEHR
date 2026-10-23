// Writes the golden and broken FHIR bundles to apps/api-node/fixtures/fhir/golden/ (npm run fhir:golden).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brokenBundles, goldenBundles } from './goldenVisits.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'fhir', 'golden');
mkdirSync(dir, { recursive: true });
for (const f of [...goldenBundles(), ...brokenBundles()]) {
  writeFileSync(join(dir, `${f.name}.json`), `${JSON.stringify(f.bundle, null, 2)}\n`, 'utf8');
  console.log(`wrote ${f.name}.json`);
}
