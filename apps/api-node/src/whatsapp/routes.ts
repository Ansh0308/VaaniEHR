// WhatsApp summary endpoints and the Meta webhook (Phase 10 Run 1, ADR-D41, FR-F10-01..04). The doctor drafts a Gujarati summary
// from the SIGNED record, edits only the two free-text fields, approves the exact text, and sends it. Every gate is server
// side: signed, WhatsApp consent, the mismatch check, approval and its hash. Audit rows hold ids, versions and counts only.
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { withdrawWhatsAppForPatient } from '../consent/routes.js';
import type { Config } from '../config/env.js';
import { errors } from '../http/errors.js';
import { permRoute, publicRoute, type RouteDef } from '../http/routeRegistry.js';
import { loadSession } from '../sessions/service.js';
import { STOP_WORDS } from './phrases.js';
import { MAX_FREE_TEXT_CHARS } from './summary.js';
import {
  applyStatus,
  approve,
  messageView,
  patientOfNumber,
  readMessages,
  readSummaries,
  requireSigned,
  requireWhatsAppConsent,
  saveDraft,
  sendApproved,
  SummaryRefused,
  summaryView,
  toSummaryView,
  verifySignature,
  webhookPayload,
} from './service.js';
import { getEffectiveConsent } from '../consent/service.js';

const idParams = z.object({ id: z.uuid() });
type IdParams = z.infer<typeof idParams>;
const draftBody = z
  .object({
    warningSigns: z.string().max(MAX_FREE_TEXT_CHARS * 2),
    followUp: z.string().max(MAX_FREE_TEXT_CHARS * 2),
  })
  .strict();
type DraftBody = z.infer<typeof draftBody>;
const emptyBody = z.object({}).strict();

const stateShape = z.object({
  /** the current signed version, or null when the visit is not signed */
  signedVersion: z.number().nullable(),
  /** the signed record says "Safety checks were not run" */
  safetyNotRun: z.boolean(),
  whatsappConsent: z.boolean(),
  /** 'mock' sends nothing; 'meta' is real WhatsApp (test allowlist only) */
  provider: z.enum(['mock', 'meta']),
  summary: summaryView.nullable(),
  messages: z.array(messageView),
});

export function whatsappRoutes(config: Config): RouteDef[] {
  // the webhook is public: a limit per address keeps a flood from costing a signature check each time (ADR-D44)
  const webhookLimiter = rateLimit({
    windowMs: 60_000,
    limit: config.webhookRateLimitMax,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        success: false,
        error: { code: 'RATE_LIMITED', message: 'Too many requests. Try again later.' },
      });
    },
  });
  return [
    permRoute<IdParams>('whatsapp.read', {
      method: 'get',
      path: '/sessions/:id/whatsapp',
      tag: 'WhatsApp',
      summary:
        "Doctor: the WhatsApp summary of the session's signed visit, the consent state and the send log",
      audit: [],
      params: idParams,
      response: stateShape,
      handler: async (ctx) => {
        const session = await loadSession(ctx.db, ctx.auth, ctx.params.id);
        if (!session) throw errors.notFound('Session not found');
        const visit = await ctx.services.visits.getVersion(ctx.db, session.clinicId, session.id);
        const consent = await getEffectiveConsent(ctx.db, session.id);
        const rows = await readSummaries(ctx.db, session.id);
        const current = visit ? rows.find((r) => r.version === visit.version) : undefined;
        return {
          data: {
            signedVersion: visit?.version ?? null,
            safetyNotRun: visit?.safetyNotRunAcknowledged ?? false,
            whatsappConsent: consent.whatsappAllowed,
            provider: ctx.services.whatsapp.name,
            summary: current && visit ? toSummaryView(current, visit.version) : null,
            messages: await readMessages(ctx.db, session.id),
          },
        };
      },
    }),

    permRoute<IdParams, DraftBody>('whatsapp.write', {
      method: 'post',
      path: '/sessions/:id/whatsapp/summary',
      tag: 'WhatsApp',
      summary:
        'Doctor: make or change the draft Gujarati summary from the signed record. Only the warning signs and the follow-up are typed by the doctor; everything else is copied from the snapshot. Refused if it does not match the snapshot',
      audit: ['WHATSAPP_SUMMARY_DRAFTED', 'WHATSAPP_SUMMARY_REFUSED'],
      params: idParams,
      body: draftBody,
      response: summaryView,
      successStatus: 201,
      handler: async (ctx) => {
        const session = await loadSession(ctx.db, ctx.auth, ctx.params.id);
        if (!session) throw errors.notFound('Session not found');
        const visit = await requireSigned(ctx.services, ctx.db, session);
        await requireWhatsAppConsent(ctx.db, session);
        let row;
        try {
          row = await saveDraft(ctx.db, session, visit, ctx.body, ctx.auth.sub);
        } catch (err) {
          if (err instanceof SummaryRefused) {
            await ctx.auditCommitted({
              action: 'WHATSAPP_SUMMARY_REFUSED',
              resourceType: 'consultation_session',
              resourceId: session.id,
              sessionId: session.id,
              meta: { version: visit.version, mismatchCount: err.mismatches.length },
            });
            throw errors.conflict(
              'The summary does not match the signed visit, so it was not made',
            );
          }
          throw err;
        }
        await ctx.audit({
          action: 'WHATSAPP_SUMMARY_DRAFTED',
          resourceType: 'whatsapp_summary',
          resourceId: row.id,
          sessionId: session.id,
          meta: { version: visit.version },
        });
        return { data: toSummaryView(row, visit.version), status: 201 };
      },
    }),

    permRoute<IdParams, Record<string, never>>('whatsapp.write', {
      method: 'post',
      path: '/sessions/:id/whatsapp/approve',
      tag: 'WhatsApp',
      summary:
        'Doctor: approve the draft summary. The exact Gujarati text and its variables are stored with a SHA-256 and can no longer change',
      audit: ['WHATSAPP_SUMMARY_APPROVED', 'WHATSAPP_SUMMARY_REFUSED'],
      params: idParams,
      body: emptyBody,
      response: summaryView,
      handler: async (ctx) => {
        const session = await loadSession(ctx.db, ctx.auth, ctx.params.id);
        if (!session) throw errors.notFound('Session not found');
        const visit = await requireSigned(ctx.services, ctx.db, session);
        await requireWhatsAppConsent(ctx.db, session);
        let row;
        try {
          row = await approve(ctx.db, session, visit, ctx.auth.sub);
        } catch (err) {
          if (err instanceof SummaryRefused) {
            await ctx.auditCommitted({
              action: 'WHATSAPP_SUMMARY_REFUSED',
              resourceType: 'consultation_session',
              resourceId: session.id,
              sessionId: session.id,
              meta: { version: visit.version, mismatchCount: err.mismatches.length },
            });
            throw errors.conflict(
              'The summary does not match the signed visit, so it was not approved',
            );
          }
          throw err;
        }
        await ctx.audit({
          action: 'WHATSAPP_SUMMARY_APPROVED',
          resourceType: 'whatsapp_summary',
          resourceId: row.id,
          sessionId: session.id,
          meta: { version: visit.version },
        });
        return { data: toSummaryView(row, visit.version) };
      },
    }),

    permRoute<IdParams, Record<string, never>>('whatsapp.write', {
      method: 'post',
      path: '/sessions/:id/whatsapp/send',
      tag: 'WhatsApp',
      summary:
        'Doctor: send the approved summary to the patient. Needs a signed visit, WhatsApp consent now, an approved summary whose hash still matches, and (for real WhatsApp) a number on the test allowlist. A failure is recorded and not retried',
      audit: ['WHATSAPP_SENT', 'WHATSAPP_SEND_FAILED'],
      params: idParams,
      body: emptyBody,
      response: messageView,
      successStatus: 201,
      handler: async (ctx) => {
        const session = await loadSession(ctx.db, ctx.auth, ctx.params.id);
        if (!session) throw errors.notFound('Session not found');
        const visit = await requireSigned(ctx.services, ctx.db, session);
        await requireWhatsAppConsent(ctx.db, session);
        const out = await sendApproved(ctx.db, ctx.services, session, visit, ctx.auth.sub);
        await ctx.audit({
          action: out.ok ? 'WHATSAPP_SENT' : 'WHATSAPP_SEND_FAILED',
          resourceType: 'whatsapp_message',
          resourceId: out.message.id,
          sessionId: session.id,
          meta: { version: visit.version, provider: out.message.provider },
        });
        return { data: out.message, status: 201 };
      },
    }),

    // ---- Meta webhook (public routes: Meta calls them; the request is authenticated by its signature, not a token)
    publicRoute<
      unknown,
      unknown,
      { 'hub.mode'?: string; 'hub.verify_token'?: string; 'hub.challenge'?: string }
    >({
      method: 'get',
      path: '/webhooks/whatsapp',
      pre: [webhookLimiter],
      tag: 'WhatsApp',
      summary:
        'Meta: webhook verification. Answers the hub.challenge only if the verify token matches',
      audit: [],
      query: z.object({
        'hub.mode': z.string().optional(),
        'hub.verify_token': z.string().optional(),
        'hub.challenge': z.string().max(200).optional(),
      }),
      responseType: 'text',
      handler: async (ctx) => {
        const expected = ctx.services.config.whatsapp.verifyToken;
        if (!expected) throw errors.notReady('The WhatsApp webhook is not configured');
        const q = ctx.query;
        if (
          q['hub.mode'] !== 'subscribe' ||
          q['hub.verify_token'] !== expected ||
          !q['hub.challenge']
        ) {
          throw errors.forbidden('Verification failed');
        }
        return { raw: { contentType: 'text/plain', body: q['hub.challenge'] } };
      },
    }),

    publicRoute<unknown, unknown>({
      method: 'post',
      path: '/webhooks/whatsapp',
      pre: [webhookLimiter],
      tag: 'WhatsApp',
      summary:
        'Meta: delivery statuses and replies. The X-Hub-Signature-256 header must match the raw body (HMAC-SHA256, app secret). A STOP reply withdraws the patient WhatsApp consent',
      audit: [
        'WHATSAPP_WEBHOOK_RECEIVED',
        'WHATSAPP_WEBHOOK_REJECTED',
        'WHATSAPP_STATUS_UPDATED',
        'WHATSAPP_STOP_RECEIVED',
        'CONSENT_WITHDRAWN',
      ],
      response: z.object({
        received: z.literal(true),
        statusUpdates: z.number(),
        stopReplies: z.number(),
      }),
      handler: async (ctx) => {
        const secret = ctx.services.config.whatsapp.appSecret;
        if (!secret) throw errors.notReady('The WhatsApp webhook is not configured');
        const raw = ctx.req.rawBody ?? Buffer.alloc(0);
        if (!verifySignature(secret, raw, ctx.req.header('x-hub-signature-256'))) {
          await ctx.auditCommitted({
            action: 'WHATSAPP_WEBHOOK_REJECTED',
            actorRole: 'whatsapp',
            resourceType: 'webhook',
            meta: { cause: 'signature' },
          });
          throw errors.unauthenticated('Bad signature');
        }
        const parsed = webhookPayload.safeParse(ctx.req.body);
        if (!parsed.success) throw errors.badRequest('Not a WhatsApp webhook payload');
        let statusUpdates = 0;
        let stopReplies = 0;
        for (const entry of parsed.data.entry ?? []) {
          for (const change of entry.changes ?? []) {
            for (const st of change.value.statuses ?? []) {
              const err = st.errors?.[0];
              const changed = await applyStatus(
                ctx.db,
                st.id,
                st.status,
                err ? `WhatsApp error ${err.code ?? ''} ${err.title ?? ''}`.trim() : null,
              );
              if (changed) statusUpdates += 1;
            }
            for (const msg of change.value.messages ?? []) {
              const word = (msg.text?.body ?? '').trim().toLowerCase();
              if (msg.type !== 'text' || !(STOP_WORDS as readonly string[]).includes(word))
                continue;
              const who = await patientOfNumber(ctx.db, ctx.services.lockoutKey, msg.from);
              if (!who) continue;
              const sessions = await withdrawWhatsAppForPatient(
                ctx.db,
                who.patientId,
                who.clinicId,
              );
              stopReplies += 1;
              for (const sessionId of sessions) {
                await ctx.audit({
                  action: 'CONSENT_WITHDRAWN',
                  actorRole: 'patient',
                  actorUserId: who.patientId,
                  clinicId: who.clinicId,
                  resourceType: 'consent',
                  resourceId: sessionId,
                  sessionId,
                  meta: { scope: 'whatsapp', source: 'patient', via: 'stop_reply' },
                });
              }
              await ctx.audit({
                action: 'WHATSAPP_STOP_RECEIVED',
                actorRole: 'patient',
                clinicId: who.clinicId,
                resourceType: 'patient',
                resourceId: who.patientId,
                meta: { sessionCount: sessions.length },
              });
            }
          }
        }
        await ctx.audit({
          action: 'WHATSAPP_WEBHOOK_RECEIVED',
          actorRole: 'whatsapp',
          resourceType: 'webhook',
          meta: { statusUpdates, stopReplies },
        });
        if (statusUpdates > 0) {
          await ctx.audit({
            action: 'WHATSAPP_STATUS_UPDATED',
            actorRole: 'whatsapp',
            resourceType: 'webhook',
            meta: { count: statusUpdates },
          });
        }
        return { data: { received: true as const, statusUpdates, stopReplies } };
      },
    }),
  ];
}
