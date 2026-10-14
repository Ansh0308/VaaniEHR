import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';
import { errors } from './errors.js';

interface Schemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

/** zod validation middleware. Parsed values are stored in res.locals.valid (Express 5 makes req.query read-only). */
export function validate(schemas: Schemas) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const valid: Record<string, unknown> = {};
    for (const part of ['body', 'query', 'params'] as const) {
      const schema = schemas[part];
      if (!schema) continue;
      const result = schema.safeParse(req[part]);
      if (!result.success) {
        const detail = result.error.issues
          .map((i) => `${part}${i.path.length ? '.' + i.path.join('.') : ''}: ${i.message}`)
          .join('; ');
        next(errors.validation(detail));
        return;
      }
      valid[part] = result.data;
    }
    res.locals.valid = valid;
    next();
  };
}
