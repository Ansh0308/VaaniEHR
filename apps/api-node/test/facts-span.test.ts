import { describe, expect, it } from 'vitest';
import { findSpanInText, normaliseText, textHash } from '../src/facts/text.js';

describe('findSpanInText', () => {
  it('finds exact substring match with correct character offsets', () => {
    const text = 'Patient complains of fever since two days and mild cough.';
    const quote = 'fever since two days';
    const span = findSpanInText(text, quote, 'exact');
    expect(span).not.toBeNull();
    expect(text.slice(span!.start, span!.end)).toBe(quote);
  });

  it('finds case-insensitive substring match', () => {
    const text = 'Patient reports SEVERE HEADACHE since yesterday';
    const quote = 'severe headache';
    const span = findSpanInText(text, quote, 'exact');
    expect(span).not.toBeNull();
    expect(text.slice(span!.start, span!.end).toLowerCase()).toBe(quote.toLowerCase());
  });

  it('finds fuzzy sliding window match when matchType is fuzzy', () => {
    const text = 'Patient has had fevr since two days in the morning';
    const quote = 'fever since two days'; // model output had "fever", transcript had "fevr"
    const span = findSpanInText(text, quote, 'fuzzy');
    expect(span).not.toBeNull();
    expect(span!.start).toBeGreaterThanOrEqual(16);
    expect(span!.end).toBeLessThanOrEqual(40);
  });

  it('returns null when evidence quote is no longer present in transcript', () => {
    const text = 'Patient has no symptoms today';
    const quote = 'severe chest pain';
    expect(findSpanInText(text, quote, 'exact')).toBeNull();
    expect(findSpanInText(text, quote, 'fuzzy')).toBeNull();
  });

  it('returns null on empty text or empty quote', () => {
    expect(findSpanInText('', 'fever', 'exact')).toBeNull();
    expect(findSpanInText('Patient has fever', '', 'exact')).toBeNull();
    expect(findSpanInText('   ', '  ', null)).toBeNull();
  });

  it('computes deterministic textHash after normalisation', () => {
    const t1 = ' દર્દીને   તાવ છે ';
    const t2 = 'દર્દીને તાવ છે';
    expect(textHash(t1)).toBe(textHash(t2));
    expect(normaliseText(t1)).toBe(t2);
  });
});
