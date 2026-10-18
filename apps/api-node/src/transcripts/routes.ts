// Saved transcripts (Phase 4B Run 2, ADR-D28). Doctor only, the session's own doctor, clinic-scoped (a session of
// another clinic or doctor is "not found"). Saving and confirming need audio + ai_processing consent AT THAT MOMENT.
// The text is clinical speech: it is returned to the doctor and stored, and never written to logs or the audit log
// (audit rows hold the session id and a segment COUNT only).
import { z } from 'zod';
import { getEffectiveConsent } from '../consent/service.js';
import type { Queryable } from '../db/tx.js';
import { errors } from '../http/errors.js';
import { permRoute, type RouteDef } from '../http/routeRegistry.js';
import { loadSession } from '../sessions/service.js';

const idParams = z.object({ id: z.uuid() });
type IdParams = z.infer<typeof idParams>;

const segmentBody = z
  .object({
    seq: z.number().int().min(0).max(9999),
    speaker: z.enum(['unknown', 'doctor', 'patient']),
    originalText: z.string().min(1).max(4000),
    /** null when the doctor has not changed the engine's text */
    editedText: z.string().min(1).max(4000).nullable(),
    language: z.string().max(12).nullable(),
    startMs: z.number().int().min(0).max(86_400_000).nullable(),
    endMs: z.number().int().min(0).max(86_400_000).nullable(),
    engine: z.string().min(1).max(40),
    engineVersion: z.string().max(60).nullable(),
  })
  .strict();
const saveBody = z
  .object({
    segments: z
      .array(segmentBody)
      .min(1)
      .max(200)
      .refine((s) => new Set(s.map((x) => x.seq)).size === s.length, 'seq must not repeat'),
  })
  .strict();
type SaveBody = z.infer<typeof saveBody>;

const segmentView = z.object({
  seq: z.number(),
  speaker: z.enum(['unknown', 'doctor', 'patient']),
  originalText: z.string(),
  editedText: z.string().nullable(),
  /** what to show: the edited text if there is one, else the engine's */
  text: z.string(),
  language: z.string().nullable(),
  startMs: z.number().nullable(),
  endMs: z.number().nullable(),
  engine: z.string(),
  engineVersion: z.string().nullable(),
  status: z.enum(['draft', 'confirmed']),
  confirmedAt: z.string().nullable(),
});

interface Row {
  seq: number;
  speaker: 'unknown' | 'doctor' | 'patient';
  original_text: string;
  edited_text: string | null;
  language: string | null;
  start_ms: number | null;
  end_ms: number | null;
  engine: string;
  engine_version: string | null;
  status: 'draft' | 'confirmed';
  confirmed_at: Date | null;
}

async function readSegments(db: Queryable, sessionId: string) {
  const r = await db.query<Row>(
    `SELECT seq, speaker, original_text, edited_text, language, start_ms, end_ms, engine, engine_version, status, confirmed_at
       FROM transcript_segment WHERE session_id = $1 ORDER BY seq`,
    [sessionId],
  );
  const segments = r.rows.map((s) => ({
    seq: s.seq,
    speaker: s.speaker,
    originalText: s.original_text,
    editedText: s.edited_text,
    text: s.edited_text ?? s.original_text,
    language: s.language,
    startMs: s.start_ms,
    endMs: s.end_ms,
    engine: s.engine,
    engineVersion: s.engine_version,
    status: s.status,
    confirmedAt: s.confirmed_at ? s.confirmed_at.toISOString() : null,
  }));
  return {
    segments,
    draftCount: segments.filter((s) => s.status === 'draft').length,
    confirmedCount: segments.filter((s) => s.status === 'confirmed').length,
  };
}

/** Removes the UNCONFIRMED draft text of a session (consent withdrawn). Confirmed text is kept. Returns how many rows. */
export async function deleteDraftSegments(db: Queryable, sessionId: string): Promise<number> {
  const r = await db.query(
    "DELETE FROM transcript_segment WHERE session_id = $1 AND status = 'draft'",
    [sessionId],
  );
  return r.rowCount ?? 0;
}

export function transcriptRoutes(): RouteDef[] {
  const listShape = z.object({
    segments: z.array(segmentView),
    draftCount: z.number(),
    confirmedCount: z.number(),
  });
  return [
    permRoute<IdParams>('transcript.read', {
      method: 'get',
      path: '/sessions/:id/transcript',
      tag: 'Transcript',
      summary:
        "Doctor: read the saved transcript of one of the doctor's own sessions (a draft until confirmed)",
      audit: [],
      params: idParams,
      response: listShape,
      handler: async (ctx) => {
        const session = await loadSession(ctx.db, ctx.auth, ctx.params.id);
        if (!session) throw errors.notFound('Session not found');
        return { data: await readSegments(ctx.db, session.id) };
      },
    }),

    permRoute<IdParams, SaveBody>('transcript.write', {
      method: 'put',
      path: '/sessions/:id/transcript/segments',
      tag: 'Transcript',
      summary:
        'Doctor: autosave transcript segments (create or update drafts by sequence number); needs audio and AI-processing consent now; a confirmed segment cannot be changed',
      audit: ['TRANSCRIPT_SAVED'],
      params: idParams,
      body: saveBody,
      response: listShape,
      handler: async (ctx) => {
        const session = await loadSession(ctx.db, ctx.auth, ctx.params.id);
        if (!session) throw errors.notFound('Session not found');
        const consent = await getEffectiveConsent(ctx.db, session.id);
        if (!consent.recordingAllowed) {
          throw errors.consentRequired('Consent required for: audio, ai_processing');
        }
        const seqs = ctx.body.segments.map((s) => s.seq);
        const locked = await ctx.db.query(
          "SELECT 1 FROM transcript_segment WHERE session_id = $1 AND seq = ANY($2::int[]) AND status = 'confirmed' LIMIT 1",
          [session.id, seqs],
        );
        if ((locked.rowCount ?? 0) > 0)
          throw errors.conflict('A confirmed segment cannot be changed');
        const s = ctx.body.segments;
        await ctx.db.query(
          `INSERT INTO transcript_segment
             (session_id, clinic_id, seq, speaker, original_text, edited_text, language, start_ms, end_ms, engine, engine_version)
           SELECT $1, $2, * FROM unnest($3::int[], $4::text[], $5::text[], $6::text[], $7::text[], $8::int[], $9::int[], $10::text[], $11::text[])
           ON CONFLICT (session_id, seq) DO UPDATE
             SET speaker = EXCLUDED.speaker, updated_at = now(),
                 edited_text = CASE WHEN EXCLUDED.edited_text = transcript_segment.original_text THEN NULL ELSE EXCLUDED.edited_text END
             WHERE transcript_segment.status = 'draft'`,
          [
            session.id,
            session.clinicId,
            seqs,
            s.map((x) => x.speaker),
            s.map((x) => x.originalText),
            // an "edit" that equals the engine's text is not an edit
            s.map((x) =>
              x.editedText !== null && x.editedText !== x.originalText ? x.editedText : null,
            ),
            s.map((x) => x.language),
            s.map((x) => x.startMs),
            s.map((x) => x.endMs),
            s.map((x) => x.engine),
            s.map((x) => x.engineVersion),
          ],
        );
        await ctx.audit({
          action: 'TRANSCRIPT_SAVED',
          resourceType: 'transcript',
          resourceId: session.id,
          sessionId: session.id,
          meta: { segmentCount: s.length },
        });
        return { data: await readSegments(ctx.db, session.id) };
      },
    }),

    permRoute<IdParams>('transcript.write', {
      method: 'post',
      path: '/sessions/:id/transcript/confirm',
      tag: 'Transcript',
      summary:
        'Doctor: confirm the transcript. Draft segments become confirmed text that is part of the record and can no longer be changed or deleted',
      audit: ['TRANSCRIPT_CONFIRMED'],
      params: idParams,
      response: listShape,
      handler: async (ctx) => {
        const session = await loadSession(ctx.db, ctx.auth, ctx.params.id);
        if (!session) throw errors.notFound('Session not found');
        const consent = await getEffectiveConsent(ctx.db, session.id);
        if (!consent.recordingAllowed) {
          throw errors.consentRequired('Consent required for: audio, ai_processing');
        }
        const done = await ctx.db.query(
          `UPDATE transcript_segment SET status = 'confirmed', confirmed_at = now(), confirmed_by = $2, updated_at = now()
            WHERE session_id = $1 AND status = 'draft'`,
          [session.id, ctx.auth.sub],
        );
        if ((done.rowCount ?? 0) === 0) throw errors.conflict('There is no draft text to confirm');
        await ctx.audit({
          action: 'TRANSCRIPT_CONFIRMED',
          resourceType: 'transcript',
          resourceId: session.id,
          sessionId: session.id,
          meta: { segmentCount: done.rowCount ?? 0 },
        });
        return { data: await readSegments(ctx.db, session.id) };
      },
    }),
  ];
}
