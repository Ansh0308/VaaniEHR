// Sign-off, signed record, amendments and history (F7, FR-F7-01..04; Phase 8 Run 1). Doctor only, the session's own
// doctor, clinic-scoped. The server decides what blocks signing; the doctor re-enters their password; the signed content
// is stored as an exact snapshot with its SHA-256 and can only be amended by adding a new version with a reason.
// Audit rows hold ids and counts only (no clinical text, no reason text).
import { z } from 'zod';
import { errors } from '../http/errors.js';
import { permRoute, type RouteDef } from '../http/routeRegistry.js';
import { rowInput } from '../prescription/service.js';
import { loadSession } from '../sessions/service.js';
import type { VisitVersion } from './repository.js';
import {
  amendedMedicines,
  blockerView,
  buildPreview,
  previewView,
  checkSignPassword,
  evaluateDraft,
  hashContent,
  requireSafetyAcknowledgement,
  runSafety,
  safetyView,
} from './service.js';

const idParams = z.object({ id: z.uuid() });
type IdParams = z.infer<typeof idParams>;
const versionParams = z.object({
  id: z.uuid(),
  version: z.coerce.number().int().min(1).max(10000),
});
type VersionParams = z.infer<typeof versionParams>;

const versionSummaryView = z.object({
  version: z.number(),
  kind: z.enum(['signed', 'amendment']),
  contentHash: z.string(),
  safetyConfigured: z.boolean(),
  safetyNotRunAcknowledged: z.boolean(),
  reason: z.string().nullable(),
  signedBy: z.uuid(),
  signedAt: z.string(),
});
const versionView = versionSummaryView.extend({ content: z.record(z.string(), z.unknown()) });

const signBody = z
  .object({
    /** the doctor's own password, entered again at the moment of signing */
    password: z.string().min(1).max(200),
    /** "Safety checks were not run": required while the safety engine is not configured */
    safetyNotRunAcknowledged: z.boolean(),
  })
  .strict();
type SignBody = z.infer<typeof signBody>;

const amendBody = signBody
  .extend({
    reason: z.string().trim().min(1).max(500),
    /** the full medicine list of the new version */
    medicines: z.array(rowInput).max(50),
  })
  .strict();
type AmendBody = z.infer<typeof amendBody>;

const previousVisitView = z.object({
  sessionId: z.uuid(),
  signedAt: z.string(),
  currentVersion: z.number(),
  medicineCount: z.number(),
  factCount: z.number(),
  safetyNotRun: z.boolean(),
});

const readiness = z.object({
  signed: z.boolean(),
  blockers: z.array(blockerView),
  medicineCount: z.number(),
  safety: safetyView,
  currentVersion: z.number().nullable(),
});

const toView = (v: VisitVersion) => ({
  version: v.version,
  kind: v.kind,
  contentHash: v.contentHash,
  safetyConfigured: v.safetyConfigured,
  safetyNotRunAcknowledged: v.safetyNotRunAcknowledged,
  reason: v.reason,
  signedBy: v.signedBy,
  signedAt: v.signedAt,
  content: v.content as unknown as Record<string, unknown>,
});

export function visitRoutes(): RouteDef[] {
  return [
    permRoute<IdParams>('visit.read', {
      method: 'get',
      path: '/sessions/:id/sign-readiness',
      tag: 'Visit',
      summary:
        'Doctor: what blocks signing this visit right now (decided by the server) and the safety-check state',
      audit: [],
      params: idParams,
      response: readiness,
      handler: async (ctx) => {
        const session = await loadSession(ctx.db, ctx.auth, ctx.params.id);
        if (!session) throw errors.notFound('Session not found');
        const visit = await ctx.services.visits.findBySession(ctx.db, session.clinicId, session.id);
        const signed = visit?.status === 'signed';
        const draft = await evaluateDraft(ctx.db, session, signed);
        const safety = await runSafety(ctx.services, session.id, draft.content.medicines);
        return {
          data: {
            signed,
            blockers: draft.blockers,
            medicineCount: draft.medicineCount,
            safety,
            currentVersion: visit?.currentVersion ?? null,
          },
        };
      },
    }),

    permRoute<IdParams, SignBody>('visit.sign', {
      method: 'post',
      path: '/sessions/:id/sign',
      tag: 'Visit',
      summary:
        'Doctor: sign the visit. The server checks the blockers, the safety acknowledgement and the password, then stores the exact snapshot and its hash',
      audit: ['VISIT_SIGNED', 'VISIT_SIGN_REFUSED'],
      params: idParams,
      body: signBody,
      response: versionView,
      successStatus: 201,
      handler: async (ctx) => {
        const session = await loadSession(ctx.db, ctx.auth, ctx.params.id);
        if (!session) throw errors.notFound('Session not found');
        const refuse = async (cause: string, blockerCount = 0) =>
          ctx.auditCommitted({
            action: 'VISIT_SIGN_REFUSED',
            resourceType: 'consultation_session',
            resourceId: session.id,
            sessionId: session.id,
            meta: { cause, blockerCount },
          });

        const existing = await ctx.services.visits.findBySession(
          ctx.db,
          session.clinicId,
          session.id,
        );
        const draft = await evaluateDraft(ctx.db, session, existing?.status === 'signed');
        if (draft.blockers.length > 0) {
          await refuse('blocked', draft.blockers.length);
          throw errors.signBlocked(draft.blockers);
        }
        const safety = await runSafety(ctx.services, session.id, draft.content.medicines);
        let flags;
        try {
          flags = requireSafetyAcknowledgement(safety, ctx.body.safetyNotRunAcknowledged);
        } catch (err) {
          await refuse(
            (err as { code?: string }).code === 'SAFETY_ERROR'
              ? 'safety_error'
              : 'safety_acknowledgement',
          );
          throw err;
        }
        try {
          await checkSignPassword(ctx.services, ctx.auth, ctx.body.password);
        } catch (err) {
          await refuse('password');
          throw err;
        }

        const content = { ...draft.content, signedAt: new Date().toISOString() };
        let version: VisitVersion;
        try {
          version = await ctx.services.visits.createSigned(ctx.db, {
            clinicId: session.clinicId,
            sessionId: session.id,
            patientRef: session.patientId,
            doctorId: session.doctorId,
            content,
            contentHash: hashContent(content),
            ...flags,
            signedBy: ctx.auth.sub,
          });
        } catch (err) {
          // two sign requests at once: the second hits the one-record-per-session rule
          if ((err as { code?: string }).code === '23505') throw errors.visitSigned();
          throw err;
        }
        await ctx.audit({
          action: 'VISIT_SIGNED',
          resourceType: 'consultation_session',
          resourceId: session.id,
          sessionId: session.id,
          meta: {
            version: version.version,
            factCount: content.facts.length,
            medicineCount: content.medicines.length,
            safetyNotRun: flags.safetyNotRunAcknowledged,
            aiContent: content.aiContentIncluded,
          },
        });
        return { data: toView(version), status: 201 };
      },
    }),

    permRoute<IdParams, AmendBody>('visit.amend', {
      method: 'post',
      path: '/sessions/:id/amend',
      tag: 'Visit',
      summary:
        'Doctor: amend a signed visit (medicine list) with a reason; adds a new version and keeps every earlier one',
      audit: ['VISIT_AMENDED', 'VISIT_AMEND_REFUSED'],
      params: idParams,
      body: amendBody,
      response: versionView,
      successStatus: 201,
      handler: async (ctx) => {
        const session = await loadSession(ctx.db, ctx.auth, ctx.params.id);
        if (!session) throw errors.notFound('Session not found');
        const refuse = async (cause: string) =>
          ctx.auditCommitted({
            action: 'VISIT_AMEND_REFUSED',
            resourceType: 'consultation_session',
            resourceId: session.id,
            sessionId: session.id,
            meta: { cause },
          });
        const previous = await ctx.services.visits.getVersion(ctx.db, session.clinicId, session.id);
        if (!previous) throw errors.conflict('This visit is not signed yet');

        const medicines = await amendedMedicines(ctx.db, ctx.body.medicines);
        const safety = await runSafety(ctx.services, session.id, medicines);
        let flags;
        try {
          flags = requireSafetyAcknowledgement(safety, ctx.body.safetyNotRunAcknowledged);
        } catch (err) {
          await refuse(
            (err as { code?: string }).code === 'SAFETY_ERROR'
              ? 'safety_error'
              : 'safety_acknowledgement',
          );
          throw err;
        }
        try {
          await checkSignPassword(ctx.services, ctx.auth, ctx.body.password);
        } catch (err) {
          await refuse('password');
          throw err;
        }

        const content = {
          ...previous.content,
          medicines,
          signedAt: new Date().toISOString(),
          amendedFrom: previous.version,
        };
        const version = await ctx.services.visits.addAmendment(ctx.db, {
          clinicId: session.clinicId,
          sessionId: session.id,
          content,
          contentHash: hashContent(content),
          ...flags,
          signedBy: ctx.auth.sub,
          reason: ctx.body.reason,
        });
        await ctx.audit({
          action: 'VISIT_AMENDED',
          resourceType: 'consultation_session',
          resourceId: session.id,
          sessionId: session.id,
          meta: { version: version.version, medicineCount: medicines.length },
        });
        return { data: toView(version), status: 201 };
      },
    }),

    permRoute<IdParams>('visit.read', {
      method: 'get',
      path: '/sessions/:id/visit',
      tag: 'Visit',
      summary: 'Doctor: the current version of the signed visit',
      audit: [],
      params: idParams,
      response: versionView,
      handler: async (ctx) => {
        const session = await loadSession(ctx.db, ctx.auth, ctx.params.id);
        if (!session) throw errors.notFound('Session not found');
        const v = await ctx.services.visits.getVersion(ctx.db, session.clinicId, session.id);
        if (!v) throw errors.notFound('This visit is not signed yet');
        return { data: toView(v) };
      },
    }),

    permRoute<IdParams>('visit.read', {
      method: 'get',
      path: '/sessions/:id/visit/versions',
      tag: 'Visit',
      summary: 'Doctor: the version history of the signed visit (no content), oldest first',
      audit: [],
      params: idParams,
      response: z.object({ versions: z.array(versionSummaryView) }),
      handler: async (ctx) => {
        const session = await loadSession(ctx.db, ctx.auth, ctx.params.id);
        if (!session) throw errors.notFound('Session not found');
        const versions = await ctx.services.visits.listVersions(
          ctx.db,
          session.clinicId,
          session.id,
        );
        return { data: { versions } };
      },
    }),

    permRoute<VersionParams>('visit.read', {
      method: 'get',
      path: '/sessions/:id/visit/versions/:version',
      tag: 'Visit',
      summary: 'Doctor: one version of the signed visit with its content',
      audit: [],
      params: versionParams,
      response: versionView,
      handler: async (ctx) => {
        const session = await loadSession(ctx.db, ctx.auth, ctx.params.id);
        if (!session) throw errors.notFound('Session not found');
        const v = await ctx.services.visits.getVersion(
          ctx.db,
          session.clinicId,
          session.id,
          ctx.params.version,
        );
        if (!v) throw errors.notFound('Version not found');
        return { data: toView(v) };
      },
    }),
    permRoute<IdParams>('visit.read', {
      method: 'get',
      path: '/sessions/:id/sign-preview',
      tag: 'Visit',
      summary:
        'Doctor: the draft as it would be signed, with the engine original beside the doctor final (facts, working condition, medicine rows)',
      audit: [],
      params: idParams,
      response: previewView,
      handler: async (ctx) => {
        const session = await loadSession(ctx.db, ctx.auth, ctx.params.id);
        if (!session) throw errors.notFound('Session not found');
        return { data: await buildPreview(ctx.db, session) };
      },
    }),

    permRoute<IdParams>('visit.read', {
      method: 'get',
      path: '/sessions/:id/previous-visits',
      tag: 'Visit',
      summary: "Doctor: this doctor's earlier signed visits for the same patient, newest first",
      audit: [],
      params: idParams,
      response: z.object({ visits: z.array(previousVisitView) }),
      handler: async (ctx) => {
        const session = await loadSession(ctx.db, ctx.auth, ctx.params.id);
        if (!session) throw errors.notFound('Session not found');
        const r = await ctx.db.query<{
          session_id: string;
          signed_at: Date;
          current_version: number;
          medicine_count: number;
          fact_count: number;
          safety_not_run: boolean;
        }>(
          `SELECT v.session_id, v.signed_at, v.current_version,
                  jsonb_array_length(w.content -> 'medicines')::int AS medicine_count,
                  jsonb_array_length(w.content -> 'facts')::int AS fact_count,
                  w.safety_not_run_acknowledged AS safety_not_run
             FROM visit_record v
             JOIN visit_record_version w ON w.visit_id = v.id AND w.version = v.current_version
            WHERE v.clinic_id = $1 AND v.doctor_id = $2 AND v.patient_ref = $3 AND v.status = 'signed'
              AND v.session_id <> $4
            ORDER BY v.signed_at DESC LIMIT 20`,
          [session.clinicId, ctx.auth.sub, session.patientId, session.id],
        );
        return {
          data: {
            visits: r.rows.map((x) => ({
              sessionId: x.session_id,
              signedAt: x.signed_at.toISOString(),
              currentVersion: x.current_version,
              medicineCount: x.medicine_count,
              factCount: x.fact_count,
              safetyNotRun: x.safety_not_run,
            })),
          },
        };
      },
    }),
  ];
}
