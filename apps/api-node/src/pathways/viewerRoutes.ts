// The read-only pathway viewer API (PG-14, Phase 6B, ADR-D35): what pathways are loaded, every node with its text in en,
// gu and hi, its source quote and page, the version history and the reviewer sign-off state. Doctors and admins may read;
// nobody edits through the API (a new version is made with the command line). The files are configuration, not clinic
// data, so there is no clinic filter and no consent check, and nothing here touches a patient or a session.
import { z } from 'zod';
import { errors } from '../http/errors.js';
import { permRoute, type RouteDef } from '../http/routeRegistry.js';
import type { Pathway, PathwayNode } from './rules.js';

const idParams = z.object({ id: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/) });
type IdParams = z.infer<typeof idParams>;
const versionQuery = z.object({ version: z.coerce.number().int().min(1).optional() });
type VersionQuery = z.infer<typeof versionQuery>;

const scalar = z.union([z.boolean(), z.number(), z.string()]);
const valueShape = z.union([scalar, z.array(scalar)]);
const localized = z.object({ en: z.string(), gu: z.string(), hi: z.string() });
const conditionShape = z.object({ op: z.string(), value: valueShape });

const versionShape = z.object({
  version: z.number(),
  status: z.enum(['test', 'draft', 'active']),
  reviewedBy: z.string().nullable(),
  reviewedOn: z.string().nullable(),
  signedOff: z.boolean(),
});
const summaryShape = z.object({
  id: z.string(),
  title: localized,
  latestVersion: z.number(),
  status: z.enum(['test', 'draft', 'active']),
  signedOff: z.boolean(),
  notActive: z.boolean(),
  nodeCount: z.number(),
  versions: z.array(versionShape),
});
const nodeShape = z.object({
  id: z.string(),
  type: z.enum(['question', 'terminal']),
  slot: z.string().nullable(),
  answer: z.string().nullable(),
  choices: z.array(z.string()).nullable(),
  ask: localized.nullable(),
  reason: localized.nullable(),
  label: localized.nullable(),
  infoWeight: z.number().nullable(),
  redFlagIf: conditionShape.nullable(),
  sourceQuote: z.string().nullable(),
  page: z.union([z.string(), z.number()]).nullable(),
  reviewedBy: z.string().nullable(),
  conceptId: z.string().nullable(),
  refer: z.boolean().nullable(),
  edges: z.array(conditionShape.extend({ to: z.string() })),
});
const detailShape = summaryShape.extend({
  version: z.number(),
  source: z.object({ doc: z.string(), page: z.union([z.string(), z.number()]) }),
  reviewedBy: z.string().nullable(),
  reviewedOn: z.string().nullable(),
  start: z.string(),
  nodes: z.array(nodeShape),
  rules: z.array(
    z.object({
      id: z.string(),
      slot: z.string(),
      op: z.string(),
      value: valueShape,
      weight: z.number(),
    }),
  ),
});

const text = (v: string | undefined): string | null => (v && v.trim() ? v : null);
const signed = (p: Pathway): boolean =>
  !!text(p.source.reviewed_by) && !!text(p.source.reviewed_on);

const versionView = (p: Pathway) => ({
  version: p.version,
  status: p.status,
  reviewedBy: text(p.source.reviewed_by),
  reviewedOn: text(p.source.reviewed_on),
  signedOff: signed(p),
});

function nodeView(n: PathwayNode) {
  const q = n.type === 'question' ? n : null;
  return {
    id: n.id,
    type: n.type,
    slot: q?.slot ?? null,
    answer: q?.answer ?? null,
    choices: q?.choices ?? null,
    ask: q?.ask ?? null,
    reason: q?.reason ?? null,
    label: n.type === 'terminal' ? n.label : null,
    infoWeight: q?.info_weight ?? null,
    redFlagIf: q?.red_flag_if ?? null,
    sourceQuote: text(n.source_quote),
    page: n.page ?? null,
    reviewedBy: text(n.reviewed_by),
    conceptId: q ? text(q.concept_id) : null,
    refer: n.type === 'terminal' ? (n.refer ?? null) : null,
    edges: (q?.edges ?? []).map((e) => ({ op: e.if.op, value: e.if.value, to: e.to })),
  };
}

export function pathwayViewerRoutes(): RouteDef[] {
  const summary = (all: Pathway[], id: string) => {
    const versions = all.filter((p) => p.id === id).sort((a, b) => b.version - a.version);
    const latest = versions[0] as Pathway;
    return {
      id,
      title: latest.title,
      latestVersion: latest.version,
      status: latest.status,
      signedOff: signed(latest),
      notActive: latest.status !== 'active',
      nodeCount: latest.nodes.length,
      versions: versions.map(versionView),
    };
  };
  return [
    permRoute('pathway.read', {
      method: 'get',
      path: '/pathways',
      tag: 'Pathways',
      summary:
        'Doctor or admin: the loaded guideline pathways with their versions and sign-off state (read only)',
      audit: [],
      response: z.object({ pathways: z.array(summaryShape), testPathwaysAllowed: z.boolean() }),
      handler: async (ctx) => {
        const all = ctx.services.pathways.allVersions;
        const ids = [...new Set(all.map((p) => p.id))].sort();
        return {
          data: {
            pathways: ids.map((id) => summary(all, id)),
            testPathwaysAllowed: ctx.services.config.pathways.allowTest,
          },
        };
      },
    }),

    permRoute<IdParams, unknown, VersionQuery>('pathway.read', {
      method: 'get',
      path: '/pathways/:id',
      tag: 'Pathways',
      summary:
        'Doctor or admin: one pathway version with every node, its text in en, gu and hi, its source quote and page (read only)',
      audit: [],
      params: idParams,
      query: versionQuery,
      response: detailShape,
      handler: async (ctx) => {
        const all = ctx.services.pathways.allVersions;
        if (!all.some((p) => p.id === ctx.params.id)) throw errors.notFound('Pathway not found');
        const base = summary(all, ctx.params.id);
        const version = ctx.query.version ?? base.latestVersion;
        const p = all.find((x) => x.id === ctx.params.id && x.version === version);
        if (!p) throw errors.notFound('Pathway version not found');
        return {
          data: {
            ...base,
            version: p.version,
            title: p.title,
            status: p.status,
            signedOff: signed(p),
            notActive: p.status !== 'active',
            nodeCount: p.nodes.length,
            source: { doc: p.source.doc, page: p.source.page },
            reviewedBy: text(p.source.reviewed_by),
            reviewedOn: text(p.source.reviewed_on),
            start: p.start,
            nodes: p.nodes.map(nodeView),
            rules: p.rules.map((r) => ({
              id: r.id,
              slot: r.slot,
              op: r.if.op,
              value: r.if.value,
              weight: r.weight,
            })),
          },
        };
      },
    }),
  ];
}
