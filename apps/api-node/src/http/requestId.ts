import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const SAFE_ID = /^[A-Za-z0-9._-]{8,64}$/;

/** Attaches req.id (reuses a well-formed inbound X-Request-Id, else a new UUID) and echoes it back. */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const inbound = req.header('x-request-id');
  req.id = inbound && SAFE_ID.test(inbound) ? inbound : randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
}
