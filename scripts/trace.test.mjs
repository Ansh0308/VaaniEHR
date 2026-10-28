// Self-test for the traceability checker. Run: node --test scripts/trace.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { countCases, validate } from './trace.mjs';

const prd = { fr: [{ id: 'FR-F1-01' }], nfr: [], pg: [] };
const fs = (have, cases = {}) => ({ exists: (p) => have.includes(p), cases: (p) => cases[p] ?? 1 });
const entry = (over = {}) => ({
  status: 'Implemented',
  why: 'x',
  code: ['a.ts'],
  tests: ['a.test.ts'],
  ...over,
});

test('a complete Implemented entry passes', () => {
  assert.deepEqual(validate(prd, { 'FR-F1-01': entry() }, fs(['a.ts', 'a.test.ts'])), []);
});
test('Implemented without a test or without code fails', () => {
  assert.match(validate(prd, { 'FR-F1-01': entry({ tests: [] }) }, fs(['a.ts']))[0], /no test/);
  assert.match(
    validate(prd, { 'FR-F1-01': entry({ code: [] }) }, fs(['a.test.ts']))[0],
    /no code reference/,
  );
});
test('a path that does not exist fails, whatever the status', () => {
  assert.match(
    validate(prd, { 'FR-F1-01': entry({ status: 'Partial' }) }, fs(['a.ts']))[0],
    /does not exist/,
  );
});
test('Planned and Partial need no test', () => {
  assert.deepEqual(
    validate(prd, { 'FR-F1-01': entry({ status: 'Planned', code: [], tests: [] }) }, fs([])),
    [],
  );
});
test('ids cannot drift: missing and unknown ids fail', () => {
  assert.match(validate(prd, {}, fs([]))[0], /missing from docs\/srs-status.json/);
  const p = validate(prd, { 'FR-F1-01': entry(), 'FR-F9-99': entry() }, fs(['a.ts', 'a.test.ts']));
  assert.match(p[0], /not in the PRD/);
});
test('a bad status or a missing reason fails', () => {
  assert.ok(
    validate(prd, { 'FR-F1-01': entry({ status: 'Done' }) }, fs(['a.ts', 'a.test.ts'])).length,
  );
  assert.ok(validate(prd, { 'FR-F1-01': entry({ why: '' }) }, fs(['a.ts', 'a.test.ts'])).length);
});
test('countCases counts it and test titles and python tests', () => {
  assert.equal(
    countCases(
      'x.test.ts',
      "it('a', () => {});\n  it.skip('b', () => {});\ndescribe('c', () => {});",
    ),
    2,
  );
  assert.equal(
    countCases(
      't.py',
      'def test_a():\n    pass\nasync def test_b():\n    pass\ndef helper():\n    pass',
    ),
    2,
  );
});
