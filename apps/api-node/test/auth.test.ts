// Auth seam (ADR-D4 + owner amendment): dev tokens, requireRole, ClinicOSTokenAuth stub, dev-login availability.
import { decodeJwt, SignJWT } from 'jose';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { DEV_CLINIC_ID, DEV_USERS } from '../src/auth/DevAuthProvider.js';
import { requireRole, authenticate } from '../src/auth/middleware.js';
import { ok } from '../src/http/respond.js';
import { buildTestApp, TEST_SECRET } from './helpers.js';

async function login(app: Parameters<typeof request>[0], role: string) {
  return request(app).post('/auth/dev-login').send({ role });
}

describe('DevAuthProvider and /auth/dev-login', () => {
  it('seeds exactly three fake users: doctor, staff, admin (all in one fake clinic)', () => {
    expect(DEV_USERS.map((u) => u.role).sort()).toEqual(['admin', 'doctor', 'staff']);
    expect(DEV_USERS.every((u) => u.isSimulated && u.clinicId === DEV_CLINIC_ID)).toBe(true);
  });

  it.each(['doctor', 'staff', 'admin'])(
    'issues a ~1h access token with the agreed claims for %s',
    async (role) => {
      const { app } = buildTestApp();
      const res = await login(app, role);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const { accessToken, tokenType, expiresIn, user } = res.body.data;
      expect(tokenType).toBe('Bearer');
      expect(expiresIn).toBe(3600);
      expect(res.body.data.refreshToken).toBeUndefined(); // no refresh token in standalone mode
      expect(user.devUser).toBe(true);

      const claims = decodeJwt(accessToken);
      expect(claims.sub).toBe(user.id);
      expect(claims['role']).toBe(role);
      expect(claims['clinicId']).toBe(DEV_CLINIC_ID);
      expect(claims['devUser']).toBe(true);
      expect((claims.exp ?? 0) - (claims.iat ?? 0)).toBe(3600);
    },
  );

  it('rejects an unknown role with VALIDATION_ERROR', async () => {
    const { app } = buildTestApp();
    const res = await login(app, 'superuser');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('whoami: 401 without a token, 401 with garbage, 200 with a valid token', async () => {
    const { app } = buildTestApp();
    expect((await request(app).get('/auth/whoami')).status).toBe(401);
    const garbage = await request(app).get('/auth/whoami').set('Authorization', 'Bearer not.a.jwt');
    expect(garbage.status).toBe(401);
    expect(garbage.body.error.code).toBe('UNAUTHENTICATED');
    const { accessToken } = (await login(app, 'doctor')).body.data;
    const good = await request(app)
      .get('/auth/whoami')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(good.status).toBe(200);
    expect(good.body.data.auth).toMatchObject({
      role: 'doctor',
      clinicId: DEV_CLINIC_ID,
      devUser: true,
    });
  });

  it('rejects an expired token', async () => {
    const { app, dev } = buildTestApp();
    const user = dev.findUser('doctor');
    const { accessToken } = await dev.issueToken(
      { sub: user.id, role: user.role, clinicId: user.clinicId, devUser: true },
      -30,
    );
    const res = await request(app)
      .get('/auth/whoami')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(401);
  });

  it('rejects a token signed with a different secret (e.g. a ClinicOS-style token)', async () => {
    const { app } = buildTestApp();
    const foreign = await new SignJWT({ userId: 'whatever' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode('some-other-system-secret-0123456789abcdef'));
    const res = await request(app).get('/auth/whoami').set('Authorization', `Bearer ${foreign}`);
    expect(res.status).toBe(401);
  });

  it('rejects a correctly signed token that lacks the dev claims or issuer', async () => {
    const { app } = buildTestApp();
    const noIssuer = await new SignJWT({ role: 'admin', clinicId: DEV_CLINIC_ID, devUser: true })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('ad310000-0000-4000-8000-000000000003')
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(TEST_SECRET));
    const res = await request(app).get('/auth/whoami').set('Authorization', `Bearer ${noIssuer}`);
    expect(res.status).toBe(401);
  });

  it('rejects alg=none tokens', async () => {
    const { app } = buildTestApp();
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
      sub: 'ad310000-0000-4000-8000-000000000003',
      role: 'admin',
      clinicId: DEV_CLINIC_ID,
      devUser: true,
      iss: 'vaaniehr-dev',
      aud: 'vaaniehr-api',
      exp: Math.floor(Date.now() / 1000) + 3600,
    })}.`;
    const res = await request(app).get('/auth/whoami').set('Authorization', `Bearer ${none}`);
    expect(res.status).toBe(401);
  });
});

describe('requireRole', () => {
  it('401 without auth, 403 for the wrong role, 200 for an allowed role', async () => {
    const { app } = buildTestApp({
      extend: (a, { dev }) =>
        a.get('/admin-only', authenticate(dev), requireRole('admin'), (_req, res) =>
          ok(res, { secret: 'fake' }),
        ),
    });
    expect((await request(app).get('/admin-only')).status).toBe(401);

    const doctor = (await login(app, 'doctor')).body.data.accessToken;
    const denied = await request(app).get('/admin-only').set('Authorization', `Bearer ${doctor}`);
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('FORBIDDEN');

    const admin = (await login(app, 'admin')).body.data.accessToken;
    const allowed = await request(app).get('/admin-only').set('Authorization', `Bearer ${admin}`);
    expect(allowed.status).toBe(200);
  });

  it('requireRole without a preceding authenticate() fails closed with 401', async () => {
    const { app } = buildTestApp({
      extend: (a) => a.get('/oops', requireRole('admin'), (_req, res) => ok(res, {})),
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

  it('does not expose /auth/dev-login at all', async () => {
    const { app } = buildTestApp({ envOverrides: env });
    const res = await request(app).post('/auth/dev-login').send({ role: 'doctor' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('fails loudly with NOT_IMPLEMENTED instead of authenticating', async () => {
    const { app } = buildTestApp({ envOverrides: env });
    const res = await request(app).get('/auth/whoami').set('Authorization', 'Bearer anything');
    expect(res.status).toBe(501);
    expect(res.body.error.code).toBe('NOT_IMPLEMENTED');
  });
});
