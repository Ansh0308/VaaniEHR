// Facts for the doctor (Phase 5A Run 1, ADR-D29): list, confirm / reject / edit, and add a manual fact. Doctor only,
// the session's own doctor, clinic-scoped. Changing a fact needs audio + ai_processing consent at that moment.
// A confirmed fact is only ever changed by an explicit doctor action here, never by the extraction pipeline.
import { z } from 'zod';
import { getEffectiveConsent } from '../consent/service.js';
import type { Queryable } from '../db/tx.js';
import { errors } from '../http/errors.js';
import { permRoute, type RouteDef } from '../http/routeRegistry.js';
import { loadSession } from '../sessions/service.js';
import { factType, factView, normaliseText, readFacts, speaker, textHash } from './service.js';

const idParams = z.object({ id: z.uuid() });
type IdParams = z.infer<typeof idParams>;
const factParams = z.object({ id: z.uuid(), factId: z.uuid() });
type FactParams = z.infer<typeof factParams>;
const listQuery = z.object({
  status: z.enum(['heard', 'confirmed', 'rejected', 'stale']).optional(),
});
type ListQuery = z.infer<typeof listQuery>;

const manualBody = z
  .object({
    type: factType,
    value: z.string().trim().min(1).max(500),
    negated: z.boolean().default(false),
    uncertain: z.boolean().default(false),
    speaker: speaker.nullable().default(null),
  })
  .strict();
type ManualBody = z.infer<typeof manualBody>;

const patchBody = z
  .object({
    action: z.enum(['confirm', 'reject', 'edit']),
    value: z.string().trim().min(1).max(500).optional(),
    negated: z.boolean().optional(),
    uncertain: z.boolean().optional(),
  })
  .strict()
  .refine(
    (b) =>
      b.action === 'edit' ||
      (b.value === undefined && b.negated === undefined && b.uncertain === undefined),
    'only an edit carries new values',
  )
  .refine(
    (b) =>
      b.action !== 'edit' ||
      b.value !== undefined ||
      b.negated !== undefined ||
      b.uncertain !== undefined,
    'an edit must change something',
  );
type PatchBody = z.infer<typeof patchBody>;

const listShape = z.object({
  facts: z.array(factView),
  heardCount: z.number(),
  confirmedCount: z.number(),
  rejectedCount: z.number(),
  staleCount: z.number(),
});

async function requireConsent(db: Queryable, sessionId: string): Promise<void> {
  const consent = await getEffectiveConsent(db, sessionId);
  if (!consent.recordingAllowed) {
    throw errors.consentRequired('Consent required for: audio, ai_processing');
  }
}

interface Locked {
  id: string;
  type: string;
  status: 'heard' | 'confirmed' | 'rejected' | 'stale';
  source_segment_id: string | null;
  evidence_quote: string | null;
}

export function factRoutes(): RouteDef[] {
  return [
    permRoute<IdParams, unknown, ListQuery>('fact.read', {
      method: 'get',
      path: '/sessions/:id/facts',
      tag: 'Facts',
      summary:
        "Doctor: list the facts extracted from one of the doctor's own sessions (heard until confirmed)",
      audit: [],
      params: idParams,
      query: listQuery,
      response: listShape,
      handler: async (ctx) => {
        const session = await loadSession(ctx.db, ctx.auth, ctx.params.id);
        if (!session) throw errors.notFound('Session not found');
        return { data: await readFacts(ctx.db, session.id, ctx.query.status) };
      },
    }),

    permRoute<IdParams, ManualBody>('fact.write', {
      method: 'post',
      path: '/sessions/:id/facts',
      tag: 'Facts',
      summary:
        'Doctor: add a fact by hand (flagged manual; it has no source span and is confirmed at once)',
      audit: ['FACT_ADDED'],
      params: idParams,
      body: manualBody,
      response: factView,
      successStatus: 201,
      handler: async (ctx) => {
        const session = await loadSession(ctx.db, ctx.auth, ctx.params.id);
        if (!session) throw errors.notFound('Session not found');
        await requireConsent(ctx.db, session.id);
        const b = ctx.body;
        const inserted = await ctx.db.query<{ id: string }>(
          `INSERT INTO extracted_fact (session_id, clinic_id, type, value, negated, uncertain, speaker, source, status,
                                       pipeline, confirmed_at, confirmed_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'manual','confirmed','manual', now(), $8) RETURNING id`,
          [
            session.id,
            session.clinicId,
            b.type,
            b.value,
            b.negated,
            b.uncertain,
            b.speaker,
            ctx.auth.sub,
          ],
        );
        const id = inserted.rows[0]?.id as string;
        await ctx.audit({
          action: 'FACT_ADDED',
          resourceType: 'fact',
          resourceId: id,
          sessionId: session.id,
          meta: { factType: b.type },
        });
        const all = await readFacts(ctx.db, session.id);
        const fact = all.facts.find((f) => f.id === id);
        if (!fact) throw new Error('fact missing after insert');
        return { data: fact, status: 201 };
      },
    }),

    permRoute<FactParams, PatchBody>('fact.write', {
      method: 'patch',
      path: '/sessions/:id/facts/:factId',
      tag: 'Facts',
      summary:
        'Doctor: confirm, reject or edit one fact. A stale fact (its source text changed) is re-confirmed only if its evidence quote is still in the segment',
      audit: ['FACT_CONFIRMED', 'FACT_REJECTED', 'FACT_EDITED'],
      params: factParams,
      body: patchBody,
      response: factView,
      handler: async (ctx) => {
        const session = await loadSession(ctx.db, ctx.auth, ctx.params.id);
        if (!session) throw errors.notFound('Session not found');
        await requireConsent(ctx.db, session.id);
        const found = await ctx.db.query<Locked>(
          `SELECT id, type, status, source_segment_id, evidence_quote
             FROM extracted_fact WHERE id = $1 AND session_id = $2 FOR UPDATE`,
          [ctx.params.factId, session.id],
        );
        const f = found.rows[0];
        if (!f) throw errors.notFound('Fact not found');
        const b = ctx.body;

        if (b.action === 'reject') {
          await ctx.db.query(
            "UPDATE extracted_fact SET status = 'rejected', confirmed_at = NULL, updated_at = now() WHERE id = $1",
            [f.id],
          );
        } else {
          // confirm or edit: a stale fact is re-checked against the CURRENT text of its segment
          let span: { start: number; end: number; hash: string } | null = null;
          if (f.status === 'stale') {
            if (!f.source_segment_id || !f.evidence_quote) {
              throw errors.conflict('The source text no longer exists');
            }
            const seg = await ctx.db.query<{ text: string }>(
              'SELECT coalesce(edited_text, original_text) AS text FROM transcript_segment WHERE id = $1',
              [f.source_segment_id],
            );
            const text = seg.rows[0]?.text;
            const quote = normaliseText(f.evidence_quote);
            const at = text === undefined ? -1 : normaliseText(text).indexOf(quote);
            if (text === undefined || at < 0) {
              throw errors.conflict(
                'The evidence is no longer in the transcript; edit the text or reject the fact',
              );
            }
            span = { start: at, end: at + quote.length, hash: textHash(text) };
          }
          const edit = b.action === 'edit';
          await ctx.db.query(
            `UPDATE extracted_fact SET
               original_value = CASE WHEN $2::boolean AND NOT edited THEN value ELSE original_value END,
               original_negated = CASE WHEN $2::boolean AND NOT edited THEN negated ELSE original_negated END,
               original_uncertain = CASE WHEN $2::boolean AND NOT edited THEN uncertain ELSE original_uncertain END,
               value = coalesce($3, value), negated = coalesce($4, negated), uncertain = coalesce($5, uncertain),
               edited = edited OR $2::boolean,
               span_start = coalesce($6, span_start), span_end = coalesce($7, span_end),
               segment_text_hash = coalesce($8, segment_text_hash),
               status = 'confirmed', confirmed_at = now(), confirmed_by = $9, updated_at = now()
             WHERE id = $1`,
            [
              f.id,
              edit,
              edit ? (b.value ?? null) : null,
              edit ? (b.negated ?? null) : null,
              edit ? (b.uncertain ?? null) : null,
              span?.start ?? null,
              span?.end ?? null,
              span?.hash ?? null,
              ctx.auth.sub,
            ],
          );
        }
        await ctx.audit({
          action:
            b.action === 'confirm'
              ? 'FACT_CONFIRMED'
              : b.action === 'reject'
                ? 'FACT_REJECTED'
                : 'FACT_EDITED',
          resourceType: 'fact',
          resourceId: f.id,
          sessionId: session.id,
          meta: { factType: f.type },
        });
        const all = await readFacts(ctx.db, session.id);
        const fact = all.facts.find((x) => x.id === f.id);
        if (!fact) throw new Error('fact missing after update');
        return { data: fact };
      },
    }),
  ];
}
