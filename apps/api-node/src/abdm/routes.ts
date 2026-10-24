// ABHA verification endpoints (Phase 9B, ADR-D42, FR-F9-01..03). MOCK or SANDBOX only: every response carries the mode and a
// notice. The staff member attests the patient agreed (stored with the start); the identity and the OTP are used once and
// never stored, logged or audited. Audit rows hold the patient id, the mode and a cause word only.
import { z } from 'zod';
import { errors } from '../http/errors.js';
import { permRoute, type RouteDef } from '../http/routeRegistry.js';
import { readStatus, startedView, startVerification, statusView, verifyOtp } from './service.js';

const patientParams = z.object({ patientId: z.uuid() });
type PatientParams = z.infer<typeof patientParams>;
const startBody = z
  .object({
    patientId: z.uuid(),
    /** a TEST ABHA number or address; the guard refuses anything else. Never stored or logged. */
    identity: z.string().min(3).max(100),
    /** the staff member confirms the patient agreed to this check */
    attested: z.literal(true),
  })
  .strict();
type StartBody = z.infer<typeof startBody>;
const otpBody = z
  .object({ txnId: z.uuid(), otp: z.string().regex(/^\d{6}$/, 'The OTP is 6 digits') })
  .strict();
type OtpBody = z.infer<typeof otpBody>;

export function abhaRoutes(): RouteDef[] {
  return [
    permRoute<PatientParams>('abha.read', {
      method: 'get',
      path: '/abha/status/:patientId',
      tag: 'ABHA',
      summary:
        'ABHA verification status of a patient of this clinic (MOCK or SANDBOX), with the mode and a notice',
      audit: [],
      params: patientParams,
      response: statusView,
      handler: async (ctx) => ({
        data: await readStatus(ctx.db, ctx.services, ctx.auth, ctx.params.patientId),
      }),
    }),

    permRoute<Record<string, never>, StartBody>('abha.verify', {
      method: 'post',
      path: '/abha/verify/start',
      tag: 'ABHA',
      summary:
        'Start an ABHA OTP check with a TEST identity (mock or sandbox). Refuses anything that is not an allowed test identity. Returns our own reference; the identity is never stored',
      audit: ['ABHA_VERIFY_STARTED', 'ABHA_VERIFY_FAILED'],
      body: startBody,
      response: startedView,
      successStatus: 201,
      handler: async (ctx) => {
        const body = ctx.body;
        const patientId = body.patientId;
        const mode = ctx.services.abha.mode;
        const out = await startVerification(
          ctx.db,
          ctx.services,
          ctx.auth,
          { patientId, identity: body.identity },
          (failure) =>
            ctx.auditCommitted({
              action: 'ABHA_VERIFY_FAILED',
              resourceType: 'patient',
              resourceId: patientId,
              meta: { stage: 'start', cause: failure, mode },
            }),
        );
        await ctx.audit({
          action: 'ABHA_VERIFY_STARTED',
          resourceType: 'patient',
          resourceId: patientId,
          meta: { mode, attested: true },
        });
        return { data: out, status: 201 };
      },
    }),

    permRoute<Record<string, never>, OtpBody>('abha.verify', {
      method: 'post',
      path: '/abha/verify/otp',
      tag: 'ABHA',
      summary:
        'Check the OTP for a started ABHA verification (mock or sandbox). Three wrong tries lock it. Stores the ABHA address, the time, the mode and a salted hash of the number; never the number or the OTP',
      audit: ['ABHA_VERIFY_SUCCEEDED', 'ABHA_VERIFY_FAILED'],
      body: otpBody,
      response: statusView,
      handler: async (ctx) => {
        if (!ctx.body) throw errors.validation('Body required');
        const mode = ctx.services.abha.mode;
        const out = await verifyOtp(
          ctx.db,
          ctx.services,
          ctx.auth,
          { txnId: ctx.body.txnId, otp: ctx.body.otp },
          (patientId, failure) =>
            ctx.auditCommitted({
              action: 'ABHA_VERIFY_FAILED',
              resourceType: 'patient',
              resourceId: patientId,
              meta: { stage: 'otp', cause: failure, mode },
            }),
        );
        await ctx.audit({
          action: 'ABHA_VERIFY_SUCCEEDED',
          resourceType: 'patient',
          resourceId: out.patientId,
          meta: { mode },
        });
        return { data: out };
      },
    }),
  ];
}
