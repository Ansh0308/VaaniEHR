// Mutation-style probes for the Phase 12B guards (ADR-D44). A checker looks for the violations a broken guard would allow: a NUL
// character reaching the database (a 500), and an unsigned webhook being accepted. On the real code it finds none. For each guard
// we REPLACE it with a broken version (vi.doMock) and require the checker to notice. Fake data only.
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

type Mutation = 'none' | 'no-nul-guard' | 'signature-always-ok';
const MOCKED = ['../src/http/noNul.js', '../src/whatsapp/service.js'] as const;

async function violations(mutation: Mutation): Promise<string[]> {
  vi.resetModules();
  for (const m of MOCKED) vi.doUnmock(m);
  if (mutation === 'no-nul-guard') {
    vi.doMock('../src/http/noNul.js', async (original) => ({
      ...(await original<typeof import('../src/http/noNul.js')>()),
      rejectNul: (_q: unknown, _r: unknown, next: () => void) => next(),
    }));
  }
  if (mutation === 'signature-always-ok') {
    vi.doMock('../src/whatsapp/service.js', async (original) => ({
      ...(await original<typeof import('../src/whatsapp/service.js')>()),
      verifySignature: () => true,
    }));
  }
  const { createHarness, SEED_EMAIL, bearer } = await import('./db/helpers.js');
  const h = await createHarness({ WHATSAPP_APP_SECRET: 'mutation-secret-not-real' });
  const found: string[] = [];
  try {
    const admin = await h.tokenFor(SEED_EMAIL.admin);
    const nul = await request(h.app)
      .get('/api/v1/medicines')
      .query({ q: `a${String.fromCharCode(0)}b` })
      .set(...bearer(admin));
    if (nul.status >= 500) found.push('a NUL character reached the database (500)');
    const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
    const unsigned = await request(h.app)
      .post('/api/v1/webhooks/whatsapp')
      .set('Content-Type', 'application/json')
      .set(
        'X-Hub-Signature-256',
        `sha256=${createHmac('sha256', 'not-the-secret').update(body).digest('hex')}`,
      )
      .send(body);
    if (unsigned.status === 200) found.push('a webhook with a wrong signature was accepted');
  } finally {
    await h.close();
  }
  return found;
}

afterEach(() => {
  vi.resetModules();
});

describe('security guard mutations', () => {
  it('the real code has no violations', async () => {
    expect(await violations('none')).toEqual([]);
  }, 60_000);
  it('the checker notices when the NUL guard is off', async () => {
    expect(await violations('no-nul-guard')).toContain(
      'a NUL character reached the database (500)',
    );
  }, 60_000);
  it('the checker notices when signature checking accepts everything', async () => {
    expect(await violations('signature-always-ok')).toContain(
      'a webhook with a wrong signature was accepted',
    );
  }, 60_000);
});
