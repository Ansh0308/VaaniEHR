// INTERNAL routes for asr-py (Phase 4A, ADR-D26). Service-signed, not browser-facing, never reachable with a user token.
// asr-py registers a stored recording, tells api-node when it deleted one, and re-checks consent while it streams.
// The clinic of an asset always comes from its session, never from the caller.
import { z } from 'zod';
import { getEffectiveConsent } from '../consent/service.js';
import { errors } from '../http/errors.js';
import { serviceRoute, type RouteDef } from '../http/routeRegistry.js';

const idParams = z.object({ id: z.uuid() });
type IdParams = z.infer<typeof idParams>;

const registerBody = z
  .object({
    assetId: z.uuid(),
    sessionId: z.uuid(),
    storageKey: z.string().min(1).max(200),
    durationS: z.number().min(0).max(86_400),
    bytes: z.number().int().min(0),
    retentionUntil: z.iso.datetime({ offset: true }),
  })
  .strict();
type RegisterBody = z.infer<typeof registerBody>;

const deletedBody = z
  .object({ reason: z.enum(['retention', 'consent_withdrawn', 'manual']) })
  .strict();
type DeletedBody = z.infer<typeof deletedBody>;

const asService = { actorRole: 'service' } as const;

export function asrInternalRoutes(): RouteDef[] {
  return [
    serviceRoute<unknown, RegisterBody>({
      method: 'post',
      path: '/internal/audio-assets',
      tag: 'Internal',
      summary:
        'Service: record that asr-py stored an encrypted recording (idempotent on the asset id)',
      audit: ['AUDIO_STORED'],
      body: registerBody,
      response: z.object({ assetId: z.uuid(), created: z.boolean() }),
      successStatus: 201,
      handler: async (ctx) => {
        const b = ctx.body;
        const session = await ctx.db.query<{ clinicos_clinic_id: string }>(
          'SELECT clinicos_clinic_id FROM consultation_session WHERE id = $1',
          [b.sessionId],
        );
        const clinicId = session.rows[0]?.clinicos_clinic_id;
        if (!clinicId) throw errors.notFound('Session not found');
        const inserted = await ctx.db.query(
          `INSERT INTO audio_asset (id, session_id, clinic_id, storage_key, duration_s, bytes, retention_until)
           VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING RETURNING id`,
          [b.assetId, b.sessionId, clinicId, b.storageKey, b.durationS, b.bytes, b.retentionUntil],
        );
        const created = (inserted.rowCount ?? 0) > 0;
        await ctx.audit({
          ...asService,
          action: 'AUDIO_STORED',
          resourceType: 'audio_asset',
          resourceId: b.assetId,
          clinicId,
          sessionId: b.sessionId,
        });
        return { data: { assetId: b.assetId, created }, status: 201 };
      },
    }),

    serviceRoute<IdParams, DeletedBody>({
      method: 'post',
      path: '/internal/audio-assets/:id/deleted',
      tag: 'Internal',
      summary:
        'Service: record that asr-py deleted a recording (retention, consent withdrawn, or by hand)',
      audit: ['AUDIO_PURGED'],
      params: idParams,
      body: deletedBody,
      response: z.object({ assetId: z.uuid(), alreadyDeleted: z.boolean() }),
      handler: async (ctx) => {
        const found = await ctx.db.query<{
          clinic_id: string;
          session_id: string;
          deleted_at: Date | null;
        }>('SELECT clinic_id, session_id, deleted_at FROM audio_asset WHERE id = $1 FOR UPDATE', [
          ctx.params.id,
        ]);
        const row = found.rows[0];
        if (!row) throw errors.notFound('Audio asset not found');
        const already = row.deleted_at !== null;
        if (!already) {
          await ctx.db.query(
            'UPDATE audio_asset SET deleted_at = now(), deleted_reason = $2 WHERE id = $1',
            [ctx.params.id, ctx.body.reason],
          );
        }
        await ctx.audit({
          ...asService,
          action: 'AUDIO_PURGED',
          resourceType: 'audio_asset',
          resourceId: ctx.params.id,
          clinicId: row.clinic_id,
          sessionId: row.session_id,
          meta: { reason: ctx.body.reason, alreadyDeleted: already },
        });
        return { data: { assetId: ctx.params.id, alreadyDeleted: already } };
      },
    }),

    serviceRoute<IdParams>({
      method: 'get',
      path: '/internal/sessions/:id/consent-status',
      tag: 'Internal',
      summary: 'Service: are audio and AI-processing consent still on record for this session?',
      audit: [],
      params: idParams,
      response: z.object({
        sessionId: z.uuid(),
        recordingAllowed: z.boolean(),
        scopes: z.object({ audio: z.boolean(), ai_processing: z.boolean() }),
      }),
      handler: async (ctx) => {
        const exists = await ctx.db.query('SELECT 1 FROM consultation_session WHERE id = $1', [
          ctx.params.id,
        ]);
        if ((exists.rowCount ?? 0) === 0) throw errors.notFound('Session not found');
        const consent = await getEffectiveConsent(ctx.db, ctx.params.id);
        return {
          data: {
            sessionId: ctx.params.id,
            recordingAllowed: consent.recordingAllowed,
            scopes: {
              audio: consent.scopes.audio.granted,
              ai_processing: consent.scopes.ai_processing.granted,
            },
          },
        };
      },
    }),
  ];
}
