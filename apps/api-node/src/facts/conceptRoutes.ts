// Concept links for facts (remaining Phase 5 items, ADR-D37). Doctor only, the session's own doctor, clinic-scoped, and
// audio + ai_processing consent at the moment of the call (the same as the other fact routes). A link is confirmed by the
// doctor or not at all: the suggestions route never writes.
import { z } from 'zod';
import { getEffectiveConsent } from '../consent/service.js';
import type { Queryable } from '../db/tx.js';
import { errors } from '../http/errors.js';
import { permRoute, type RouteDef } from '../http/routeRegistry.js';
import { loadSession } from '../sessions/service.js';
import {
  clearLink,
  conceptExists,
  confirmLink,
  suggestForSession,
  type Lang,
} from '../concepts/service.js';
import { factView, readFacts } from './service.js';

const idParams = z.object({ id: z.uuid() });
type IdParams = z.infer<typeof idParams>;
const factParams = z.object({ id: z.uuid(), factId: z.uuid() });
type FactParams = z.infer<typeof factParams>;
const langQuery = z.object({ lang: z.enum(['en', 'gu', 'hi']).default('en') });
type LangQuery = z.infer<typeof langQuery>;
const confirmBody = z.object({ conceptId: z.string().min(1).max(64) }).strict();
type ConfirmBody = z.infer<typeof confirmBody>;

const suggestionShape = z.object({
  conceptId: z.string(),
  label: z.string(),
  /** every concept of the draft list is "unreviewed"; the screen says so next to each suggestion */
  reviewStatus: z.enum(['unreviewed', 'reviewed']),
});
const suggestionsShape = z.object({
  listLoaded: z.boolean(),
  byFact: z.record(z.string(), z.array(suggestionShape)),
  conceptLabels: z.record(z.string(), z.string()),
});

async function requireConsent(db: Queryable, sessionId: string): Promise<void> {
  const consent = await getEffectiveConsent(db, sessionId);
  if (!consent.recordingAllowed) {
    throw errors.consentRequired('Consent required for: audio, ai_processing');
  }
}

export function conceptRoutes(): RouteDef[] {
  return [
    permRoute<IdParams, unknown, LangQuery>('fact.read', {
      method: 'get',
      path: '/sessions/:id/concept-suggestions',
      tag: 'Facts',
      summary:
        'Doctor: up to 3 suggested concepts per fact from the UNREVIEWED draft list (never stored; no score)',
      audit: [],
      params: idParams,
      query: langQuery,
      response: suggestionsShape,
      handler: async (ctx) => {
        const session = await loadSession(ctx.db, ctx.auth, ctx.params.id);
        if (!session) throw errors.notFound('Session not found');
        await requireConsent(ctx.db, session.id);
        return {
          data: await suggestForSession(
            ctx.db,
            ctx.services.concepts,
            session.id,
            ctx.query.lang as Lang,
          ),
        };
      },
    }),

    permRoute<FactParams, ConfirmBody>('fact.write', {
      method: 'post',
      path: '/sessions/:id/facts/:factId/concept',
      tag: 'Facts',
      summary:
        'Doctor: confirm the concept link of a fact (the only way a link is ever set; records who and when)',
      audit: ['FACT_CONCEPT_CONFIRMED'],
      params: factParams,
      body: confirmBody,
      response: factView,
      handler: async (ctx) => {
        const session = await loadSession(ctx.db, ctx.auth, ctx.params.id);
        if (!session) throw errors.notFound('Session not found');
        await requireConsent(ctx.db, session.id);
        const catalog = ctx.services.concepts;
        if (!catalog.loaded) throw errors.conflict('The concept list is not loaded');
        if (!conceptExists(catalog, ctx.body.conceptId)) {
          throw errors.validation('That concept is not in the list');
        }
        const result = await confirmLink(ctx.db, {
          sessionId: session.id,
          factId: ctx.params.factId,
          conceptId: ctx.body.conceptId,
          doctorId: ctx.auth.sub,
        });
        if (result === 'missing') throw errors.notFound('Fact not found');
        if (result === 'rejected') throw errors.conflict('A rejected fact cannot be linked');
        if (result === 'not_linkable') {
          throw errors.validation('Only symptoms can be linked to a concept');
        }
        await ctx.audit({
          action: 'FACT_CONCEPT_CONFIRMED',
          resourceType: 'fact',
          resourceId: ctx.params.factId,
          sessionId: session.id,
          meta: { conceptId: ctx.body.conceptId },
        });
        const all = await readFacts(ctx.db, session.id);
        const fact = all.facts.find((f) => f.id === ctx.params.factId);
        if (!fact) throw new Error('fact missing after the link');
        return { data: fact };
      },
    }),

    permRoute<FactParams>('fact.write', {
      method: 'delete',
      path: '/sessions/:id/facts/:factId/concept',
      tag: 'Facts',
      summary: 'Doctor: clear the concept link of a fact',
      audit: ['FACT_CONCEPT_CLEARED'],
      params: factParams,
      response: factView,
      handler: async (ctx) => {
        const session = await loadSession(ctx.db, ctx.auth, ctx.params.id);
        if (!session) throw errors.notFound('Session not found');
        await requireConsent(ctx.db, session.id);
        const cleared = await clearLink(ctx.db, {
          sessionId: session.id,
          factId: ctx.params.factId,
        });
        if (cleared === null) throw errors.conflict('This fact has no concept link');
        await ctx.audit({
          action: 'FACT_CONCEPT_CLEARED',
          resourceType: 'fact',
          resourceId: ctx.params.factId,
          sessionId: session.id,
          meta: { conceptId: cleared },
        });
        const all = await readFacts(ctx.db, session.id);
        const fact = all.facts.find((f) => f.id === ctx.params.factId);
        if (!fact) throw new Error('fact missing after clearing the link');
        return { data: fact };
      },
    }),
  ];
}
