// Secrets never leave through logs, audit rows or error bodies (Phase 12B, ADR-D44; ASVS 16.2.5, 14.2.x; docs/ENV_VARS.md).
// Distinctive secret values are configured, then failing logins, forged tokens, bad signatures, validation errors and a forced
// internal error are run with logging switched on. Stdout, stderr, the audit table and every error body are scanned for those
// values and for secret-shaped strings. The scanner is itself tested, so it cannot pass by being blind. Fake data only.
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config/env.js';
import { redactMessage } from '../src/logger.js';
import { bearer, createHarness, SEED_EMAIL, type Harness } from './db/helpers.js';
import { baseEnv } from './helpers.js';

const SECRETS = {
  WHATSAPP_APP_SECRET: 'wa-app-secret-DISTINCT-7f3a91c2e8b4',
  WHATSAPP_VERIFY_TOKEN: 'wa-verify-token-DISTINCT-5d21b7a09c3e',
  WHATSAPP_ACCESS_TOKEN: 'wa-access-token-DISTINCT-a1b2c3d4e5f6',
  ABDM_CLIENT_SECRET: 'abdm-client-secret-DISTINCT-99aa77bb55cc',
  ABDM_CLIENT_ID: 'abdm-client-id-DISTINCT-42',
};
const TYPED_PASSWORD = 'Typed-Wrong-Passw0rd-DISTINCT';
const LOGIN_EMAIL = 'someone.private@example.invalid';

/** shapes that should never appear in a log line, an audit row or an error body */
export const SECRET_SHAPES: { name: string; re: RegExp }[] = [
  { name: 'JWT', re: /\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]*/ },
  { name: 'bcrypt hash', re: /\$2[aby]\$\d{2}\$[./A-Za-z0-9]{20,}/ },
  { name: 'private key block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'database URL with a password', re: /postgres(?:ql)?:\/\/[^\s:@/]+:[^\s@]+@/ },
  { name: 'cloud access key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'API key shape', re: /\bsk-[A-Za-z0-9]{20,}\b/ },
  { name: 'bearer value', re: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/ },
];
export const findSecrets = (text: string, values: string[]): string[] => [
  ...values.filter((v) => text.includes(v)).map((v) => `value ${v.slice(0, 8)}...`),
  ...SECRET_SHAPES.filter((s) => s.re.test(text)).map((s) => s.name),
];

describe('the scanner itself', () => {
  it('finds planted values and shapes, and nothing in ordinary text', () => {
    expect(findSecrets(`x ${SECRETS.WHATSAPP_APP_SECRET} y`, Object.values(SECRETS))).toHaveLength(
      1,
    );
    expect(findSecrets('Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123', [])).toContain(
      'bearer value',
    );
    expect(findSecrets('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJl', [])).toContain('JWT');
    expect(findSecrets('postgres://vaani_app:hunter2hunter2@db:5432/x', [])).toContain(
      'database URL with a password',
    );
    expect(findSecrets('$2b$12$' + 'a'.repeat(53), [])).toContain('bcrypt hash');
    expect(
      findSecrets('Login failed for a user. Request 5eed0000-0000-4000-8000-000000000001', []),
    ).toEqual([]);
  });
  it('redactMessage masks quoted text, e-mail, tokens and digit runs and caps the length', () => {
    const out = redactMessage(
      `invalid input syntax for type uuid: "${LOGIN_EMAIL}" from a.b@c.invalid token eyJhbGciOi.eyJzdWIi.sig 9100000000000 ${'z'.repeat(400)}`,
    );
    expect(out).not.toMatch(/someone|a\.b@c|eyJ|9100000000000/);
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out).toContain('invalid input syntax for type uuid');
  });
});

describe('what the running API writes', () => {
  let h: Harness;
  const seen: string[] = [];
  const bodies: string[] = [];
  const restore: (() => void)[] = [];
  const all = Object.values(SECRETS);

  beforeAll(async () => {
    process.env.LOG_IN_TESTS = 'true';
    const out = vi.spyOn(process.stdout, 'write').mockImplementation((c: unknown) => {
      seen.push(String(c));
      return true;
    });
    const err = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
      seen.push(a.map(String).join(' '));
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => {
      seen.push(a.map(String).join(' '));
    });
    restore.push(
      () => out.mockRestore(),
      () => err.mockRestore(),
      () => warn.mockRestore(),
    );
    h = await createHarness({ ...SECRETS });
  });
  afterAll(async () => {
    for (const r of restore) r();
    delete process.env.LOG_IN_TESTS;
    await h.close();
  });

  const note = (res: { text: string; headers: Record<string, unknown> }) => {
    bodies.push(res.text, JSON.stringify(res.headers));
  };

  it('runs the failure paths', async () => {
    const real = [h.config.devAuthSecret as string, h.config.internalServiceSecret as string];
    all.push(...real);
    const staff = await h.tokenFor(SEED_EMAIL.staff);
    const doctor = await h.tokenFor(SEED_EMAIL.doctor1);
    // failed logins (unknown user, wrong password, locked account), with a typed password that must not be kept
    for (let i = 0; i < 7; i += 1) {
      note(
        await request(h.app)
          .post('/api/v1/auth/login')
          .send({ email: SEED_EMAIL.researcher, password: TYPED_PASSWORD }),
      );
    }
    note(
      await request(h.app)
        .post('/api/v1/auth/login')
        .send({ email: LOGIN_EMAIL, password: TYPED_PASSWORD }),
    );
    note(
      await request(h.app).post('/api/v1/auth/login').send({ email: 12, password: TYPED_PASSWORD }),
    );
    // forged and junk tokens
    note(
      await request(h.app)
        .get('/api/v1/auth/me')
        .set(...bearer('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJl')),
    );
    note(
      await request(h.app)
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer ' + 'q'.repeat(300)),
    );
    // webhook without a valid signature, with a wrong verify token, with a bad body
    const body = JSON.stringify({ object: 'x', entry: [] });
    note(
      await request(h.app)
        .post('/api/v1/webhooks/whatsapp')
        .set('Content-Type', 'application/json')
        .set('X-Hub-Signature-256', 'sha256=' + '1'.repeat(64))
        .send(body),
    );
    note(
      await request(h.app)
        .get('/api/v1/webhooks/whatsapp')
        .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'guess', 'hub.challenge': 'c' }),
    );
    // validation errors and forbidden calls with secret-looking input
    note(
      await request(h.app)
        .post('/api/v1/patients')
        .set(...bearer(staff))
        .send({ phone: 'x', password: TYPED_PASSWORD, token: 'Bearer ' + 'k'.repeat(40) }),
    );
    note(
      await request(h.app)
        .get('/api/v1/audit')
        .set(...bearer(staff)),
    );
    note(
      await request(h.app)
        .get('/api/v1/medicines')
        .query({ q: `a${String.fromCharCode(0)}` })
        .set(...bearer(staff)),
    );
    // service route with a bad signature
    note(
      await request(h.app)
        .post('/api/v1/internal/audio-assets')
        .set('X-Service-Timestamp', String(Math.floor(Date.now() / 1000)))
        .set('X-Service-Signature', 'f'.repeat(64))
        .send({}),
    );
    // a forced internal error whose message carries a JWT, an e-mail address, a database URL and a secret
    const original = h.services.directory.getPatient.bind(h.services.directory);
    h.services.directory.getPatient = async () => {
      throw new Error(
        `boom "${LOGIN_EMAIL}" eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJl postgres://u:hunter2hunter2@db/x ${SECRETS.ABDM_CLIENT_SECRET}`,
      );
    };
    const crash = await request(h.app)
      .get(`/api/v1/patients/${randomUUID()}`)
      .set(...bearer(doctor));
    h.services.directory.getPatient = original;
    expect(crash.status).toBe(500);
    expect(crash.body.error).toEqual({ code: 'INTERNAL', message: 'Internal server error' });
    note(crash);
    expect(seen.join('\n')).toContain('unhandled_error'); // the error WAS logged, so the scan below is meaningful
  }, 120_000);

  it('no configured secret and no secret-shaped string reached the logs', () => {
    const logs = seen.join('\n');
    expect(logs.length).toBeGreaterThan(50);
    expect(logs.split(String.fromCharCode(10)).filter((l) => /postgres(ql)?:\/\//.test(l))).toEqual(
      [],
    );
    expect(findSecrets(logs, [...all, TYPED_PASSWORD, LOGIN_EMAIL])).toEqual([]);
  });
  it('none reached an error body or a response header', () => {
    expect(findSecrets(bodies.join('\n'), [...all, TYPED_PASSWORD])).toEqual([]);
  });
  it('none reached the audit log (the typed password and the e-mail address are not kept either)', async () => {
    const rows = JSON.stringify((await h.db.owner.query('SELECT * FROM audit_log')).rows);
    expect(rows.length).toBeGreaterThan(100);
    expect(findSecrets(rows, [...all, TYPED_PASSWORD, LOGIN_EMAIL])).toEqual([]);
  });
});

describe('configuration errors', () => {
  it('name the variable but never echo a secret value', () => {
    const attempts: Record<string, string>[] = [
      { ...baseEnv, DATABASE_URL: 'postgres://user:Sup3r-Secret-Pw@host/db?x=REPLACE_ME' },
      { ...baseEnv, DEV_AUTH_SECRET: 'short-secret-value' },
      { ...baseEnv, INTERNAL_SERVICE_SECRET: 'REPLACE_ME_x-secret-value' },
      { ...baseEnv, SIMULATED_DATA_ONLY: 'false' },
    ];
    for (const env of attempts) {
      let message = '';
      try {
        loadConfig(env);
      } catch (e) {
        message = String((e as Error).message);
      }
      expect(message.length).toBeGreaterThan(0);
      expect(message).not.toMatch(/Sup3r-Secret-Pw|short-secret-value|x-secret-value/);
    }
  });
});
