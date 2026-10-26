// Dependency audit gate (Phase 12B, ADR-D44). Runs `npm audit` and `pip-audit` and fails on high or critical findings that are not in
// the documented allowlist (security/audit-allowlist.json). Every allowlist entry needs a reason, an owner and an expiry date; an
// expired entry no longer counts, so an accepted risk has to be looked at again.
//   node scripts/audit-gate.mjs npm            npm audit (all workspaces), fails on high/critical
//   node scripts/audit-gate.mjs pip <python>   pip-audit of the Python environment. pip-audit gives no severity, so ANY known
//                                              vulnerability fails (stricter than npm) unless allowlisted
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { npm, run, ROOT } from './lib.mjs';

export const BLOCKING = new Set(['high', 'critical']);

/** @returns {{entries: {id:string, package?:string, reason:string, owner:string, expires:string}[]}} */
export function loadAllowlist(path = join(ROOT, 'security', 'audit-allowlist.json')) {
  const data = JSON.parse(readFileSync(path, 'utf8'));
  for (const e of data.entries ?? []) {
    for (const key of ['id', 'reason', 'owner', 'expires']) {
      if (!e[key] || typeof e[key] !== 'string')
        throw new Error(`allowlist entry ${e.id ?? '?'} needs "${key}"`);
    }
    if (Number.isNaN(Date.parse(e.expires)))
      throw new Error(`allowlist entry ${e.id}: "expires" is not a date`);
  }
  return data;
}

const allowed = (allowlist, ids, pkg, today) =>
  allowlist.entries.find(
    (e) =>
      ids.includes(e.id) &&
      (!e.package || e.package === pkg) &&
      Date.parse(e.expires) >= today.getTime(),
  );

/** Findings from `npm audit --json` (npm 7+ format): one per vulnerable package, with the advisory ids it comes from. */
export function npmFindings(report) {
  return Object.values(report.vulnerabilities ?? {}).map((v) => ({
    package: v.name,
    severity: v.severity,
    ids: (v.via ?? [])
      .filter((x) => typeof x === 'object')
      .map((x) => (x.url ?? '').split('/').pop())
      .filter(Boolean),
  }));
}

/** Findings from `pip-audit --format json`. */
export function pipFindings(report) {
  return (report.dependencies ?? []).flatMap((d) =>
    (d.vulns ?? []).map((v) => ({
      package: d.name,
      severity: 'unknown',
      ids: [v.id, ...(v.aliases ?? [])],
    })),
  );
}

/** @returns {{blocking: object[], accepted: object[], notBlocking: object[], expired: object[]}} */
export function judge(
  findings,
  allowlist,
  today = new Date(),
  blockingSeverities = BLOCKING,
  pip = false,
) {
  const out = { blocking: [], accepted: [], notBlocking: [], expired: [] };
  for (const f of findings) {
    const counts = pip || blockingSeverities.has(f.severity);
    if (!counts) {
      out.notBlocking.push(f);
      continue;
    }
    if (allowed(allowlist, f.ids, f.package, today)) out.accepted.push(f);
    else {
      if (
        allowlist.entries.some(
          (e) => f.ids.includes(e.id) && (!e.package || e.package === f.package),
        )
      )
        out.expired.push(f);
      out.blocking.push(f);
    }
  }
  return out;
}

function report(title, result) {
  const line = (f) => `  ${f.package} [${f.severity}] ${f.ids.join(', ') || '(no advisory id)'}`;
  console.log(
    `${title}: ${result.blocking.length} blocking, ${result.accepted.length} accepted, ${result.notBlocking.length} below the gate`,
  );
  for (const f of result.blocking)
    console.log(
      `BLOCKING${result.expired.includes(f) ? ' (allowlist entry expired)' : ''}${line(f)}`,
    );
  for (const f of result.accepted) console.log(`accepted${line(f)}`);
  for (const f of result.notBlocking) console.log(`below the gate${line(f)}`);
}

function main() {
  const [mode, python, ...extra] = process.argv.slice(2);
  const allowlist = loadAllowlist();
  if (mode === 'npm') {
    const r = npm(['audit', '--json'], { quiet: true });
    const result = judge(npmFindings(JSON.parse(r.stdout || '{}')), allowlist);
    report('npm audit', result);
    process.exit(result.blocking.length ? 1 : 0);
  }
  if (mode === 'pip') {
    const r = run(
      python ?? 'python',
      [
        '-m',
        'pip_audit',
        ...extra,
        '--format',
        'json',
        '--progress-spinner',
        'off',
        '--timeout',
        '60',
      ],
      { quiet: true },
    );
    if (r.status !== 0 && r.status !== 1) {
      console.log(`pip-audit could not run (exit ${r.status}): ${String(r.stderr).slice(-300)}`);
      process.exit(2);
    }
    const result = judge(
      pipFindings(JSON.parse(r.stdout || '{}')),
      allowlist,
      new Date(),
      BLOCKING,
      true,
    );
    report('pip-audit', result);
    process.exit(result.blocking.length ? 1 : 0);
  }
  console.log('usage: node scripts/audit-gate.mjs npm | pip <python>');
  process.exit(2);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
