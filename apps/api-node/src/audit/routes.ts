// /api/v1/audit: read this clinic's log (admin: full rows; researcher: anonymised), export it as CSV (admin), and verify
// the hash chain (admin). PG-16.
//  - Filters are user, action and date range ONLY, validated by zod, and every query is scoped to the caller's clinic.
//  - Pages are capped (MAX_PAGE_SIZE). The export is capped too (EXPORT_MAX_ROWS) and is itself an audit event.
//  - The CSV holds identifiers only (no IP address, no free-form metadata), and every cell is neutralised against
//    spreadsheet formula injection (see csv.ts).
import type { QueryResultRow } from 'pg';
import { z } from 'zod';
import { permRoute, type RouteDef } from '../http/routeRegistry.js';
import { errors } from '../http/errors.js';
import { AUDIT_ACTIONS, readChainRows, toChainRow } from './audit.js';
import type { ChainRow } from './chain.js';
import { ChainVerifier } from './chain.js';
import { toCsv } from './csv.js';

export const MAX_PAGE_SIZE = 100;
export const EXPORT_MAX_ROWS = 5000;

/** A date ('2026-10-15') or a full ISO timestamp. A bare date means the whole UTC day. */
const dateInput = (edge: 'start' | 'end') =>
  z
    .union([z.iso.date(), z.iso.datetime({ offset: true })])
    .transform((v) =>
      v.length === 10 ? `${v}T${edge === 'start' ? '00:00:00.000' : '23:59:59.999'}Z` : v,
    );

const filterShape = {
  actorUserId: z.uuid().optional(),
  action: z.enum(AUDIT_ACTIONS).optional(),
  from: dateInput('start').optional(),
  to: dateInput('end').optional(),
};
type Filter = {
  actorUserId?: string | undefined;
  action?: (typeof AUDIT_ACTIONS)[number] | undefined;
  from?: string | undefined;
  to?: string | undefined;
};
const rangeOk = (f: Filter) => !f.from || !f.to || Date.parse(f.from) <= Date.parse(f.to);
const RANGE_MESSAGE = { message: 'from must not be after to', path: ['from'] };

const listQuery = z
  .object({
    ...filterShape,
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(50),
    /** Cursor: return rows older than this seq (newest first). */
    beforeSeq: z.coerce.number().int().min(1).optional(),
  })
  .refine(rangeOk, RANGE_MESSAGE);
type ListQuery = z.infer<typeof listQuery>;

const exportBody = z.object(filterShape).refine(rangeOk, RANGE_MESSAGE);
type ExportBody = z.infer<typeof exportBody>;

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

/** Builds the WHERE clause. The clinic condition is always first and always present. */
function where(clinicId: string, f: Filter, beforeSeq?: number) {
  const params: unknown[] = [clinicId];
  const parts = ['clinic_id = $1'];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    parts.push(sql.replace('?', `$${params.length}`));
  };
  if (f.actorUserId) add('actor_user_id = ?', f.actorUserId);
  if (f.action) add('action = ?', f.action);
  if (f.from) add('ts >= ?', f.from);
  if (f.to) add('ts <= ?', f.to);
  if (beforeSeq) add('seq < ?', beforeSeq);
  return { sql: parts.join(' AND '), params };
}

const CSV_HEADER = [
  'seq',
  'ts',
  'action',
  'actor_user_id',
  'actor_role',
  'resource_type',
  'resource_id',
  'session_id',
  'request_id',
  'row_hash',
] as const;

export function auditRoutes(): RouteDef[] {
  return [
    permRoute<unknown, unknown, ListQuery>('audit.read', {
      method: 'get',
      path: '/audit',
      tag: 'Audit',
      summary:
        "This clinic's audit log, newest first, with optional user, action and date filters. Admin sees full rows; " +
        'researcher sees anonymised rows (and cannot filter by user). Rows with no clinic are not shown.',
      audit: [],
      query: listQuery,
      response: z.object({
        items: z.array(z.record(z.string(), z.unknown())),
        nextBeforeSeq: z.number().nullable(),
      }),
      handler: async (ctx) => {
        const { limit, beforeSeq, ...filter } = ctx.query;
        if (filter.actorUserId && ctx.auth.role !== 'admin') {
          // filtering by person would let an anonymised view be un-anonymised one user at a time
          throw errors.forbidden('Filtering by user is not available for your role');
        }
        const q = where(ctx.auth.clinicId, filter, beforeSeq);
        const r = await ctx.db.query<QueryResultRow & Parameters<typeof toChainRow>[0]>(
          `SELECT * FROM audit_log WHERE ${q.sql} ORDER BY seq DESC LIMIT $${q.params.length + 1}`,
          [...q.params, limit],
        );
        const rows = r.rows.map(toChainRow);
        const items = ctx.auth.role === 'admin' ? rows : rows.map(anonymise);
        const last = rows[rows.length - 1];
        return { data: { items, nextBeforeSeq: rows.length === limit && last ? last.seq : null } };
      },
    }),

    permRoute<unknown, ExportBody>('audit.export', {
      method: 'post',
      path: '/audit/export',
      tag: 'Audit',
      summary:
        `Export this clinic's audit rows (same filters as the list) as CSV, newest first, at most ${EXPORT_MAX_ROWS} ` +
        'rows. Identifiers only; spreadsheet formulas are neutralised. The export is itself written to the audit log.',
      audit: ['AUDIT_EXPORTED'],
      body: exportBody,
      responseType: 'csv',
      handler: async (ctx) => {
        const q = where(ctx.auth.clinicId, ctx.body);
        const r = await ctx.db.query<QueryResultRow & Parameters<typeof toChainRow>[0]>(
          `SELECT * FROM audit_log WHERE ${q.sql} ORDER BY seq DESC LIMIT $${q.params.length + 1}`,
          [...q.params, EXPORT_MAX_ROWS + 1],
        );
        const truncated = r.rows.length > EXPORT_MAX_ROWS;
        const rows = r.rows.slice(0, EXPORT_MAX_ROWS).map(toChainRow);
        const csv = toCsv(
          CSV_HEADER,
          rows.map((row) => [
            row.seq,
            row.ts,
            row.action,
            row.actorUserId,
            row.actorRole,
            row.resourceType,
            row.resourceId,
            row.sessionId,
            row.requestId,
            row.rowHash,
          ]),
        );
        // The export is an audit event: who exported, how many rows, whether it was cut, and which filters (never values).
        await ctx.audit({
          action: 'AUDIT_EXPORTED',
          resourceType: 'audit_log',
          meta: {
            rowCount: rows.length,
            truncated,
            filteredByAction: ctx.body.action ?? null,
            filteredByUser: Boolean(ctx.body.actorUserId),
            filteredByDate: Boolean(ctx.body.from || ctx.body.to),
          },
        });
        return {
          raw: {
            contentType: 'text/csv; charset=utf-8',
            body: csv,
            filename: `audit-${new Date().toISOString().slice(0, 10)}.csv`,
            headers: {
              'X-Exported-Rows': String(rows.length),
              'X-Export-Truncated': String(truncated),
            },
          },
        };
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
