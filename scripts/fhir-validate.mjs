// Validates FHIR files against the ABDM IG (ndhm.in 6.5.0) with the official HL7 validator 7.0.3 (ADR-D40).
//   node scripts/fhir-validate.mjs [--out <dir>] [--expect-valid] <file.json>...
// ONE validator process checks every file (loading the IG takes minutes, so files are batched). Per-file results are written to
// <out>/<name>.outcome.json (the raw OperationOutcome, nothing suppressed) and a summary is printed as JSON:
//   [{ file, errors, warnings, information, issues: [{ severity, path, message }] }]
// Java: the validator needs Java 11 or newer. If `java` is 11+ it is used; otherwise the script runs the pinned container
// eclipse-temurin:17-jre through Docker. Exit code: 0 = the validator ran (errors in a bundle are RESULTS, not failures);
// 1 = it could not run; 2 = --expect-valid was given and some file has errors. Needs `node scripts/fhir-fetch.mjs` first.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARTEFACTS, FHIR_DIR } from './fhir-fetch.mjs';

const [IG, JAR] = ARTEFACTS.map((a) => a.file);
// Temurin 17.0.20.1 JRE (Java 11+ is required by the validator); pinned by digest, checked locally 2026-10-23
export const VALIDATOR_IMAGE =
  'eclipse-temurin:17-jre@sha256:e04fa72be13b257a59fdec6dc14af78c8f80f035d3c1ed4e03e45552a231d4c8';

function javaMajor() {
  const r = spawnSync('java', ['-version'], { encoding: 'utf8' });
  if (r.error || r.status !== 0) return 0;
  const m = /version "(\d+)(?:\.(\d+))?/.exec(`${r.stderr}${r.stdout}`);
  if (!m) return 0;
  return m[1] === '1' ? Number(m[2]) : Number(m[1]);
}

/** Pure: turns a validator OperationOutcome into the summary used by the tests, the API and the UI. */
export function summarise(outcome) {
  const issues = (outcome.issue ?? []).map((i) => ({
    severity: i.severity,
    path: (i.expression ?? [i.location?.[0] ?? ''])[0] ?? '',
    message: i.details?.text ?? i.diagnostics ?? '',
  }));
  const count = (s) => issues.filter((i) => i.severity === s).length;
  return {
    errors: count('error') + count('fatal'),
    warnings: count('warning'),
    information: count('information'),
    issues,
  };
}

export function validateFiles(files, outDir) {
  for (const f of [IG, JAR]) {
    if (!existsSync(f)) throw new Error(`missing ${f}: run "node scripts/fhir-fetch.mjs" first`);
  }
  mkdirSync(outDir, { recursive: true });
  // stage the inputs inside data/fhir so the same relative paths work for Java and for Docker
  const stage = join(FHIR_DIR, 'stage');
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  const names = files.map((f, i) => `${String(i).padStart(3, '0')}-${basename(f)}`);
  files.forEach((f, i) => copyFileSync(f, join(stage, names[i])));
  const combined = join(FHIR_DIR, 'out', 'batch-result.json');
  mkdirSync(join(FHIR_DIR, 'out'), { recursive: true });
  rmSync(combined, { force: true });

  const args = (base) => [
    '-jar',
    `${base}/validator/validator_cli-7.0.3.jar`,
    ...names.map((n) => `${base}/stage/${n}`),
    '-version',
    '4.0.1',
    '-ig',
    `${base}/ig/ndhm.in-6.5.0.tgz`,
    '-output',
    `${base}/out/batch-result.json`,
  ];
  let r;
  if (javaMajor() >= 11) {
    // the HL7 package cache lives under data/fhir/home/.fhir (same place the container uses), not in the user's home
    r = spawnSync('java', [`-Duser.home=${join(FHIR_DIR, 'home')}`, ...args(FHIR_DIR)], {
      stdio: ['ignore', 2, 2],
      env: process.env,
    });
  } else {
    const home = join(FHIR_DIR, 'home');
    mkdirSync(home, { recursive: true });
    r = spawnSync(
      'docker',
      [
        'run',
        '--rm',
        '-v',
        `${FHIR_DIR}:/fhir`,
        '-v',
        `${home}:/root`,
        VALIDATOR_IMAGE,
        'java',
        ...args('/fhir'),
      ],
      { stdio: ['ignore', 2, 2], env: { ...process.env, MSYS_NO_PATHCONV: '1' } },
    );
  }
  if (!existsSync(combined)) {
    throw new Error(
      `the validator did not produce a result (exit ${r.status}); see its output above`,
    );
  }
  const raw = JSON.parse(readFileSync(combined, 'utf8'));
  // one file gives an OperationOutcome, several give a Bundle of them
  const outcomes = raw.resourceType === 'Bundle' ? raw.entry.map((e) => e.resource) : [raw];
  const results = [];
  for (const [i, file] of files.entries()) {
    const oc =
      outcomes.find((o) => (o.extension ?? []).some((e) => e.valueString?.endsWith(names[i]))) ??
      (outcomes.length === 1 ? outcomes[0] : undefined);
    if (!oc) throw new Error(`no validator result for ${file}`);
    writeFileSync(join(outDir, `${basename(file)}.outcome.json`), JSON.stringify(oc, null, 2));
    results.push({ file: resolve(file), ...summarise(oc) });
  }
  return results;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const argv = process.argv.slice(2);
  let outDir = join(FHIR_DIR, 'out');
  let expectValid = false;
  const files = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') outDir = resolve(argv[++i]);
    else if (argv[i] === '--expect-valid') expectValid = true;
    else files.push(resolve(argv[i]));
  }
  if (files.length === 0) {
    console.error(
      'usage: node scripts/fhir-validate.mjs [--out dir] [--expect-valid] <file.json>...',
    );
    process.exit(1);
  }
  try {
    const results = validateFiles(files, outDir);
    console.log(
      JSON.stringify(
        results.map(({ issues, ...rest }) => ({
          ...rest,
          issues: issues.filter((i) => i.severity !== 'information'),
        })),
        null,
        2,
      ),
    );
    process.exit(expectValid && results.some((x) => x.errors > 0) ? 2 : 0);
  } catch (err) {
    console.error(String(err?.message ?? err));
    process.exit(1);
  }
}
