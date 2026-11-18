// Text normalisation shared by the speech/extraction service and api-node (ADR-D29). The span of a fact refers to the
// NORMALISED segment text: Unicode NFC, runs of whitespace collapsed to one space, trimmed. The hash of that text is
// stored with the fact; if the segment's text changes, the hash no longer matches and the fact is stale.
import { createHash } from 'node:crypto';

export const normaliseText = (text: string): string =>
  text.normalize('NFC').replace(/\s+/g, ' ').trim();

export const textHash = (text: string): string =>
  createHash('sha256').update(normaliseText(text), 'utf8').digest('hex');

/**
 * Locates the exact character span of verified evidence within segment text.
 * Requires an exact verbatim substring match after Unicode NFC normalisation.
 * Does NOT accept approximate, fuzzy, or case-folded similarity to re-ground stale evidence (fail-closed clinical integrity).
 */
export function findSpanInText(text: string, quote: string): { start: number; end: number } | null {
  const normText = normaliseText(text);
  const normQuote = normaliseText(quote);
  if (!normText || !normQuote) return null;

  // Exact verbatim substring match
  const exactAt = normText.indexOf(normQuote);
  if (exactAt >= 0) {
    return { start: exactAt, end: exactAt + normQuote.length };
  }

  // Fail-closed: Never approximate or guess modified evidence.
  return null;
}
