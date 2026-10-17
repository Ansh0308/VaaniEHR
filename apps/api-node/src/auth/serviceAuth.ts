// Service-to-service authentication (Phase 4A, ADR-D26): asr-py calls a few INTERNAL routes on api-node. They are not
// browser routes and accept no user token. A request is accepted only with a fresh timestamp and a signature
//   HMAC-SHA256(INTERNAL_SERVICE_SECRET, timestamp \n METHOD \n path \n sha256(body))
// in the headers X-Service-Timestamp (unix seconds) and X-Service-Signature (hex). Anything else is a 401.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { errors } from '../http/errors.js';

export const SERVICE_MAX_SKEW_SECONDS = 60;

export function serviceSignature(
  secret: string,
  timestamp: number,
  method: string,
  path: string,
  body: Buffer | string,
): string {
  const digest = createHash('sha256').update(body).digest('hex');
  return createHmac('sha256', secret)
    .update(`${timestamp}\n${method.toUpperCase()}\n${path}\n${digest}`)
    .digest('hex');
}

export function authenticateService(
  getSecret: () => string | undefined,
  now: () => number = () => Date.now(),
): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const secret = getSecret();
    if (!secret) return next(errors.notReady('The speech service is not configured'));
    const timestamp = Number(req.header('x-service-timestamp'));
    const given = req.header('x-service-signature') ?? '';
    if (!Number.isInteger(timestamp) || !/^[0-9a-f]{64}$/.test(given)) {
      return next(errors.unauthenticated());
    }
    if (Math.abs(Math.floor(now() / 1000) - timestamp) > SERVICE_MAX_SKEW_SECONDS) {
      return next(errors.unauthenticated());
    }
    const path = req.originalUrl.split('?')[0] ?? '';
    const expected = serviceSignature(secret, timestamp, req.method, path, req.rawBody ?? '');
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(given, 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) return next(errors.unauthenticated());
    next();
  };
}
