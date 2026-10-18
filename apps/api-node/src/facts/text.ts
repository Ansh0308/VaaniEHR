// Text normalisation shared by the speech/extraction service and api-node (ADR-D29). The span of a fact refers to the
// NORMALISED segment text: Unicode NFC, runs of whitespace collapsed to one space, trimmed. The hash of that text is
// stored with the fact; if the segment's text changes, the hash no longer matches and the fact is stale.
import { createHash } from 'node:crypto';

export const normaliseText = (text: string): string =>
  text.normalize('NFC').replace(/\s+/g, ' ').trim();

export const textHash = (text: string): string =>
  createHash('sha256').update(normaliseText(text), 'utf8').digest('hex');
