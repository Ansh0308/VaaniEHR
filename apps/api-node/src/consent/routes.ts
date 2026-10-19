// Consent endpoints (F1, PG-05). Grant, withdraw, read the effective state, read the notice text.
// Every consent event is written to the append-only consent_event table AND the audit log (FR-F1-05), in one
// transaction. Withdrawal is possible at any time (FR-F1-04); stopping the recording and marking audio for deletion
// happen in Phase 4, which reads `recordingAllowed` / uses requireConsent().
import { z } from 'zod';
import { errors } from '../http/errors.js';
import { authedRoute, permRoute, type RouteDef } from '../http/routeRegistry.js';
import { loadSession } from '../sessions/service.js';
import { deleteDerivedPathwayRows } from '../pathways/service.js';
import { deleteDraftSegments } from '../transcripts/routes.js';
import { CONSENT_SCOPES, NOTICE_LANGUAGES, type ConsentScope } from './notices.js';
import { getEffectiveConsent, listConsentEvents } from './service.js';

const scopeEnum = z.enum(CONSENT_SCOPES);
const idParams = z.object({ id: z.uuid() });
type IdParams = z.infer<typeof idParams>;

const grantBody = z.object({
  scopes: z
    .array(scopeEnum)
    .min(1)
    .max(CONSENT_SCOPES.length)
    .refine((s) => new Set(s).size === s.length, 'scopes must not repeat'),
  noticeVersion: z.string().min(1).max(20),
  noticeLanguage: z.enum(NOTICE_LANGUAGES),
  source: z.enum(['patient', 'staff']),
});
type GrantBody = z.infer<typeof grantBody>;

const withdrawBody = z.object({
  scopes: z
    .array(scopeEnum)
    .min(1)
    .max(CONSENT_SCOPES.length)
    .refine((s) => new Set(s).size === s.length, 'scopes must not repeat')
    .optional(),
  source: z.enum(['patient', 'staff']),
});
type WithdrawBody = z.infer<typeof withdrawBody>;

const noticeQuery = z.object({ version: z.string().min(1).max(20).optional() });
type NoticeQuery = z.infer<typeof noticeQuery>;

const scopeState = z.object({
  granted: z.boolean(),
  since: z.string().nullable(),
  noticeVersion: z.string().nullable(),
  noticeLanguage: z.enum(NOTICE_LANGUAGES).nullable(),
  source: z.enum(['patient', 'staff']).nullable(),
});
const consentView = z.object({
  sessionId: z.uuid(),
  scopes: z.object({ audio: scopeState, ai_processing: scopeState, whatsapp: scopeState }),
  recordingAllowed: z.boolean(),
  whatsappAllowed: z.boolean(),
});

export function consentRoutes(): RouteDef[] {
  return [
    authedRoute<unknown, unknown, NoticeQuery>({
      method: 'get',
      path: '/consent/notice',
      tag: 'Consent',
      summary:
        'The consent notice for a version in BOTH languages in one response (en and gu), for side-by-side display. ' +
        'Placeholder markers and the Gujarati needsReview flag are part of the payload.',
      audit: [],
      query: noticeQuery,
      handler: async (ctx) => {
        const { notices } = ctx.services;
        const version = ctx.query.version ?? notices.latestVersion();
        const en = notices.get(version, 'en');
        const gu = notices.get(version, 'gu');
        if (!en || !gu) throw errors.notFound('Consent notice not found');
        return { data: { version, notices: { en, gu } } };
      },
    }),

    permRoute<IdParams>('consent.read', {
      method: 'get',
      path: '/sessions/:id/consent',
      tag: 'Consent',
      summary: 'Current effective consent for a session, plus the event history',
      audit: [],
      params: idParams,
      response: consentView.extend({ events: z.array(z.record(z.string(), z.unknown())) }),
      handler: async (ctx) => {
        const session = await loadSession(ctx.db, ctx.auth, ctx.params.id);
        if (!session) throw errors.notFound('Session not found');
        const [effective, events] = await Promise.all([
          getEffectiveConsent(ctx.db, session.id),
          listConsentEvents(ctx.db, session.id),
        ]);
        return { data: { ...effective, events } };
      },
    }),

    permRoute<IdParams, GrantBody>('consent.grant', {
      method: 'post',
      path: '/sessions/:id/consent',
      tag: 'Consent',
      summary: 'Record consent for one or more scopes (audio, ai_processing, whatsapp)',
      audit: ['CONSENT_GRANTED'],
      params: idParams,
      body: grantBody,
      response: consentView,
      successStatus: 201,
      handler: async (ctx) => {
        const session = await loadSession(ctx.db, ctx.auth, ctx.params.id);
        if (!session) throw errors.notFound('Session not found');
        if (session.status === 'ended') throw errors.conflict('Session has ended');
        const { noticeVersion, noticeLanguage, source, scopes } = ctx.body;
        if (!ctx.services.notices.get(noticeVersion, noticeLanguage)) {
          throw errors.validation(
            `body: unknown consent notice ${noticeVersion}/${noticeLanguage}`,
          );
        }
        for (const scope of scopes) {
          await insertEvent(ctx, session.id, scope, true, noticeVersion, noticeLanguage, source);
          await ctx.audit({
            action: 'CONSENT_GRANTED',
            resourceType: 'consent',
            resourceId: session.id,
            sessionId: session.id,
            meta: { scope, noticeVersion, noticeLanguage, source },
          });
        }
        return { data: await getEffectiveConsent(ctx.db, session.id) };
      },
    }),

    permRoute<IdParams, WithdrawBody>('consent.withdraw', {
      method: 'post',
      path: '/sessions/:id/consent/withdraw',
      tag: 'Consent',
      summary:
        'Withdraw consent (all granted scopes, or the listed ones). Always allowed while the session exists.',
      audit: ['CONSENT_WITHDRAWN', 'TRANSCRIPT_DRAFT_DELETED', 'PATHWAY_DATA_DELETED'],
      params: idParams,
      body: withdrawBody,
      response: consentView.extend({ stopRecording: z.boolean() }),
      handler: async (ctx) => {
        const session = await loadSession(ctx.db, ctx.auth, ctx.params.id);
        if (!session) throw errors.notFound('Session not found');
        const current = await getEffectiveConsent(ctx.db, session.id);
        const wanted: readonly ConsentScope[] = ctx.body.scopes ?? CONSENT_SCOPES;
        const toWithdraw = wanted.filter((s) => current.scopes[s].granted);
        if (toWithdraw.length === 0) throw errors.conflict('No granted consent to withdraw');
        for (const scope of toWithdraw) {
          const last = current.scopes[scope];
          await insertEvent(
            ctx,
            session.id,
            scope,
            false,
            last.noticeVersion as string,
            last.noticeLanguage as 'en' | 'gu',
            ctx.body.source,
          );
          await ctx.audit({
            action: 'CONSENT_WITHDRAWN',
            resourceType: 'consent',
            resourceId: session.id,
            sessionId: session.id,
            meta: { scope, source: ctx.body.source },
          });
        }
        const after = await getEffectiveConsent(ctx.db, session.id);
        // FR-F1-04: recording must stop as soon as audio or AI consent is gone. Phase 4 acts on this flag.
        const stopRecording = current.recordingAllowed && !after.recordingAllowed;
        // ADR-D28: when audio or AI-processing consent is gone, UNCONFIRMED draft transcript text is deleted too
        // (the audio is deleted by the speech service). Doctor-confirmed text stays: it is part of the record.
        if (stopRecording) {
          const deleted = await deleteDraftSegments(ctx.db, session.id);
          if (deleted.segments > 0 || deleted.facts > 0) {
            await ctx.audit({
              action: 'TRANSCRIPT_DRAFT_DELETED',
              resourceType: 'transcript',
              resourceId: session.id,
              sessionId: session.id,
              meta: { segmentCount: deleted.segments, factCount: deleted.facts },
            });
          }
          // ADR-D34: suggested questions and the candidate shortlist are derived from AI processing too
          const pathway = await deleteDerivedPathwayRows(ctx.db, session.id);
          if (pathway.questions > 0 || pathway.candidates > 0) {
            await ctx.audit({
              action: 'PATHWAY_DATA_DELETED',
              resourceType: 'session',
              resourceId: session.id,
              sessionId: session.id,
              meta: { questionCount: pathway.questions, candidateCount: pathway.candidates },
            });
          }
        }
        return { data: { ...after, stopRecording } };
      },
    }),
  ];
}

async function insertEvent(
  ctx: {
    db: import('../db/tx.js').Queryable;
    auth: { sub: string; role: string; clinicId: string };
  },
  sessionId: string,
  scope: ConsentScope,
  granted: boolean,
  noticeVersion: string,
  noticeLanguage: 'en' | 'gu',
  source: 'patient' | 'staff',
): Promise<void> {
  await ctx.db.query(
    `INSERT INTO consent_event
       (session_id, clinic_id, scope, granted, notice_version, notice_language, source,
        recorded_by_user_id, recorded_by_role, ts)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      sessionId,
      ctx.auth.clinicId,
      scope,
      granted,
      noticeVersion,
      noticeLanguage,
      source,
      ctx.auth.sub,
      ctx.auth.role,
      new Date().toISOString(),
    ],
  );
}
