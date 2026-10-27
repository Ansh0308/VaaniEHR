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

/**
 * A patient's STOP reply on WhatsApp (Phase 10): withdraws the WhatsApp consent of EVERY session of this patient in this clinic
 * that still has it. The event comes from the patient themselves (source 'patient', role 'patient'). Returns the session ids so
 * the caller can audit each one. Kept in this file because only the consent routes write consent events (static rule).
 */
export async function withdrawWhatsAppForPatient(
  db: import('../db/tx.js').Queryable,
  patientId: string,
  clinicId: string,
): Promise<string[]> {
  const open = await db.query<{ id: string; notice_version: string; notice_language: 'en' | 'gu' }>(
    `SELECT s.id, last.notice_version, last.notice_language
       FROM consultation_session s
       JOIN LATERAL (SELECT granted, notice_version, notice_language FROM consent_event e
                      WHERE e.session_id = s.id AND e.scope = 'whatsapp' ORDER BY e.seq DESC LIMIT 1) last ON true
      WHERE s.clinicos_patient_id = $1 AND s.clinicos_clinic_id = $2 AND last.granted`,
    [patientId, clinicId],
  );
  for (const row of open.rows) {
    await insertEvent(
      { db, auth: { sub: patientId, role: 'patient', clinicId } },
      row.id,
      'whatsapp',
      false,
      row.notice_version,
      row.notice_language,
      'patient',
    );
  }
  return open.rows.map((r) => r.id);
}

/**
 * An erasure request is completed (Phase 12B, ADR-D45): EVERY scope still granted in EVERY session of this patient in this clinic is
 * withdrawn, by the admin who completes the request on the patient's behalf (source 'patient' = the data subject asked). The
 * speech service then deletes the audio at its next purge run (it asks api-node for the consent state first). Kept in this file
 * because only the consent routes write consent events (static rule). Returns what was withdrawn so the caller can audit it.
 */
export async function withdrawEverythingForPatient(
  db: import('../db/tx.js').Queryable,
  patientId: string,
  clinicId: string,
  actor: { sub: string; role: string },
): Promise<{ sessionId: string; scopes: ConsentScope[] }[]> {
  const sessions = await db.query<{ id: string }>(
    'SELECT id FROM consultation_session WHERE clinicos_patient_id = $1 AND clinicos_clinic_id = $2',
    [patientId, clinicId],
  );
  const out: { sessionId: string; scopes: ConsentScope[] }[] = [];
  for (const row of sessions.rows) {
    const current = await getEffectiveConsent(db, row.id);
    const scopes = CONSENT_SCOPES.filter((s) => current.scopes[s].granted);
    for (const scope of scopes) {
      const last = current.scopes[scope];
      await insertEvent(
        { db, auth: { sub: actor.sub, role: actor.role, clinicId } },
        row.id,
        scope,
        false,
        last.noticeVersion as string,
        last.noticeLanguage as 'en' | 'gu',
        'patient',
      );
    }
    if (scopes.length > 0) out.push({ sessionId: row.id, scopes });
  }
  return out;
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
