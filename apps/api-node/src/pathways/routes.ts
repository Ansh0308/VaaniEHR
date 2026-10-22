// Pathway endpoints for the doctor (Phase 6A, ADR-D34): the next suggested question, what the doctor did with it, the
// shortlist of CANDIDATE conditions with evidence, and the doctor's choice of a WORKING CONDITION. Nothing here diagnoses.
// Doctor only, the session's own doctor, clinic-scoped, and consent (audio + AI processing) is checked at call time.
import { z } from 'zod';
import { getEffectiveConsent } from '../consent/service.js';
import type { Queryable } from '../db/tx.js';
import { errors } from '../http/errors.js';
import { permRoute, type RouteDef } from '../http/routeRegistry.js';
import { loadSession } from '../sessions/service.js';
import { computeState, ensureEvent, langQuery, type LangQuery } from './service.js';

const idParams = z.object({ id: z.uuid() });
type IdParams = z.infer<typeof idParams>;
const eventParams = z.object({ id: z.uuid(), eventId: z.uuid() });
type EventParams = z.infer<typeof eventParams>;

const actionBody = z
  .object({ action: z.enum(['asked', 'dismissed', 'snoozed', 'acknowledged']) })
  .strict();
type ActionBody = z.infer<typeof actionBody>;

const selectBody = z.union([
  z.object({ pathwayId: z.string().min(1).max(64), version: z.number().int().min(1) }).strict(),
  z.object({ notListed: z.literal(true), text: z.string().trim().min(1).max(200) }).strict(),
]);
type SelectBody = z.infer<typeof selectBody>;

const nextShape = z.object({
  outcome: z.enum(['QUESTION', 'RED_FLAG', 'ABSTAIN', 'COMPLETE']),
  eventId: z.uuid().nullable(),
  eventStatus: z.string().nullable(),
  nodeId: z.string().nullable(),
  pathwayId: z.string().nullable(),
  pathwayVersion: z.number().nullable(),
  slot: z.string().nullable(),
  /** the question to put to the patient, for the doctor to use or not */
  ask: z.string().nullable(),
  /** one line: why this is suggested */
  reasonText: z.string(),
  redFlags: z.array(z.string()),
  questionsUsed: z.number(),
  questionCap: z.number(),
  slotConflicts: z.array(z.string()),
  pathwayTitle: z.string().nullable(),
  pathwayStatus: z.enum(['test', 'draft', 'active']).nullable(),
  /** true when any loaded pathway is not active: the screen then says "Test pathway - not clinical" */
  notActive: z.boolean(),
});

const evidenceShape = z.object({
  ruleId: z.string(),
  slot: z.string(),
  nodeId: z.string().nullable(),
  /** the confirmed fact that set this slot, if any (the screen shows that fact) */
  factId: z.string().nullable(),
});
const candidateShape = z.object({
  rank: z.number(),
  pathwayId: z.string(),
  version: z.number(),
  title: z.string(),
  status: z.enum(['test', 'draft', 'active']),
  score: z.number(),
  evidenceFor: z.array(evidenceShape),
  evidenceAgainst: z.array(evidenceShape),
  source: z.object({ doc: z.string(), page: z.union([z.string(), z.number()]) }),
});
const selectedShape = z
  .object({
    notListed: z.boolean(),
    pathwayId: z.string().nullable(),
    version: z.number().nullable(),
    title: z.string().nullable(),
    text: z.string().nullable(),
    selectedAt: z.string(),
  })
  .nullable();
const candidatesShape = z.object({
  outcome: z.enum(['QUESTION', 'RED_FLAG', 'ABSTAIN', 'COMPLETE']),
  /** shown with the list: these are suggestions for the doctor to consider, not a diagnosis */
  notice: z.string(),
  notActive: z.boolean(),
  candidates: z.array(candidateShape),
  selected: selectedShape,
});

async function requireConsent(db: Queryable, sessionId: string): Promise<void> {
  const consent = await getEffectiveConsent(db, sessionId);
  if (!consent.recordingAllowed) {
    throw errors.consentRequired('Consent required for: audio, ai_processing');
  }
}

interface SelectedRow {
  not_listed: boolean;
  pathway_id: string | null;
  pathway_version: number | null;
  not_listed_text: string | null;
  selected_at: Date;
}

async function readSelected(
  db: Queryable,
  sessionId: string,
  titleOf: (id: string | null) => string | null,
) {
  const r = await db.query<SelectedRow>(
    `SELECT not_listed, pathway_id, pathway_version, not_listed_text, selected_at FROM candidate
      WHERE session_id = $1 AND kind = 'selected' AND superseded_at IS NULL`,
    [sessionId],
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    notListed: row.not_listed,
    pathwayId: row.pathway_id,
    version: row.pathway_version,
    title: titleOf(row.pathway_id),
    text: row.not_listed_text,
    selectedAt: row.selected_at.toISOString(),
  };
}

const NOTICE =
  'Candidates for the doctor to consider, with the evidence for and against. This is not a diagnosis; the doctor decides.';

const titleIn = (
  pathways: { id: string; title: Record<'en' | 'gu' | 'hi', string> }[],
  id: string | null,
  lang: 'en' | 'gu' | 'hi',
): string | null => (id === null ? null : (pathways.find((p) => p.id === id)?.title[lang] ?? null));

const recordShape = z.object({
  selected: selectedShape,
  acknowledgedRedFlags: z.array(
    z.object({
      eventId: z.uuid(),
      pathwayId: z.string(),
      pathwayTitle: z.string().nullable(),
      actedAt: z.string(),
    }),
  ),
  notActive: z.boolean(),
});

export function pathwayRoutes(): RouteDef[] {
  return [
    permRoute<IdParams, unknown, LangQuery>('question.read', {
      method: 'get',
      path: '/sessions/:id/questions/next',
      tag: 'Pathways',
      summary:
        'Doctor: the next suggested question, or a red flag, or "more information needed" (rules only, no language model)',
      audit: [], // a read: the question_event row (pathway id + version + time) is the record; acting on it is audited
      params: idParams,
      query: langQuery,
      response: nextShape,
      handler: async (ctx) => {
        const session = await loadSession(ctx.db, ctx.auth, ctx.params.id);
        if (!session) throw errors.notFound('Session not found');
        await requireConsent(ctx.db, session.id);
        const catalog = ctx.services.pathways;
        const state = await computeState(ctx.db, catalog, session.id, ctx.query.lang);
        const { out } = state;
        const event = await ensureEvent(ctx.db, session, out);
        return {
          data: {
            outcome: out.outcome,
            eventId: event?.id ?? null,
            eventStatus: event?.status ?? null,
            nodeId: out.node_id,
            pathwayId: out.pathway_id,
            pathwayVersion: out.pathway_version,
            slot: out.slot,
            ask: out.ask,
            reasonText: out.reason_text,
            redFlags: out.red_flags,
            questionsUsed: state.questionsUsed,
            questionCap: catalog.engine.question_cap,
            slotConflicts: state.conflicts,
            pathwayTitle: titleIn(catalog.pathways, out.pathway_id, ctx.query.lang),
            pathwayStatus: catalog.pathways.find((p) => p.id === out.pathway_id)?.status ?? null,
            notActive: catalog.pathways.some((p) => p.status !== 'active'),
          },
        };
      },
    }),

    permRoute<EventParams, ActionBody>('question.act', {
      method: 'post',
      path: '/sessions/:id/questions/:eventId/action',
      lockedWhenSigned: true,
      tag: 'Pathways',
      summary:
        'Doctor: record what was done with a suggested question (asked, dismissed, snoozed) or acknowledge a red flag',
      audit: ['QUESTION_ACTED', 'RED_FLAG_ACKNOWLEDGED'],
      params: eventParams,
      body: actionBody,
      response: z.object({ id: z.uuid(), status: z.string() }),
      handler: async (ctx) => {
        const session = await loadSession(ctx.db, ctx.auth, ctx.params.id);
        if (!session) throw errors.notFound('Session not found');
        await requireConsent(ctx.db, session.id);
        const found = await ctx.db.query<{
          id: string;
          kind: 'question' | 'red_flag';
          status: string;
          pathway_id: string;
          node_id: string;
        }>(
          `SELECT id, kind, status, pathway_id, node_id FROM question_event
            WHERE id = $1 AND session_id = $2 FOR UPDATE`,
          [ctx.params.eventId, session.id],
        );
        const e = found.rows[0];
        if (!e) throw errors.notFound('Question not found');
        const redFlag = e.kind === 'red_flag';
        if (redFlag !== (ctx.body.action === 'acknowledged')) {
          throw errors.validation(
            redFlag
              ? 'A red flag can only be acknowledged'
              : 'A question is asked, dismissed or snoozed; only a red flag is acknowledged',
          );
        }
        if (e.status !== 'suggested') throw errors.conflict('This suggestion was already handled');
        await ctx.db.query(
          'UPDATE question_event SET status = $2, acted_at = now(), acted_by = $3 WHERE id = $1',
          [e.id, ctx.body.action, ctx.auth.sub],
        );
        await ctx.audit({
          action: redFlag ? 'RED_FLAG_ACKNOWLEDGED' : 'QUESTION_ACTED',
          resourceType: 'question_event',
          resourceId: e.id,
          sessionId: session.id,
          meta: redFlag
            ? { pathwayId: e.pathway_id, nodeId: e.node_id }
            : { pathwayId: e.pathway_id, nodeId: e.node_id, questionAction: ctx.body.action },
        });
        return { data: { id: e.id, status: ctx.body.action } };
      },
    }),

    permRoute<IdParams, unknown, LangQuery>('candidate.read', {
      method: 'get',
      path: '/sessions/:id/candidates',
      tag: 'Pathways',
      summary:
        "Doctor: the top candidate conditions with evidence for and against, and the doctor's working condition if chosen",
      audit: [],
      params: idParams,
      query: langQuery,
      response: candidatesShape,
      handler: async (ctx) => {
        const session = await loadSession(ctx.db, ctx.auth, ctx.params.id);
        if (!session) throw errors.notFound('Session not found');
        await requireConsent(ctx.db, session.id);
        const catalog = ctx.services.pathways;
        const { out, factIds } = await computeState(ctx.db, catalog, session.id, ctx.query.lang);
        // the shortlist is a snapshot kept for evaluation; each read replaces the previous one
        await ctx.db.query("DELETE FROM candidate WHERE session_id = $1 AND kind = 'derived'", [
          session.id,
        ]);
        for (const [i, c] of out.candidates.entries()) {
          await ctx.db.query(
            `INSERT INTO candidate (session_id, clinic_id, kind, pathway_id, pathway_version, rank, score)
             VALUES ($1, $2, 'derived', $3, $4, $5, $6)`,
            [session.id, session.clinicId, c.pathway_id, c.version, i + 1, c.score],
          );
        }
        const titleOf = (id: string | null) =>
          id === null
            ? null
            : (catalog.pathways.find((p) => p.id === id)?.title[ctx.query.lang] ?? null);
        return {
          data: {
            outcome: out.outcome,
            notice: NOTICE,
            notActive: catalog.pathways.some((p) => p.status !== 'active'),
            candidates: out.candidates.map((c, i) => ({
              rank: i + 1,
              pathwayId: c.pathway_id,
              version: c.version,
              title: c.title,
              status: catalog.pathways.find((p) => p.id === c.pathway_id)?.status ?? 'test',
              score: c.score,
              evidenceFor: c.evidence_for.map((e) => ({
                ruleId: e.rule_id,
                slot: e.slot,
                nodeId: e.node_id,
                factId: factIds[e.slot] ?? null,
              })),
              evidenceAgainst: c.evidence_against.map((e) => ({
                ruleId: e.rule_id,
                slot: e.slot,
                nodeId: e.node_id,
                factId: factIds[e.slot] ?? null,
              })),
              source: c.source,
            })),
            selected: await readSelected(ctx.db, session.id, titleOf),
          },
        };
      },
    }),

    permRoute<IdParams, unknown, LangQuery>('candidate.read', {
      method: 'get',
      path: '/sessions/:id/pathway-record',
      tag: 'Pathways',
      summary:
        "Doctor: what the doctor decided and keeps (the working condition, acknowledged red flags). Readable after consent is withdrawn, because it holds only the doctor's own decisions",
      audit: [],
      params: idParams,
      query: langQuery,
      response: recordShape,
      handler: async (ctx) => {
        const session = await loadSession(ctx.db, ctx.auth, ctx.params.id);
        if (!session) throw errors.notFound('Session not found');
        const catalog = ctx.services.pathways;
        const lang = ctx.query.lang;
        const titleOf = (id: string | null) => titleIn(catalog.pathways, id, lang);
        const flags = await ctx.db.query<{
          id: string;
          pathway_id: string;
          acted_at: Date;
        }>(
          `SELECT id, pathway_id, acted_at FROM question_event
            WHERE session_id = $1 AND kind = 'red_flag' AND status = 'acknowledged' ORDER BY acted_at`,
          [session.id],
        );
        return {
          data: {
            selected: await readSelected(ctx.db, session.id, titleOf),
            acknowledgedRedFlags: flags.rows.map((r) => ({
              eventId: r.id,
              pathwayId: r.pathway_id,
              pathwayTitle: titleOf(r.pathway_id),
              actedAt: r.acted_at.toISOString(),
            })),
            notActive: catalog.pathways.some((p) => p.status !== 'active'),
          },
        };
      },
    }),

    permRoute<IdParams>('candidate.select', {
      method: 'post',
      path: '/sessions/:id/candidates/select/undo',
      lockedWhenSigned: true,
      tag: 'Pathways',
      summary:
        'Doctor: undo the working-condition choice (the earlier row is kept as history, marked superseded)',
      audit: ['CANDIDATE_SELECTION_UNDONE'],
      params: idParams,
      response: z.object({ undone: z.literal(true) }),
      handler: async (ctx) => {
        const session = await loadSession(ctx.db, ctx.auth, ctx.params.id);
        if (!session) throw errors.notFound('Session not found');
        await requireConsent(ctx.db, session.id);
        const done = await ctx.db.query<{ id: string }>(
          `UPDATE candidate SET superseded_at = now()
            WHERE session_id = $1 AND kind = 'selected' AND superseded_at IS NULL RETURNING id`,
          [session.id],
        );
        const row = done.rows[0];
        if (!row) throw errors.conflict('There is no working condition to undo');
        await ctx.audit({
          action: 'CANDIDATE_SELECTION_UNDONE',
          resourceType: 'candidate',
          resourceId: row.id,
          sessionId: session.id,
          meta: {},
        });
        return { data: { undone: true as const } };
      },
    }),

    permRoute<IdParams, SelectBody, LangQuery>('candidate.select', {
      method: 'post',
      path: '/sessions/:id/candidates/select',
      lockedWhenSigned: true,
      tag: 'Pathways',
      summary:
        'Doctor: choose a working condition from the loaded pathways, or record "not listed" with a short note',
      audit: ['CANDIDATE_SELECTED'],
      params: idParams,
      query: langQuery,
      body: selectBody,
      response: selectedShape.unwrap(),
      successStatus: 201,
      handler: async (ctx) => {
        const session = await loadSession(ctx.db, ctx.auth, ctx.params.id);
        if (!session) throw errors.notFound('Session not found');
        await requireConsent(ctx.db, session.id);
        const catalog = ctx.services.pathways;
        const body = ctx.body;
        let pathwayId: string | null = null;
        let version: number | null = null;
        if ('pathwayId' in body) {
          const p = catalog.pathways.find((x) => x.id === body.pathwayId);
          if (!p || p.version !== body.version) {
            throw errors.validation('That condition and version are not in the loaded pathways');
          }
          pathwayId = p.id;
          version = p.version;
        }
        await ctx.db.query(
          `UPDATE candidate SET superseded_at = now()
            WHERE session_id = $1 AND kind = 'selected' AND superseded_at IS NULL`,
          [session.id],
        );
        const notListed = 'notListed' in body;
        const inserted = await ctx.db.query<{ id: string }>(
          `INSERT INTO candidate (session_id, clinic_id, kind, pathway_id, pathway_version, not_listed,
                                  not_listed_text, selected_by, selected_at)
           VALUES ($1, $2, 'selected', $3, $4, $5, $6, $7, now()) RETURNING id`,
          [
            session.id,
            session.clinicId,
            pathwayId,
            version,
            notListed,
            'text' in body ? body.text : null,
            ctx.auth.sub,
          ],
        );
        await ctx.audit({
          action: 'CANDIDATE_SELECTED',
          resourceType: 'candidate',
          resourceId: inserted.rows[0]?.id as string,
          sessionId: session.id,
          // the free note is never audited; the pathway id is a configuration identifier
          meta: { notListed, ...(pathwayId ? { pathwayId, pathwayVersion: version } : {}) },
        });
        const titleOf = (id: string | null) =>
          id === null
            ? null
            : (catalog.pathways.find((p) => p.id === id)?.title[ctx.query.lang] ?? null);
        const selected = await readSelected(ctx.db, session.id, titleOf);
        if (!selected) throw new Error('selection missing after insert');
        return { data: selected, status: 201 };
      },
    }),
  ];
}
