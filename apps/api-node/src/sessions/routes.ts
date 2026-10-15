// /api/v1/sessions: create a consultation session for a patient, read it. (PRD 9.2; consent hangs off a session.)
import { z } from 'zod';
import { errors } from '../http/errors.js';
import { permRoute, type RouteDef } from '../http/routeRegistry.js';
import { getConsentFlagsFor, getEffectiveConsent } from '../consent/service.js';
import { loadSession, toSession } from './service.js';
import type { QueryResultRow } from 'pg';

const createBody = z.object({ patientId: z.uuid(), tokenId: z.uuid().optional() });
type CreateBody = z.infer<typeof createBody>;
const MAX_LIST = 50;
const listQuery = z.object({
  status: z.enum(['created', 'in_progress', 'ended']).optional(),
  /** Only "open" (not ended) sessions: what the doctor dashboard calls drafts. */
  open: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIST).default(20),
  /** Cursor: return sessions started before this ISO timestamp (newest first). */
  before: z.iso.datetime({ offset: true }).optional(),
});
type ListQuery = z.infer<typeof listQuery>;
const idParams = z.object({ id: z.uuid() });
type IdParams = z.infer<typeof idParams>;

const sessionView = z.object({
  id: z.uuid(),
  tokenId: z.uuid().nullable(),
  patientId: z.uuid(),
  doctorId: z.uuid(),
  clinicId: z.uuid(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  languageMix: z.string().nullable(),
  status: z.enum(['created', 'in_progress', 'ended']),
});

export function sessionRoutes(): RouteDef[] {
  return [
    permRoute<unknown, CreateBody>('session.create', {
      method: 'post',
      path: '/sessions',
      tag: 'Sessions',
      summary: 'Open a consultation session for a patient (the caller becomes the session doctor)',
      audit: ['SESSION_CREATED'],
      body: createBody,
      response: sessionView,
      successStatus: 201,
      handler: async (ctx) => {
        const patient = await ctx.services.directory.getPatient(
          ctx.auth.clinicId,
          ctx.body.patientId,
        );
        if (!patient) throw errors.notFound('Patient not found');
        const r = await ctx.db.query<QueryResultRow & Parameters<typeof toSession>[0]>(
          `INSERT INTO consultation_session
             (clinicos_token_id, clinicos_patient_id, clinicos_doctor_id, clinicos_clinic_id)
           VALUES ($1, $2, $3, $4) RETURNING *`,
          [ctx.body.tokenId ?? null, patient.id, ctx.auth.sub, ctx.auth.clinicId],
        );
        const row = r.rows[0];
        if (!row) throw new Error('session insert returned no row');
        const session = toSession(row);
        await ctx.audit({
          action: 'SESSION_CREATED',
          resourceType: 'session',
          resourceId: session.id,
          sessionId: session.id,
          meta: { patientId: patient.id },
        });
        return { data: session };
      },
    }),

    permRoute<unknown, unknown, ListQuery>('session.listMine', {
      method: 'get',
      path: '/sessions',
      tag: 'Sessions',
      summary:
        "The signed-in doctor's OWN sessions in their clinic, newest first (never another doctor's), with the patient's " +
        'name and a consent summary.',
      audit: [],
      query: listQuery,
      handler: async (ctx) => {
        const { status, open, limit, before } = ctx.query;
        const params: unknown[] = [ctx.auth.clinicId, ctx.auth.sub];
        const parts = ['clinicos_clinic_id = $1', 'clinicos_doctor_id = $2'];
        if (status) {
          params.push(status);
          parts.push(`status = $${params.length}`);
        }
        if (open === true) parts.push("status <> 'ended'");
        if (before) {
          params.push(before);
          parts.push(`started_at < $${params.length}`);
        }
        params.push(limit);
        const r = await ctx.db.query<QueryResultRow & Parameters<typeof toSession>[0]>(
          `SELECT * FROM consultation_session WHERE ${parts.join(' AND ')}
            ORDER BY started_at DESC, id DESC LIMIT $${params.length}`,
          params,
        );
        const sessions = r.rows.map(toSession);
        const consent = await getConsentFlagsFor(
          ctx.db,
          sessions.map((s) => s.id),
        );
        const names = new Map<string, string | null>();
        for (const id of new Set(sessions.map((s) => s.patientId))) {
          const patient = await ctx.services.directory.getPatient(ctx.auth.clinicId, id);
          names.set(id, patient?.name ?? null);
        }
        const last = sessions[sessions.length - 1];
        return {
          data: {
            items: sessions.map((s) => ({
              ...s,
              patientName: names.get(s.patientId) ?? null,
              consent: consent.get(s.id),
            })),
            nextBefore: sessions.length === limit && last ? last.startedAt : null,
          },
        };
      },
    }),

    permRoute<IdParams>('session.read', {
      method: 'get',
      path: '/sessions/:id',
      tag: 'Sessions',
      summary: 'Read a session with its current consent state',
      audit: [],
      params: idParams,
      response: sessionView,
      handler: async (ctx) => {
        const session = await loadSession(ctx.db, ctx.auth, ctx.params.id);
        if (!session) throw errors.notFound('Session not found');
        const consent = await getEffectiveConsent(ctx.db, session.id);
        return { data: { ...session, consent } };
      },
    }),
  ];
}
