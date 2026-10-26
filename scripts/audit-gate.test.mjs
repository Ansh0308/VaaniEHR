// Self-test for the audit gate. Run: node --test scripts/audit-gate.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { judge, loadAllowlist, npmFindings, pipFindings } from './audit-gate.mjs';

const today = new Date('2026-10-26');
const none = { entries: [] };
const entry = (over = {}) => ({
  id: 'GHSA-aaaa',
  package: 'pkg',
  reason: 'no fix yet',
  owner: 'owner',
  expires: '2027-01-31',
  ...over,
});

test('npm audit JSON becomes one finding per package with the advisory ids', () => {
  const f = npmFindings({
    vulnerabilities: {
      a: {
        name: 'a',
        severity: 'high',
        via: [{ url: 'https://github.com/advisories/GHSA-aaaa' }, 'b'],
      },
      b: { name: 'b', severity: 'moderate', via: ['a'] },
    },
  });
  assert.deepEqual(f, [
    { package: 'a', severity: 'high', ids: ['GHSA-aaaa'] },
    { package: 'b', severity: 'moderate', ids: [] },
  ]);
});

test('high and critical block, moderate and low do not', () => {
  const findings = ['low', 'moderate', 'high', 'critical'].map((s) => ({
    package: s,
    severity: s,
    ids: [`GHSA-${s}`],
  }));
  const r = judge(findings, none, today);
  assert.deepEqual(
    r.blocking.map((f) => f.package),
    ['high', 'critical'],
  );
  assert.deepEqual(
    r.notBlocking.map((f) => f.package),
    ['low', 'moderate'],
  );
});

test('an allowlisted finding passes until the entry expires', () => {
  const f = [{ package: 'pkg', severity: 'high', ids: ['GHSA-aaaa'] }];
  assert.equal(judge(f, { entries: [entry()] }, today).blocking.length, 0);
  assert.equal(judge(f, { entries: [entry()] }, today).accepted.length, 1);
  const late = judge(f, { entries: [entry({ expires: '2026-10-01' })] }, today);
  assert.equal(late.blocking.length, 1);
  assert.equal(late.expired.length, 1);
});

test('an allowlist entry for another package or another id accepts nothing', () => {
  const f = [{ package: 'pkg', severity: 'critical', ids: ['GHSA-aaaa'] }];
  assert.equal(judge(f, { entries: [entry({ package: 'other' })] }, today).blocking.length, 1);
  assert.equal(judge(f, { entries: [entry({ id: 'GHSA-zzzz' })] }, today).blocking.length, 1);
});

test('pip-audit has no severity, so every finding blocks unless allowlisted', () => {
  const f = pipFindings({
    dependencies: [
      { name: 'pkg', version: '1', vulns: [{ id: 'PYSEC-1', aliases: ['GHSA-aaaa'] }] },
      { name: 'ok', vulns: [] },
    ],
  });
  assert.equal(f.length, 1);
  assert.equal(judge(f, none, today, undefined, true).blocking.length, 1);
  assert.equal(judge(f, { entries: [entry()] }, today, undefined, true).blocking.length, 0);
});

test('the committed allowlist is valid, and an entry without a reason or date is refused', async () => {
  const { writeFileSync, mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  assert.ok(Array.isArray(loadAllowlist().entries));
  const dir = mkdtempSync(join(tmpdir(), 'allow-'));
  const bad = join(dir, 'a.json');
  writeFileSync(
    bad,
    JSON.stringify({ entries: [{ id: 'GHSA-x', owner: 'o', expires: '2027-01-01' }] }),
  );
  assert.throws(() => loadAllowlist(bad), /reason/);
  writeFileSync(
    bad,
    JSON.stringify({ entries: [{ id: 'GHSA-x', reason: 'r', owner: 'o', expires: 'someday' }] }),
  );
  assert.throws(() => loadAllowlist(bad), /not a date/);
});
