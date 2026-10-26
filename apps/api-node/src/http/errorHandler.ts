import type { NextFunction, Request, Response } from 'express';
import { AppError, errors } from './errors.js';
import { fail } from './respond.js';
import { logger, redactMessage } from '../logger.js';

/** 404 for any unmatched route. */
export function notFoundHandler(_req: Request, _res: Response, next: NextFunction): void {
  next(errors.notFound());
}

interface BodyParserError extends Error {
  type?: string;
  status?: number;
}

/** Central error handler. Never leaks stack traces or internal messages to the client. */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    fail(res, err.status, err.code, err.message, err.details);
    return;
  }

  const parserError = err as BodyParserError;
  if (parserError?.type === 'entity.parse.failed') {
    fail(res, 400, 'BAD_REQUEST', 'Malformed JSON body');
    return;
  }
  if (parserError?.type === 'entity.too.large') {
    fail(res, 413, 'BAD_REQUEST', 'Request body too large');
    return;
  }

  logger.error('unhandled_error', {
    requestId: req.id,
    name: err instanceof Error ? err.name : 'unknown',
    detail: redactMessage(err instanceof Error ? err.message : String(err)),
    ...(typeof (err as { code?: unknown })?.code === 'string'
      ? { code: (err as { code: string }).code }
      : {}),
  });
  fail(res, 500, 'INTERNAL', 'Internal server error');
}
