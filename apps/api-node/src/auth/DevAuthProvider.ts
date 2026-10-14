// Standalone dev auth (ADR-D4 amendment, owner answer 2026-10-14):
// own access token, about 1 hour, signed HS256 with a VaaniEHR-only secret,
// claims { sub, role, clinicId, devUser: true }. No refresh token. Seeded fake users only (Hard Rule 1).
import { jwtVerify, SignJWT } from 'jose';
import { z } from 'zod';
import { ROLES, type AuthContext, type AuthProvider, type Role } from './types.js';

export const DEV_ISSUER = 'vaaniehr-dev';
export const DEV_AUDIENCE = 'vaaniehr-api';

export const DEV_CLINIC_ID = 'c0ffee00-0000-4000-8000-0000000000c1';

export interface DevUser {
  id: string;
  name: string;
  role: Extract<Role, 'doctor' | 'staff' | 'admin'>;
  clinicId: string;
  /** Marks seeded data as fake. */
  isSimulated: true;
}

/** Three seeded FAKE users. No real people, no real credentials (dev-login needs none). */
export const DEV_USERS: readonly DevUser[] = [
  {
    id: 'd0c70000-0000-4000-8000-000000000001',
    name: 'Dr. Fake Doctor',
    role: 'doctor',
    clinicId: DEV_CLINIC_ID,
    isSimulated: true,
  },
  {
    id: '57aff000-0000-4000-8000-000000000002',
    name: 'Fake Staff Member',
    role: 'staff',
    clinicId: DEV_CLINIC_ID,
    isSimulated: true,
  },
  {
    id: 'ad310000-0000-4000-8000-000000000003',
    name: 'Fake Admin',
    role: 'admin',
    clinicId: DEV_CLINIC_ID,
    isSimulated: true,
  },
];

const claimsSchema = z.object({
  sub: z.uuid(),
  role: z.enum(ROLES),
  clinicId: z.uuid(),
  devUser: z.literal(true),
});

export interface IssuedToken {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}

export class DevAuthProvider implements AuthProvider {
  private readonly key: Uint8Array;

  constructor(
    secret: string,
    private readonly ttlSeconds: number,
  ) {
    this.key = new TextEncoder().encode(secret);
  }

  findUser(role: DevUser['role']): DevUser {
    const user = DEV_USERS.find((u) => u.role === role);
    if (!user) throw new Error(`No seeded dev user for role ${role}`);
    return user;
  }

  /** Issue a token for a context. `ttlOverrideSeconds` exists for tests (negative = already expired). */
  async issueToken(ctx: AuthContext, ttlOverrideSeconds?: number): Promise<IssuedToken> {
    const ttl = ttlOverrideSeconds ?? this.ttlSeconds;
    const now = Math.floor(Date.now() / 1000);
    const accessToken = await new SignJWT({ role: ctx.role, clinicId: ctx.clinicId, devUser: true })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(ctx.sub)
      .setIssuer(DEV_ISSUER)
      .setAudience(DEV_AUDIENCE)
      .setIssuedAt(now)
      .setExpirationTime(now + ttl)
      .sign(this.key);
    return { accessToken, tokenType: 'Bearer', expiresIn: ttl };
  }

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
