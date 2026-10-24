// ABHA verification through the API (Phase 9B, ADR-D42, FR-F9-01..03): MOCK flow, every failure, the attestation gate, the
// identity guard before the provider, what is stored (address, time, mode, salted hash; never the number or the OTP), and a
// log-redaction proof. Obviously fake identities only; nothing leaves the machine.
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AbhaError } from '../src/abdm/errors.js';
import { MOCK_IDENTITIES, MOCK_OTP } from '../src/abdm/identityGuard.js';
import type { AbhaProvider } from '../src/abdm/provider.js';
import { bearer, createHarness, SEED_EMAIL, type Harness } from './db/helpers.js';

const M = MOCK_IDENTITIES;
let h: Harness;
let staff: string;
let doctor: string;
let admin: string;
let patientId: string;
let otherPatientId: string;

const owner = (sql: string, p: unknown[] = []) => h.db.owner.query(sql, p);
const post = (path: string, body: object, token = staff) =>
  request(h.app)
    .post(`/api/v1${path}`)
    .set(...bearer(token))
    .send(body);
const get = (path: string, token = staff) =>
  request(h.app)
    .get(`/api/v1${path}`)
    .set(...bearer(token));
const start = (identity: string, pid = patientId, token = staff) =>
  post('/abha/verify/start', { patientId: pid, identity, attested: true }, token);
const otp = (txnId: string, code: string, token = staff) =>
  post('/abha/verify/otp', { txnId, otp: code }, token);

beforeAll(async () => {
  h = await createHarness();
  staff = await h.tokenFor(SEED_EMAIL.staff);
  doctor = await h.tokenFor(SEED_EMAIL.doctor1);
  admin = await h.tokenFor(SEED_EMAIL.admin);
  patientId = h.seed.patients[0]?.id as string;
  otherPatientId = h.seed.patients[1]?.id as string;
});
afterAll(async () => {
  await h.close();
});

describe('status', () => {
  it('says MOCK, lists only fake identities, and is unverified at first', async () => {
    const r = await get(`/abha/status/${patientId}`);
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ verified: false, mode: 'mock', abhaAddress: null });
    expect(r.body.data.notice).toMatch(/^MOCK/);
    expect(r.body.data.mockIdentities).toHaveLength(5);
  });
  it('an unknown patient is not found', async () => {
    expect((await get('/abha/status/00000000-0000-4000-8000-000000000001')).status).toBe(404);
  });
});

describe('start gates', () => {
  it('needs the attestation (nothing reaches the provider without it)', async () => {
    const spy = vi.spyOn(h.services.abha, 'startOtp');
    const r = await post('/abha/verify/start', { patientId, identity: M.ok.number });
    expect(r.status).toBe(400);
    const r2 = await post('/abha/verify/start', {
      patientId,
      identity: M.ok.number,
      attested: false,
    });
    expect(r2.status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
  it('refuses Aadhaar-like, unknown and production-looking identities before the provider', async () => {
    const spy = vi.spyOn(h.services.abha, 'startOtp');
    const aadhaar = await start('123456789012');
    expect(aadhaar.status).toBe(400);
    expect(aadhaar.body.error.code).toBe('ABHA_IDENTITY_REJECTED');
    expect(aadhaar.body.error.message).toMatch(/Aadhaar/);
    expect((await start('91555555555555')).body.error.code).toBe('ABHA_IDENTITY_REJECTED');
    expect((await start('someone@abdm')).body.error.code).toBe('ABHA_IDENTITY_REJECTED');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    const rows = await owner(
      `SELECT meta FROM audit_log WHERE action='ABHA_VERIFY_FAILED' ORDER BY seq`,
    );
    expect(rows.rows.length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(rows.rows)).toMatch(/identity_aadhaar_like/);
  });
});

describe('failures are plain, structured and audited', () => {
  it('rate limited, outage, unknown account', async () => {
    const limited = await start(M.rateLimited.number);
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('ABHA_RATE_LIMITED');
    expect(limited.body.error.message).toMatch(/^MOCK/);
    const down = await start(M.down.number);
    expect([down.status, down.body.error.code]).toEqual([503, 'ABHA_UNAVAILABLE']);
    const unknown = await start(M.unknown.number);
    expect([unknown.status, unknown.body.error.code]).toEqual([422, 'ABHA_NOT_FOUND']);
  });
  it('an expired OTP', async () => {
    const s = await start(M.expired.number);
    expect(s.status).toBe(201);
    const r = await otp(s.body.data.txnId, MOCK_OTP);
    expect([r.status, r.body.error.code]).toEqual([410, 'ABHA_OTP_EXPIRED']);
    const again = await otp(s.body.data.txnId, MOCK_OTP);
    expect(again.status).toBe(409);
  });
  it('wrong OTP counts down and the third wrong try locks it; the right OTP then fails too', async () => {
    const s = await start(M.ok.number);
    const txnId = s.body.data.txnId as string;
    const a = await otp(txnId, '000000');
    expect([a.status, a.body.error.code, a.body.error.details?.attemptsLeft]).toEqual([
      400,
      'ABHA_OTP_WRONG',
      2,
    ]);
    expect((await otp(txnId, '111111')).body.error.details?.attemptsLeft).toBe(1);
    expect((await otp(txnId, '222222')).body.error.details?.attemptsLeft).toBe(0);
    const late = await otp(txnId, MOCK_OTP);
    expect(late.status).toBe(409);
    const st = await owner(`SELECT status, attempts FROM abha_txn WHERE id = $1`, [txnId]);
    expect(st.rows[0]).toMatchObject({ status: 'locked', attempts: 3 });
    expect((await get(`/abha/status/${patientId}`)).body.data.verified).toBe(false);
  });
  it('a malformed OTP is a validation error', async () => {
    const s = await start(M.ok.address);
    expect((await otp(s.body.data.txnId, '12ab56')).status).toBe(400);
  });
});

describe('success', () => {
  it('verifies, stores only the address, time, mode and a salted hash, and audits without values', async () => {
    const s = await start(M.ok.number, patientId, doctor);
    expect(s.body.data.notice).toMatch(/^MOCK/);
    expect(JSON.stringify(s.body)).not.toContain(M.ok.number);
    const r = await otp(s.body.data.txnId, MOCK_OTP, doctor);
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({
      verified: true,
      abhaAddress: M.ok.address,
      verifiedMode: 'mock',
      mode: 'mock',
    });
    expect(JSON.stringify(r.body)).not.toContain(M.ok.number);
    const link = await owner(`SELECT * FROM abha_link WHERE patient_id = $1`, [patientId]);
    expect(link.rows).toHaveLength(1);
    expect(link.rows[0].abha_number_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(link.rows[0].mode).toBe('mock');
    // the number and the OTP are nowhere in the two tables or in the audit log
    const everything = JSON.stringify([
      (await owner(`SELECT * FROM abha_link`)).rows,
      (await owner(`SELECT * FROM abha_txn`)).rows,
      (await owner(`SELECT * FROM audit_log`)).rows,
    ]);
    expect(everything).not.toContain(M.ok.number);
    expect(everything).not.toContain(MOCK_OTP);
    const actions = (
      await owner(`SELECT action FROM audit_log WHERE action LIKE 'ABHA_%' ORDER BY seq`)
    ).rows.map((x) => x.action);
    expect(actions).toContain('ABHA_VERIFY_STARTED');
    expect(actions).toContain('ABHA_VERIFY_SUCCEEDED');
    expect(actions).toContain('ABHA_VERIFY_FAILED');
    const st = await get(`/abha/status/${patientId}`, admin);
    expect(st.body.data).toMatchObject({ verified: true, abhaAddress: M.ok.address });
  });
  it('the hash is per patient: the same number gives a different hash for another patient', async () => {
    const s = await start(M.ok.address, otherPatientId);
    await otp(s.body.data.txnId, MOCK_OTP);
    const hashes = (
      await owner(`SELECT patient_id, abha_number_hash FROM abha_link ORDER BY created_at`)
    ).rows;
    expect(hashes).toHaveLength(2);
    expect(hashes[0].abha_number_hash).not.toBe(hashes[1].abha_number_hash);
  });
  it('a second verification updates the one row', async () => {
    const s = await start(M.ok.number);
    await otp(s.body.data.txnId, MOCK_OTP);
    expect(
      (await owner(`SELECT count(*)::int AS n FROM abha_link WHERE patient_id = $1`, [patientId]))
        .rows[0].n,
    ).toBe(1);
  });
});

describe('transactions', () => {
  it('another clinic or an unknown transaction is not found; five starts per patient per quarter hour', async () => {
    expect((await otp('00000000-0000-4000-8000-000000000009', MOCK_OTP)).status).toBe(404);
    await owner(`DELETE FROM abha_txn`);
    for (let i = 0; i < 5; i += 1) expect((await start(M.ok.number)).status).toBe(201);
    const sixth = await start(M.ok.number);
    expect([sixth.status, sixth.body.error.code]).toEqual([429, 'ABHA_RATE_LIMITED']);
    await owner(`DELETE FROM abha_txn`);
  });
  it('a lapsed transaction is expired even with the right OTP', async () => {
    const s = await start(M.ok.number);
    await owner(`UPDATE abha_txn SET expires_at = now() - interval '1 minute' WHERE id = $1`, [
      s.body.data.txnId,
    ]);
    const r = await otp(s.body.data.txnId, MOCK_OTP);
    expect([r.status, r.body.error.code]).toEqual([410, 'ABHA_OTP_EXPIRED']);
  });
});

describe('provider behaviour is mapped, not leaked', () => {
  it('a sandbox-mode provider: the mock identities are refused, text from the provider never reaches the client', async () => {
    const calls: string[] = [];
    const fake: AbhaProvider = {
      mode: 'sandbox',
      startOtp: async (i) => {
        calls.push(i.value);
        throw new AbhaError('rejected', 'ABDM could not accept the request.');
      },
      verifyOtp: async () => {
        throw new AbhaError('unavailable', 'x');
      },
    };
    const original = h.services.abha;
    h.services.abha = fake;
    try {
      const refused = await start(M.ok.number);
      expect(refused.body.error.code).toBe('ABHA_IDENTITY_REJECTED');
      expect(calls).toHaveLength(0);
      const st = await get(`/abha/status/${patientId}`);
      expect(st.body.data.mode).toBe('sandbox');
      expect(st.body.data.notice).toMatch(/^SANDBOX/);
      expect(st.body.data.mockIdentities).toBeNull();
    } finally {
      h.services.abha = original;
    }
  });
  it('an unexpected provider crash is a plain 502 with fixed words', async () => {
    const original = h.services.abha;
    h.services.abha = {
      mode: 'mock',
      startOtp: async () => {
        throw new Error(`boom ${M.ok.number}`);
      },
      verifyOtp: original.verifyOtp.bind(original),
    };
    try {
      const r = await start(M.ok.number);
      expect(r.status).toBe(502);
      expect(JSON.stringify(r.body)).not.toContain(M.ok.number);
    } finally {
      h.services.abha = original;
    }
  });
});

describe('log redaction', () => {
  it('no number, OTP or token reaches stdout, stderr or the audit log across the whole flow', async () => {
    process.env.LOG_IN_TESTS = 'true';
    const seen: string[] = [];
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
    try {
      const original = h.services.abha;
      const s = await start(M.ok.number);
      await otp(s.body.data.txnId, '999999');
      await otp(s.body.data.txnId, MOCK_OTP);
      await start('123456789012');
      h.services.abha = {
        mode: 'mock',
        startOtp: async () => {
          throw new Error(`boom ${M.ok.number} ${MOCK_OTP}`);
        },
        verifyOtp: original.verifyOtp.bind(original),
      };
      await start(M.ok.number);
      h.services.abha = original;
    } finally {
      out.mockRestore();
      err.mockRestore();
      warn.mockRestore();
      delete process.env.LOG_IN_TESTS;
    }
    const all = seen.join('\n') + JSON.stringify((await owner(`SELECT * FROM audit_log`)).rows);
    expect(all).not.toContain(M.ok.number);
    expect(all).not.toContain('123456789012');
    expect(all).not.toContain('999999');
    expect(all).not.toMatch(/Bearer /);
  });
});
