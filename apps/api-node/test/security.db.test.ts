// Permanent security tests (Phase 12B, ADR-D44). These add attack-shaped probes on top of the per-feature suites: rbac.db.test.ts
// (every route x every role), clinic-isolation.db.test.ts (every route, both ways), auth.test.ts (JWT alg none, expiry, issuer),
// auth.db.test.ts (lockout, login rate limit, revocation), visit-sign.db.test.ts (sign password throttle), asr-token.db.test.ts
// (audio token without consent), abha.db.test.ts (OTP caps, redaction), whatsapp.db.test.ts (webhook signature). Fake data only.
import { createHmac, randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEV_AUDIENCE, DEV_ISSUER } from '../src/auth/DevAuthProvider.js';
import { allRoutes } from '../src/routes/index.js';
import { bearer, createHarness, SEED_EMAIL, type Harness } from './db/helpers.js';

const APP_SECRET = 'security-suite-app-secret-not-real';
let h: Harness;
let admin: string;
let doctor: string;
let staff: string;
const ID = '5eed0000-0000-4000-8000-0000000000ff';
const api = (path: string) => `/api/v1${path}`;
const fill = (path: string) => path.replace(/:[A-Za-z]+/g, ID);

beforeAll(async () => {
  h = await createHarness({ WHATSAPP_APP_SECRET: APP_SECRET });
  admin = await h.tokenFor(SEED_EMAIL.admin);
  doctor = await h.tokenFor(SEED_EMAIL.doctor1);
  staff = await h.tokenFor(SEED_EMAIL.staff);
});
afterAll(async () => {
  await h.close();
});

const userId = (email: string): string => h.seed.users.find((u) => u.email === email)?.id as string;
const clinicId = (): string => h.seed.clinics[0]?.id as string;
const forge = async (
  claims: Record<string, unknown>,
  opts: { secret?: string; ttl?: number; aud?: string; iss?: string } = {},
) => {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ devUser: true, ...claims })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(opts.iss ?? DEV_ISSUER)
    .setAudience(opts.aud ?? DEV_AUDIENCE)
    .setIssuedAt(now - 10)
    .setExpirationTime(now + (opts.ttl ?? 600))
    .sign(new TextEncoder().encode(opts.secret ?? (h.config.devAuthSecret as string)));
};
const goodClaims = (email: string, role: string) => ({
  sub: userId(email),
  role,
  clinicId: clinicId(),
  jti: randomUUID(),
});
const me = (token: string) =>
  request(h.app)
    .get(api('/auth/me'))
    .set(...bearer(token));

describe('authentication on every route', () => {
  const guarded = (): { method: string; path: string }[] =>
    allRoutes(h.config)
      .filter((r) => r.access.kind !== 'public')
      .map((r) => ({ method: r.method, path: fill(`/${r.path.replace(/^\//, '')}`) }));

  it('no token, a malformed header or a junk token is a 401 on every non-public route', async () => {
    const routes = guarded();
    expect(routes.length).toBeGreaterThan(60);
    for (const r of routes) {
      for (const header of [
        undefined,
        'Bearer',
        'Bearer not.a.jwt',
        'Basic Zm9vOmJhcg==',
        'Bearer ' + 'a'.repeat(600),
      ]) {
        const req = request(h.app)[r.method as 'get'](api(r.path));
        if (header !== undefined) req.set('Authorization', header);
        const res = await req.send(r.method === 'get' ? undefined : {});
        expect(res.status, `${r.method} ${r.path} with ${header ?? 'no header'}`).toBe(401);
        expect(res.body.success).toBe(false);
      }
    }
  }, 120_000);

  it('a token in a query string or a cookie is not accepted', async () => {
    expect((await request(h.app).get(api(`/auth/me?access_token=${doctor}`))).status).toBe(401);
    expect(
      (
        await request(h.app)
          .get(api('/auth/me'))
          .set('Cookie', `token=${doctor}; access_token=${doctor}`)
      ).status,
    ).toBe(401);
  });
});

describe('forged and altered tokens', () => {
  it('a correctly signed token naming a role the user does not have is refused (claims are checked against the directory)', async () => {
    const t = await forge(goodClaims(SEED_EMAIL.staff, 'admin'));
    expect((await me(t)).status).toBe(401);
    expect(
      (
        await request(h.app)
          .get(api('/audit'))
          .set(...bearer(t))
      ).status,
    ).toBe(401);
  });
  it('a valid signature for a user that does not exist, or in another clinic, is refused', async () => {
    expect(
      (await me(await forge({ ...goodClaims(SEED_EMAIL.doctor1, 'doctor'), sub: randomUUID() })))
        .status,
    ).toBe(401);
    expect(
      (
        await me(
          await forge({ ...goodClaims(SEED_EMAIL.doctor1, 'doctor'), clinicId: randomUUID() }),
        )
      ).status,
    ).toBe(401);
  });
  it('wrong secret, wrong audience, wrong issuer and an expired token are refused; the honest token works', async () => {
    const claims = goodClaims(SEED_EMAIL.doctor1, 'doctor');
    expect((await me(await forge(claims, { secret: 'x'.repeat(40) }))).status).toBe(401);
    expect((await me(await forge(claims, { aud: 'someone-else' }))).status).toBe(401);
    expect((await me(await forge(claims, { iss: 'someone-else' }))).status).toBe(401);
    expect((await me(await forge(claims, { ttl: -5 }))).status).toBe(401);
    expect((await me(await forge(claims))).status).toBe(200);
  });
  it('flipping one character of the payload or the signature breaks the token', async () => {
    const [head, payload, sig] = doctor.split('.') as [string, string, string];
    const flip = (s: string) => s.slice(0, -2) + (s.endsWith('A') ? 'B' : 'A') + s.slice(-1);
    expect((await me([head, flip(payload), sig].join('.'))).status).toBe(401);
    expect((await me([head, payload, flip(sig)].join('.'))).status).toBe(401);
    // a payload that says admin with the original signature
    const adminPayload = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(payload, 'base64url').toString()),
        role: 'admin',
      }),
    ).toString('base64url');
    expect((await me([head, adminPayload, sig].join('.'))).status).toBe(401);
  });
  it('a token with the signature removed or a different algorithm header is refused', async () => {
    const [head, payload] = doctor.split('.') as [string, string];
    expect((await me(`${head}.${payload}.`)).status).toBe(401);
    const hs512 = Buffer.from(JSON.stringify({ alg: 'HS512', typ: 'JWT' })).toString('base64url');
    const sig = createHmac('sha512', h.config.devAuthSecret as string)
      .update(`${hs512}.${payload}`)
      .digest('base64url');
    expect((await me(`${hs512}.${payload}.${sig}`)).status).toBe(401);
  });
});

describe('authorisation bypass attempts', () => {
  it('a role named in a header, the query or the body changes nothing', async () => {
    const res = await request(h.app)
      .get(api('/audit?role=admin'))
      .set(...bearer(staff))
      .set('X-Role', 'admin')
      .set('X-User-Role', 'admin')
      .set('X-Clinic-Id', randomUUID());
    expect(res.status).toBe(403);
    const post = await request(h.app)
      .post(api('/medicines'))
      .set(...bearer(staff))
      .send({ role: 'admin', clinicId: randomUUID() });
    expect(post.status).toBe(403);
  });
  it('a method-override header does not turn a GET into a write', async () => {
    const res = await request(h.app)
      .get(api('/audit'))
      .set(...bearer(doctor))
      .set('X-HTTP-Method-Override', 'DELETE')
      .set('X-Method-Override', 'DELETE');
    expect(res.status).toBe(403); // doctors may not read the audit log; the GET itself is what is judged
    const own = await request(h.app)
      .get(api('/templates'))
      .set(...bearer(doctor))
      .set('X-HTTP-Method-Override', 'DELETE');
    expect(own.status).toBe(200);
  });
  it('path tricks (double slash, trailing slash, case, encoded dots) never reach an admin route as staff', async () => {
    for (const p of [
      '//audit',
      '/audit/',
      '/AUDIT',
      '/audit/%2e%2e/audit',
      '/%61udit',
      '/./audit',
      '/audit;x=1',
      '/audit%00',
    ]) {
      const res = await request(h.app)
        .get(`/api/v1${p}`)
        .set(...bearer(staff));
      expect([400, 401, 403, 404], `GET ${p}`).toContain(res.status);
    }
  });
  it('no GET route writes (state changes use POST, PUT, PATCH or DELETE; ASVS 3.5.3)', () => {
    const writers = allRoutes(h.config).filter((r) => r.method === 'get' && r.audit.length > 0);
    // a GET may audit a READ of sensitive data (the audit log itself); none may be one of the mutating action families
    for (const r of writers) {
      expect(
        r.audit.every((a) => /READ|VIEWED|EXPORT_DOWNLOADED/.test(a)),
        `${r.path} audits ${r.audit.join(',')}`,
      ).toBe(true);
    }
  });
  it('a patient-role or researcher token cannot call clinical routes', async () => {
    const researcher = await h.tokenFor(SEED_EMAIL.researcher);
    for (const path of [
      '/patients/' + ID,
      '/sessions',
      `/sessions/${ID}/facts`,
      `/sessions/${ID}/visit`,
      `/abha/status/${ID}`,
    ]) {
      expect(
        (
          await request(h.app)
            .get(api(path))
            .set(...bearer(researcher))
        ).status,
        path,
      ).toBe(403);
    }
  });
});

describe('request size, type and shape limits', () => {
  it('a body over 100 kb is refused with the error envelope and no stack', async () => {
    const res = await request(h.app)
      .post(api('/patients/lookup'))
      .set(...bearer(staff))
      .send({ phone: '0'.repeat(150_000) });
    expect(res.status).toBe(413);
    expect(res.body.success).toBe(false);
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.(ts|js):\d+|node_modules/);
  });
  it('malformed JSON and the wrong content type are 4xx, never 500', async () => {
    const bad = await request(h.app)
      .post(api('/patients/lookup'))
      .set(...bearer(staff))
      .set('Content-Type', 'application/json')
      .send('{"phone": ');
    expect(bad.status).toBe(400);
    const text = await request(h.app)
      .post(api('/patients/lookup'))
      .set(...bearer(staff))
      .set('Content-Type', 'text/plain')
      .send('phone=0000000001');
    expect(text.status).toBeLessThan(500);
    expect(text.status).toBeGreaterThanOrEqual(400);
    const form = await request(h.app)
      .post(api('/patients/lookup'))
      .set(...bearer(staff))
      .type('form')
      .send({ phone: '0000000001' });
    expect(form.status).toBeGreaterThanOrEqual(400);
    expect(form.status).toBeLessThan(500);
  });
  it('unknown fields on a strict body are refused (no mass assignment)', async () => {
    const res = await request(h.app)
      .post(api('/abha/verify/otp'))
      .set(...bearer(staff))
      .send({ txnId: ID, otp: '123456', role: 'admin', clinicId: ID });
    expect(res.status).toBe(400);
  });
  it('every response carries nosniff and a JSON content type; the CSV export is an attachment', async () => {
    const ok = await request(h.app)
      .get(api('/auth/me'))
      .set(...bearer(admin));
    expect(ok.headers['x-content-type-options']).toBe('nosniff');
    expect(ok.headers['content-type']).toMatch(/^application\/json; charset=utf-8/);
    const err = await request(h.app).get(api('/nope'));
    expect(err.headers['content-type']).toMatch(/^application\/json/);
    const csv = await request(h.app)
      .post(api('/audit/export'))
      .set(...bearer(admin))
      .send({});
    expect(csv.headers['content-disposition']).toMatch(/^attachment/);
    expect(csv.headers['cache-control']).toBe('no-store');
    expect(csv.headers['content-type']).toMatch(/^text\/csv/);
  });
  it('CORS answers only the configured origin and sends no wildcard', async () => {
    const good = await request(h.app).get('/health').set('Origin', h.config.corsOrigin);
    expect(good.headers['access-control-allow-origin']).toBe(h.config.corsOrigin);
    const evil = await request(h.app).get('/health').set('Origin', 'https://evil.example');
    // the allowed origin is one fixed value (ASVS 3.4.2): a foreign origin is never echoed and never gets a wildcard
    expect(evil.headers['access-control-allow-origin']).not.toBe('https://evil.example');
    expect(evil.headers['access-control-allow-origin']).not.toBe('*');
    const pre = await request(h.app)
      .options(api('/patients'))
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(pre.headers['access-control-allow-origin']).toBe(h.config.corsOrigin);
    expect(pre.headers['access-control-allow-origin']).not.toBe('*');
  });
  it('a NUL character in the query, the body or the path is a 400 (found by the injection probes: it was a 500)', async () => {
    const nul = String.fromCharCode(0);
    expect(
      (
        await request(h.app)
          .get(api('/medicines'))
          .query({ q: `a${nul}b` })
          .set(...bearer(admin))
      ).status,
    ).toBe(400);
    expect(
      (
        await request(h.app)
          .post(api('/patients/lookup'))
          .set(...bearer(staff))
          .send({ phone: `00${nul}1` })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(h.app)
          .get(api('/medicines?q=a%00b'))
          .set(...bearer(admin))
      ).status,
    ).toBe(400);
    expect(
      (
        await request(h.app)
          .get(api('/sessions/%00/visit'))
          .set(...bearer(doctor))
      ).status,
    ).toBe(400);
  });
  it('the API sends Strict-Transport-Security of at least a year (ASVS 3.4.1)', async () => {
    const res = await request(h.app).get('/health');
    const maxAge = Number(
      /max-age=(\d+)/.exec(String(res.headers['strict-transport-security']))?.[1] ?? 0,
    );
    expect(maxAge).toBeGreaterThanOrEqual(31_536_000);
  });
});

describe('injection attempts on search and filter endpoints', () => {
  const payloads = [
    "' OR '1'='1",
    "'; DROP TABLE medicine_master; --",
    '" OR ""="',
    '%',
    '_',
    '\\',
    "') UNION SELECT password_hash FROM mock_clinicos_user --",
    '${7*7}',
    '<script>alert(1)</script>',
    '\u0000',
    'a'.repeat(500),
    '../../etc/passwd',
  ];
  const count = async (table: string) =>
    Number((await h.db.owner.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0]?.n);

  it('medicine search treats every payload as text: never 500, no SQL error text, tables intact, no widening', async () => {
    const before = await count('medicine_master');
    const baseline = await request(h.app)
      .get(api('/medicines'))
      .query({ q: 'zzzz-no-such-medicine-zzzz' })
      .set(...bearer(admin));
    expect(baseline.status).toBe(200);
    for (const q of payloads) {
      const res = await request(h.app)
        .get(api('/medicines'))
        .query({ q })
        .set(...bearer(admin));
      expect([200, 400], q).toContain(res.status);
      expect(JSON.stringify(res.body)).not.toMatch(
        /syntax error|pg_catalog|relation "|password_hash|stack/i,
      );
      if (res.status === 200 && /OR|UNION|DROP/.test(q)) {
        expect(res.body.data.total, q).toBe(baseline.body.data.total);
      }
    }
    expect(await count('medicine_master')).toBe(before);
  });
  it('audit filters, session filters and the phone lookup do the same', async () => {
    const users = await count('mock_clinicos_user');
    for (const v of payloads) {
      const a = await request(h.app)
        .get(api('/audit'))
        .query({ action: v, actorUserId: v, from: v, to: v, beforeSeq: v })
        .set(...bearer(admin));
      expect([200, 400], `audit ${v}`).toContain(a.status);
      const s = await request(h.app)
        .get(api('/sessions'))
        .query({ status: v, before: v, open: v })
        .set(...bearer(doctor));
      expect([200, 400], `sessions ${v}`).toContain(s.status);
      const p = await request(h.app)
        .post(api('/patients/lookup'))
        .set(...bearer(staff))
        .send({ phone: v });
      expect([200, 400], `lookup ${v}`).toContain(p.status);
      for (const res of [a, s, p])
        expect(JSON.stringify(res.body)).not.toMatch(
          /syntax error|pg_catalog|relation "|password_hash/i,
        );
    }
    expect(await count('mock_clinicos_user')).toBe(users);
  });
  it('ids in the path must be UUIDs: junk ids are a 400 or 404, never a database error', async () => {
    for (const bad of ["1' OR '1'='1", '../x', '%00', 'null', '9'.repeat(80)]) {
      const res = await request(h.app)
        .get(api(`/sessions/${encodeURIComponent(bad)}/visit`))
        .set(...bearer(doctor));
      expect([400, 404], bad).toContain(res.status);
    }
  });
});

describe('the public webhook', () => {
  let hl: Harness;
  beforeAll(async () => {
    hl = await createHarness({ WHATSAPP_APP_SECRET: APP_SECRET, WEBHOOK_RATE_LIMIT_MAX: '4' });
  });
  afterAll(async () => {
    await hl.close();
  });
  const payload = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
  const post = (signature?: string, secret = APP_SECRET, body = payload) => {
    const sig = signature ?? `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
    return request(h.app)
      .post(api('/webhooks/whatsapp'))
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', sig)
      .send(body);
  };

  it('a request without a valid signature changes nothing and is refused (missing, malformed, wrong secret, altered body)', async () => {
    const before = await h.db.owner.query('SELECT count(*)::int AS n FROM whatsapp_message');
    const cases = [
      request(h.app)
        .post(api('/webhooks/whatsapp'))
        .set('Content-Type', 'application/json')
        .send(payload),
      post('sha256='),
      post('sha256=zz'),
      post(`sha256=${'0'.repeat(64)}`),
      post(undefined, 'a-different-secret-entirely'),
      post(`sha256=${createHmac('sha256', APP_SECRET).update('another body').digest('hex')}`),
    ];
    const results = [];
    for (const c of cases) results.push((await c).status);
    expect(
      results.every((s) => s === 401 || s === 403),
      results.join(','),
    ).toBe(true);
    const after = await h.db.owner.query('SELECT count(*)::int AS n FROM whatsapp_message');
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
  });
  it('the verification handshake needs the verify token and does not echo a challenge otherwise', async () => {
    const res = await request(h.app).get(api('/webhooks/whatsapp')).query({
      'hub.mode': 'subscribe',
      'hub.verify_token': 'wrong',
      'hub.challenge': 'CHALLENGE123',
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(res.body) + res.text).not.toContain('CHALLENGE123');
  });
  it('is rate limited per address even for signed requests (WEBHOOK_RATE_LIMIT_MAX=4; ASVS 6.1.1, unbounded consumption)', async () => {
    const signed = () =>
      request(hl.app)
        .post(api('/webhooks/whatsapp'))
        .set('Content-Type', 'application/json')
        .set(
          'X-Hub-Signature-256',
          `sha256=${createHmac('sha256', APP_SECRET).update(payload).digest('hex')}`,
        )
        .send(payload);
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) statuses.push((await signed()).status);
    expect(statuses.slice(0, 4).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(4)).toEqual([429, 429]);
    const last = await signed();
    expect(last.body.error.code).toBe('RATE_LIMITED');
    // an unsigned flood is limited the same way (the limit comes before the signature check)
    const unsigned = await request(hl.app).post(api('/webhooks/whatsapp')).send(payload);
    expect(unsigned.status).toBe(429);
  });
});

describe('rate limits that exist elsewhere (pointers, so a removal is noticed)', () => {
  it('login, sign, OTP and webhook each declare a limiter in the source', async () => {
    const { readFileSync } = await import('node:fs');
    const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
    expect(src('auth/routes.ts')).toMatch(/rateLimit\(/);
    expect(src('visits/service.ts')).toMatch(/MAX_FAILURES\s*=\s*5/);
    expect(src('abdm/service.ts')).toMatch(/MAX_OTP_ATTEMPTS\s*=\s*3/);
    expect(src('abdm/service.ts')).toMatch(/MAX_STARTS_PER_QUARTER_HOUR\s*=\s*5/);
    expect(src('whatsapp/routes.ts')).toMatch(/webhookLimiter/);
  });
});
