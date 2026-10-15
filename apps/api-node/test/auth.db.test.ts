// Login, logout, token checks against the user directory, lockout and rate limiting (NFR-SEC-01).
import { decodeJwt } from 'jose';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/auth/password.js';
import { bearer, createHarness, SEED_EMAIL, type Harness } from './db/helpers.js';

let h: Harness;
beforeEach(async () => {
  h = await createHarness();
});
afterEach(async () => {
  await h.close();
});

const login = (email: string, password: string) =>
  request(h.app).post('/api/v1/auth/login').send({ email, password });
const auditRows = async (action: string) =>
  (await h.db.owner.query('SELECT * FROM audit_log WHERE action = $1 ORDER BY seq', [action])).rows;

describe('POST /api/v1/auth/login', () => {
  it('issues a ~1 h bearer token with the agreed claims and no refresh token', async () => {
    const res = await login(SEED_EMAIL.doctor1, h.passwords[SEED_EMAIL.doctor1] as string);
    expect(res.status).toBe(200);
    const { accessToken, tokenType, expiresIn, user } = res.body.data;
    expect(tokenType).toBe('Bearer');
    expect(expiresIn).toBe(3600);
    expect(res.body.data.refreshToken).toBeUndefined();
    expect(user).toMatchObject({ role: 'doctor', status: 'approved', isSimulated: true });
    expect(user.passwordHash).toBeUndefined();

    const claims = decodeJwt(accessToken);
    expect(claims.sub).toBe(user.id);
    expect(claims['role']).toBe('doctor');
    expect(claims['clinicId']).toBe(user.clinicId);
    expect(claims['devUser']).toBe(true);
    expect(claims.jti).toMatch(/^[0-9a-f-]{36}$/);
    expect((claims.exp ?? 0) - (claims.iat ?? 0)).toBe(3600);
  });

  it('accepts the e-mail in any letter case and with surrounding spaces', async () => {
    const res = await login(
      '  DOCTOR1@Example.Invalid ',
      h.passwords[SEED_EMAIL.doctor1] as string,
    );
    expect(res.status).toBe(200);
  });

  it('wrong password and unknown e-mail give the SAME 401 answer (no user enumeration)', async () => {
    const wrong = await login(SEED_EMAIL.doctor1, 'definitely-not-the-password');
    const unknown = await login('nobody@example.invalid', 'definitely-not-the-password');
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
    expect(wrong.body.error.message).toBe('Invalid email or password');
  });

  it('writes LOGIN_SUCCEEDED / LOGIN_FAILED audit rows with no e-mail or password in them', async () => {
    await login(SEED_EMAIL.staff, h.passwords[SEED_EMAIL.staff] as string);
    await login(SEED_EMAIL.staff, 'wrong-password-1');
    await login('nobody@example.invalid', 'wrong-password-2');
    expect(await auditRows('LOGIN_SUCCEEDED')).toHaveLength(1);
    const failed = await auditRows('LOGIN_FAILED');
    expect(failed).toHaveLength(2);
    expect(failed[0].actor_role).toBe('staff'); // known account: attributed
    expect(failed[1].actor_user_id).toBeNull(); // unknown e-mail: nobody to attribute
    const everything = JSON.stringify((await h.db.owner.query('SELECT * FROM audit_log')).rows);
    for (const secret of [
      'wrong-password-1',
      'wrong-password-2',
      'nobody@example',
      SEED_EMAIL.staff,
    ]) {
      expect(everything).not.toContain(secret);
    }
  });

  it.each(['pending', 'rejected', 'suspended'])(
    'a %s account cannot sign in even with the right password (403)',
    async (status) => {
      await h.db.owner.query(
        "UPDATE mock_clinicos_user SET status = $1 WHERE email = 'doctor2@example.invalid'",
        [status],
      );
      const res = await login(SEED_EMAIL.doctor2, h.passwords[SEED_EMAIL.doctor2] as string);
      expect(res.status).toBe(403);
      expect(res.body.error.message).toContain(status);
      expect(res.body.data).toBeUndefined();
    },
  );

  it('the unused patient role can never sign in', async () => {
    const hash = await hashPassword('patient-password-123456', 4);
    await h.db.owner.query(
      `INSERT INTO mock_clinicos_user (name, email, password_hash, role, status, clinic_id)
       VALUES ('Fake Patient Login', 'patientlogin@example.invalid', $1, 'patient', 'approved', $2)`,
      [hash, h.seed.clinics[0]?.id],
    );
    const res = await login('patientlogin@example.invalid', 'patient-password-123456');
    expect(res.status).toBe(403);
  });

  it('validates the body (400) without touching the database', async () => {
    expect((await request(h.app).post('/api/v1/auth/login').send({})).status).toBe(400);
    expect((await login(SEED_EMAIL.admin, '')).status).toBe(400);
    expect((await login('', 'x')).status).toBe(400);
    expect((await login(SEED_EMAIL.admin, 'x'.repeat(201))).status).toBe(400);
  });
});

describe('token checks on every request', () => {
  it('GET /auth/me returns the signed-in user from the directory', async () => {
    const token = await h.tokenFor(SEED_EMAIL.admin);
    const res = await request(h.app)
      .get('/api/v1/auth/me')
      .set(...bearer(token));
    expect(res.status).toBe(200);
    expect(res.body.data.user).toMatchObject({ role: 'admin', status: 'approved' });
    expect(res.body.data.tokenExpiresAt).toBeGreaterThan(Date.now() / 1000);
  });

  it('logout revokes the token: the same token is refused afterwards, other tokens still work', async () => {
    const a = await h.tokenFor(SEED_EMAIL.doctor1);
    const b = await h.tokenFor(SEED_EMAIL.doctor1); // a second device
    expect(
      (
        await request(h.app)
          .get('/api/v1/auth/me')
          .set(...bearer(a))
      ).status,
    ).toBe(200);
    const out = await request(h.app)
      .post('/api/v1/auth/logout')
      .set(...bearer(a));
    expect(out.status).toBe(200);
    expect(out.body.data).toEqual({ loggedOut: true });
    const after = await request(h.app)
      .get('/api/v1/auth/me')
      .set(...bearer(a));
    expect(after.status).toBe(401);
    expect(
      (
        await request(h.app)
          .get('/api/v1/auth/me')
          .set(...bearer(b))
      ).status,
    ).toBe(200);
    expect(await auditRows('LOGOUT')).toHaveLength(1);
    expect(
      (
        await request(h.app)
          .post('/api/v1/auth/logout')
          .set(...bearer(a))
      ).status,
    ).toBe(401);
  });

  it('a user suspended after the token was issued is refused immediately', async () => {
    const token = await h.tokenFor(SEED_EMAIL.staff);
    await h.db.owner.query(
      "UPDATE mock_clinicos_user SET status = 'suspended' WHERE email = 'staff@example.invalid'",
    );
    expect(
      (
        await request(h.app)
          .get('/api/v1/auth/me')
          .set(...bearer(token))
      ).status,
    ).toBe(401);
  });

  it('a token is refused if the user role or clinic changed since it was issued', async () => {
    const roleToken = await h.tokenFor(SEED_EMAIL.doctor1);
    await h.db.owner.query(
      "UPDATE mock_clinicos_user SET role = 'staff' WHERE email = 'doctor1@example.invalid'",
    );
    expect(
      (
        await request(h.app)
          .get('/api/v1/auth/me')
          .set(...bearer(roleToken))
      ).status,
    ).toBe(401);

    const clinicToken = await h.tokenFor(SEED_EMAIL.admin);
    await h.db.owner.query(
      "UPDATE mock_clinicos_user SET clinic_id = '5eed0000-0000-4000-8000-0000000000ff' WHERE email = 'admin@example.invalid'",
    );
    expect(
      (
        await request(h.app)
          .get('/api/v1/auth/me')
          .set(...bearer(clinicToken))
      ).status,
    ).toBe(401);
  });

  it('a token for a user that no longer exists is refused', async () => {
    const token = await h.tokenFor(SEED_EMAIL.researcher);
    await h.db.owner.query(
      "DELETE FROM mock_clinicos_user WHERE email = 'researcher@example.invalid'",
    );
    expect(
      (
        await request(h.app)
          .get('/api/v1/auth/me')
          .set(...bearer(token))
      ).status,
    ).toBe(401);
  });

  it('rejects a missing, malformed or garbage Authorization header', async () => {
    expect((await request(h.app).get('/api/v1/auth/me')).status).toBe(401);
    expect(
      (await request(h.app).get('/api/v1/auth/me').set('Authorization', 'Basic abc')).status,
    ).toBe(401);
    expect(
      (await request(h.app).get('/api/v1/auth/me').set('Authorization', 'Bearer not.a.jwt')).status,
    ).toBe(401);
  });
});

describe('account lockout (5 failures lock an account for 15 minutes)', () => {
  const wrong = (email: string) => login(email, 'wrong-password-wrong');

  it('locks after 5 failures and then refuses even the right password (429 ACCOUNT_LOCKED)', async () => {
    for (let i = 0; i < 5; i += 1) expect((await wrong(SEED_EMAIL.doctor2)).status).toBe(401);
    const locked = await login(SEED_EMAIL.doctor2, h.passwords[SEED_EMAIL.doctor2] as string);
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe('ACCOUNT_LOCKED');
    const reasons = (await auditRows('LOGIN_FAILED')).map((r) => r.meta.reason);
    expect(reasons).toContain('account_locked');
  });

  it("another account is not affected by someone else's lockout", async () => {
    for (let i = 0; i < 5; i += 1) await wrong(SEED_EMAIL.doctor2);
    expect(
      (await login(SEED_EMAIL.doctor1, h.passwords[SEED_EMAIL.doctor1] as string)).status,
    ).toBe(200);
  });

  it('a lockout also applies to unknown e-mails (cannot be used to probe which accounts exist)', async () => {
    for (let i = 0; i < 5; i += 1) await wrong('ghost@example.invalid');
    expect((await login('ghost@example.invalid', 'whatever-password')).status).toBe(429);
  });

  it('unlocks when the lock time has passed, and a good login resets the counter', async () => {
    for (let i = 0; i < 5; i += 1) await wrong(SEED_EMAIL.staff);
    await h.db.owner.query("UPDATE login_lockout SET locked_until = now() - interval '1 minute'");
    expect((await login(SEED_EMAIL.staff, h.passwords[SEED_EMAIL.staff] as string)).status).toBe(
      200,
    );
    const row = (await h.db.owner.query('SELECT failed_count, locked_until FROM login_lockout'))
      .rows[0];
    expect(row).toMatchObject({ failed_count: 0, locked_until: null });
  });

  it('4 failures then a success then 4 failures does not lock (the success resets the count)', async () => {
    for (let i = 0; i < 4; i += 1) await wrong(SEED_EMAIL.admin);
    expect((await login(SEED_EMAIL.admin, h.passwords[SEED_EMAIL.admin] as string)).status).toBe(
      200,
    );
    for (let i = 0; i < 4; i += 1) await wrong(SEED_EMAIL.admin);
    expect((await login(SEED_EMAIL.admin, h.passwords[SEED_EMAIL.admin] as string)).status).toBe(
      200,
    );
  });

  it('old failures outside the window are forgotten', async () => {
    for (let i = 0; i < 4; i += 1) await wrong(SEED_EMAIL.researcher);
    await h.db.owner.query("UPDATE login_lockout SET updated_at = now() - interval '2 hours'");
    await wrong(SEED_EMAIL.researcher); // would be the 5th, but the count restarts at 1
    const row = (await h.db.owner.query('SELECT failed_count, locked_until FROM login_lockout'))
      .rows[0];
    expect(row).toMatchObject({ failed_count: 1, locked_until: null });
  });

  it('the lockout table stores only a hash of the e-mail, never the address', async () => {
    await wrong(SEED_EMAIL.admin);
    const text = JSON.stringify((await h.db.owner.query('SELECT * FROM login_lockout')).rows);
    expect(text).not.toContain('example.invalid');
    expect(text).toMatch(/[0-9a-f]{64}/);
  });
});

describe('per-IP login rate limit', () => {
  it('answers 429 RATE_LIMITED once the limit is exceeded, even for correct credentials', async () => {
    const limited = await createHarness({ LOGIN_RATE_LIMIT_MAX: '3' });
    try {
      const attempt = (email: string) =>
        request(limited.app)
          .post('/api/v1/auth/login')
          .send({ email, password: 'wrong-password-x' });
      // different e-mails so the per-account lockout is not what stops us
      for (const email of ['a@example.invalid', 'b@example.invalid', 'c@example.invalid']) {
        expect((await attempt(email)).status).toBe(401);
      }
      const blocked = await attempt('d@example.invalid');
      expect(blocked.status).toBe(429);
      expect(blocked.body).toMatchObject({ success: false, error: { code: 'RATE_LIMITED' } });
      const good = await request(limited.app)
        .post('/api/v1/auth/login')
        .send({ email: SEED_EMAIL.admin, password: limited.passwords[SEED_EMAIL.admin] });
      expect(good.status).toBe(429);
      // only login is limited
      expect((await request(limited.app).get('/health')).status).toBe(200);
    } finally {
      await limited.close();
    }
  });
});

describe('AUTH_PROVIDER=clinicos (Phase 12 stub)', () => {
  it('password login does not exist: 501 NOT_IMPLEMENTED', async () => {
    const stub = await createHarness({
      AUTH_PROVIDER: 'clinicos',
      CLINICOS_BASE_URL: 'http://localhost:5000',
      DEV_AUTH_SECRET: undefined,
    });
    try {
      const res = await request(stub.app)
        .post('/api/v1/auth/login')
        .send({ email: 'a@b.co', password: 'x' });
      expect(res.status).toBe(501);
      expect(res.body.error.code).toBe('NOT_IMPLEMENTED');
    } finally {
      await stub.close();
    }
  });
});
