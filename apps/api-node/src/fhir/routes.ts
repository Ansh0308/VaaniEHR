// FHIR bundles of a signed visit (Phase 9A, ADR-D40, FR-F8-03..05). The doctor builds and validates the bundles of the current
// visit version and exports a bundle only when the validator called it valid; the admin sees the verdict and the errors (no
// clinical content). A signed visit stays signed whatever the verdict. Audit rows hold ids, versions and counts only.
import { z } from 'zod';
import { errors } from '../http/errors.js';
import { permRoute, type RouteDef } from '../http/routeRegistry.js';
import { loadSession } from '../sessions/service.js';
import {
  BUNDLE_KINDS,
  bundleVersions,
  bundleView,
  generateBundles,
  readBundles,
  toView,
} from './service.js';

const idParams = z.object({ id: z.uuid() });
type IdParams = z.infer<typeof idParams>;
const versionQuery = z.object({ version: z.coerce.number().int().min(1).max(10000).optional() });
type VersionQuery = z.infer<typeof versionQuery>;
const generateBody = z.object({ revalidate: z.boolean().default(false) }).strict();
type GenerateBody = z.infer<typeof generateBody>;
const exportBody = z
  .object({ kind: z.enum(BUNDLE_KINDS), version: z.number().int().min(1).max(10000).optional() })
  .strict();
type ExportBody = z.infer<typeof exportBody>;

const listShape = z.object({
  /** the current signed version, or null when the visit is not signed */
  currentVersion: z.number().nullable(),
  /** versions that already have bundles */
  versions: z.array(z.number()),
  version: z.number().nullable(),
  bundles: z.array(bundleView),
});

export function fhirRoutes(): RouteDef[] {
  return [
    permRoute<IdParams, unknown, VersionQuery>('fhir.read', {
      method: 'get',
      path: '/sessions/:id/fhir',
      tag: 'FHIR',
      summary:
        'Doctor and admin: the FHIR bundles of a signed visit version with the validator verdict (the bundle itself is for the doctor only)',
      audit: [],
      params: idParams,
      query: versionQuery,
      response: listShape,
      handler: async (ctx) => {
        const session = await loadSession(ctx.db, ctx.auth, ctx.params.id);
        if (!session) throw errors.notFound('Session not found');
        const current = await ctx.services.visits.getVersion(ctx.db, session.clinicId, session.id);
        const version = ctx.query.version ?? current?.version ?? null;
        const rows = version === null ? [] : await readBundles(ctx.db, session.id, version);
        return {
          data: {
            currentVersion: current?.version ?? null,
            versions: await bundleVersions(ctx.db, session.id),
            version,
            bundles: rows.map((r) => toView(r, ctx.auth.role === 'doctor')),
          },
        };
      },
    }),

    permRoute<IdParams, GenerateBody>('fhir.generate', {
      method: 'post',
      path: '/sessions/:id/fhir',
      tag: 'FHIR',
      summary:
        'Doctor: build and validate the FHIR bundles of the current signed version (existing verdicts are kept; revalidate only repeats a bundle that was not validated)',
      audit: ['FHIR_GENERATED'],
      params: idParams,
      body: generateBody,
      response: listShape,
      successStatus: 201,
      handler: async (ctx) => {
        const session = await loadSession(ctx.db, ctx.auth, ctx.params.id);
        if (!session) throw errors.notFound('Session not found');
        const visit = await ctx.services.visits.getVersion(ctx.db, session.clinicId, session.id);
        if (!visit) throw errors.conflict('This visit is not signed yet');
        const rows = await generateBundles(
          ctx.db,
          ctx.services,
          session,
          visit,
          ctx.auth.sub,
          ctx.body.revalidate,
        );
        await ctx.audit({
          action: 'FHIR_GENERATED',
          resourceType: 'consultation_session',
          resourceId: session.id,
          sessionId: session.id,
          meta: {
            version: visit.version,
            bundleCount: rows.length,
            validCount: rows.filter((r) => r.status === 'valid').length,
            invalidCount: rows.filter((r) => r.status === 'invalid').length,
            notValidatedCount: rows.filter((r) => r.status === 'not_validated').length,
          },
        });
        return {
          data: {
            currentVersion: visit.version,
            versions: await bundleVersions(ctx.db, session.id),
            version: visit.version,
            bundles: rows.map((r) => toView(r, true)),
          },
          status: 201,
        };
      },
    }),

    permRoute<IdParams, ExportBody>('fhir.export', {
      method: 'post',
      path: '/sessions/:id/fhir/export',
      tag: 'FHIR',
      summary:
        'Doctor: take one bundle as a file. Refused (409) unless the validator called it valid: an invalid or not-validated bundle cannot be exported',
      audit: ['FHIR_EXPORTED'],
      params: idParams,
      body: exportBody,
      response: z.object({ filename: z.string(), bundle: z.record(z.string(), z.unknown()) }),
      handler: async (ctx) => {
        const session = await loadSession(ctx.db, ctx.auth, ctx.params.id);
        if (!session) throw errors.notFound('Session not found');
        const current = await ctx.services.visits.getVersion(ctx.db, session.clinicId, session.id);
        const version = ctx.body.version ?? current?.version;
        if (version === undefined) throw errors.conflict('This visit is not signed yet');
        const row = (await readBundles(ctx.db, session.id, version)).find(
          (r) => r.kind === ctx.body.kind,
        );
        if (!row) throw errors.notFound('Bundle not found');
        if (row.status !== 'valid') {
          throw errors.conflict('This bundle is not valid, so it cannot be exported');
        }
        await ctx.audit({
          action: 'FHIR_EXPORTED',
          resourceType: 'consultation_session',
          resourceId: session.id,
          sessionId: session.id,
          meta: { version, kind: ctx.body.kind },
        });
        return {
          data: {
            filename: `visit-${session.id}-v${version}-${ctx.body.kind}.json`,
            bundle: row.bundle,
          },
        };
      },
    }),
  ];
}
