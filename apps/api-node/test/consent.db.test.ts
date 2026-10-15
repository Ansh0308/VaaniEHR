// Consent (F1): grant, withdraw, effective state, the server-side gate, append-only storage, notice text.
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { authenticate } from '../src/auth/middleware.js';
import { requireConsent } from '../src/consent/requireConsent.js';
import { ok } from '../src/http/respond.js';
import { bearer, createHarness, SEED_EMAIL, type Harness } from './db/helpers.js';

let h: Harness;
let staff: string;
let doctor: string;
let doctor2: string;
let admin: string;
let sid: string;

const grantBody = (scopes: string[], extra: Record<string, unknown> = {}) => ({
  scopes,
  noticeVersion: '0.1',
  noticeLanguage: 'en',
  source: 'staff',
  ...extra,
});

beforeEach(async () => {
  h = await createHarness();
  [staff, doctor, doctor2, admin] = await Promise.all([
    h.tokenFor(SEED_EMAIL.staff),
    h.tokenFor(SEED_EMAIL.doctor1),
    h.tokenFor(SEED_EMAIL.doctor2),
    h.tokenFor(SEED_EMAIL.admin),
  ]);
  const created = await request(h.app)
    .post('/api/v1/sessions')
    .set(...bearer(doctor))
    .send({ patientId: h.seed.patients[0]?.id });
  sid = created.body.data.id as string;
});
afterEach(async () => {
  await h.close();
});

const grant = (token: string, body: unknown, id = sid) =>
  request(h.app)
    .post(`/api/v1/sessions/${id}/consent`)
    .set(...bearer(token))
    .send(body as object);
const withdraw = (token: string, body: unknown, id = sid) =>
  request(h.app)
    .post(`/api/v1/sessions/${id}/consent/withdraw`)
    .set(...bearer(token))
    .send(body as object);
const state = async (token = doctor, id = sid) =>
  (
    await request(h.app)
      .get(`/api/v1/sessions/${id}/consent`)
      .set(...bearer(token))
  ).body.data;
const auditCount = async (action: string) =>
  Number(
    (
      await h.db.owner.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM audit_log WHERE action = $1',
        [action],
      )
    ).rows[0]?.n,
  );

describe('effective consent', () => {
  it('starts with nothing granted and recording not allowed', async () => {
    const s = await state();
    expect(s.recordingAllowed).toBe(false);
    expect(s.whatsappAllowed).toBe(false);
    for (const scope of ['audio', 'ai_processing', 'whatsapp'])
      expect(s.scopes[scope].granted).toBe(false);
    expect(s.events).toEqual([]);
  });

  it('FR-F1-01: recording needs BOTH audio and ai_processing', async () => {
    expect((await grant(staff, grantBody(['audio']))).body.data.recordingAllowed).toBe(false);
    expect((await state()).recordingAllowed).toBe(false);
    const both = await grant(staff, grantBody(['ai_processing']));
    expect(both.status).toBe(201);
    expect(both.body.data.recordingAllowed).toBe(true);
    expect((await state()).recordingAllowed).toBe(true);
  });

  it('FR-F1-03: WhatsApp is a separate scope and does not unlock recording (or vice versa)', async () => {
    await grant(staff, grantBody(['whatsapp']));
    const s = await state();
    expect(s.whatsappAllowed).toBe(true);
    expect(s.recordingAllowed).toBe(false);
    await grant(staff, grantBody(['audio', 'ai_processing']));
    expect((await state()).whatsappAllowed).toBe(true);
  });

  it('FR-F1-02: records notice version, language, source, who recorded it, and a server timestamp', async () => {
    const before = Date.now();
    await grant(
      staff,
      grantBody(['audio'], { noticeLanguage: 'gu', source: 'patient', ts: '1999-01-01T00:00:00Z' }),
    );
    const s = await state();
    expect(s.scopes.audio).toMatchObject({
      granted: true,
      noticeVersion: '0.1',
      noticeLanguage: 'gu',
      source: 'patient',
    });
    const ts = Date.parse(s.scopes.audio.since);
    expect(ts).toBeGreaterThanOrEqual(before - 1000);
    expect(ts).toBeLessThanOrEqual(Date.now() + 1000); // a client-supplied timestamp is ignored
    const row = (await h.db.owner.query('SELECT * FROM consent_event')).rows[0];
    expect(row.recorded_by_role).toBe('staff');
    expect(row.recorded_by_user_id).toBe(h.seed.users.find((u) => u.role === 'staff')?.id);
  });

  it('staff, admin AND doctor may capture consent (ADR-D20: PG-05 and Journey A)', async () => {
    expect((await grant(staff, grantBody(['audio']))).status).toBe(201);
    expect((await grant(admin, grantBody(['ai_processing']))).status).toBe(201);
    expect((await grant(doctor, grantBody(['whatsapp']))).status).toBe(201);
    expect((await state()).events.map((e: { recordedByRole: string }) => e.recordedByRole)).toEqual(
      ['staff', 'admin', 'doctor'],
    );
  });

  it('researchers cannot read or change consent (403)', async () => {
    const researcher = await h.tokenFor(SEED_EMAIL.researcher);
    expect((await grant(researcher, grantBody(['audio']))).status).toBe(403);
    expect((await withdraw(researcher, { source: 'staff' })).status).toBe(403);
    expect(
      (
        await request(h.app)
          .get(`/api/v1/sessions/${sid}/consent`)
          .set(...bearer(researcher))
      ).status,
    ).toBe(403);
  });
});

describe('grant validation', () => {
  it.each([
    ['no scopes', grantBody([])],
    ['an unknown scope', grantBody(['video'])],
    ['a repeated scope', grantBody(['audio', 'audio'])],
    ['an unknown notice version', grantBody(['audio'], { noticeVersion: '9.9' })],
    ['an unknown language', grantBody(['audio'], { noticeLanguage: 'hi' })],
    ['an unknown source', grantBody(['audio'], { source: 'robot' })],
    ['a missing source', { scopes: ['audio'], noticeVersion: '0.1', noticeLanguage: 'en' }],
  ])('rejects %s (400)', async (_label, body) => {
    const res = await grant(staff, body);
    expect(res.status).toBe(400);
    expect(await state().then((s) => s.events)).toEqual([]);
  });

  it('refuses a bad session id (400), an unknown one (404) and writes nothing', async () => {
    expect((await grant(staff, grantBody(['audio']), 'nope')).status).toBe(400);
    expect(
      (await grant(staff, grantBody(['audio']), '5eed0000-0000-4000-8000-00000000ffff')).status,
    ).toBe(404);
    expect((await h.db.owner.query('SELECT count(*)::int AS n FROM consent_event')).rows[0].n).toBe(
      0,
    );
  });

  it("another doctor cannot touch a doctor's session (404), but staff can capture consent for it", async () => {
    expect((await grant(doctor2, grantBody(['audio']))).status).toBe(404);
    expect(
      (
        await request(h.app)
          .get(`/api/v1/sessions/${sid}/consent`)
          .set(...bearer(doctor2))
      ).status,
    ).toBe(404);
    expect((await grant(staff, grantBody(['audio']))).status).toBe(201);
  });

  it('cannot grant on an ended session (409)', async () => {
    await h.db.owner.query(
      "UPDATE consultation_session SET status = 'ended', ended_at = now() WHERE id = $1",
      [sid],
    );
    expect((await grant(staff, grantBody(['audio']))).status).toBe(409);
  });
});

describe('withdrawal (FR-F1-04)', () => {
  beforeEach(async () => {
    await grant(staff, grantBody(['audio', 'ai_processing', 'whatsapp'], { noticeLanguage: 'gu' }));
  });

  it('withdrawing audio switches recording off and tells the caller to stop recording', async () => {
    const res = await withdraw(doctor, { scopes: ['audio'], source: 'patient' });
    expect(res.status).toBe(200);
    expect(res.body.data.stopRecording).toBe(true);
    expect(res.body.data.recordingAllowed).toBe(false);
    expect(res.body.data.scopes.audio.granted).toBe(false);
    expect(res.body.data.scopes.ai_processing.granted).toBe(true); // untouched
  });

  it('withdrawing only WhatsApp does not stop recording', async () => {
    const res = await withdraw(staff, { scopes: ['whatsapp'], source: 'patient' });
    expect(res.body.data.stopRecording).toBe(false);
    expect(res.body.data.recordingAllowed).toBe(true);
    expect(res.body.data.whatsappAllowed).toBe(false);
  });

  it('with no scopes listed, everything granted is withdrawn', async () => {
    const res = await withdraw(admin, { source: 'patient' });
    expect(res.body.data.scopes.audio.granted).toBe(false);
    expect(res.body.data.scopes.ai_processing.granted).toBe(false);
    expect(res.body.data.scopes.whatsapp.granted).toBe(false);
    expect(res.body.data.stopRecording).toBe(true);
  });

  it('the withdrawal event keeps the notice version and language that were granted', async () => {
    await withdraw(staff, { scopes: ['audio'], source: 'patient' });
    const last = (await h.db.owner.query('SELECT * FROM consent_event WHERE granted = false'))
      .rows[0];
    expect(last).toMatchObject({ notice_version: '0.1', notice_language: 'gu', scope: 'audio' });
  });

  it('withdrawing something that is not granted is a 409 and writes nothing', async () => {
    await withdraw(staff, { source: 'patient' });
    const before = (await h.db.owner.query('SELECT count(*)::int AS n FROM consent_event')).rows[0]
      .n;
    expect((await withdraw(staff, { source: 'patient' })).status).toBe(409);
    expect((await h.db.owner.query('SELECT count(*)::int AS n FROM consent_event')).rows[0].n).toBe(
      before,
    );
  });

  it('is still possible after the session has ended', async () => {
    await h.db.owner.query("UPDATE consultation_session SET status = 'ended' WHERE id = $1", [sid]);
    expect((await withdraw(staff, { source: 'patient' })).status).toBe(200);
  });

  it('consent can be granted again after a withdrawal: the newest event wins, history is kept in order', async () => {
    await withdraw(staff, { scopes: ['audio'], source: 'patient' });
    expect((await state()).scopes.audio.granted).toBe(false);
    await grant(staff, grantBody(['audio']));
    const s = await state();
    expect(s.scopes.audio.granted).toBe(true);
    const audioEvents = s.events.filter((e: { scope: string }) => e.scope === 'audio');
    expect(audioEvents.map((e: { granted: boolean }) => e.granted)).toEqual([true, false, true]);
    const seqs = s.events.map((e: { seq: number }) => e.seq);
    expect(seqs).toEqual([...seqs].sort((a: number, b: number) => a - b));
  });
});

describe('FR-F1-05: every consent event is in the consent log AND the audit log', () => {
  it('one audit row per scope granted and per scope withdrawn, with the scope in the metadata', async () => {
    await grant(staff, grantBody(['audio', 'ai_processing']));
    await withdraw(staff, { scopes: ['audio'], source: 'patient' });
    expect(await auditCount('CONSENT_GRANTED')).toBe(2);
    expect(await auditCount('CONSENT_WITHDRAWN')).toBe(1);
    const metas = (
      await h.db.owner.query(
        "SELECT meta FROM audit_log WHERE action LIKE 'CONSENT_%' ORDER BY seq",
      )
    ).rows;
    expect(metas.map((r) => r.meta.scope)).toEqual(['audio', 'ai_processing', 'audio']);
    const events = (await h.db.owner.query('SELECT count(*)::int AS n FROM consent_event')).rows[0]
      .n;
    expect(events).toBe(3);
  });

  it('a failed request leaves neither a consent event nor an audit row', async () => {
    const auditBefore = (await h.db.owner.query('SELECT count(*)::int AS n FROM audit_log')).rows[0]
      .n;
    await grant(staff, grantBody(['audio'], { noticeVersion: '9.9' }));
    expect((await h.db.owner.query('SELECT count(*)::int AS n FROM audit_log')).rows[0].n).toBe(
      auditBefore,
    );
    expect((await h.db.owner.query('SELECT count(*)::int AS n FROM consent_event')).rows[0].n).toBe(
      0,
    );
  });

  it('the app role cannot rewrite or delete consent history', async () => {
    await grant(staff, grantBody(['audio']));
    await expect(h.appPool.query('UPDATE consent_event SET granted = false')).rejects.toMatchObject(
      { code: '42501' },
    );
    await expect(h.appPool.query('DELETE FROM consent_event')).rejects.toMatchObject({
      code: '42501',
    });
  });
});

describe('requireConsent: the server-side gate for recording routes', () => {
  function gatedApp() {
    return createApp({
      config: h.config,
      authProvider: h.services.auth,
      checkDb: async () => {},
      services: h.services,
      extend: (app) => {
        app.get(
          '/gate/:id',
          authenticate(h.services.auth),
          requireConsent(h.appPool, 'audio', 'ai_processing'),
          (_req, res) => ok(res, { recording: 'would start' }),
        );
        app.use(express.json());
      },
    });
  }
  const gate = (token: string, id = sid) =>
    request(gatedApp())
      .get(`/gate/${id}`)
      .set(...bearer(token));

  it('blocks with 403 CONSENT_REQUIRED when nothing is on record, naming what is missing', async () => {
    const res = await gate(doctor);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CONSENT_REQUIRED');
    expect(res.body.error.message).toContain('audio');
    expect(res.body.error.message).toContain('ai_processing');
  });

  it('still blocks when only one of the two scopes is granted', async () => {
    await grant(staff, grantBody(['audio']));
    const res = await gate(doctor);
    expect(res.status).toBe(403);
    expect(res.body.error.message).toContain('ai_processing');
    expect(res.body.error.message).not.toContain('audio');
  });

  it('opens when both scopes are granted, and closes again the moment either is withdrawn', async () => {
    await grant(staff, grantBody(['audio', 'ai_processing']));
    expect((await gate(doctor)).status).toBe(200);
    await withdraw(staff, { scopes: ['ai_processing'], source: 'patient' });
    expect((await gate(doctor)).status).toBe(403);
  });

  it('WhatsApp consent alone does not open the recording gate', async () => {
    await grant(staff, grantBody(['whatsapp']));
    expect((await gate(doctor)).status).toBe(403);
  });

  it("fails closed for an unknown session, another doctor's session and a missing token", async () => {
    await grant(staff, grantBody(['audio', 'ai_processing']));
    expect((await gate(doctor, '5eed0000-0000-4000-8000-00000000ffff')).status).toBe(404);
    expect((await gate(doctor2)).status).toBe(404);
    expect((await request(gatedApp()).get(`/gate/${sid}`)).status).toBe(401);
  });
});

describe('GET /consent/notice (both languages in one response)', () => {
  const get = (query = '', token = staff) =>
    request(h.app)
      .get(`/api/v1/consent/notice${query}`)
      .set(...bearer(token));

  it('returns the latest version with English AND Gujarati together, for side-by-side display', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body.data.version).toBe('0.1');
    expect(Object.keys(res.body.data.notices).sort()).toEqual(['en', 'gu']);
    expect(res.body.data.notices.en).toMatchObject({ language: 'en', version: '0.1' });
    expect(res.body.data.notices.gu).toMatchObject({ language: 'gu', version: '0.1' });
    expect(res.body.data.notices.gu.body).toMatch(/[઀-૿]/);
  });

  it('keeps the placeholder markers and the Gujarati needs-review flag in the payload', async () => {
    const { en, gu } = (await get()).body.data.notices;
    expect(en.status).toBe('PLACEHOLDER');
    expect(en.body).toMatch(/PLACEHOLDER/);
    expect(en.title).toMatch(/PLACEHOLDER/);
    expect(gu.status).toBe('PLACEHOLDER');
    expect(gu.needsReview).toBe(true);
    for (const scope of ['audio', 'ai_processing', 'whatsapp']) {
      expect(en.scopes[scope].description).toMatch(/PLACEHOLDER/);
      expect(gu.scopes[scope].label.length).toBeGreaterThan(0);
    }
  });

  it('accepts an explicit known version; 404 for an unknown one; 401 without a token', async () => {
    expect((await get('?version=0.1')).status).toBe(200);
    expect((await get('?version=9.9')).status).toBe(404);
    expect((await request(h.app).get('/api/v1/consent/notice')).status).toBe(401);
  });

  it('any signed-in user may read it (it is the text the patient is shown)', async () => {
    for (const token of [staff, doctor, admin]) expect((await get('', token)).status).toBe(200);
  });
});
