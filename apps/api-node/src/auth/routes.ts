// /api/v1/auth/*: login, logout, me. Standalone mode (AUTH_PROVIDER=dev) - ADR-D4 and its 2026-10-14 amendment:
// own ~1 h access token, no refresh token. Logout revokes the token's jti server-side.
import { createHmac } from 'node:crypto';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import type { Config } from '../config/env.js';
import { withTransaction } from '../db/tx.js';
import { errors } from '../http/errors.js';
import { fail } from '../http/respond.js';
import { authedRoute, publicRoute, type RouteDef } from '../http/routeRegistry.js';
import { LOGIN_ROLES } from './permissions.js';
import { verifyPassword } from './password.js';

const loginBody = z.object({
  email: z.string().trim().min(3).max(200),
  password: z.string().min(1).max(200),
});
type LoginBody = z.infer<typeof loginBody>;

const userView = z.object({
  id: z.uuid(),
  name: z.string(),
  role: z.string(),
  clinicId: z.uuid().nullable(),
  status: z.string(),
  isSimulated: z.boolean(),
});

const loginResponse = z.object({
  accessToken: z.string(),
  tokenType: z.literal('Bearer'),
  expiresIn: z.number().int(),
  user: userView,
});

/**
 * Non-reversible reference for the login lockout table: HMAC-SHA256 of the normalised e-mail with a server-side key.
 * A plain hash of an e-mail could be reversed by guessing addresses; without the key it cannot be.
 */
export const emailReference = (key: string, email: string): string =>
  createHmac('sha256', key).update(email.trim().toLowerCase()).digest('hex');

export function authRoutes(config: Config): RouteDef[] {
  const loginLimiter = rateLimit({
    windowMs: config.loginRateWindowMs,
    limit: config.loginRateLimitMax,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) => {
      fail(res, 429, 'RATE_LIMITED', 'Too many login attempts from this address. Try again later.');
    },
  });

  return [
    publicRoute<unknown, LoginBody>({
      method: 'post',
      path: '/auth/login',
      tag: 'Auth',
      summary: 'Sign in with e-mail and password; returns a ~1 h access token (no refresh token)',
      audit: ['LOGIN_SUCCEEDED', 'LOGIN_FAILED'],
      body: loginBody,
      response: loginResponse,
      pre: [loginLimiter],
      handler: async (ctx) => {
        const { pool, devLogin, tokens, dummyPasswordHash, config: cfg } = ctx.services;
        if (!devLogin || !tokens) {
          throw errors.notImplemented('Password login is only available with AUTH_PROVIDER=dev');
        }
        const { email, password } = ctx.body;
        const key = emailReference(ctx.services.lockoutKey, email);

        const failed = async (
          reason: string,
          user?: { id: string; role: string; clinicId: string | null },
        ): Promise<void> => {
          await ctx.auditCommitted({
            action: 'LOGIN_FAILED',
            actorUserId: user?.id ?? null,
            actorRole: user?.role ?? null,
            clinicId: user?.clinicId ?? null,
            meta: { reason },
          });
        };

        const lock = await pool.query<{ locked: boolean }>(
          'SELECT (locked_until IS NOT NULL AND locked_until > now()) AS locked FROM login_lockout WHERE email_hash = $1',
          [key],
        );
        if (lock.rows[0]?.locked) {
          await failed('account_locked');
          throw errors.locked();
        }

        const user = await devLogin.findLoginByEmail(email);
        // Always run one bcrypt comparison so unknown e-mails cost the same time as wrong passwords.
        const valid = await verifyPassword(password, user?.passwordHash ?? dummyPasswordHash);

        if (!user || !valid) {
          await withTransaction(pool, async (tx) => {
            await tx.query(
              `INSERT INTO login_lockout (email_hash, failed_count, updated_at) VALUES ($1, 1, now())
               ON CONFLICT (email_hash) DO UPDATE SET
                 failed_count = CASE WHEN login_lockout.updated_at < now() - make_interval(secs => $2)
                                     THEN 1 ELSE login_lockout.failed_count + 1 END,
                 updated_at = now()`,
              [key, cfg.lockoutMs / 1000],
            );
            await tx.query(
              `UPDATE login_lockout SET locked_until = now() + make_interval(secs => $2)
               WHERE email_hash = $1 AND failed_count >= $3`,
              [key, cfg.lockoutMs / 1000, cfg.lockoutMaxFailures],
            );
          });
          await failed('invalid_credentials', user ?? undefined);
          throw errors.unauthenticated('Invalid email or password');
        }

        // The password was right; now apply account rules (ClinicOS blocks non-approved users in rbac).
        if (user.status !== 'approved') {
          await failed(`status_${user.status}`, user);
          throw errors.forbidden(`Your account is ${user.status}. Contact your clinic admin.`);
        }
        if (!LOGIN_ROLES.includes(user.role) || !user.clinicId) {
          await failed('role_not_allowed', user);
          throw errors.forbidden('This account type cannot sign in to VaaniEHR.');
        }

        await ctx.db.query(
          `UPDATE login_lockout SET failed_count = 0, locked_until = NULL, updated_at = now() WHERE email_hash = $1`,
          [key],
        );
        const issued = await tokens.issueToken({
          sub: user.id,
          role: user.role,
          clinicId: user.clinicId,
          devUser: true,
        });
        await ctx.audit({
          action: 'LOGIN_SUCCEEDED',
          actorUserId: user.id,
          actorRole: user.role,
          clinicId: user.clinicId,
          resourceType: 'user',
          resourceId: user.id,
          meta: { jti: issued.jti },
        });
        return {
          data: {
            accessToken: issued.accessToken,
            tokenType: issued.tokenType,
            expiresIn: issued.expiresIn,
            user: {
              id: user.id,
              name: user.name,
              role: user.role,
              clinicId: user.clinicId,
              status: user.status,
              isSimulated: user.isSimulated,
            },
          },
        };
      },
    }),

    authedRoute({
      method: 'post',
      path: '/auth/logout',
      tag: 'Auth',
      summary: 'Revoke the current access token',
      audit: ['LOGOUT'],
      response: z.object({ loggedOut: z.literal(true) }),
      handler: async (ctx) => {
        const { jti, exp, sub } = ctx.auth;
        if (jti && exp) {
          await ctx.db.query(
            `INSERT INTO revoked_token (jti, user_id, expires_at) VALUES ($1, $2, to_timestamp($3))
             ON CONFLICT (jti) DO NOTHING`,
            [jti, sub, exp],
          );
        }
        await ctx.audit({ action: 'LOGOUT', resourceType: 'user', resourceId: sub });
        return { data: { loggedOut: true } };
      },
    }),

    authedRoute({
      method: 'get',
      path: '/auth/me',
      tag: 'Auth',
      summary: 'The signed-in user (read from the directory on every call)',
      audit: [],
      response: z.object({ user: userView, tokenExpiresAt: z.number().int().nullable() }),
      handler: async (ctx) => {
        const user = await ctx.services.directory.getUser(ctx.auth.sub);
        if (!user) throw errors.unauthenticated();
        return {
          data: {
            user: {
              id: user.id,
              name: user.name,
              role: user.role,
              clinicId: user.clinicId,
              status: user.status,
              isSimulated: user.isSimulated,
            },
            tokenExpiresAt: ctx.auth.exp ?? null,
          },
        };
      },
    }),
  ];
}
