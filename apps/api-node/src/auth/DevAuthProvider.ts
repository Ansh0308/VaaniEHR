// Standalone dev auth (ADR-D4 amendment, owner answer 2026-10-14):
// own access token, about 1 hour, signed HS256 with a VaaniEHR-only secret,
// claims { sub, role, clinicId, devUser: true } plus a `jti` so logout can revoke it. No refresh token.
// Tokens are only issued after a real password login (POST /api/v1/auth/login); there is no passwordless endpoint.
import { randomUUID } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';
import { z } from 'zod';
import { ROLES, type AuthContext, type AuthProvider } from './types.js';

export const DEV_ISSUER = 'vaaniehr-dev';
export const DEV_AUDIENCE = 'vaaniehr-api';

const claimsSchema = z.object({
  sub: z.uuid(),
  role: z.enum(ROLES),
  clinicId: z.uuid(),
  devUser: z.literal(true),
  jti: z.uuid(),
  exp: z.number().int(),
});

export interface IssuedToken {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  jti: string;
}

export class DevAuthProvider implements AuthProvider {
  private readonly key: Uint8Array;

  constructor(
    secret: string,
    private readonly ttlSeconds: number,
  ) {
    this.key = new TextEncoder().encode(secret);
  }

  /** Issue a token for a context. `ttlOverrideSeconds` exists for tests (negative = already expired). */
  async issueToken(ctx: AuthContext, ttlOverrideSeconds?: number): Promise<IssuedToken> {
    const ttl = ttlOverrideSeconds ?? this.ttlSeconds;
    const now = Math.floor(Date.now() / 1000);
    const jti = randomUUID();
    const accessToken = await new SignJWT({ role: ctx.role, clinicId: ctx.clinicId, devUser: true })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(ctx.sub)
      .setJti(jti)
      .setIssuer(DEV_ISSUER)
      .setAudience(DEV_AUDIENCE)
      .setIssuedAt(now)
      .setExpirationTime(now + ttl)
      .sign(this.key);
    return { accessToken, tokenType: 'Bearer', expiresIn: ttl, jti };
  }

  /** Signature, issuer, audience, expiry and claim shape only. DB-backed checks live in DbBackedAuthProvider. */
  async authenticate(token: string): Promise<AuthContext | null> {
    if (!token) return null;
    try {
      const { payload } = await jwtVerify(token, this.key, {
        algorithms: ['HS256'],
        issuer: DEV_ISSUER,
        audience: DEV_AUDIENCE,
      });
      const claims = claimsSchema.safeParse(payload);
      if (!claims.success) return null;
      return { ...claims.data };
    } catch {
      return null;
    }
  }
}
