// Fetches the two third-party artefacts the FHIR validator needs and checks them against pinned SHA-256 values (ADR-D40):
//  1. the official ABDM FHIR Implementation Guide package ndhm.in (NRCeS), licence CC0-1.0 (its package.json says so);
//  2. the HL7 FHIR validator (validator_cli.jar, Apache-2.0).
// Both go to data/fhir/ (git-ignored: data/ is private by the repository rule; nothing here is committed). Run once on a new
// machine or in CI: `node scripts/fhir-fetch.mjs`. An existing file with the right hash is kept.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const FHIR_DIR = join(ROOT, 'data', 'fhir');

export const ARTEFACTS = [
  {
    name: 'ABDM FHIR IG ndhm.in 6.5.0 (NRCeS, current release of 2025-05-08; confirmed on https://nrces.in/ndhm/fhir/r4/ 2026-10-23)',
    url: 'https://nrces.in/ndhm/fhir/r4/package.tgz',
    file: join(FHIR_DIR, 'ig', 'ndhm.in-6.5.0.tgz'),
    sha256: '41fa99955adbd1983a235d7c7136b30f423ce34ff541d86b354d95b7704527d4',
  },
  {
    name: 'HL7 FHIR validator 7.0.3 (hapifhir/org.hl7.fhir.core release of 2026-10-21)',
    url: 'https://github.com/hapifhir/org.hl7.fhir.core/releases/download/7.0.3/validator_cli.jar',
    file: join(FHIR_DIR, 'validator', 'validator_cli-7.0.3.jar'),
    sha256: '57aa43fb40cec5de41def81c927725fd85908eeb71509b7f9313e04d9b8ec79b',
  },
];

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

export async function fetchAll() {
  for (const a of ARTEFACTS) {
    if (existsSync(a.file) && sha256(a.file) === a.sha256) {
      console.log(`ok (cached)  ${a.name}`);
      continue;
    }
    console.log(`fetching     ${a.name}\n             ${a.url}`);
    const res = await fetch(a.url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`download failed (${res.status}) for ${a.url}`);
    const body = Buffer.from(await res.arrayBuffer());
    const got = createHash('sha256').update(body).digest('hex');
    if (got !== a.sha256) {
      throw new Error(
        `SHA-256 mismatch for ${a.file}: expected ${a.sha256}, got ${got}. Not saved. If the publisher re-issued the file, check the release notes and update the pin in this script (ADR-D40).`,
      );
    }
    mkdirSync(dirname(a.file), { recursive: true });
    const tmp = `${a.file}.part`;
    writeFileSync(tmp, body);
    renameSync(tmp, a.file);
    console.log(`ok           ${a.file} (${body.length} bytes)`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  fetchAll().catch((err) => {
    console.error(String(err?.message ?? err));
    process.exit(1);
  });
}
