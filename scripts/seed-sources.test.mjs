// Self-test for the seed source rule. Run: node --test scripts/seed-sources.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkSeed, parseCsv } from './seed-sources.mjs';

const csv = (content, path = 'seed/medicines/x.csv') => checkSeed([{ path, content }]);

test('CSV with a source on every row passes', () => {
  assert.deepEqual(
    csv('name,source\nFakeDrug-A,"Fake source, page 1"\nFakeDrug-B,Fake source p2\n'),
    [],
  );
});

test('CSV without a source column fails', () => {
  assert.match(csv('name,dose\nFakeDrug-A,1\n')[0], /no "source" column/);
});

test('CSV row with an empty source fails and names the row', () => {
  const problems = csv('name,source\nA,ok\nB,\nC,   \n');
  assert.equal(problems.length, 2);
  assert.match(problems[0], /data row 2/);
});

test('quoted commas and newlines do not confuse the parser', () => {
  assert.deepEqual(parseCsv('a,b\n"x, y","line1\nline2"\n'), [
    ['a', 'b'],
    ['x, y', 'line1\nline2'],
  ]);
});

test('JSON object needs a root source; row arrays need per-row sources', () => {
  const ok = {
    path: 'seed/pathways/t.json',
    content: JSON.stringify({ source: { doc: 'Toy' }, nodes: [] }),
  };
  assert.deepEqual(checkSeed([ok]), []);
  const noRoot = { path: 'seed/pathways/t.json', content: JSON.stringify({ nodes: [] }) };
  assert.match(checkSeed([noRoot])[0], /root object has no/);
  const badRows = {
    path: 'seed/safety/r.json',
    content: JSON.stringify({ source: 's', rules: [{ source: 'a' }, {}] }),
  };
  assert.match(checkSeed([badRows])[0], /rules\[1\]/);
});

test('JSON array elements each need a source; invalid JSON is reported', () => {
  assert.deepEqual(
    checkSeed([{ path: 'seed/a.json', content: '[{"source":"s"},{"source":"t"}]' }]),
    [],
  );
  assert.match(checkSeed([{ path: 'seed/a.json', content: '[{"x":1}]' }])[0], /element\[0\]/);
  assert.match(checkSeed([{ path: 'seed/a.json', content: '{oops' }])[0], /invalid JSON/);
});

test('scripts and docs are allowed; raw/licensed file types are rejected', () => {
  const allowed = ['seed/README.md', 'seed/medicines/build.mjs', 'seed/medicines/build.py'].map(
    (path) => ({
      path,
      content: 'x',
    }),
  );
  assert.deepEqual(checkSeed(allowed), []);
  const rejected = checkSeed(
    ['seed/nlem.pdf', 'seed/a.xlsx', 'seed/clip.wav', 'seed/noext'].map((path) => ({
      path,
      content: 'x',
    })),
  );
  assert.equal(rejected.length, 4);
  assert.match(rejected[0], /not allowed in seed/);
});
