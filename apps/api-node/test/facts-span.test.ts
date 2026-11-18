import { describe, expect, it } from 'vitest';
import { findSpanInText, normaliseText, textHash } from '../src/facts/text.js';

describe('findSpanInText (fail-closed evidence integrity)', () => {
  it('finds exact substring match with correct character offsets', () => {
    const text = 'Patient complains of fever since two days and mild cough.';
    const quote = 'fever since two days';
    const span = findSpanInText(text, quote);
    expect(span).not.toBeNull();
    expect(text.slice(span!.start, span!.end)).toBe(quote);
  });

  it('refuses case-modified match to ensure evidence cannot be confirmed without exact match', () => {
    const text = 'Patient reports SEVERE HEADACHE since yesterday';
    const quote = 'severe headache';
    const span = findSpanInText(text, quote);
    expect(span).toBeNull();
  });

  it('refuses approximate or fuzzy similarity matches when transcript text has changed', () => {
    const text = 'Patient has had fevr since two days in the morning';
    const quote = 'fever since two days'; // typo / edit: transcript has "fevr", quote was "fever"
    // Fail-closed: Must NEVER guess or re-ground on fuzzy similarity
    expect(findSpanInText(text, quote)).toBeNull();
  });

  it('refuses re-grounding when evidence quote is no longer present in transcript', () => {
    const text = 'Patient has no symptoms today';
    const quote = 'severe chest pain';
    expect(findSpanInText(text, quote)).toBeNull();
  });

  it('refuses empty text or empty quote', () => {
    expect(findSpanInText('', 'fever')).toBeNull();
    expect(findSpanInText('Patient has fever', '')).toBeNull();
    expect(findSpanInText('   ', '  ')).toBeNull();
  });

  it('computes deterministic textHash after normalisation', () => {
    const t1 = ' દર્દીને   તાવ છે ';
    const t2 = 'દર્દીને તાવ છે';
    expect(textHash(t1)).toBe(textHash(t2));
    expect(normaliseText(t1)).toBe(t2);
  });
});
