// Erasure request endpoints (PG-20; Phase 12B Run 2, ADR-D45). Staff and admins record a request for a patient of their clinic;
// admins review it and complete or refuse it. Every step is audited with ids and counts only (never notes, reasons or content).
// Completing removes what is not part of a signed visit record and keeps the signed record and the audit log; whether that is
// legally right is an open question (OCI-016), the page says so.
import { z } from 'zod';
import { errors } from '../http/errors.js';
import { permRoute, type RouteDef } from '../http/routeRegistry.js';
import {
  CHANNELS,
  complete,
  createRequest,
  impact,
  listRequests,
  refuse,
  startReview,
} from './service.js';

const STATUS = z.enum(['received', 'in_review', 'completed', 'refused']);
const idParams = z.object({ id: z.uuid() });
type IdParams = z.infer<typeof idParams>;
const createBody = z
  .object({
    patientId: z.uuid(),
    channel: z.enum(CHANNELS),
    note: z.string().trim().max(500).default(''),
  })
  .strict();
type CreateBody = z.infer<typeof createBody>;
const refuseBody = z.object({ reason: z.string().trim().min(3).max(500) }).strict();
type RefuseBody = z.infer<typeof refuseBody>;
const completeBody = z.object({ confirm: z.literal(true) }).strict();
type CompleteBody = z.infer<typeof completeBody>;
const listQuery = z.object({ status: STATUS.optional() });
type ListQuery = z.infer<typeof listQuery>;

const view = z.object({
  id: z.uuid(),
  patientId: z.uuid(),
  patientName: z.string().nullable(),
  status: STATUS,
  channel: z.enum(CHANNELS),
  note: z.string(),
  requestedByRole: z.string(),
  receivedAt: z.string(),
  reviewedAt: z.string().nullable(),
  decidedAt: z.string().nullable(),
  refusalReason: z.string().nullable(),
  result: z.record(z.string(), z.number()).nullable(),
});

export function privacyRoutes(): RouteDef[] {
  return [
    permRoute<unknown, CreateBody>('privacy.request', {
      method: 'post',
      path: '/privacy/requests',
      tag: 'Privacy',
      summary:
        'Staff or admin: record an erasure request for a patient of this clinic (one open request per patient)',
      audit: ['ERASURE_REQUESTED'],
      body: createBody,
      response: view,
      successStatus: 201,
      handler: async (ctx) => {
        const out = await createRequest(ctx.db, ctx.services, ctx.auth, ctx.body);
        await ctx.audit({
          action: 'ERASURE_REQUESTED',
          resourceType: 'erasure_request',
          resourceId: out.id,
          meta: { patientId: out.patientId, channel: out.channel },
        });
        return { data: out, status: 201 };
      },
    }),

    permRoute<unknown, unknown, ListQuery>('privacy.read', {
      method: 'get',
      path: '/privacy/requests',
      tag: 'Privacy',
      summary:
        'The erasure requests of this clinic, newest first (an admin sees all; staff see the ones they recorded)',
      audit: [],
      query: listQuery,
      response: z.object({ items: z.array(view) }),
      handler: async (ctx) => ({
        data: { items: await listRequests(ctx.db, ctx.services, ctx.auth, ctx.query.status) },
      }),
    }),

    permRoute<IdParams>('privacy.manage', {
      method: 'get',
      path: '/privacy/requests/:id/impact',
      tag: 'Privacy',
      summary:
        'Admin: what completing this request would remove and what stays, as counts (nothing is changed)',
      audit: [],
      params: idParams,
      response: z.object({ counts: z.record(z.string(), z.number()) }),
      handler: async (ctx) => {
        const r = await ctx.db.query<{ patient_id: string }>(
          'SELECT patient_id FROM erasure_request WHERE id = $1 AND clinic_id = $2',
          [ctx.params.id, ctx.auth.clinicId],
        );
        if (!r.rows[0]) throw errors.notFound('Request not found');
        return { data: { counts: await impact(ctx.db, r.rows[0].patient_id, ctx.auth.clinicId) } };
      },
    }),

    permRoute<IdParams, Record<string, never>>('privacy.manage', {
      method: 'post',
      path: '/privacy/requests/:id/review',
      tag: 'Privacy',
      summary: 'Admin: take a received request into review',
      audit: ['ERASURE_IN_REVIEW'],
      params: idParams,
      body: z.object({}).strict(),
      response: view,
      handler: async (ctx) => {
        const out = await startReview(ctx.db, ctx.services, ctx.auth, ctx.params.id);
        await ctx.audit({
          action: 'ERASURE_IN_REVIEW',
          resourceType: 'erasure_request',
          resourceId: out.id,
          meta: { patientId: out.patientId },
        });
        return { data: out };
      },
    }),

    permRoute<IdParams, RefuseBody>('privacy.manage', {
      method: 'post',
      path: '/privacy/requests/:id/refuse',
      tag: 'Privacy',
      summary:
        'Admin: refuse a request, with a reason that is kept on the request (not in the audit log)',
      audit: ['ERASURE_REFUSED'],
      params: idParams,
      body: refuseBody,
      response: view,
      handler: async (ctx) => {
        const out = await refuse(ctx.db, ctx.services, ctx.auth, ctx.params.id, ctx.body.reason);
        await ctx.audit({
          action: 'ERASURE_REFUSED',
          resourceType: 'erasure_request',
          resourceId: out.id,
          meta: { patientId: out.patientId },
        });
        return { data: out };
      },
    }),

    permRoute<IdParams, CompleteBody>('privacy.manage', {
      method: 'post',
      path: '/privacy/requests/:id/complete',
      tag: 'Privacy',
      summary:
        'Admin: complete a request in review. Removes everything about the patient that is not part of a signed visit record (audio is deleted by the speech service at its next purge run); the signed record and the audit log stay',
      audit: [
        'ERASURE_COMPLETED',
        'CONSENT_WITHDRAWN',
        'TRANSCRIPT_DRAFT_DELETED',
        'PATHWAY_DATA_DELETED',
      ],
      params: idParams,
      body: completeBody,
      response: view,
      handler: async (ctx) => {
        const done = await complete(ctx.db, ctx.services, ctx.auth, ctx.params.id);
        for (const w of done.withdrawn) {
          await ctx.audit({
            action: 'CONSENT_WITHDRAWN',
            resourceType: 'consent',
            resourceId: w.sessionId,
            sessionId: w.sessionId,
            meta: { scopeCount: w.scopes.length, source: 'erasure' },
          });
        }
        for (const d of done.drafts) {
          if (d.segments > 0 || d.facts > 0) {
            await ctx.audit({
              action: 'TRANSCRIPT_DRAFT_DELETED',
              resourceType: 'transcript',
              resourceId: d.sessionId,
              sessionId: d.sessionId,
              meta: { segmentCount: d.segments, factCount: d.facts },
            });
          }
          if (d.questions > 0 || d.candidates > 0) {
            await ctx.audit({
              action: 'PATHWAY_DATA_DELETED',
              resourceType: 'session',
              resourceId: d.sessionId,
              sessionId: d.sessionId,
              meta: { questionCount: d.questions, candidateCount: d.candidates },
            });
          }
        }
        await ctx.audit({
          action: 'ERASURE_COMPLETED',
          resourceType: 'erasure_request',
          resourceId: done.view.id,
          meta: { patientId: done.view.patientId, ...done.counts },
        });
        return { data: done.view };
      },
    }),
  ];
}
