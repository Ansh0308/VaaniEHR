// Mutation-style tests for the WhatsApp gates (Phase 10 Run 1, ADR-D41; the by-hand break-tests, kept). A checker looks for the
// violations a broken gate would allow: a summary for an unsigned visit, one without WhatsApp consent, one that differs from
// the signed snapshot, a send without approval, a send of text that was changed after approval, a send to a number that is not
// on the allowlist, a webhook with a bad signature, a STOP reply that does not withdraw consent, and another doctor using the
// session. On the real code it finds none. For each gate we REPLACE it with a broken version (vi.doMock) and require the
// checker to notice. Fake data only; the provider is always a fake.
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Harness } from './db/helpers.js';

type Mutation =
  | 'none'
  | 'no-sign-gate'
  | 'no-consent-gate'
  | 'detector-off'
  | 'send-approves-itself'
  | 'no-hash-check'
  | 'no-allowlist'
  | 'bad-signature-accepted'
  | 'stop-ignored'
  | 'no-session-scoping';

const MOCKED = [
  '../src/whatsapp/service.js',
  '../src/whatsapp/detector.js',
  '../src/whatsapp/summary.js',
  '../src/whatsapp/provider.js',
  '../src/sessions/service.js',
] as const;
const g = globalThis as { __badGenerator?: boolean };
const SECRET = 'mutation-app-secret-not-real';

async function build(mutation: Mutation) {
  vi.resetModules();
  for (const m of MOCKED) vi.doUnmock(m);
  // a generator with a bug, switched on only for the detector probe: it writes 1 mg where the snapshot says 10 mg
  vi.doMock('../src/whatsapp/summary.js', async (original) => {
    const real = await original<typeof import('../src/whatsapp/summary.js')>();
    return {
      ...real,
      ...(mutation === 'no-hash-check' ? { summaryHash: () => 'a'.repeat(64) } : {}),
      buildSummary: (...args: Parameters<typeof real.buildSummary>) => {
        const s = real.buildSummary(...args);
        if (!g.__badGenerator) return s;
        const bad = (x: string) => x.replace(' 10 mg', ' 1 mg');
        return { ...s, params: { ...s.params, p2: bad(s.params.p2) }, textGu: bad(s.textGu) };
      },
    };
  });
  if (mutation === 'detector-off') {
    vi.doMock('../src/whatsapp/detector.js', async (original) => ({
      ...(await original<typeof import('../src/whatsapp/detector.js')>()),
      findMismatches: () => [],
    }));
  }
  if (mutation === 'no-sign-gate') {
    vi.doMock('../src/whatsapp/service.js', async (original) => {
      const real = await original<typeof import('../src/whatsapp/service.js')>();
      return {
        ...real,
        // an unsigned visit is treated as an empty signed one
        requireSigned: async (...a: Parameters<typeof real.requireSigned>) =>
          real.requireSigned(...a).catch(() => ({
            version: 1,
            kind: 'signed',
            content: { schema: 1, facts: [], medicines: [], workingCondition: null },
            contentHash: 'a'.repeat(64),
            safetyConfigured: false,
            safetyNotRunAcknowledged: false,
            reason: null,
            signedBy: '00000000-0000-4000-8000-000000000000',
            signedAt: new Date().toISOString(),
          })),
      };
    });
  }
  if (mutation === 'no-consent-gate') {
    vi.doMock('../src/whatsapp/service.js', async (original) => ({
      ...(await original<typeof import('../src/whatsapp/service.js')>()),
      requireWhatsAppConsent: async () => undefined,
    }));
  }
  if (mutation === 'send-approves-itself') {
    vi.doMock('../src/whatsapp/service.js', async (original) => {
      const real = await original<typeof import('../src/whatsapp/service.js')>();
      return {
        ...real,
        // sending quietly approves the draft first
        sendApproved: async (...a: Parameters<typeof real.sendApproved>) => {
          const [db, , session, visit, userId] = a;
          await real.approve(db, session, visit, userId).catch(() => undefined);
          return real.sendApproved(...a);
        },
      };
    });
  }
  if (mutation === 'bad-signature-accepted') {
    vi.doMock('../src/whatsapp/service.js', async (original) => ({
      ...(await original<typeof import('../src/whatsapp/service.js')>()),
      verifySignature: () => true,
    }));
  }
  if (mutation === 'stop-ignored') {
    vi.doMock('../src/whatsapp/service.js', async (original) => ({
      ...(await original<typeof import('../src/whatsapp/service.js')>()),
      patientOfNumber: async () => null,
    }));
  }
  if (mutation === 'no-allowlist') {
    vi.doMock('../src/whatsapp/provider.js', async (original) => {
      const real = await original<typeof import('../src/whatsapp/provider.js')>();
      class Broken extends real.MetaWhatsApp {
        constructor(cfg: ConstructorParameters<typeof real.MetaWhatsApp>[0], f?: typeof fetch) {
          super(
            {
              ...cfg,
              allowlist: new Proxy([], {
                get: (t, k) => (k === 'includes' ? () => true : Reflect.get(t, k)),
              }) as string[],
            },
            f,
          );
        }
      }
      return { ...real, MetaWhatsApp: Broken };
    });
  }
  if (mutation === 'no-session-scoping') {
    vi.doMock('../src/sessions/service.js', async (original) => {
      const real = await original<typeof import('../src/sessions/service.js')>();
      return {
        ...real,
        loadSession: async (
          db: { query: (sql: string, values: unknown[]) => Promise<{ rows: unknown[] }> },
          _auth: unknown,
          id: string,
        ) => {
          const r = await db.query('SELECT * FROM consultation_session WHERE id = $1', [id]);
          return r.rows[0] ? real.toSession(r.rows[0] as never) : null;
        },
      };
    });
  }
  const helpers = await import('./db/helpers.js');
  const h = await helpers.createHarness({
    WHATSAPP_APP_SECRET: SECRET,
    WHATSAPP_VERIFY_TOKEN: 'v',
  });
  return { helpers, h };
}

/** What a broken gate would let through. Empty means every gate held. */
async function violations(
  helpers: typeof import('./db/helpers.js'),
  h: Harness,
): Promise<string[]> {
  const found: string[] = [];
  const provider = await import('../src/whatsapp/provider.js');
  const doctor = await h.tokenFor(helpers.SEED_EMAIL.doctor1);
  const doctor2 = await h.tokenFor(helpers.SEED_EMAIL.doctor2);
  const password = h.passwords[helpers.SEED_EMAIL.doctor1] as string;
  const doctorId = h.seed.users.find((u) => u.email === helpers.SEED_EMAIL.doctor1)?.id as string;
  const staffId = h.seed.users.find((u) => u.email === helpers.SEED_EMAIL.staff)?.id;
  const clinicId = h.seed.clinics[0]?.id as string;
  const owner = (sql: string, p: unknown[] = []) => h.db.owner.query(sql, p);
  const patient = (
    await owner('SELECT id, phone FROM mock_clinicos_patient WHERE clinic_id = $1 LIMIT 1', [
      clinicId,
    ])
  ).rows[0] as { id: string; phone: string };
  const medicine = (
    await owner(
      `INSERT INTO medicine_master (generic_name, strength, dose_form, source, source_page) VALUES ('toy-medicine-wm','10 mg','tablet','TOY',1) RETURNING id`,
    )
  ).rows[0]?.id as string;
  const mock = new provider.MockWhatsApp();
  h.services.whatsapp = mock;

  const fresh = async (opts: { sign: boolean; consent: boolean }) => {
    const session = (
      await owner(
        `INSERT INTO consultation_session (clinicos_patient_id, clinicos_doctor_id, clinicos_clinic_id) VALUES ($1,$2,$3) RETURNING id`,
        [patient.id, doctorId, clinicId],
      )
    ).rows[0]?.id as string;
    const call = (method: 'get' | 'post', path: string, body?: object, token = doctor) => {
      const r = request(h.app)
        [method](`/api/v1/sessions/${session}${path}`)
        .set(...helpers.bearer(token));
      return body ? r.send(body) : r;
    };
    if (opts.sign) {
      const { resetSignThrottle } = await import('../src/visits/service.js');
      resetSignThrottle();
      await call('post', '/prescription/items', {
        medicineId: medicine,
        frequency: 'BD',
        duration: '5 days',
        dose: '1 tablet',
      });
      await call('post', '/sign', { password, safetyNotRunAcknowledged: true });
    }
    if (opts.consent) {
      await owner(
        `INSERT INTO consent_event (session_id, clinic_id, scope, granted, notice_version, notice_language, source, recorded_by_user_id, recorded_by_role, ts)
         VALUES ($1,$2,'whatsapp',true,'0.1','en','staff',$3,'staff',now())`,
        [session, clinicId, staffId],
      );
    }
    const draft = (token = doctor) =>
      call(
        'post',
        '/whatsapp/summary',
        { warningSigns: 'toy warning', followUp: 'toy follow-up' },
        token,
      );
    return { session, call, draft };
  };
  const ok = (status: number) => status >= 200 && status < 300;

  // 1) an unsigned visit
  {
    const s = await fresh({ sign: false, consent: true });
    if (ok((await s.draft()).status)) found.push('a summary was made for an unsigned visit');
  }
  // 2) no WhatsApp consent: draft, approve and send must all be refused
  {
    const s = await fresh({ sign: true, consent: false });
    const r = [
      (await s.draft()).status,
      (await s.call('post', '/whatsapp/approve', {})).status,
      (await s.call('post', '/whatsapp/send', {})).status,
    ];
    if (r.some(ok) || mock.sent.length > 0) found.push('WhatsApp consent was not required');
  }
  // 3) a generator that writes the wrong strength must be caught by the mismatch detector
  {
    const s = await fresh({ sign: true, consent: true });
    g.__badGenerator = true;
    try {
      if (ok((await s.draft()).status))
        found.push('a summary that differs from the signed visit was accepted');
    } finally {
      g.__badGenerator = false;
    }
  }
  // 4) a send without approval
  {
    const before = mock.sent.length;
    const s = await fresh({ sign: true, consent: true });
    await s.draft();
    if (ok((await s.call('post', '/whatsapp/send', {})).status) || mock.sent.length > before)
      found.push('a summary was sent without approval');
  }
  // 5) text changed after approval must not be sent
  {
    const before = mock.sent.length;
    const s = await fresh({ sign: true, consent: true });
    await s.draft();
    await s.call('post', '/whatsapp/approve', {});
    await owner(
      `UPDATE whatsapp_summary SET params = jsonb_set(params, '{p3}', '"changed after approval"'), text_gu = replace(text_gu, 'toy warning', 'changed after approval') WHERE session_id = $1`,
      [s.session],
    );
    await s.call('post', '/whatsapp/send', {});
    if (mock.sent.length > before) found.push('text changed after approval was sent');
  }
  // 6) real WhatsApp must not reach a number that is not on the allowlist
  {
    const s = await fresh({ sign: true, consent: true });
    await s.draft();
    await s.call('post', '/whatsapp/approve', {});
    const spy = vi.fn(
      async () => new Response(JSON.stringify({ messages: [{ id: 'wamid.X' }] }), { status: 200 }),
    );
    h.services.whatsapp = new provider.MetaWhatsApp(
      {
        accessToken: 'test-token',
        phoneNumberId: '1',
        apiVersion: 'v-test',
        allowlist: ['919999900001'],
      },
      spy as unknown as typeof fetch,
    );
    await s.call('post', '/whatsapp/send', {});
    if (spy.mock.calls.length > 0)
      found.push('a message went to a number that is not on the allowlist');
    h.services.whatsapp = mock;
  }
  // 7) a webhook with a bad signature
  {
    const body = JSON.stringify({ entry: [] });
    const res = await request(h.app)
      .post('/api/v1/webhooks/whatsapp')
      .set('Content-Type', 'application/json')
      .set(
        'X-Hub-Signature-256',
        `sha256=${createHmac('sha256', 'wrong').update(body).digest('hex')}`,
      )
      .send(body);
    if (ok(res.status)) found.push('a webhook with a bad signature was accepted');
  }
  // 8) a STOP reply must withdraw the WhatsApp consent
  {
    const s = await fresh({ sign: true, consent: true });
    await s.draft();
    await s.call('post', '/whatsapp/approve', {});
    h.services.whatsapp = {
      name: 'meta',
      send: async () => ({ ok: true, providerMessageId: 'wamid.MUT', error: null }),
    };
    await s.call('post', '/whatsapp/send', {});
    h.services.whatsapp = mock;
    const body = JSON.stringify({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  { from: `91${patient.phone}`, id: 'in', type: 'text', text: { body: 'STOP' } },
                ],
              },
            },
          ],
        },
      ],
    });
    await request(h.app)
      .post('/api/v1/webhooks/whatsapp')
      .set('Content-Type', 'application/json')
      .set(
        'X-Hub-Signature-256',
        `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`,
      )
      .send(body);
    const state = (await s.call('get', '/whatsapp')).body.data;
    if (state?.whatsappConsent !== false)
      found.push('a STOP reply did not withdraw the WhatsApp consent');
  }
  // 9) another doctor must not use this doctor's session
  {
    const s = await fresh({ sign: true, consent: true });
    if (ok((await s.draft(doctor2)).status))
      found.push("another doctor could use this doctor's session");
  }
  return found;
}

const open: Harness[] = [];
afterEach(async () => {
  while (open.length) await open.pop()?.close();
  vi.resetModules();
});

describe('the unmodified WhatsApp gates hold', () => {
  it('finds no violation', async () => {
    const { helpers, h } = await build('none');
    open.push(h);
    expect(await violations(helpers, h)).toEqual([]);
  });
});

describe('each WhatsApp gate, when broken, is caught', () => {
  it.each([
    ['no-sign-gate', 'a summary was made for an unsigned visit'],
    ['no-consent-gate', 'WhatsApp consent was not required'],
    ['detector-off', 'a summary that differs from the signed visit was accepted'],
    ['send-approves-itself', 'a summary was sent without approval'],
    ['no-hash-check', 'text changed after approval was sent'],
    ['no-allowlist', 'a message went to a number that is not on the allowlist'],
    ['bad-signature-accepted', 'a webhook with a bad signature was accepted'],
    ['stop-ignored', 'a STOP reply did not withdraw the WhatsApp consent'],
    ['no-session-scoping', "another doctor could use this doctor's session"],
  ] as const)('%s', async (mutation, expected) => {
    const { helpers, h } = await build(mutation);
    open.push(h);
    expect(await violations(helpers, h)).toContain(expected);
  });
});
