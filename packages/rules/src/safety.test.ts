import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  canonicalSafetyJson,
  isSafetyRuleSetEligible,
  safetyRuleSetHash,
  validateSafetyLockFile,
  validateSafetyRuleSet,
  validateSafetyRuleSetCollection,
} from './safety.js';

const source = () => ({
  source_id: 'synthetic-source',
  document_title: 'Synthetic test document',
  edition_or_version: 'test edition',
  locator: 'synthetic section',
  license_reuse: 'Synthetic fixture; no clinical source.',
  citation: 'Synthetic test reference; not clinical.',
});
const review = () => ({
  state: 'approved',
  reviewer: 'Synthetic Reviewer',
  reviewer_role: 'Test-only role',
  reviewed_on: '2026-10-29',
  approval_reference: 'SYNTHETIC-ONLY',
});
const draft = () => ({
  id: 'proposed_five_conditions',
  schema_version: 1,
  version: 1,
  status: 'draft',
  source: { citation: 'TODO(source)' },
  clinical_review: { state: 'unreviewed' },
  rules: [],
});
const approved = () => ({
  id: 'synthetic_only',
  schema_version: 1,
  version: 1,
  status: 'clinically_approved',
  source: source(),
  clinical_review: review(),
  rules: [
    {
      id: 'synthetic_stop',
      kind: 'out_of_scope_stop',
      enabled: true,
      source: source(),
      clinical_review: review(),
    },
  ],
});
const lockFor = (x: ReturnType<typeof approved>, file = 'one.safety.json') => ({
  schema_version: 1 as const,
  source: 'Synthetic immutability lock; not clinical approval.',
  locks: { 'synthetic_only@1': { file, sha256: safetyRuleSetHash(x) } },
});

function cli(command: string, target: string) {
  return spawnSync(
    process.execPath,
    ['--import', 'tsx', 'packages/rules/src/cli.ts', command, target],
    { cwd: resolve(process.cwd(), '../..'), encoding: 'utf8' },
  );
}

describe('safety-rule preparation gate', () => {
  it('allows an empty draft but never treats it as eligible', () => {
    const x = draft();
    expect(validateSafetyRuleSet(x).errors).toEqual([]);
    expect(isSafetyRuleSetEligible(x)).toBe(false);
  });
  it('canonicalizes object keys while preserving meaningful differences and array order', () => {
    expect(canonicalSafetyJson({ b: 2, a: { z: true, y: 1 } })).toBe(
      canonicalSafetyJson({ a: { y: 1, z: true }, b: 2 }),
    );
    expect(safetyRuleSetHash({ a: 1, b: 2 })).toBe(safetyRuleSetHash({ b: 2, a: 1 }));
    expect(safetyRuleSetHash({ items: ['a', 'b'] })).not.toBe(
      safetyRuleSetHash({ items: ['b', 'a'] }),
    );
  });
  it('rejects malformed structures, duplicate ids and invalid calendar dates', () => {
    const x = draft() as any;
    delete x.source;
    x.clinical_review = { state: 'pending', reviewed_on: '2026-02-30' };
    x.rules = [
      { id: 'a', kind: 'bad', enabled: 'yes' },
      { id: 'a', kind: 'major_interaction', enabled: false, source: { citation: 'x' } },
    ];
    expect(validateSafetyRuleSet(x).errors.join('\n')).toMatch(
      /source.citation|calendar date|kind|boolean|duplicates/,
    );
  });
  it('rejects disabled approved rules and incomplete source or reviewer metadata', () => {
    const x = approved() as any;
    x.rules[0].enabled = false;
    delete x.source.locator;
    delete x.rules[0].clinical_review.approval_reference;
    expect(validateSafetyRuleSet(x).errors.join('\n')).toMatch(
      /cannot contain disabled|source.locator|approval_reference/,
    );
    expect(isSafetyRuleSetEligible(x)).toBe(false);
  });
  it('requires an immutable lock for approved content and catches tampering, path changes and status changes', () => {
    const x = approved();
    const lock = lockFor(x);
    expect(
      validateSafetyRuleSetCollection([{ file: 'one.safety.json', data: x }], lock, true).errors,
    ).toEqual([]);
    x.rules[0]!.source.locator = 'changed synthetic locator';
    expect(
      validateSafetyRuleSetCollection(
        [{ file: 'one.safety.json', data: x }],
        lock,
        true,
      ).errors.join('\n'),
    ).toMatch(/content differs/);
    const changedReviewer = approved();
    changedReviewer.clinical_review.approval_reference = 'SYNTHETIC-CHANGED';
    expect(
      validateSafetyRuleSetCollection(
        [{ file: 'one.safety.json', data: changedReviewer }],
        lock,
        true,
      ).errors.join('\n'),
    ).toMatch(/content differs/);
    expect(
      validateSafetyRuleSetCollection(
        [{ file: 'nested/one.safety.json', data: approved() }],
        lock,
        true,
      ).errors.join('\n'),
    ).toMatch(/path differs/);
    expect(isSafetyRuleSetEligible(approved(), lock.locks['synthetic_only@1'])).toBe(true);
    expect(
      isSafetyRuleSetEligible(
        { ...approved(), status: 'review_pending' },
        lock.locks['synthetic_only@1'],
      ),
    ).toBe(false);
  });
  it('validates malformed locks and duplicate versions', () => {
    expect(
      validateSafetyLockFile({
        schema_version: 1,
        source: 'x',
        locks: { bad: { file: '', sha256: 'no' } },
      }).errors.join('\n'),
    ).toMatch(/invalid lock key|SHA-256/);
    const x = approved();
    const lock = lockFor(x);
    expect(
      validateSafetyRuleSetCollection(
        [
          { file: 'a.safety.json', data: x },
          { file: 'b.safety.json', data: x },
        ],
        lock,
        true,
      ).errors.join('\n'),
    ).toMatch(/already appears/);
  });
  it('recursively lints drafts read-only and makes immutable locks only for complete approved synthetic fixtures', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vaaniehr-safety-'));
    try {
      const empty = join(dir, 'empty');
      mkdirSync(empty);
      expect(cli('safety-lint', empty).status).toBe(1);
      writeFileSync(join(dir, 'draft.safety.json'), JSON.stringify(draft()));
      expect(cli('safety-lint', dir).status).toBe(0);
      expect(cli('safety-lock', dir).status).toBe(1);
      const nested = join(dir, 'nested');
      mkdirSync(nested);
      writeFileSync(join(nested, 'approved.safety.json'), JSON.stringify(approved()));
      expect(cli('safety-lint', dir).status).toBe(1);
      expect(cli('safety-lock', dir).status).toBe(0);
      const lock = JSON.parse(readFileSync(join(dir, 'safety-rules.lock.json'), 'utf8'));
      expect(lock.locks['synthetic_only@1'].file).toBe('nested/approved.safety.json');
      expect(cli('safety-lint', dir).status).toBe(0);
      expect(cli('safety-lock', dir).stdout).toMatch(/nothing new/);
      writeFileSync(join(dir, 'safety-rules.lock.json'), '{');
      expect(cli('safety-lint', dir).status).toBe(1);
      writeFileSync(join(dir, 'safety-rules.lock.json'), JSON.stringify(lock));
      writeFileSync(
        join(nested, 'approved.safety.json'),
        JSON.stringify({ ...approved(), source: { ...source(), locator: 'tampered' } }),
      );
      expect(cli('safety-lint', dir).status).toBe(1);
      expect(cli('safety-lock', dir).status).toBe(1);
      writeFileSync(join(dir, 'bad.safety.json'), '{');
      expect(cli('safety-lint', dir).stdout).toMatch(/not valid JSON/);
      expect(cli('safety-lint', join(dir, 'missing')).status).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
