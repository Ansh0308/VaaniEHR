// /api/v1/audit: read the log (admin: full; researcher: anonymised) and verify the hash chain (admin). PG-16.
import { z } from 'zod';
import { permRoute, type RouteDef } from '../http/routeRegistry.js';
import type { ChainRow } from './chain.js';
import { ChainVerifier } from './chain.js';
import { readChainRows, toChainRow } from './audit.js';
import type { QueryResultRow } from 'pg';

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  /** Cursor: return rows older than this seq (newest first). */
  beforeSeq: z.coerce.number().int().min(1).optional(),
});
type ListQuery = z.infer<typeof listQuery>;

/** Researchers see what happened, never who or to whom (PRD 2.2: "read (anonymised)"). */
export function anonymise(row: ChainRow) {
  return {
    seq: row.seq,
    ts: row.ts,
    action: row.action,
    resourceType: row.resourceType,
    actorRole: row.actorRole,
  };
}

export function auditRoutes(): RouteDef[] {
  return [
    permRoute<unknown, unknown, ListQuery>('audit.read', {
      method: 'get',
      path: '/audit',
      tag: 'Audit',
      summary:
        "This clinic's audit log, newest first. Admin sees full rows; researcher sees anonymised rows. " +
        'Rows with no clinic (seed, failed logins for unknown e-mails) are not shown.',
      audit: [],
      query: listQuery,
      response: z.object({
        items: z.array(z.record(z.string(), z.unknown())),
        nextBeforeSeq: z.number().nullable(),
      }),
      handler: async (ctx) => {
        const { limit, beforeSeq } = ctx.query;
        const r = await ctx.db.query<QueryResultRow & Parameters<typeof toChainRow>[0]>(
          `SELECT * FROM audit_log
            WHERE clinic_id = $3 AND ($1::bigint IS NULL OR seq < $1)
            ORDER BY seq DESC LIMIT $2`,
          [beforeSeq ?? null, limit, ctx.auth.clinicId],
        );
        const rows = r.rows.map(toChainRow);
        const items = ctx.auth.role === 'admin' ? rows : rows.map(anonymise);
        const last = rows[rows.length - 1];
        return { data: { items, nextBeforeSeq: rows.length === limit && last ? last.seq : null } };
      },
    }),

    permRoute('audit.verify', {
      method: 'get',
      path: '/audit/verify',
      tag: 'Audit',
      summary:
        'Re-compute the whole hash chain and report whether it is intact. The chain is shared by all clinics, so ' +
        'the answer carries no row counts or hashes; use `npm run verify:audit` for those.',
      audit: [],
      response: z.object({
        ok: z.boolean(),
        firstBrokenSeq: z.number().optional(),
        reason: z.string().optional(),
      }),
      handler: async (ctx) => {
        const verifier = new ChainVerifier();
        let after = 0;
        for (;;) {
          const page = await readChainRows(ctx.db, after, 2000);
          for (const row of page) {
            const failure = verifier.push(row);
            if (failure) {
              return {
                data: { ok: false, firstBrokenSeq: failure.firstBrokenSeq, reason: failure.reason },
              };
            }
          }
          const last = page[page.length - 1];
          if (!last || page.length < 2000) break;
          after = last.seq;
        }
        verifier.finish();
        return { data: { ok: true } };
      },
    }),
  ];
}
