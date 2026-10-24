// ABHA building blocks without a database (Phase 9B, ADR-D42): the identity guard, the RSA helper, the mock fixtures, the client
// token cache, retry and error classification. Fake identities, a throw-away RSA key and a fake fetch only.
import { constants, generateKeyPairSync, privateDecrypt } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AbdmClient } from '../../src/abdm/client.js';
import { encryptForAbdm, parsePublicKey } from '../../src/abdm/encryption.js';
import { AbhaError } from '../../src/abdm/errors.js';
import {
  checkIdentity,
  MOCK_IDENTITIES,
  MOCK_OTP,
  normaliseIdentity,
} from '../../src/abdm/identityGuard.js';
import { MOCK_OTP_LIFETIME_MS, MockAbha } from '../../src/abdm/mockProvider.js';
import { createAbha } from '../../src/abdm/provider.js';
import { SandboxAbha } from '../../src/abdm/sandboxProvider.js';

const M = MOCK_IDENTITIES;
const failure = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
  } catch (e) {
    return e instanceof AbhaError ? e.failure : 'other';
  }
  return 'none';
};

describe('identity guard', () => {
  it('accepts only the mock set in mock mode', () => {
    expect(checkIdentity(M.ok.number, 'mock', []).ok).toBe(true);
    expect(checkIdentity('91-0000-0000-0001', 'mock', []).ok).toBe(true);
    expect(checkIdentity(M.ok.address, 'mock', []).ok).toBe(true);
    expect(checkIdentity('91000000000009', 'mock', []).reason).toBe('not_allowlisted');
  });
  it('refuses Aadhaar-like and malformed numbers', () => {
    expect(checkIdentity('123456789012', 'mock', []).reason).toBe('aadhaar_like');
    expect(checkIdentity('1234 5678 9012', 'sandbox', ['91000000000001']).reason).toBe(
      'aadhaar_like',
    );
    expect(checkIdentity('1234567', 'mock', []).reason).toBe('malformed');
  });
  it('refuses production-looking addresses', () => {
    expect(checkIdentity('someone@abdm', 'mock', []).reason).toBe('production_address');
    expect(checkIdentity('someone@ndhm', 'sandbox', ['someone@ndhm']).reason).toBe(
      'production_address',
    );
  });
  it('sandbox mode accepts only the owner allowlist, never the mock set', () => {
    expect(checkIdentity('91111111111111', 'sandbox', ['91111111111111']).ok).toBe(true);
    expect(checkIdentity(M.ok.number, 'sandbox', ['91111111111111']).ok).toBe(false);
    expect(checkIdentity('91111111111111', 'sandbox', []).ok).toBe(false);
  });
  it('normalises spaces and dashes', () => {
    expect(normaliseIdentity('91-0000 0000-0001').value).toBe('91000000000001');
  });
});

describe('encryption helper', () => {
  it('RSA-OAEP (SHA-1) encrypts to something only the private key opens', () => {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = publicKey.export({ type: 'spki', format: 'pem' }) as string;
    const der = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    for (const published of [pem, der]) {
      const out = encryptForAbdm(parsePublicKey(published), 'fake-value-123456');
      expect(out).not.toContain('fake-value');
      const plain = privateDecrypt(
        { key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha1' },
        Buffer.from(out, 'base64'),
      );
      expect(plain.toString()).toBe('fake-value-123456');
    }
  });
});

describe('MockAbha fixtures', () => {
  it('success returns the mock address', async () => {
    const m = new MockAbha();
    const { txn } = await m.startOtp({ kind: 'abha_address', value: M.ok.address });
    const r = await m.verifyOtp({ txn, otp: MOCK_OTP });
    expect(r.abhaAddress).toBe(M.ok.address);
  });
  it('wrong OTP', async () => {
    const m = new MockAbha();
    const { txn } = await m.startOtp({ kind: 'abha_number', value: M.ok.number });
    expect(await failure(m.verifyOtp({ txn, otp: '000000' }))).toBe('otp_wrong');
  });
  it('expired: the expired identity and a lapsed clock', async () => {
    const m = new MockAbha();
    const a = await m.startOtp({ kind: 'abha_number', value: M.expired.number });
    expect(await failure(m.verifyOtp({ txn: a.txn, otp: MOCK_OTP }))).toBe('otp_expired');
    let now = 1_000_000;
    const c = new MockAbha(() => now);
    const b = await c.startOtp({ kind: 'abha_number', value: M.ok.number });
    now += MOCK_OTP_LIFETIME_MS + 1;
    expect(await failure(c.verifyOtp({ txn: b.txn, otp: MOCK_OTP }))).toBe('otp_expired');
  });
  it('rate limit, outage, unknown, and a non-mock identity', async () => {
    const m = new MockAbha();
    expect(await failure(m.startOtp({ kind: 'abha_number', value: M.rateLimited.number }))).toBe(
      'rate_limited',
    );
    expect(await failure(m.startOtp({ kind: 'abha_number', value: M.down.number }))).toBe(
      'unavailable',
    );
    expect(await failure(m.startOtp({ kind: 'abha_number', value: M.unknown.number }))).toBe(
      'identity_unknown',
    );
    expect(await failure(m.startOtp({ kind: 'abha_number', value: '91999999999999' }))).toBe(
      'rejected',
    );
  });
});

describe('provider selection', () => {
  it('is the mock by default and never falls back to the mock when sandbox is asked for', async () => {
    expect(createAbha({}).mode).toBe('mock');
    const off = createAbha({ ABDM_PROVIDER: 'sandbox' });
    expect(await failure(off.startOtp({ kind: 'abha_number', value: M.ok.number }))).toBe(
      'not_configured',
    );
    const noCreds = createAbha({ ABDM_PROVIDER: 'sandbox', ABDM_ENABLE_SANDBOX: 'true' });
    expect(await failure(noCreds.startOtp({ kind: 'abha_number', value: M.ok.number }))).toBe(
      'not_configured',
    );
    expect(
      createAbha({
        ABDM_PROVIDER: 'sandbox',
        ABDM_ENABLE_SANDBOX: 'true',
        ABDM_CLIENT_ID: 'x',
        ABDM_CLIENT_SECRET: 'y',
      }).mode,
    ).toBe('sandbox');
  });
});

describe('AbdmClient', () => {
  const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const der = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers });

  function fake(handler: (url: string, init: RequestInit) => Response) {
    const calls: { url: string; body: string }[] = [];
    const sleeps: number[] = [];
    const client = new AbdmClient({
      clientId: 'test-id',
      clientSecret: 'test-secret',
      sessionUrl: 'https://sbx.invalid/session',
      certUrl: 'https://sbx.invalid/cert',
      abhaUrl: 'https://sbx.invalid/abha',
      fetchImpl: (async (url: string, init: RequestInit) => {
        calls.push({ url, body: String(init.body ?? '') });
        return handler(url, init);
      }) as unknown as typeof fetch,
      sleep: async (ms) => void sleeps.push(ms),
    });
    return { client, calls, sleeps };
  }
  const base = (url: string): Response | null =>
    url.endsWith('/session')
      ? json(200, { accessToken: 'tok', expiresIn: 600 })
      : url.endsWith('/cert')
        ? json(200, { publicKey: der })
        : null;

  it('caches the token and the public key', async () => {
    const { client, calls } = fake((u) => base(u) ?? json(200, { ok: true }));
    await client.post('/a', {});
    await client.post('/b', {});
    await client.publicKey();
    await client.publicKey();
    expect(calls.filter((c) => c.url.endsWith('/session'))).toHaveLength(1);
    expect(calls.filter((c) => c.url.endsWith('/cert'))).toHaveLength(1);
  });
  it('retries 503 with backoff then succeeds; gives up as unavailable', async () => {
    let n = 0;
    const ok = fake((u) => base(u) ?? (++n < 3 ? json(503, {}) : json(200, { done: 1 })));
    expect(await ok.client.post('/x', {})).toEqual({ done: 1 });
    expect(ok.sleeps).toEqual([500, 1000]);
    const down = fake((u) => base(u) ?? json(503, {}));
    expect(await failure(down.client.post('/x', {}))).toBe('unavailable');
  });
  it('429 becomes rate_limited and honours Retry-After', async () => {
    const f = fake((u) => base(u) ?? json(429, {}, { 'retry-after': '2' }));
    let caught: AbhaError | null = null;
    try {
      await f.client.post('/x', {});
    } catch (e) {
      caught = e as AbhaError;
    }
    expect(caught?.failure).toBe('rate_limited');
    expect(caught?.retryAfterSeconds).toBe(2);
  });
  it('classifies refusals and drops the provider text', async () => {
    const mk = (message: string) => fake((u) => base(u) ?? json(400, { message }));
    expect(await failure(mk('Invalid OTP').client.post('/x', {}))).toBe('otp_wrong');
    expect(await failure(mk('OTP has expired').client.post('/x', {}))).toBe('otp_expired');
    expect(await failure(mk('Account not found').client.post('/x', {}))).toBe('identity_unknown');
    let text = '';
    try {
      await mk('echo 91000000000001 and 123456').client.post('/x', {});
    } catch (e) {
      text = (e as Error).message;
    }
    expect(text).not.toMatch(/91000000000001|123456/);
  });
  it('SandboxAbha sends only encrypted values', async () => {
    const f = fake(
      (u) =>
        base(u) ??
        json(200, {
          txnId: 't1',
          ABHAProfile: { abhaAddress: 'a@sbx', ABHANumber: '91000000000001' },
        }),
    );
    const s = new SandboxAbha(f.client);
    const { txn } = await s.startOtp({ kind: 'abha_number', value: '91000000000001' });
    const r = await s.verifyOtp({ txn, otp: '123456' });
    expect(r.abhaAddress).toBe('a@sbx');
    const sent = f.calls
      .filter((c) => c.url.includes('/profile/login'))
      .map((c) => c.body)
      .join('');
    expect(sent).not.toContain('91000000000001');
    expect(sent).not.toContain('123456');
  });
});
