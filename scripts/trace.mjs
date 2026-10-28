// Traceability matrix (Phase 13A, NFR-MAINT-02): PRD ID -> SRS section -> code -> tests -> latest recorded result.
// `npm run trace` writes docs/TRACEABILITY.md. It FAILS when an ID is missing from or unknown to docs/srs-status.json, a listed path does not exist, or a requirement marked
// Implemented has no code path or no test. Latest results are read from results/tests/ (written by `npm run test:results`).
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, parsePrd, readStatus, sectionOf } from './srs-lib.mjs';

const CASE_TS = /(?:^|[^\w.])(?:it|test)(?:\.(?:each|skip|only|concurrent))*\s*\(\s*['"`]/gm;
const CASE_PY = /^\s*(?:async\s+)?def test_\w+/gm;

/** Number of test cases in a file; 0 means "not a test file" (a checking script has none). */
export function countCases(path, text) {
  const re = path.endsWith('.py') ? CASE_PY : CASE_TS;
  return (text.match(re) ?? []).length;
}

/** Pure check of the status map against the PRD ids. `fs` = { exists(path), cases(path) } so it can be tested. */
export function validate(prd, status, fs) {
  const problems = [];
  const ids = [...prd.fr, ...prd.nfr, ...prd.pg].map((r) => r.id);
  const known = new Set(ids);
  for (const id of ids)
    if (!status[id]) problems.push(`${id}: in the PRD but missing from docs/srs-status.json`);
  for (const id of Object.keys(status)) {
    if (id.startsWith('_')) continue;
    if (!known.has(id)) problems.push(`${id}: in docs/srs-status.json but not in the PRD`);
  }
  for (const id of ids) {
    const s = status[id];
    if (!s) continue;
    if (!['Implemented', 'Partial', 'Planned'].includes(s.status))
      problems.push(`${id}: bad status ${s.status}`);
    if (!s.why) problems.push(`${id}: no reason given`);
    for (const p of s.code ?? [])
      if (!fs.exists(p)) problems.push(`${id}: code path does not exist: ${p}`);
    for (const p of s.tests ?? [])
      if (!fs.exists(p)) problems.push(`${id}: test path does not exist: ${p}`);
    if (s.status === 'Implemented') {
      if (!(s.code ?? []).length)
        problems.push(`${id}: marked Implemented but has no code reference`);
      if (!(s.tests ?? []).length) problems.push(`${id}: marked Implemented but has no test`);
    }
  }
  return problems;
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const rel = (p) => p.replaceAll('\\', '/').replace(ROOT.replaceAll('\\', '/') + '/', '');

/** Reads results/tests/*.json (vitest --reporter=json) and *.xml (pytest --junitxml) into { relpath: {passed, failed, skipped} }. */
export function loadResults() {
  const dir = join(ROOT, 'results', 'tests');
  const out = {};
  let when = null;
  for (const f of walk(dir)) {
    const text = readFileSync(f, 'utf8');
    const t = statSync(f).mtime.toISOString().slice(0, 10);
    when = when && when > t ? when : t;
    if (f.endsWith('.json')) {
      const j = JSON.parse(text);
      for (const r of j.testResults ?? []) {
        const k = rel(r.name);
        const a = r.assertionResults ?? [];
        out[k] = {
          passed: a.filter((x) => x.status === 'passed').length,
          failed: a.filter((x) => x.status === 'failed').length,
          skipped: a.filter((x) => x.status !== 'passed' && x.status !== 'failed').length,
          suiteError: r.status === 'failed' && a.length === 0,
        };
      }
    } else if (f.endsWith('.xml')) {
      for (const m of text.matchAll(/<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g)) {
        const cls = /classname="([^"]*)"/.exec(m[1])?.[1] ?? '';
        const parts = cls.split('.');
        const mod = parts.filter((p) => p.startsWith('test_')).pop();
        if (!mod) continue;
        const k = `apps/asr-py/tests/${mod}.py`;
        const o = (out[k] ??= { passed: 0, failed: 0, skipped: 0 });
        const body = m[3] ?? '';
        if (/<(failure|error)\b/.test(body)) o.failed++;
        else if (/<skipped\b/.test(body)) o.skipped++;
        else o.passed++;
      }
    }
  }
  return { results: out, when };
}

function main() {
  const prd = parsePrd();
  const status = readStatus();
  const fs = {
    exists: (p) => existsSync(join(ROOT, p)),
    cases: (p) =>
      existsSync(join(ROOT, p)) && statSync(join(ROOT, p)).isFile()
        ? countCases(p, readFileSync(join(ROOT, p), 'utf8'))
        : 0,
  };
  const problems = validate(prd, status, fs);
  const { results, when } = loadResults();
  const haveResults = Object.keys(results).length > 0;

  const rows = [];
  const kinds = [
    ['FR', prd.fr],
    ['NFR', prd.nfr],
    ['PG', prd.pg],
  ];
  const runCell = (tests) => {
    if (!tests.length) return '-';
    const parts = tests.map((p) => {
      const r = results[p];
      if (!r) return fs.cases(p) === 0 ? 'script, CI only' : 'no result recorded';
      if (r.failed || r.suiteError) return `**FAIL** (${r.failed || 'suite error'})`;
      return `pass ${r.passed}${r.skipped ? `, ${r.skipped} skipped` : ''}`;
    });
    const uniq = [...new Set(parts)];
    return uniq.length === 1 ? uniq[0] : uniq.join('; ');
  };
  let failing = 0;
  for (const [kind, list] of kinds) {
    for (const r of list) {
      const s = status[r.id];
      if (!s) continue;
      const tests = s.tests ?? [];
      const cases = tests.reduce((n, p) => n + fs.cases(p), 0);
      const res = runCell(tests);
      if (res.includes('FAIL')) failing++;
      rows.push({
        kind,
        id: r.id,
        section: sectionOf(r.id),
        status: s.status,
        code: s.code ?? [],
        tests,
        cases,
        res,
        ref: [...(s.adr ?? []).map((a) => `ADR-${a}`), ...(s.oci ?? [])],
      });
    }
  }
  const noTest = rows.filter((r) => !r.tests.length);
  const noCode = rows.filter((r) => !r.code.length);
  const partial = rows.filter((r) => r.status === 'Partial');
  const count = (k, st) => rows.filter((r) => r.kind === k && r.status === st).length;
  const total = (k) => rows.filter((r) => r.kind === k).length;

  const md = (list) => list.map((r) => `${r.id} (${r.status})`).join(', ') || 'none';
  const fmtPaths = (a) => (a.length ? a.map((p) => `\`${p}\``).join('<br>') : '-');
  const fmtTests = (r) =>
    r.tests.length ? r.tests.map((p) => `\`${p}\` (${fs.cases(p) || 'script'})`).join('<br>') : '-';
  const out = `# Traceability matrix (Phase 13A)

> Generated by \`npm run trace\` (\`scripts/trace.mjs\`) from the PRD (\`DOCUMENTS/VaaniEHR_PRD.md\`) and \`docs/srs-status.json\`. Do not edit by hand. The command fails when a requirement marked Implemented has no existing code path or no existing test, when a listed path does not exist, or when an ID is missing from or unknown to the status file. It checks that a test file exists and holds test cases; it does **not** prove that the tests cover the whole sentence of the requirement. Where the coverage is only part of the requirement the status is Partial and the reason is in docs/SRS.md.

**Latest results.** ${haveResults ? `Read from \`results/tests/\` (files last written ${when}); produced by \`npm run test:results\`. The database tests need Docker; a file with no recorded result was not run in that pass.` : 'No `results/tests/` files were found, so no result is recorded. Run `npm run test:results` and then `npm run trace`.'} The browser tests (\`scripts/e2e.mjs\`) and checking scripts run in CI and are marked "script, CI only"; their results are not recorded here.

## Summary

| Kind | Requirements | Implemented | Partial | Planned |
|---|---|---|---|---|
${kinds.map(([k]) => `| ${k} | ${total(k)} | ${count(k, 'Implemented')} | ${count(k, 'Partial')} | ${count(k, 'Planned')} |`).join('\n')}

Test files referenced by a requirement whose recorded result is a failure: ${failing}.

## Gaps (every requirement with no test, no code, or only partial coverage)

- **No test:** ${md(noTest)}
- **No code reference:** ${md(noCode)}
- **Partial (the reason is in docs/SRS.md):** ${md(partial)}

## Matrix

| ID | SRS | Status | Code | Tests (cases) | Latest result | ADR / OCI |
|---|---|---|---|---|---|---|
${rows.map((r) => `| ${r.id} | ${r.section} | ${r.status} | ${fmtPaths(r.code)} | ${fmtTests(r)} | ${r.res} | ${r.ref.join(', ') || '-'} |`).join('\n')}

The metrics M-01 to M-17 and the features without requirement rows (F11, F14, F15) are covered in docs/SRS.md sections 7 and 4, not here, because the PRD gives them no testable requirement sentence.
`;
  const target = join(ROOT, 'docs', 'TRACEABILITY.md');
  if (problems.length) {
    console.error(
      `trace FAILED (${problems.length}):\n` + problems.map((p) => '  - ' + p).join('\n'),
    );
    process.exit(1);
  }
  writeFileSync(target, out);
  console.log(
    `wrote docs/TRACEABILITY.md (${rows.length} requirements; no test: ${noTest.length}; no code: ${noCode.length}; partial: ${partial.length}; failing: ${failing})`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
