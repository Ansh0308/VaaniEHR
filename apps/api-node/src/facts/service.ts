// Extracted facts: shared pieces (types, views, staleness). Fact text is clinical speech: it is returned to the doctor
// and stored, never logged and never put in the audit log (ids and counts only).
import { z } from 'zod';
import type { Queryable } from '../db/tx.js';
import { normaliseText, textHash } from './text.js';

export const FACT_TYPES = [
  'symptom',
  'duration',
  'severity',
  'vital',
  'allergy',
  'past_condition',
  'current_medicine',
  'red_flag_mention',
] as const;
export const FACT_STATUSES = ['heard', 'confirmed', 'rejected', 'stale'] as const;
export const factType = z.enum(FACT_TYPES);
export const speaker = z.enum(['unknown', 'doctor', 'patient']);

export const factView = z.object({
  id: z.uuid(),
  type: factType,
  value: z.string(),
  negated: z.boolean(),
  uncertain: z.boolean(),
  speaker: speaker.nullable(),
  /** 'manual' = typed by the doctor (no span); 'extracted' = from the model, always with a source span */
  source: z.enum(['extracted', 'manual']),
  sourceSegmentSeq: z.number().nullable(),
  spanStart: z.number().nullable(),
  spanEnd: z.number().nullable(),
  evidenceQuote: z.string().nullable(),
  matchType: z.enum(['exact', 'fuzzy']).nullable(),
  status: z.enum(FACT_STATUSES),
  edited: z.boolean(),
  originalValue: z.string().nullable(),
  pipeline: z.string(),
  model: z.string().nullable(),
  conceptId: z.string().nullable(),
  snomedId: z.string().nullable(),
  confirmedAt: z.string().nullable(),
});

interface FactRow {
  id: string;
  type: (typeof FACT_TYPES)[number];
  value: string;
  negated: boolean;
  uncertain: boolean;
  speaker: 'unknown' | 'doctor' | 'patient' | null;
  source: 'extracted' | 'manual';
  seq: number | null;
  span_start: number | null;
  span_end: number | null;
  evidence_quote: string | null;
  match_type: 'exact' | 'fuzzy' | null;
  status: (typeof FACT_STATUSES)[number];
  edited: boolean;
  original_value: string | null;
  pipeline: string;
  model: string | null;
  concept_id: string | null;
  snomed_id: string | null;
  confirmed_at: Date | null;
}

export const toFactView = (r: FactRow) => ({
  id: r.id,
  type: r.type,
  value: r.value,
  negated: r.negated,
  uncertain: r.uncertain,
  speaker: r.speaker,
  source: r.source,
  sourceSegmentSeq: r.seq,
  spanStart: r.span_start,
  spanEnd: r.span_end,
  evidenceQuote: r.evidence_quote,
  matchType: r.match_type,
  status: r.status,
  edited: r.edited,
  originalValue: r.original_value,
  pipeline: r.pipeline,
  model: r.model,
  conceptId: r.concept_id,
  snomedId: r.snomed_id,
  confirmedAt: r.confirmed_at ? r.confirmed_at.toISOString() : null,
});

export async function readFacts(db: Queryable, sessionId: string, status?: string) {
  const r = await db.query<FactRow>(
    `SELECT f.id, f.type, f.value, f.negated, f.uncertain, f.speaker, f.source, s.seq, f.span_start, f.span_end,
            f.evidence_quote, f.match_type, f.status, f.edited, f.original_value, f.pipeline, f.model, f.concept_id,
            f.snomed_id, f.confirmed_at
       FROM extracted_fact f LEFT JOIN transcript_segment s ON s.id = f.source_segment_id
      WHERE f.session_id = $1 AND ($2::text IS NULL OR f.status = $2)
      ORDER BY coalesce(s.seq, 1000000), f.span_start NULLS LAST, f.created_at`,
    [sessionId, status ?? null],
  );
  const facts = r.rows.map(toFactView);
  const count = (s: string) => facts.filter((f) => f.status === s).length;
  return {
    facts,
    heardCount: count('heard'),
    confirmedCount: count('confirmed'),
    rejectedCount: count('rejected'),
    staleCount: count('stale'),
  };
}

/**
 * Facts whose source segment text changed become 'stale' (heard or confirmed ones; the doctor must re-confirm).
 * They are never rewritten. `seqs` are the segment numbers that were just saved. Returns how many became stale.
 */
export async function markStaleForSegments(
  db: Queryable,
  sessionId: string,
  seqs: number[],
): Promise<number> {
  if (seqs.length === 0) return 0;
  const segs = await db.query<{ id: string; text: string }>(
    `SELECT id, coalesce(edited_text, original_text) AS text FROM transcript_segment
      WHERE session_id = $1 AND seq = ANY($2::int[])`,
    [sessionId, seqs],
  );
  let stale = 0;
  for (const s of segs.rows) {
    const r = await db.query(
      `UPDATE extracted_fact SET status = 'stale', confirmed_at = NULL, updated_at = now()
        WHERE source_segment_id = $1 AND status IN ('heard', 'confirmed') AND segment_text_hash <> $2`,
      [s.id, textHash(s.text)],
    );
    stale += r.rowCount ?? 0;
  }
  return stale;
}

export { normaliseText, textHash };
