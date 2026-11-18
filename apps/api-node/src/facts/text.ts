// Text normalisation shared by the speech/extraction service and api-node (ADR-D29). The span of a fact refers to the
// NORMALISED segment text: Unicode NFC, runs of whitespace collapsed to one space, trimmed. The hash of that text is
// stored with the fact; if the segment's text changes, the hash no longer matches and the fact is stale.
import { createHash } from 'node:crypto';
import { ratio } from '../pathways/rules.js';

export const normaliseText = (text: string): string =>
  text.normalize('NFC').replace(/\s+/g, ' ').trim();

export const textHash = (text: string): string =>
  createHash('sha256').update(normaliseText(text), 'utf8').digest('hex');

/**
 * Finds the character span of evidence within segment text.
 * Handles exact matches, case-folded matches, and fuzzy similarity search for fuzzy-matched facts.
 */
export function findSpanInText(
  text: string,
  quote: string,
  matchType: 'exact' | 'fuzzy' | null,
): { start: number; end: number } | null {
  const normText = normaliseText(text);
  const normQuote = normaliseText(quote);
  if (!normText || !normQuote) return null;

  // 1. Exact substring match
  const exactAt = normText.indexOf(normQuote);
  if (exactAt >= 0) {
    return { start: exactAt, end: exactAt + normQuote.length };
  }

  // 2. Case-insensitive substring match
  const lowerText = normText.toLowerCase();
  const lowerQuote = normQuote.toLowerCase();
  const lowerAt = lowerText.indexOf(lowerQuote);
  if (lowerAt >= 0) {
    return { start: lowerAt, end: lowerAt + normQuote.length };
  }

  // 3. For fuzzy-matched facts, look for sliding window with high similarity (>= 0.75)
  if (matchType === 'fuzzy' && normText.length <= 600 && normQuote.length >= 3) {
    const quoteLen = lowerQuote.length;
    const minW = Math.max(2, Math.floor(quoteLen * 0.75));
    const maxW = Math.min(lowerText.length, Math.ceil(quoteLen * 1.25));
    let bestRatio = 0;
    let bestSpan: { start: number; end: number } | null = null;

    for (let w = minW; w <= maxW; w++) {
      for (let s = 0; s <= lowerText.length - w; s++) {
        const slice = lowerText.slice(s, s + w);
        const r = ratio(slice, lowerQuote);
        if (r >= 0.75 && r > bestRatio) {
          bestRatio = r;
          bestSpan = { start: s, end: s + w };
        }
      }
    }
    if (bestSpan) return bestSpan;
  }

  return null;
}
