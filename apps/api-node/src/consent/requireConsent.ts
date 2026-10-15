// Server-side consent gate (FR-F1-01, FR-F1-03). Phase 4 puts this in front of every recording / AI route, Phase 10 in
// front of WhatsApp sending. The session id is read from req.params.id and must be visible to the caller.
// Fails closed: no consent, a withdrawn scope, or an unknown session all stop the request.
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type pg from 'pg';
import { errors } from '../http/errors.js';
import { loadSession } from '../sessions/service.js';
import { getEffectiveConsent } from './service.js';
import type { ConsentScope } from './notices.js';

export function requireConsent(pool: pg.Pool, ...scopes: ConsentScope[]): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (!req.auth) throw errors.unauthenticated();
      const sessionId = String(req.params.id ?? '');
      const session = await loadSession(pool, req.auth, sessionId);
      if (!session) throw errors.notFound('Session not found');
      const consent = await getEffectiveConsent(pool, session.id);
      const missing = scopes.filter((s) => !consent.scopes[s].granted);
      if (missing.length > 0) {
        throw errors.consentRequired(`Consent required for: ${missing.join(', ')}`);
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
