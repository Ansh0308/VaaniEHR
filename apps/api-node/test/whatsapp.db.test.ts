// The Gujarati WhatsApp summary through the API (Phase 10 Run 1, ADR-D41): the sign gate, the consent gate, drafting from the
// signed snapshot, approval with a hash, sending (mock), the log, failures, the allowlist, the Meta webhook (signature,
// delivery statuses, STOP). Fake data and a fake provider only; nothing leaves the machine.
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MetaWhatsApp, MockWhatsApp, type WhatsAppProvider } from '../src/whatsapp/provider.js';
import { summaryHash, type SummaryParams } from '../src/whatsapp/summary.js';
import { resetSignThrottle } from '../src/visits/service.js';
import { bearer, createHarness, SEED_EMAIL, type Harness } from './db/helpers.js';

const APP_SECRET = 'test-app-secret-not-real';
const VERIFY = 'test-verify-token-not-real';

let h: Harness;
let doctor: string;
let doctor2: string;
let clinicId: string;
let doctorId: string;
let staffId: string;
let patientId: string;
let patientPhone: string;
let medA: string;
let mock: MockWhatsApp;

const PW = () => h.passwords[SEED_EMAIL.doctor1] as string;
const owner = (sql: string, p: unknown[] = []) => h.db.owner.query(sql, p);
const call = (
  method: 'get' | 'post',
  session: string,
  path: string,
  body?: object,
  token = doctor,
) => {
  const r = request(h.app)
    [method](`/api/v1/sessions/${session}${path}`)
    .set(...bearer(token));
  return body ? r.send(body) : r;
};
const consent = (session: string, granted: boolean) =>
  owner(
    `INSERT INTO consent_event (session_id, clinic_id, scope, granted, notice_version, notice_language, source,
       recorded_by_user_id, recorded_by_role, ts) VALUES ($1,$2,'whatsapp',$3,'0.1','en','staff',$4,'staff',now())`,
    [session, clinicId, granted, staffId],
  );
const newSession = async (): Promise<string> =>
  (
    await owner(
      `INSERT INTO consultation_session (clinicos_patient_id, clinicos_doctor_id, clinicos_clinic_id) VALUES ($1,$2,$3) RETURNING id`,
      [patientId, doctorId, clinicId],
    )
  ).rows[0]?.id as string;
/** a session whose visit is signed (a confirmed manual fact and one medicine) */
const signed = async (): Promise<string> => {
  resetSignThrottle();
  const s = await newSession();
  await owner(
    `INSERT INTO extracted_fact (session_id, clinic_id, type, value, source, status, pipeline, confirmed_at, confirmed_by)
     VALUES ($1,$2,'symptom','toy symptom','manual','confirmed','manual',now(),$3)`,
    [s, clinicId, doctorId],
  );
  await call('post', s, '/prescription/items', {
    medicineId: medA,
    frequency: 'BD',
    duration: '5 days',
    dose: '1 tablet',
  });
  expect(
    (await call('post', s, '/sign', { password: PW(), safetyNotRunAcknowledged: true })).status,
  ).toBe(201);
  return s;
};
const draft = (s: string, over: object = {}, token = doctor) =>
  call(
    'post',
    s,
    '/whatsapp/summary',
    { warningSigns: 'toy warning words', followUp: 'toy follow-up words', ...over },
    token,
  );
const audits = async (action: string, session?: string) =>
  (
    await owner(
      `SELECT meta, actor_role FROM audit_log WHERE action = $1 ${session ? 'AND session_id = $2' : ''} ORDER BY seq`,
      session ? [action, session] : [action],
    )
  ).rows;
const hook = (payload: object, secret = APP_SECRET, signature?: string) => {
  const raw = JSON.stringify(payload);
  const sig = signature ?? `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
  return request(h.app)
    .post('/api/v1/webhooks/whatsapp')
    .set('Content-Type', 'application/json')
    .set('X-Hub-Signature-256', sig)
    .send(raw);
};
const wrap = (value: object) => ({
  object: 'whatsapp_business_account',
  entry: [{ id: '1', changes: [{ field: 'messages', value }] }],
});
const fakeMeta = (id: string): WhatsAppProvider => ({
  name: 'meta',
  send: async () => ({ ok: true, providerMessageId: id, error: null }),
});

beforeAll(async () => {
  h = await createHarness({ WHATSAPP_APP_SECRET: APP_SECRET, WHATSAPP_VERIFY_TOKEN: VERIFY });
  doctor = await h.tokenFor(SEED_EMAIL.doctor1);
  doctor2 = await h.tokenFor(SEED_EMAIL.doctor2);
  clinicId = h.seed.clinics[0]?.id as string;
  doctorId = h.seed.users.find((u) => u.email === SEED_EMAIL.doctor1)?.id as string;
  staffId = h.seed.users.find((u) => u.email === SEED_EMAIL.staff)?.id as string;
  const p = (
    await owner('SELECT id, phone FROM mock_clinicos_patient WHERE clinic_id = $1 LIMIT 1', [
      clinicId,
    ])
  ).rows[0];
  patientId = p.id as string;
  patientPhone = p.phone as string;
  medA = (
    await owner(
      `INSERT INTO medicine_master (generic_name, strength, dose_form, source, source_page)
       VALUES ('toy-medicine-wa','10 mg','tablet','TOY-LIST 1',5) RETURNING id`,
    )
  ).rows[0]?.id as string;
  mock = new MockWhatsApp();
});
afterAll(async () => {
  await h.close();
});
const useMock = () => {
  mock = new MockWhatsApp();
  h.services.whatsapp = mock;
};

describe('the sign gate and the consent gate (server side)', () => {
  it('nothing can be drafted, approved or sent before the visit is signed', async () => {
    useMock();
    const s = await newSession();
    await consent(s, true);
    expect((await draft(s)).status).toBe(409);
    expect((await call('post', s, '/whatsapp/approve', {})).status).toBe(409);
    expect((await call('post', s, '/whatsapp/send', {})).status).toBe(409);
    const state = (await call('get', s, '/whatsapp')).body.data;
    expect(state).toMatchObject({
      signedVersion: null,
      whatsappConsent: true,
      summary: null,
      messages: [],
      provider: 'mock',
    });
    expect(mock.sent).toHaveLength(0);
  });

  it('without WhatsApp consent nothing can be drafted, approved or sent, even for a signed visit', async () => {
    useMock();
    const s = await signed();
    for (const [path, body] of [
      ['/whatsapp/summary', { warningSigns: '', followUp: '' }],
      ['/whatsapp/approve', {}],
      ['/whatsapp/send', {}],
    ] as const) {
      const res = await call('post', s, path, body);
      expect(res.status, path).toBe(403);
      expect(res.body.error.code).toBe('CONSENT_REQUIRED');
    }
    expect(mock.sent).toHaveLength(0);
    expect((await call('get', s, '/whatsapp')).body.data).toMatchObject({
      signedVersion: 1,
      whatsappConsent: false,
      safetyNotRun: true,
    });
  });

  it('the consent is checked again at every step: withdrawn after approval, the send is refused', async () => {
    useMock();
    const s = await signed();
    await consent(s, true);
    expect((await draft(s)).status).toBe(201);
    expect((await call('post', s, '/whatsapp/approve', {})).status).toBe(200);
    await consent(s, false);
    const res = await call('post', s, '/whatsapp/send', {});
    expect(res.status).toBe(403);
    expect(mock.sent).toHaveLength(0);
  });
});

describe('drafting from the signed snapshot', () => {
  it('builds the Gujarati text from the snapshot with the doctor-typed free text, as needs review and needs Gujarati review', async () => {
    useMock();
    const s = await signed();
    await consent(s, true);
    const res = await draft(s);
    expect(res.status).toBe(201);
    const d = res.body.data;
    expect(d).toMatchObject({
      version: 1,
      status: 'needs_review',
      needsGujaratiReview: true,
      stale: false,
      textHash: null,
      approvedAt: null,
    });
    expect(d.textGu).toContain(
      '1. toy-medicine-wa 10 mg tablet - 1 tablet, દિવસમાં બે વાર, 5 days',
    );
    expect(d.textGu).toContain('લક્ષણ: toy symptom');
    expect(d.textGu).toContain('toy warning words');
    expect(d.textEn).toContain('twice a day');
    expect(d.warningSigns).toBe('toy warning words');
    expect((await audits('WHATSAPP_SUMMARY_DRAFTED', s))[0]?.meta).toEqual({ version: 1 });
  });

  it('only the two free-text fields can be sent in; anything else is refused, and the draft can be edited until approved', async () => {
    useMock();
    const s = await signed();
    await consent(s, true);
    expect((await draft(s, { medicines: 'x' })).status).toBe(400);
    expect((await call('post', s, '/whatsapp/summary', { warningSigns: 'a' })).status).toBe(400);
    await draft(s);
    const edited = await draft(s, { followUp: 'changed follow-up' });
    expect(edited.status).toBe(201);
    expect(edited.body.data.textGu).toContain('changed follow-up');
    expect(
      (await owner('SELECT count(*)::int AS n FROM whatsapp_summary WHERE session_id = $1', [s]))
        .rows[0]?.n,
    ).toBe(1);
  });

  it('a text that is too long or has a placeholder is refused in words', async () => {
    useMock();
    const s = await signed();
    await consent(s, true);
    expect((await draft(s, { warningSigns: 'x'.repeat(601) })).status).toBe(400);
    expect((await draft(s, { followUp: 'see {{1}}' })).status).toBe(400);
  });

  it("is the session's own doctor only", async () => {
    useMock();
    const s = await signed();
    await consent(s, true);
    expect((await draft(s, {}, doctor2)).status).toBe(404);
    expect((await call('get', s, '/whatsapp', undefined, doctor2)).status).toBe(404);
  });
});

describe('approval and sending', () => {
  it('approval stores the exact text with a SHA-256; the approved text can no longer change, in the API or the database', async () => {
    useMock();
    const s = await signed();
    await consent(s, true);
    await draft(s);
    const res = await call('post', s, '/whatsapp/approve', {});
    expect(res.status).toBe(200);
    const row = (
      await owner(
        'SELECT params, text_gu, text_hash, status FROM whatsapp_summary WHERE session_id = $1',
        [s],
      )
    ).rows[0];
    expect(row.status).toBe('approved');
    expect(row.text_hash).toBe(summaryHash(row.text_gu as string, row.params as SummaryParams));
    expect(res.body.data.textHash).toBe(row.text_hash);
    expect((await draft(s, { followUp: 'late change' })).status).toBe(409);
    await expect(
      h.appPool.query("UPDATE whatsapp_summary SET follow_up = 'x' WHERE session_id = $1", [s]),
    ).rejects.toThrow(/approved WhatsApp summary cannot be changed/);
    await expect(
      h.appPool.query('DELETE FROM whatsapp_summary WHERE session_id = $1', [s]),
    ).rejects.toThrow(/permission denied|cannot be deleted/);
    expect((await audits('WHATSAPP_SUMMARY_APPROVED', s))[0]?.meta).toEqual({ version: 1 });
  });

  it('sends the approved text to the patient through the mock, logs it without the phone number, and refuses a second send', async () => {
    useMock();
    const s = await signed();
    await consent(s, true);
    await draft(s);
    await call('post', s, '/whatsapp/approve', {});
    const res = await call('post', s, '/whatsapp/send', {});
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      status: 'sent',
      provider: 'mock',
      summaryVersion: 1,
      errorMessage: null,
      recipientLast4: patientPhone.slice(-4),
    });
    expect(mock.sent).toHaveLength(1);
    const sent = mock.sent[0]!;
    expect(sent.toDigits).toBe(`91${patientPhone}`);
    expect(sent.template).toBe('vaaniehr_visit_summary_gu');
    expect(sent.language).toBe('gu');
    const stored = (
      await owner('SELECT params, text_gu FROM whatsapp_summary WHERE session_id = $1', [s])
    ).rows[0];
    expect(sent.params).toEqual(stored.params);
    expect(sent.text).toBe(stored.text_gu);
    const log = (await owner('SELECT * FROM whatsapp_message WHERE session_id = $1', [s])).rows;
    expect(log).toHaveLength(1);
    expect(Object.values(log[0]).map(String)).not.toContain(patientPhone);
    expect(Object.values(log[0]).map(String)).not.toContain(`91${patientPhone}`);
    expect(log[0].channel).toBe('whatsapp');
    expect(log[0].patient_id).toBe(patientId);
    expect((await call('post', s, '/whatsapp/send', {})).status).toBe(409);
    expect(mock.sent).toHaveLength(1);
    const state = (await call('get', s, '/whatsapp')).body.data;
    expect(state.messages).toHaveLength(1);
    expect((await audits('WHATSAPP_SENT', s))[0]?.meta).toEqual({ version: 1, provider: 'mock' });
  });

  it('a draft that was never approved cannot be sent', async () => {
    useMock();
    const s = await signed();
    await consent(s, true);
    await draft(s);
    expect((await call('post', s, '/whatsapp/send', {})).status).toBe(409);
    expect(mock.sent).toHaveLength(0);
  });

  it('an approved text that was tampered with in storage is not sent (hash and snapshot are checked at send time)', async () => {
    useMock();
    const s = await signed();
    await consent(s, true);
    await draft(s);
    await call('post', s, '/whatsapp/approve', {});
    await owner(
      `UPDATE whatsapp_summary SET params = jsonb_set(params, '{p2}', to_jsonb(replace(params->>'p2', '10 mg', '100 mg'))),
              text_gu = replace(text_gu, '10 mg', '100 mg') WHERE session_id = $1`,
      [s],
    );
    const res = await call('post', s, '/whatsapp/send', {});
    expect(res.status).toBe(409);
    expect(mock.sent).toHaveLength(0);
  });

  it('after an amendment the old summary is stale: it cannot be sent, and a new one is needed for the new version', async () => {
    useMock();
    const s = await signed();
    await consent(s, true);
    await draft(s);
    await call('post', s, '/whatsapp/approve', {});
    resetSignThrottle();
    const amend = await call('post', s, '/amend', {
      password: PW(),
      safetyNotRunAcknowledged: true,
      reason: 'toy reason',
      medicines: [{ medicineId: medA, frequency: 'OD', duration: '2 days' }],
    });
    expect(amend.status).toBe(201);
    expect((await call('post', s, '/whatsapp/send', {})).status).toBe(409);
    expect((await call('get', s, '/whatsapp')).body.data).toMatchObject({
      signedVersion: 2,
      summary: null,
    });
    const d2 = await draft(s);
    expect(d2.body.data.version).toBe(2);
    expect(d2.body.data.textGu).toContain('2 days');
  });

  it('a provider failure is recorded as a failed message, audited, not retried; a later send may try again', async () => {
    const s = await signed();
    await consent(s, true);
    await draft(s);
    await call('post', s, '/whatsapp/approve', {});
    const failing = vi.fn(async () => ({
      ok: false,
      providerMessageId: null,
      error: 'WhatsApp could not be reached or timed out.',
    }));
    h.services.whatsapp = { name: 'mock', send: failing };
    const res = await call('post', s, '/whatsapp/send', {});
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      status: 'failed',
      errorMessage: 'WhatsApp could not be reached or timed out.',
    });
    expect(failing).toHaveBeenCalledTimes(1);
    expect(await audits('WHATSAPP_SEND_FAILED', s)).toHaveLength(1);
    useMock();
    expect((await call('post', s, '/whatsapp/send', {})).body.data.status).toBe('sent');
  });

  it('real WhatsApp refuses a number that is not on the allowlist before anything reaches Meta', async () => {
    const s = await signed();
    await consent(s, true);
    await draft(s);
    await call('post', s, '/whatsapp/approve', {});
    const fetchSpy = vi.fn();
    h.services.whatsapp = new MetaWhatsApp(
      {
        accessToken: 'test-token',
        phoneNumberId: '1',
        apiVersion: 'v-test',
        allowlist: ['919999900001'],
      },
      fetchSpy as unknown as typeof fetch,
    );
    const res = await call('post', s, '/whatsapp/send', {});
    expect(res.body.data).toMatchObject({ status: 'failed', provider: 'meta' });
    expect(res.body.data.errorMessage).toMatch(/allowlist/);
    expect(fetchSpy).not.toHaveBeenCalled();
    useMock();
  });
});

describe('the Meta webhook', () => {
  it('answers the verification challenge only with the right token', async () => {
    const ok = await request(h.app)
      .get('/api/v1/webhooks/whatsapp')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY, 'hub.challenge': '12345' });
    expect(ok.status).toBe(200);
    expect(ok.text).toBe('12345');
    for (const q of [
      { 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': '1' },
      { 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY },
      { 'hub.mode': 'other', 'hub.verify_token': VERIFY, 'hub.challenge': '1' },
    ]) {
      expect((await request(h.app).get('/api/v1/webhooks/whatsapp').query(q)).status).toBe(403);
    }
  });

  it('rejects a payload with a missing or wrong signature, changes nothing, and audits the rejection', async () => {
    const before = (await audits('WHATSAPP_WEBHOOK_REJECTED')).length;
    expect((await hook(wrap({ statuses: [] }), 'another-secret')).status).toBe(401);
    expect((await hook(wrap({ statuses: [] }), APP_SECRET, 'sha256=00')).status).toBe(401);
    expect((await hook(wrap({ statuses: [] }), APP_SECRET, 'nonsense')).status).toBe(401);
    const noHeader = await request(h.app)
      .post('/api/v1/webhooks/whatsapp')
      .send(wrap({ statuses: [] }));
    expect(noHeader.status).toBe(401);
    expect((await audits('WHATSAPP_WEBHOOK_REJECTED')).length - before).toBe(4);
    // a body altered after signing no longer matches
    const raw = JSON.stringify(wrap({ statuses: [] }));
    const sig = `sha256=${createHmac('sha256', APP_SECRET).update(raw).digest('hex')}`;
    const tampered = await request(h.app)
      .post('/api/v1/webhooks/whatsapp')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', sig)
      .send(raw.replace('"1"', '"2"'));
    expect(tampered.status).toBe(401);
  });

  it('applies delivery statuses forward only: sent, then delivered, then read; a late delivered does not move it back', async () => {
    const s = await signed();
    await consent(s, true);
    await draft(s);
    await call('post', s, '/whatsapp/approve', {});
    h.services.whatsapp = fakeMeta('wamid.STATUS1');
    expect((await call('post', s, '/whatsapp/send', {})).body.data.status).toBe('sent');
    const status = (st: string, extra: object = {}) =>
      hook(
        wrap({
          statuses: [{ id: 'wamid.STATUS1', status: st, recipient_id: '910000000001', ...extra }],
        }),
      );
    expect((await status('delivered')).body.data).toMatchObject({
      received: true,
      statusUpdates: 1,
    });
    expect((await call('get', s, '/whatsapp')).body.data.messages[0]).toMatchObject({
      status: 'delivered',
    });
    expect((await call('get', s, '/whatsapp')).body.data.messages[0].deliveredAt).not.toBeNull();
    expect((await status('read')).body.data.statusUpdates).toBe(1);
    expect((await status('delivered')).body.data.statusUpdates).toBe(0);
    expect((await status('failed')).body.data.statusUpdates).toBe(0);
    expect((await call('get', s, '/whatsapp')).body.data.messages[0].status).toBe('read');
    expect(
      (await hook(wrap({ statuses: [{ id: 'wamid.UNKNOWN', status: 'delivered' }] }))).body.data
        .statusUpdates,
    ).toBe(0);
    useMock();
  });

  it('a failed status records the error text from WhatsApp', async () => {
    const s = await signed();
    await consent(s, true);
    await draft(s);
    await call('post', s, '/whatsapp/approve', {});
    h.services.whatsapp = fakeMeta('wamid.STATUS2');
    await call('post', s, '/whatsapp/send', {});
    await hook(
      wrap({
        statuses: [
          {
            id: 'wamid.STATUS2',
            status: 'failed',
            errors: [{ code: 131049, title: 'not delivered' }],
          },
        ],
      }),
    );
    expect((await call('get', s, '/whatsapp')).body.data.messages[0]).toMatchObject({
      status: 'failed',
      errorMessage: 'WhatsApp error 131049 not delivered',
    });
    useMock();
  });

  it('a STOP reply withdraws the WhatsApp consent of every session of that patient, audited as the patient; nothing more can be sent', async () => {
    const s1 = await signed();
    const s2 = await newSession();
    await consent(s1, true);
    await consent(s2, true);
    await draft(s1);
    await call('post', s1, '/whatsapp/approve', {});
    h.services.whatsapp = fakeMeta('wamid.STOP1');
    await call('post', s1, '/whatsapp/send', {});
    const reply = (body: string, from = `91${patientPhone}`) =>
      hook(wrap({ messages: [{ from, id: 'wamid.IN1', type: 'text', text: { body } }] }));
    expect((await reply('hello')).body.data.stopReplies).toBe(0);
    expect((await call('get', s1, '/whatsapp')).body.data.whatsappConsent).toBe(true);
    expect((await reply('stop', '919999999999')).body.data.stopReplies).toBe(0); // a number we never wrote to
    expect((await reply('  STOP ')).body.data).toMatchObject({ received: true, stopReplies: 1 });
    for (const s of [s1, s2]) {
      expect((await call('get', s, '/whatsapp')).body.data.whatsappConsent).toBe(false);
      const ev = (
        await owner(
          "SELECT granted, source, recorded_by_role, recorded_by_user_id FROM consent_event WHERE session_id = $1 AND scope = 'whatsapp' ORDER BY seq DESC LIMIT 1",
          [s],
        )
      ).rows[0];
      expect(ev).toEqual({
        granted: false,
        source: 'patient',
        recorded_by_role: 'patient',
        recorded_by_user_id: patientId,
      });
    }
    const withdrawn = await audits('CONSENT_WITHDRAWN', s1);
    expect(withdrawn.at(-1)).toMatchObject({
      actor_role: 'patient',
      meta: { scope: 'whatsapp', source: 'patient', via: 'stop_reply' },
    });
    expect((await audits('WHATSAPP_STOP_RECEIVED')).length).toBeGreaterThan(0);
    expect((await draft(s1)).status).toBe(403);
    // a second STOP finds nothing left to withdraw
    expect((await reply('stop')).body.data.stopReplies).toBe(1);
    expect(
      (
        await owner(
          "SELECT count(*)::int AS n FROM consent_event WHERE session_id = $1 AND scope = 'whatsapp'",
          [s2],
        )
      ).rows[0]?.n,
    ).toBe(2);
    useMock();
  });
});

describe('the message log guard', () => {
  it('only the delivery status can change; nothing can be deleted', async () => {
    useMock();
    const s = await signed();
    await consent(s, true);
    await draft(s);
    await call('post', s, '/whatsapp/approve', {});
    await call('post', s, '/whatsapp/send', {});
    await expect(
      h.appPool.query("UPDATE whatsapp_message SET template = 'x' WHERE session_id = $1", [s]),
    ).rejects.toThrow(/only the delivery status/);
    await expect(
      h.appPool.query('DELETE FROM whatsapp_message WHERE session_id = $1', [s]),
    ).rejects.toThrow(/permission denied|cannot be deleted/);
    await expect(
      h.appPool.query("UPDATE whatsapp_message SET status = 'delivered' WHERE session_id = $1", [
        s,
      ]),
    ).resolves.toBeTruthy();
    await expect(
      h.appPool.query("UPDATE whatsapp_message SET status = 'sent' WHERE session_id = $1", [s]),
    ).rejects.toThrow(/only moves forward/);
  });
});
