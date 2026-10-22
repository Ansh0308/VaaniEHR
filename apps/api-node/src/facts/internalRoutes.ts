// INTERNAL routes for the extraction pipeline in asr-py (ADR-D29): service-signed, never reachable with a user token.
// asr-py reads the segment ids and TEXT of a session (and nothing else: no patient, clinic or user data), and submits
// the facts it found. Both need audio + ai_processing consent at that moment. A submitted fact is accepted only if its
// segment belongs to the session, its text hash still matches the segment, its span is inside the text and (for an
// exact match) the quote is exactly what the span covers. Existing facts are never touched: duplicates are skipped.
import { z } from 'zod';
import { getEffectiveConsent } from '../consent/service.js';
import { errors } from '../http/errors.js';
import { serviceRoute, type RouteDef } from '../http/routeRegistry.js';
import { factType, normaliseText, speaker, textHash } from './service.js';

const idParams = z.object({ id: z.uuid() });
type IdParams = z.infer<typeof idParams>;

const factBody = z
  .object({
    segmentId: z.uuid(),
    type: factType,
    value: z.string().trim().min(1).max(500),
    negated: z.boolean(),
    uncertain: z.boolean(),
    speaker: speaker.nullable(),
    spanStart: z.number().int().min(0),
    spanEnd: z.number().int().min(1),
    evidenceQuote: z.string().min(1).max(1000),
    matchType: z.enum(['exact', 'fuzzy']),
    segmentTextHash: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();
const submitBody = z
  .object({
    runId: z.uuid(),
    pipeline: z.enum(['plain', 'constrained', 'grounded']),
    model: z.string().min(1).max(120),
    /** facts the pipeline dropped as ungrounded (the hallucination count), recorded as a number only */
    droppedUngrounded: z.number().int().min(0).max(100_000),
    facts: z.array(factBody).max(500),
  })
  .strict();
type SubmitBody = z.infer<typeof submitBody>;

const asService = { actorRole: 'service' } as const;

export function factInternalRoutes(): RouteDef[] {
  return [
    serviceRoute<IdParams>({
      method: 'get',
      path: '/internal/sessions/:id/transcript-segments',
      tag: 'Internal',
      summary:
        'Service: segment ids, order, speaker and TEXT of a session for extraction (needs audio and AI-processing consent; no patient, clinic or user data)',
      audit: [],
      params: idParams,
      response: z.object({
        segments: z.array(
          z.object({ segmentId: z.uuid(), seq: z.number(), speaker: speaker, text: z.string() }),
        ),
      }),
      handler: async (ctx) => {
        const exists = await ctx.db.query('SELECT 1 FROM consultation_session WHERE id = $1', [
          ctx.params.id,
        ]);
        if ((exists.rowCount ?? 0) === 0) throw errors.notFound('Session not found');
        const consent = await getEffectiveConsent(ctx.db, ctx.params.id);
        if (!consent.recordingAllowed) {
          throw errors.consentRequired('Consent required for: audio, ai_processing');
        }
        const r = await ctx.db.query<{
          id: string;
          seq: number;
          speaker: 'unknown' | 'doctor' | 'patient';
          text: string;
        }>(
          `SELECT id, seq, speaker, coalesce(edited_text, original_text) AS text
             FROM transcript_segment WHERE session_id = $1 ORDER BY seq`,
          [ctx.params.id],
        );
        return {
          data: {
            segments: r.rows.map((s) => ({
              segmentId: s.id,
              seq: s.seq,
              speaker: s.speaker,
              text: s.text,
            })),
          },
        };
      },
    }),

    serviceRoute<IdParams, SubmitBody>({
      method: 'post',
      path: '/internal/sessions/:id/facts',
      tag: 'Internal',
      summary:
        'Service: submit extracted facts as "heard" (grounded facts only; stale, invalid and duplicate ones are counted and skipped)',
      audit: ['FACTS_EXTRACTED'],
      params: idParams,
      body: submitBody,
      response: z.object({
        inserted: z.number(),
        duplicates: z.number(),
        staleRejected: z.number(),
        invalidRejected: z.number(),
      }),
      successStatus: 201,
      handler: async (ctx) => {
        const session = await ctx.db.query<{ clinicos_clinic_id: string }>(
          'SELECT clinicos_clinic_id FROM consultation_session WHERE id = $1',
          [ctx.params.id],
        );
        const clinicId = session.rows[0]?.clinicos_clinic_id;
        if (!clinicId) throw errors.notFound('Session not found');
        const consent = await getEffectiveConsent(ctx.db, ctx.params.id);
        if (!consent.recordingAllowed) {
          throw errors.consentRequired('Consent required for: audio, ai_processing');
        }
        // a signed visit's content is locked: no new facts arrive after sign-off (Phase 8)
        const signed = await ctx.db.query(
          "SELECT 1 FROM visit_record WHERE session_id = $1 AND status = 'signed'",
          [ctx.params.id],
        );
        if ((signed.rowCount ?? 0) > 0) throw errors.visitSigned();
        const b = ctx.body;
        const segs = await ctx.db.query<{ id: string; text: string }>(
          `SELECT id, coalesce(edited_text, original_text) AS text FROM transcript_segment
            WHERE session_id = $1 AND id = ANY($2::uuid[])`,
          [ctx.params.id, [...new Set(b.facts.map((f) => f.segmentId))]],
        );
        const text = new Map(segs.rows.map((s) => [s.id, normaliseText(s.text)]));
        let inserted = 0;
        let duplicates = 0;
        let staleRejected = 0;
        let invalidRejected = 0;
        for (const f of b.facts) {
          const current = text.get(f.segmentId);
          if (current === undefined) {
            invalidRejected += 1; // not a segment of this session
            continue;
          }
          if (textHash(current) !== f.segmentTextHash) {
            staleRejected += 1; // the text changed after the model read it
            continue;
          }
          const inside = f.spanEnd <= current.length && f.spanEnd > f.spanStart;
          const quoteOk =
            f.matchType === 'fuzzy' || current.slice(f.spanStart, f.spanEnd) === f.evidenceQuote;
          if (!inside || !quoteOk) {
            invalidRejected += 1;
            continue;
          }
          const r = await ctx.db.query(
            `INSERT INTO extracted_fact
               (session_id, clinic_id, type, value, negated, uncertain, speaker, source, source_segment_id, span_start,
                span_end, evidence_quote, match_type, segment_text_hash, status, pipeline, model, run_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,'extracted',$8,$9,$10,$11,$12,$13,'heard',$14,$15,$16)
             ON CONFLICT DO NOTHING`,
            [
              ctx.params.id,
              clinicId,
              f.type,
              f.value,
              f.negated,
              f.uncertain,
              f.speaker,
              f.segmentId,
              f.spanStart,
              f.spanEnd,
              f.evidenceQuote,
              f.matchType,
              f.segmentTextHash,
              b.pipeline,
              b.model,
              b.runId,
            ],
          );
          if ((r.rowCount ?? 0) > 0) inserted += 1;
          else duplicates += 1;
        }
        await ctx.audit({
          ...asService,
          action: 'FACTS_EXTRACTED',
          resourceType: 'fact',
          resourceId: b.runId,
          clinicId,
          sessionId: ctx.params.id,
          meta: {
            inserted,
            duplicates,
            staleRejected,
            invalidRejected,
            droppedUngrounded: b.droppedUngrounded,
          },
        });
        return { data: { inserted, duplicates, staleRejected, invalidRejected }, status: 201 };
      },
    }),
  ];
}
