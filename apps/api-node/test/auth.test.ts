// Token layer (ADR-D4 + owner amendment) without a database: claims, expiry, forged tokens, requireRole,
// requirePermission and the ClinicOSTokenAuth stub. Login, revocation and user-status checks need the database
// and live in test/auth.db.test.ts.
import { decodeJwt, SignJWT } from 'jose';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { authenticate, requirePermission, requireRole } from '../src/auth/middleware.js';
import { ok } from '../src/http/respond.js';
import { buildTestApp, TEST_CLINIC_ID, TEST_SECRET, testIdentity } from './helpers.js';

const claimsOf = (role: 'doctor' | 'staff' | 'admin' | 'researcher') => {
  const id = testIdentity(role);
  return { sub: id.id, role: id.role, clinicId: id.clinicId, devUser: true as const };
};

function appWithWhoami() {
  return buildTestApp({
    extend: (a, { provider }) =>
      a.get('/whoami', authenticate(provider), (req, res) => ok(res, { auth: req.auth })),
  });
}

describe('DevAuthProvider tokens', () => {
  it('issues a ~1h access token with the agreed claims plus a jti, and no refresh token', async () => {
    const { dev } = buildTestApp();
    const issued = await dev.issueToken(claimsOf('doctor'));
    expect(issued.tokenType).toBe('Bearer');
    expect(issued.expiresIn).toBe(3600);
    expect(Object.keys(issued).sort()).toEqual(['accessToken', 'expiresIn', 'jti', 'tokenType']);

    const claims = decodeJwt(issued.accessToken);
    expect(claims.sub).toBe(testIdentity('doctor').id);
    expect(claims['role']).toBe('doctor');
    expect(claims['clinicId']).toBe(TEST_CLINIC_ID);
    expect(claims['devUser']).toBe(true);
    expect(claims.jti).toBe(issued.jti);
    expect((claims.exp ?? 0) - (claims.iat ?? 0)).toBe(3600);
  });

  it('verifies a good token and returns the context, including jti and exp', async () => {
    const { dev } = buildTestApp();
    const { accessToken, jti } = await dev.issueToken(claimsOf('staff'));
    const ctx = await dev.authenticate(accessToken);
    expect(ctx).toMatchObject({ sub: testIdentity('staff').id, role: 'staff', jti });
    expect(ctx?.exp).toBeGreaterThan(Date.now() / 1000);
  });

  it('401 without a token, 401 with garbage, 200 with a valid token', async () => {
    const { app, dev } = appWithWhoami();
    expect((await request(app).get('/whoami')).status).toBe(401);
    const garbage = await request(app).get('/whoami').set('Authorization', 'Bearer not.a.jwt');
    expect(garbage.status).toBe(401);
    expect(garbage.body.error.code).toBe('UNAUTHENTICATED');
    const { accessToken } = await dev.issueToken(claimsOf('doctor'));
    const good = await request(app).get('/whoami').set('Authorization', `Bearer ${accessToken}`);
    expect(good.status).toBe(200);
    expect(good.body.data.auth).toMatchObject({ role: 'doctor', clinicId: TEST_CLINIC_ID });
  });

  it('rejects an expired token', async () => {
    const { app, dev } = appWithWhoami();
    const { accessToken } = await dev.issueToken(claimsOf('doctor'), -30);
    const res = await request(app).get('/whoami').set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(401);
  });

  it('rejects a token signed with a different secret (e.g. a ClinicOS-style token)', async () => {
    const { app } = appWithWhoami();
    const foreign = await new SignJWT({ userId: 'whatever' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode('some-other-system-secret-0123456789abcdef'));
    const res = await request(app).get('/whoami').set('Authorization', `Bearer ${foreign}`);
    expect(res.status).toBe(401);
  });

  it('rejects a correctly signed token that lacks the issuer or the jti', async () => {
    const { app } = appWithWhoami();
    const key = new TextEncoder().encode(TEST_SECRET);
    const noIssuer = await new SignJWT({ role: 'admin', clinicId: TEST_CLINIC_ID, devUser: true })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(testIdentity('admin').id)
      .setJti(crypto.randomUUID())
      .setExpirationTime('1h')
      .sign(key);
    expect(
      (await request(app).get('/whoami').set('Authorization', `Bearer ${noIssuer}`)).status,
    ).toBe(401);

    const noJti = await new SignJWT({ role: 'admin', clinicId: TEST_CLINIC_ID, devUser: true })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(testIdentity('admin').id)
      .setIssuer('vaaniehr-dev')
      .setAudience('vaaniehr-api')
      .setExpirationTime('1h')
      .sign(key);
    expect((await request(app).get('/whoami').set('Authorization', `Bearer ${noJti}`)).status).toBe(
      401,
    );
  });

  it('rejects alg=none tokens', async () => {
    const { app } = appWithWhoami();
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
      sub: testIdentity('admin').id,
      role: 'admin',
      clinicId: TEST_CLINIC_ID,
      devUser: true,
      jti: crypto.randomUUID(),
      iss: 'vaaniehr-dev',
      aud: 'vaaniehr-api',
      exp: Math.floor(Date.now() / 1000) + 3600,
    })}.`;
    const res = await request(app).get('/whoami').set('Authorization', `Bearer ${none}`);
    expect(res.status).toBe(401);
  });
});

describe('requireRole and requirePermission', () => {
  it('401 without auth, 403 for the wrong role, 200 for an allowed role', async () => {
    const { app, dev } = buildTestApp({
      extend: (a, { provider }) =>
        a.get('/admin-only', authenticate(provider), requireRole('admin'), (_req, res) =>
          ok(res, { secret: 'fake' }),
        ),
    });
    expect((await request(app).get('/admin-only')).status).toBe(401);

    const doctor = (await dev.issueToken(claimsOf('doctor'))).accessToken;
    const denied = await request(app).get('/admin-only').set('Authorization', `Bearer ${doctor}`);
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('FORBIDDEN');

    const admin = (await dev.issueToken(claimsOf('admin'))).accessToken;
    const allowed = await request(app).get('/admin-only').set('Authorization', `Bearer ${admin}`);
    expect(allowed.status).toBe(200);
  });

  it('requireRole without a preceding authenticate() fails closed with 401', async () => {
    const { app } = buildTestApp({
      extend: (a) => a.get('/oops', requireRole('admin'), (_req, res) => ok(res, {})),
    });
    expect((await request(app).get('/oops')).status).toBe(401);
  });

  it('requirePermission reads the single permissions table', async () => {
    const { app, dev } = buildTestApp({
      extend: (a, { provider }) =>
        a.get(
          '/audit-ish',
          authenticate(provider),
          requirePermission('audit.verify'),
          (_req, res) => ok(res, {}),
        ),
    });
    const send = async (role: 'doctor' | 'staff' | 'admin' | 'researcher') => {
      const { accessToken } = await dev.issueToken(claimsOf(role));
      return request(app).get('/audit-ish').set('Authorization', `Bearer ${accessToken}`);
    };
    expect((await send('admin')).status).toBe(200);
    expect((await send('researcher')).status).toBe(403);
    expect((await send('doctor')).status).toBe(403);
    expect((await send('staff')).status).toBe(403);
  });

  it('requirePermission without a preceding authenticate() fails closed with 401', async () => {
    const { app } = buildTestApp({
      extend: (a) => a.get('/oops', requirePermission('audit.read'), (_req, res) => ok(res, {})),
    });
    expect((await request(app).get('/oops')).status).toBe(401);
  });
});

describe('AUTH_PROVIDER=clinicos (Phase 12 stub)', () => {
  const env = {
    AUTH_PROVIDER: 'clinicos',
    CLINICOS_BASE_URL: 'http://localhost:5000',
    DEV_AUTH_SECRET: undefined,
  };

  it('fails loudly with NOT_IMPLEMENTED instead of authenticating', async () => {
    const { app } = buildTestApp({
      envOverrides: env,
      extend: (a, { provider }) =>
        a.get('/whoami', authenticate(provider), (req, res) => ok(res, { auth: req.auth })),
    });
    const res = await request(app).get('/whoami').set('Authorization', 'Bearer anything');
    expect(res.status).toBe(501);
    expect(res.body.error.code).toBe('NOT_IMPLEMENTED');
  });
});
