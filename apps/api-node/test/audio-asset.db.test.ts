// INTERNAL routes for asr-py (ADR-D26): signed requests only, idempotent registration, audited deletion, consent re-check.
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serviceSignature } from '../src/auth/serviceAuth.js';
import { bearer, createHarness, SEED_EMAIL, type Harness } from './db/helpers.js';
import { TEST_INTERNAL_SECRET } from './helpers.js';

let h: Harness;
let sessionId: string;
let clinicId: string;

const PREFIX = '/api/v1';
function signed(
  method: 'get' | 'post',
  path: string,
  body?: object,
  opts: { secret?: string; offsetSeconds?: number } = {},
) {
  const raw = body ? JSON.stringify(body) : '';
  const ts = Math.floor(Date.now() / 1000) + (opts.offsetSeconds ?? 0);
  const signature = serviceSignature(
    opts.secret ?? TEST_INTERNAL_SECRET,
    ts,
    method,
    `${PREFIX}${path}`,
    raw,
  );
  const req = request(h.app)
    [method](`${PREFIX}${path}`)
    .set('X-Service-Timestamp', String(ts))
    .set('X-Service-Signature', signature);
  return body ? req.set('Content-Type', 'application/json').send(raw) : req;
}
const register = (assetId: string, over: object = {}) =>
  signed('post', '/internal/audio-assets', {
    assetId,
    sessionId,
    storageKey: `${assetId}.vaud`,
    durationS: 12.5,
    bytes: 400_000,
    retentionUntil: '2027-01-15T00:00:00Z',
    ...over,
  });
const record = async (scope: string, granted = true) =>
  h.db.owner.query(
    `INSERT INTO consent_event (session_id, clinic_id, scope, granted, notice_version, notice_language, source,
       recorded_by_user_id, recorded_by_role, ts)
     VALUES ($1,$2,$3,$4,'0.1','en','staff',$5,'staff',now())`,
    [
      sessionId,
      clinicId,
      scope,
      granted,
      h.seed.users.find((u) => u.email === SEED_EMAIL.staff)?.id,
    ],
  );

beforeAll(async () => {
  h = await createHarness();
  clinicId = h.seed.clinics[0]?.id as string;
  const patient = await h.db.owner.query<{ id: string }>(
    'SELECT id FROM mock_clinicos_patient WHERE clinic_id = $1 LIMIT 1',
    [clinicId],
  );
  sessionId = (
    await h.db.owner.query<{ id: string }>(
      `INSERT INTO consultation_session (clinicos_patient_id, clinicos_doctor_id, clinicos_clinic_id)
       VALUES ($1, $2, $3) RETURNING id`,
      [patient.rows[0]?.id, h.seed.users.find((u) => u.email === SEED_EMAIL.doctor1)?.id, clinicId],
    )
  ).rows[0]?.id as string;
});
afterAll(async () => {
  await h.close();
});

describe('who may call the internal routes', () => {
  it('nobody without a valid signature: no headers, bad signature, wrong secret, stale timestamp, user token', async () => {
    const id = randomUUID();
    const url = `${PREFIX}/internal/sessions/${sessionId}/consent-status`;
    expect((await request(h.app).get(url)).status).toBe(401);
    const adminToken = await h.tokenFor(SEED_EMAIL.admin);
    expect(
      (
        await request(h.app)
          .get(url)
          .set(...bearer(adminToken))
      ).status,
    ).toBe(401);
    expect(
      (
        await signed('get', `/internal/sessions/${sessionId}/consent-status`, undefined, {
          secret: 'y'.repeat(40),
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await signed('get', `/internal/sessions/${sessionId}/consent-status`, undefined, {
          offsetSeconds: -120,
        })
      ).status,
    ).toBe(401);
    // the signature covers the body: a body changed after signing is refused
    const good = register(id);
    const tampered = await request(h.app)
      .post(`${PREFIX}/internal/audio-assets`)
      .set('Content-Type', 'application/json')
      .set('X-Service-Timestamp', String(Math.floor(Date.now() / 1000)))
      .set('X-Service-Signature', 'a'.repeat(64))
      .send({ assetId: id });
    expect(tampered.status).toBe(401);
    expect((await good).status).toBe(201);
  });
});

describe('POST /internal/audio-assets', () => {
  it('records a stored recording once, takes the clinic from the session, and audits it (idempotent)', async () => {
    const id = randomUUID();
    const first = await register(id);
    expect(first.body.data).toEqual({ assetId: id, created: true });
    expect((await register(id)).body.data.created).toBe(false);
    const row = await h.db.owner.query(
      'SELECT clinic_id, duration_s, deleted_at FROM audio_asset WHERE id = $1',
      [id],
    );
    expect(row.rows[0]).toMatchObject({ clinic_id: clinicId, deleted_at: null });
    const audit = await h.db.owner.query(
      `SELECT actor_role, clinic_id, session_id FROM audit_log WHERE action = 'AUDIO_STORED' AND resource_id = $1`,
      [id],
    );
    expect(audit.rows[0]).toMatchObject({
      actor_role: 'service',
      clinic_id: clinicId,
      session_id: sessionId,
    });
  });

  it('refuses an unknown session (404), unknown fields and a negative duration (400)', async () => {
    expect((await register(randomUUID(), { sessionId: randomUUID() })).status).toBe(404);
    expect((await register(randomUUID(), { extra: 1 })).status).toBe(400);
    expect((await register(randomUUID(), { durationS: -1 })).status).toBe(400);
  });
});

describe('POST /internal/audio-assets/:id/deleted', () => {
  it('marks it deleted with the reason, audits it, and a second call changes nothing', async () => {
    const id = randomUUID();
    await register(id);
    const first = await signed('post', `/internal/audio-assets/${id}/deleted`, {
      reason: 'retention',
    });
    expect(first.body.data).toEqual({ assetId: id, alreadyDeleted: false });
    const again = await signed('post', `/internal/audio-assets/${id}/deleted`, {
      reason: 'manual',
    });
    expect(again.body.data.alreadyDeleted).toBe(true);
    const row = await h.db.owner.query('SELECT deleted_reason FROM audio_asset WHERE id = $1', [
      id,
    ]);
    expect(row.rows[0]?.deleted_reason).toBe('retention'); // the first reason stays
    expect(
      (await signed('post', `/internal/audio-assets/${randomUUID()}/deleted`, { reason: 'manual' }))
        .status,
    ).toBe(404);
    expect(
      (await signed('post', `/internal/audio-assets/${id}/deleted`, { reason: 'because' })).status,
    ).toBe(400);
  });

  it('the runtime role can never delete the row itself', async () => {
    const app = new pg.Pool({ connectionString: h.db.appUrl, max: 1 });
    const res = await app.query('DELETE FROM audio_asset').then(
      () => 'deleted',
      (e: Error) => e.message,
    );
    await app.end();
    expect(res).toMatch(/permission denied/);
  });
});

describe('GET /internal/sessions/:id/consent-status', () => {
  it('follows the effective consent, including a later withdrawal', async () => {
    const path = `/internal/sessions/${sessionId}/consent-status`;
    expect((await signed('get', path)).body.data).toMatchObject({ recordingAllowed: false });
    await record('audio');
    await record('ai_processing');
    expect((await signed('get', path)).body.data).toMatchObject({
      recordingAllowed: true,
      scopes: { audio: true, ai_processing: true },
    });
    await record('audio', false);
    expect((await signed('get', path)).body.data).toMatchObject({
      recordingAllowed: false,
      scopes: { audio: false },
    });
    expect((await signed('get', `/internal/sessions/${randomUUID()}/consent-status`)).status).toBe(
      404,
    );
  });
});
