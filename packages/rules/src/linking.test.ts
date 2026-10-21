// The TypeScript linker (ADR-D37): behaviour, and parity with the Python reference through the shared fixture.
import { describe, expect, it } from 'vitest';
import { ConceptLinker, norm, ratio } from './linking.js';
import { FIXTURES, readJson } from './testutil.js';
import { join } from 'node:path';

interface Parity {
  concepts: { id: string; labels: Record<string, string[]> }[];
  cases: {
    type: string;
    value: string;
    limit: number;
    expect: { concept_id: string; form: string; method: string; score: number }[];
  }[];
}
const parity = readJson(join(FIXTURES, 'concepts', 'linker-parity.json')) as Parity;

describe('the TypeScript linker matches the Python reference', () => {
  const linker = new ConceptLinker(parity.concepts);
  it('gives the same suggestions for every case of the parity file', () => {
    expect(parity.cases.length).toBeGreaterThan(40);
    for (const c of parity.cases) {
      expect({
        case: [c.type, c.value, c.limit],
        got: linker.suggest(c.type, c.value, c.limit),
      }).toEqual({
        case: [c.type, c.value, c.limit],
        got: c.expect,
      });
    }
  });
});

describe('the pieces', () => {
  it('normalises like the reference: NFC, case, punctuation, whitespace, all three scripts', () => {
    expect(norm('  Fever!! ')).toBe('fever');
    expect(norm('ખાંસી'.normalize('NFD'))).toBe('ખાંસી');
    expect(norm('cold (runny nose)')).toBe('cold runny nose');
    expect(norm('Drug-A twice')).toBe('drug a twice');
  });
  it('computes the difflib ratio exactly', () => {
    expect(ratio('fevr', 'fever')).toBeCloseTo(0.8889, 4);
    expect(ratio('chest paine', 'chest pain')).toBeCloseTo(0.9524, 4);
    expect(ratio('', '')).toBe(1);
    expect(ratio('abc', 'xyz')).toBe(0);
    expect(ratio('abcd', 'abcd')).toBe(1);
  });
  it('ranks exact, then contained, then fuzzy, keeps ties, limits, and only links symptoms', () => {
    const l = new ConceptLinker([
      { id: 'a', labels: { en: ['pain'] } },
      { id: 'b', labels: { en: ['pain'] } },
      { id: 'c', labels: { en: ['chest pain'] } },
      { id: 'd', labels: { en: ['chest paine'] } },
    ]);
    expect(l.suggest('symptom', 'chest pain').map((s) => [s.concept_id, s.method])).toEqual([
      ['c', 'exact'],
      ['a', 'contained'],
      ['b', 'contained'],
    ]);
    expect(l.suggest('symptom', 'pain').map((s) => s.concept_id)).toEqual(['a', 'b']);
    expect(l.suggest('symptom', 'pain', 1)).toHaveLength(1);
    expect(l.suggest('allergy', 'pain')).toEqual([]);
    expect(l.suggest('symptom', '   ')).toEqual([]);
  });
});
