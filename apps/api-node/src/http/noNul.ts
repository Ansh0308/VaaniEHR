// A NUL character (U+0000) cannot be stored by PostgreSQL text columns and has no use in this API: it would only produce a
// database error (a 500). Found by the Phase 12B injection probes; refused up front as a 400 (ADR-D44, ASVS 2.2.1).
import type { NextFunction, Request, Response } from 'express';
import { errors } from './errors.js';

function hasNul(value: unknown, depth = 0): boolean {
  if (typeof value === 'string') return value.includes('\u0000');
  if (depth > 20 || value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((v) => hasNul(v, depth + 1));
  return Object.entries(value as Record<string, unknown>).some(
    ([k, v]) => k.includes('\u0000') || hasNul(v, depth + 1),
  );
}

export function rejectNul(req: Request, _res: Response, next: NextFunction): void {
  let decoded = req.originalUrl;
  try {
    decoded = decodeURIComponent(req.originalUrl);
  } catch {
    // an undecodable URL is judged as it is
  }
  if (decoded.includes('\u0000') || hasNul(req.query) || hasNul(req.body)) {
    next(errors.badRequest('The request contains a character that is not allowed'));
    return;
  }
  next();
}
