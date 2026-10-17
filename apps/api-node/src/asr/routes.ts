// Speech-service access (Phase 4A). The only browser-facing route: it mints a short-lived signed token, and only
// after the server itself has confirmed consent scopes audio + ai_processing for THIS session (FR-F1-01).
import { z } from 'zod';
import { getEffectiveConsent } from '../consent/service.js';
import { errors } from '../http/errors.js';
import { permRoute, type RouteDef } from '../http/routeRegistry.js';
import { loadSession } from '../sessions/service.js';
import { ASR_TOKEN_TTL_SECONDS, signAsrToken } from './token.js';

const idParams = z.object({ id: z.uuid() });
type IdParams = z.infer<typeof idParams>;

export function asrRoutes(): RouteDef[] {
  return [
    permRoute<IdParams>('asr.token', {
      method: 'post',
      path: '/sessions/:id/asr-token',
      tag: 'Speech',
      summary: `Doctor: get a ${ASR_TOKEN_TTL_SECONDS}-second token to stream audio to the speech service; refused unless audio and AI-processing consent are on record`,
      audit: ['ASR_TOKEN_ISSUED'],
      params: idParams,
      response: z.object({
        token: z.string(),
        expiresAt: z.string(),
        expiresInSeconds: z.number(),
        scopes: z.array(z.string()),
      }),
      handler: async (ctx) => {
        const secret = ctx.services.config.internalServiceSecret;
        if (!secret) throw errors.notReady('The speech service is not configured');
        const session = await loadSession(ctx.db, ctx.auth, ctx.params.id);
        if (!session) throw errors.notFound('Session not found');
        const consent = await getEffectiveConsent(ctx.db, session.id);
        if (!consent.recordingAllowed) {
          throw errors.consentRequired('Consent required for: audio, ai_processing');
        }
        const signed = signAsrToken(secret, {
          sessionId: session.id,
          scopes: ['audio', 'ai_processing'],
          userId: ctx.auth.sub,
          clinicId: session.clinicId,
        });
        await ctx.audit({
          action: 'ASR_TOKEN_ISSUED',
          resourceType: 'session',
          resourceId: session.id,
        });
        return {
          data: {
            token: signed.token,
            expiresAt: signed.expiresAt,
            expiresInSeconds: ASR_TOKEN_TTL_SECONDS,
            scopes: signed.claims.scopes,
          },
        };
      },
    }),
  ];
}
