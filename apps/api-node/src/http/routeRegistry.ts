// One registry for every /api/v1 route. Each route states its access rule, its audit actions and its zod schemas ONCE;
// the same data drives (1) the Express wiring below, (2) the RBAC matrix test, (3) the "every mutating route is
// audited" test, and (4) the generated OpenAPI file. Nothing else may register /api/v1 routes (test: route-coverage).
//
// Guarantees enforced here, not by convention:
//  - authentication, then permission, then validation, then handler (so a wrong role is 403 before any validation);
//  - every non-GET handler runs in ONE database transaction, and its audit rows are written in that transaction;
//  - a non-GET handler that returns success without writing an audit row is turned into a 500 and rolled back;
//  - an audit action the route did not declare is rejected.
import type { Request, RequestHandler, Response, Router } from 'express';
import type { ZodType } from 'zod';
import { appendAudit, type AuditAction, type AuditEntry } from '../audit/audit.js';
import { authenticate, requirePermission } from '../auth/middleware.js';
import type { PermissionId } from '../auth/permissions.js';
import type { AuthContext } from '../auth/types.js';
import { withTransaction, type Queryable } from '../db/tx.js';
import type { Services } from '../services.js';
import { ok } from './respond.js';
import { validate } from './validate.js';

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';
export type Access =
  { kind: 'public' } | { kind: 'authenticated' } | { kind: 'permission'; permission: PermissionId };

/** Fields a handler may set on an audit row; actor, clinic, ip and request id are filled in from the request. */
export type AuditInput = Omit<AuditEntry, 'ip' | 'requestId'> & {
  actorUserId?: string | null;
  actorRole?: string | null;
  clinicId?: string | null;
};

export interface BaseContext<P, B, Q> {
  req: Request;
  res: Response;
  services: Services;
  params: P;
  body: B;
  query: Q;
  /** The pool for GET routes; the open transaction for every other method. */
  db: Queryable;
  /** Append an audit row inside this request's transaction (non-GET routes). */
  audit: (entry: AuditInput) => Promise<void>;
  /** Append an audit row in its OWN transaction so it survives a failed request (e.g. a failed login). */
  auditCommitted: (entry: AuditInput) => Promise<void>;
}
export interface AuthedContext<P, B, Q> extends BaseContext<P, B, Q> {
  auth: AuthContext;
}
export interface PublicContext<P, B, Q> extends BaseContext<P, B, Q> {
  auth: AuthContext | undefined;
}

export interface HandlerResult {
  data: unknown;
  status?: number;
}

interface RouteBase<P, B, Q> {
  method: HttpMethod;
  /** Express path relative to /api/v1, e.g. '/sessions/:id/consent'. */
  path: string;
  tag: string;
  summary: string;
  /** Audit actions this route may write. Required (non-empty) for every non-GET route. */
  audit: readonly AuditAction[];
  params?: ZodType<P>;
  body?: ZodType<B>;
  query?: ZodType<Q>;
  /** Shape of `data` in the success envelope (documentation only). */
  response?: ZodType;
  successStatus?: number;
  /** Middleware that runs before authentication (e.g. the login rate limiter). */
  pre?: RequestHandler[];
}

export interface RouteDef {
  method: HttpMethod;
  path: string;
  tag: string;
  summary: string;
  access: Access;
  audit: readonly AuditAction[];
  params?: ZodType;
  body?: ZodType;
  query?: ZodType;
  response?: ZodType;
  successStatus: number;
  pre: RequestHandler[];
  handler: (ctx: PublicContext<unknown, unknown, unknown>) => Promise<HandlerResult>;
}

type Erase<T> = (ctx: T) => Promise<HandlerResult>;

export function publicRoute<P = unknown, B = unknown, Q = unknown>(
  def: RouteBase<P, B, Q> & { handler: Erase<PublicContext<P, B, Q>> },
): RouteDef {
  return finish({ kind: 'public' }, def);
}

export function authedRoute<P = unknown, B = unknown, Q = unknown>(
  def: RouteBase<P, B, Q> & { handler: Erase<AuthedContext<P, B, Q>> },
): RouteDef {
  return finish({ kind: 'authenticated' }, def);
}

export function permRoute<P = unknown, B = unknown, Q = unknown>(
  permission: PermissionId,
  def: RouteBase<P, B, Q> & { handler: Erase<AuthedContext<P, B, Q>> },
): RouteDef {
  return finish({ kind: 'permission', permission }, def);
}

function finish<P, B, Q>(
  access: Access,
  def: RouteBase<P, B, Q> & { handler: (ctx: never) => Promise<HandlerResult> },
): RouteDef {
  if (def.method !== 'get' && def.audit.length === 0) {
    throw new Error(
      `${def.method.toUpperCase()} ${def.path}: mutating routes must declare audit actions`,
    );
  }
  return {
    method: def.method,
    path: def.path,
    tag: def.tag,
    summary: def.summary,
    access,
    audit: def.audit,
    ...(def.params ? { params: def.params } : {}),
    ...(def.body ? { body: def.body } : {}),
    ...(def.query ? { query: def.query } : {}),
    ...(def.response ? { response: def.response } : {}),
    successStatus: def.successStatus ?? 200,
    pre: def.pre ?? [],
    handler: def.handler as RouteDef['handler'],
  };
}

export const isMutating = (method: HttpMethod): boolean => method !== 'get';

function auditFields(req: Request, input: AuditInput): AuditEntry {
  return {
    ...input,
    actorUserId: input.actorUserId ?? req.auth?.sub ?? null,
    actorRole: input.actorRole ?? req.auth?.role ?? null,
    clinicId: input.clinicId ?? req.auth?.clinicId ?? null,
    ip: req.ip ?? null,
    requestId: req.id,
  };
}

/** Wires every route onto `router` (mounted at /api/v1). */
export function mountRoutes(router: Router, defs: readonly RouteDef[], services: Services): void {
  for (const def of defs) {
    const chain: RequestHandler[] = [...def.pre];
    if (def.access.kind !== 'public') chain.push(authenticate(services.auth));
    if (def.access.kind === 'permission') chain.push(requirePermission(def.access.permission));
    chain.push(
      validate({
        ...(def.params && { params: def.params }),
        ...(def.body && { body: def.body }),
        ...(def.query && { query: def.query }),
      }),
    );
    chain.push(async (req: Request, res: Response, next) => {
      try {
        const valid = (res.locals.valid ?? {}) as {
          params?: unknown;
          body?: unknown;
          query?: unknown;
        };
        const run = async (
          db: Queryable,
          counter: { n: number },
          tx: Parameters<typeof appendAudit>[0] | null,
        ) => {
          const record = async (input: AuditInput, target: Parameters<typeof appendAudit>[0]) => {
            if (!def.audit.includes(input.action)) {
              throw new Error(
                `${def.method.toUpperCase()} ${def.path} wrote undeclared audit action ${input.action}`,
              );
            }
            await appendAudit(target, auditFields(req, input));
            counter.n += 1;
          };
          const ctx: PublicContext<unknown, unknown, unknown> = {
            req,
            res,
            services,
            auth: req.auth,
            params: valid.params ?? req.params,
            body: valid.body,
            query: valid.query,
            db,
            audit: async (input) => {
              if (!tx) throw new Error(`${def.path}: GET routes cannot write audit rows`);
              await record(input, tx);
            },
            auditCommitted: async (input) => {
              await withTransaction(services.pool, (own) => record(input, own));
            },
          };
          return def.handler(ctx);
        };

        let result: HandlerResult;
        if (isMutating(def.method)) {
          const counter = { n: 0 };
          result = await withTransaction(services.pool, async (tx) => {
            const out = await run(tx, counter, tx);
            if (counter.n === 0) {
              throw new Error(
                `${def.method.toUpperCase()} ${def.path} returned success without an audit entry`,
              );
            }
            return out;
          });
        } else {
          result = await run(services.pool, { n: 0 }, null);
        }
        ok(res, result.data, result.status ?? def.successStatus);
      } catch (err) {
        next(err);
      }
    });
    router[def.method](def.path, ...chain);
  }
}
