import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { errors } from '../http/errors.js';
import { roleHasPermission, type PermissionId } from './permissions.js';
import type { AuthProvider, Role } from './types.js';

/** Extract the token from "Authorization: Bearer <token>". */
export function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

/** Authenticates the request via the configured AuthProvider; sets req.auth or fails 401. */
export function authenticate(provider: AuthProvider): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const token = bearerToken(req.header('authorization'));
      if (!token) throw errors.unauthenticated();
      const ctx = await provider.authenticate(token);
      if (!ctx) throw errors.unauthenticated('Invalid or expired token');
      req.auth = ctx;
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Role gate. Must run after authenticate(); without req.auth it answers 401, with a wrong role 403. */
export function requireRole(...allowed: Role[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(errors.unauthenticated());
    if (!allowed.includes(req.auth.role)) return next(errors.forbidden());
    next();
  };
}

/** Permission gate driven by the single table in permissions.ts. Must run after authenticate(). */
export function requirePermission(permission: PermissionId): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(errors.unauthenticated());
    if (!roleHasPermission(req.auth.role, permission)) return next(errors.forbidden());
    next();
  };
}
