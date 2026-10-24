// Mutation-style tests for the ABHA gates (Phase 9B, ADR-D42; the by-hand break-tests, kept). A checker looks for the violations a
// broken gate would allow: an Aadhaar-like or unlisted identity reaching the provider, and unlimited wrong OTP tries. On the real
// code it finds none. For each gate we REPLACE it with a broken version (vi.doMock) and require the checker to notice.
// Fake identities only; the provider is the mock.
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Harness } from './db/helpers.js';

type Mutation = 'none' | 'guard-off' | 'attempt-count-off';
const MOCKED = [
  '../src/abdm/identityGuard.js',
  '../src/db/tx.js',
  '../src/abdm/service.js',
] as const;

async function build(mutation: Mutation) {
  vi.resetModules();
  for (const m of MOCKED) vi.doUnmock(m);
  if (mutation === 'guard-off') {
    vi.doMock('../src/abdm/identityGuard.js', async (original) => {
      const real = await original<typeof import('../src/abdm/identityGuard.js')>();
      return {
        ...real,
        checkIdentity: (raw: string) => {
          const n = real.normaliseIdentity(raw);
          return { ok: true, kind: n.kind, value: n.value, reason: 'ok' };
        },
      };
    });
  }
  if (mutation === 'attempt-count-off') {
    vi.doMock('../src/db/tx.js', async (original) => {
      const real = await original<typeof import('../src/db/tx.js')>();
      return {
        ...real,
        withTransaction: (pool: never, fn: (db: never) => Promise<unknown>) =>
          real.withTransaction(pool, (db) =>
            fn({
              ...db,
              query: (sql: unknown, ...rest: unknown[]) =>
                /attempts = attempts \+ 1/.test(String(sql))
                  ? Promise.resolve({ rows: [], rowCount: 0 })
                  : (db.query as (...a: unknown[]) => Promise<unknown>)(sql, ...rest),
            } as never),
          ),
      };
    });
  }
  const { createHarness, SEED_EMAIL, bearer } = await import('./db/helpers.js');
  const { MOCK_IDENTITIES, MOCK_OTP } = await import('../src/abdm/identityGuard.js');
  const h: Harness = await createHarness();
  const staff = await h.tokenFor(SEED_EMAIL.staff);
  const patientId = h.seed.patients[0]?.id as string;
  const post = (path: string, body: object) =>
    request(h.app)
      .post(`/api/v1${path}`)
      .set(...bearer(staff))
      .send(body);
  return { h, post, patientId, M: MOCK_IDENTITIES, OTP: MOCK_OTP };
}

/** the violations: what a broken gate would allow */
async function violations(mutation: Mutation): Promise<string[]> {
  const { h, post, patientId, M, OTP } = await build(mutation);
  const found: string[] = [];
  try {
    const seen: string[] = [];
    const original = h.services.abha.startOtp.bind(h.services.abha);
    h.services.abha.startOtp = async (i) => {
      seen.push(i.value);
      return original(i);
    };
    // an Aadhaar-like number must be refused before it reaches the provider
    await post('/abha/verify/start', { patientId, identity: '123456789012', attested: true });
    if (seen.includes('123456789012')) found.push('aadhaar-like number reached the provider');
    // five wrong OTPs, then the right one: the real code locked the transaction after three
    const s = await post('/abha/verify/start', {
      patientId,
      identity: M.ok.number,
      attested: true,
    });
    const txnId = s.body.data?.txnId as string;
    for (let i = 0; i < 5; i += 1) await post('/abha/verify/otp', { txnId, otp: '000000' });
    const last = await post('/abha/verify/otp', { txnId, otp: OTP });
    if (last.status === 200) found.push('the OTP was accepted after five wrong tries');
  } finally {
    await h.close();
  }
  return found;
}

afterEach(() => {
  vi.resetModules();
});

describe('ABHA gate mutations', () => {
  it('the real code has no violations', async () => {
    expect(await violations('none')).toEqual([]);
  }, 60_000);
  it('the checker notices when the identity guard is off', async () => {
    expect(await violations('guard-off')).toContain('aadhaar-like number reached the provider');
  }, 60_000);
  it('the checker notices when wrong tries are not counted', async () => {
    expect(await violations('attempt-count-off')).toContain(
      'the OTP was accepted after five wrong tries',
    );
  }, 60_000);
});
