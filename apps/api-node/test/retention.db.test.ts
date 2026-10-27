// Retention end to end on the api-node side (Phase 12B Run 2, ADR-D45; PRD NFR-PRIV-01): when the speech service has deleted old
// audio it reports the deletion; the report is audited, the signed record is not touched, and young audio is not marked. A
// consent withdrawal removes the draft transcript, heard facts and the audio's right to exist (the speech service deletes the
// file at its next run: apps/asr-py/tests/test_storage.py), while the signed record stays. Fake data only.
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serviceSignature } from '../src/auth/serviceAuth.js';
import { resetSignThrottle } from '../src/visits/service.js';
import { bearer, createHarness, SEED_EMAIL, type Harness } from './db/helpers.js';
import { TEST_INTERNAL_SECRET } from './helpers.js';

const PREFIX = '/api/v1';
let h: Harness;
let doctor: string;
let staff: string;
let clinicId: string;
let doctorId: string;
let staffId: string;
let patientId: string;
let medicineId: string;

const owner = (sql: string, p: unknown[] = []) => h.db.owner.query(sql, p);
const PW = () => h.passwords[SEED_EMAIL.doctor1] as string;
const service = (method: 'get' | 'post', path: string, body?: object) => {
  const raw = body ? JSON.stringify(body) : '';
  const ts = Math.floor(Date.now() / 1000);
  const req = request(h.app)
    [method](`${PREFIX}${path}`)
    .set('X-Service-Timestamp', String(ts))
    .set(
      'X-Service-Signature',
      serviceSignature(TEST_INTERNAL_SECRET, ts, method, `${PREFIX}${path}`, raw),
    );
  return body ? req.set('Content-Type', 'application/json').send(raw) : req;
};
const scope = (session: string, name: string, granted: boolean) =>
  owner(
    `INSERT INTO consent_event (session_id, clinic_id, scope, granted, notice_version, notice_language, source,
       recorded_by_user_id, recorded_by_role, ts) VALUES ($1,$2,$3,$4,'0.1','en','staff',$5,'staff',now())`,
    [session, clinicId, name, granted, staffId],
  );
const asset = async (session: string, retentionUntil: string): Promise<string> => {
  const id = randomUUID();
  const res = await service('post', '/internal/audio-assets', {
    assetId: id,
    sessionId: session,
    storageKey: `${id}.vaud`,
    durationS: 30,
    bytes: 1000,
    retentionUntil,
  });
  expect(res.status).toBe(201);
  return id;
};
/** a session with a signed visit: one confirmed manual fact, one medicine, signed with the doctor's password */
const signedSession = async (): Promise<string> => {
  resetSignThrottle();
  const s = (
    await owner(
      `INSERT INTO consultation_session (clinicos_patient_id, clinicos_doctor_id, clinicos_clinic_id) VALUES ($1,$2,$3) RETURNING id`,
      [patientId, doctorId, clinicId],
    )
  ).rows[0]?.id as string;
  await owner(
    `INSERT INTO extracted_fact (session_id, clinic_id, type, value, source, status, pipeline, confirmed_at, confirmed_by)
     VALUES ($1,$2,'symptom','toy symptom','manual','confirmed','manual',now(),$3)`,
    [s, clinicId, doctorId],
  );
  await request(h.app)
    .post(`${PREFIX}/sessions/${s}/prescription/items`)
    .set(...bearer(doctor))
    .send({ medicineId, frequency: 'BD', duration: '5 days', dose: '1 tablet' });
  const signed = await request(h.app)
    .post(`${PREFIX}/sessions/${s}/sign`)
    .set(...bearer(doctor))
    .send({ password: PW(), safetyNotRunAcknowledged: true });
  expect(signed.status).toBe(201);
  return s;
};
const snapshot = async (session: string) =>
  JSON.stringify([
    (
      await owner(
        'SELECT status, current_version, signed_at, updated_at FROM visit_record WHERE session_id = $1',
        [session],
      )
    ).rows,
    (
      await owner(
        'SELECT version, content_hash, signed_at FROM visit_record_version WHERE session_id = $1 ORDER BY version',
        [session],
      )
    ).rows,
    (
      await owner(
        'SELECT value, status FROM extracted_fact WHERE session_id = $1 ORDER BY created_at',
        [session],
      )
    ).rows,
    (
      await owner(
        'SELECT name, frequency, duration FROM prescription_item WHERE session_id = $1 ORDER BY position',
        [session],
      )
    ).rows,
  ]);

beforeAll(async () => {
  h = await createHarness();
  doctor = await h.tokenFor(SEED_EMAIL.doctor1);
  staff = await h.tokenFor(SEED_EMAIL.staff);
  clinicId = h.seed.clinics[0]?.id as string;
  doctorId = h.seed.users.find((u) => u.email === SEED_EMAIL.doctor1)?.id as string;
  staffId = h.seed.users.find((u) => u.email === SEED_EMAIL.staff)?.id as string;
  patientId = (
    await owner('SELECT id FROM mock_clinicos_patient WHERE clinic_id = $1 LIMIT 1', [clinicId])
  ).rows[0]?.id as string;
  medicineId = (
    await owner(
      `INSERT INTO medicine_master (generic_name, strength, dose_form, source, source_page)
       VALUES ('toy-medicine-ret','10 mg','tablet','TOY-LIST 1',5) RETURNING id`,
    )
  ).rows[0]?.id as string;
});
afterAll(async () => {
  await h.close();
});

describe('retention', () => {
  it('old audio is reported deleted and audited; young audio is untouched; the signed record does not change', async () => {
    const s = await signedSession();
    const old = await asset(s, '2026-01-01T00:00:00Z'); // past its retention date
    const young = await asset(s, '2027-12-31T00:00:00Z');
    const before = await snapshot(s);
    // what the speech service does for the old file after it has deleted it (apps/asr-py/app/purge.py)
    const done = await service('post', `/internal/audio-assets/${old}/deleted`, {
      reason: 'retention',
    });
    expect(done.status).toBe(200);
    const rows = (
      await owner('SELECT id, deleted_at, deleted_reason FROM audio_asset WHERE session_id = $1', [
        s,
      ])
    ).rows;
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId[old].deleted_at).not.toBeNull();
    expect(byId[old].deleted_reason).toBe('retention');
    expect(byId[young].deleted_at).toBeNull();
    const audit = (
      await owner(
        `SELECT actor_role, meta FROM audit_log WHERE action = 'AUDIO_PURGED' AND resource_id = $1`,
        [old],
      )
    ).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0]?.actor_role).toBe('service');
    expect(JSON.stringify(audit[0]?.meta)).toContain('retention');
    expect(
      (
        await owner(`SELECT 1 FROM audit_log WHERE action = 'AUDIO_PURGED' AND resource_id = $1`, [
          young,
        ])
      ).rowCount,
    ).toBe(0);
    expect(await snapshot(s)).toBe(before);
  });
});

describe('consent withdrawal', () => {
  it('removes the draft transcript, heard facts and the permission for the audio; the signed record stays; the later purge is audited', async () => {
    const s = await signedSession();
    await scope(s, 'audio', true);
    await scope(s, 'ai_processing', true);
    const recording = await asset(s, '2027-12-31T00:00:00Z');
    const seg = (
      await owner(
        `INSERT INTO transcript_segment (session_id, clinic_id, seq, speaker, original_text, status, engine, engine_version)
         VALUES ($1,$2,0,'patient','toy draft words','draft','mock','1') RETURNING id`,
        [s, clinicId],
      )
    ).rows[0]?.id as string;
    await owner(
      `INSERT INTO extracted_fact (session_id, clinic_id, type, value, source, source_segment_id, span_start, span_end,
         evidence_quote, match_type, segment_text_hash, status, pipeline)
       VALUES ($1,$2,'symptom','toy heard symptom','extracted',$3,0,3,'toy','exact',$4,'heard','grounded')`,
      [s, clinicId, seg, 'a'.repeat(64)],
    );
    const before = await snapshot(s);
    const confirmedBefore = (
      await owner(
        `SELECT count(*)::int AS n FROM extracted_fact WHERE session_id = $1 AND status = 'confirmed'`,
        [s],
      )
    ).rows[0]?.n;
    // the speech service asks api-node before every purge run
    const open = await service('get', `/internal/sessions/${s}/consent-status`);
    expect(open.body.data.scopes.audio).toBe(true);
    const out = await request(h.app)
      .post(`${PREFIX}/sessions/${s}/consent/withdraw`)
      .set(...bearer(staff))
      .send({ source: 'patient' });
    expect(out.status).toBe(200);
    expect(out.body.data.stopRecording).toBe(true);
    const closed = await service('get', `/internal/sessions/${s}/consent-status`);
    expect(closed.body.data.scopes.audio).toBe(false); // apps/asr-py/tests/test_storage.py: this deletes the file
    expect(
      (await owner('SELECT count(*)::int AS n FROM transcript_segment WHERE session_id = $1', [s]))
        .rows[0]?.n,
    ).toBe(0);
    expect(
      (
        await owner(
          `SELECT count(*)::int AS n FROM extracted_fact WHERE session_id = $1 AND status <> 'confirmed'`,
          [s],
        )
      ).rows[0]?.n,
    ).toBe(0);
    expect(
      (
        await owner(
          `SELECT count(*)::int AS n FROM extracted_fact WHERE session_id = $1 AND status = 'confirmed'`,
          [s],
        )
      ).rows[0]?.n,
    ).toBe(confirmedBefore);
    // the file is gone at the next purge run, which reports it with the reason
    expect(
      (
        await service('post', `/internal/audio-assets/${recording}/deleted`, {
          reason: 'consent_withdrawn',
        })
      ).status,
    ).toBe(200);
    const audit = (
      await owner(`SELECT meta FROM audit_log WHERE action = 'AUDIO_PURGED' AND resource_id = $1`, [
        recording,
      ])
    ).rows;
    expect(JSON.stringify(audit[0]?.meta)).toContain('consent_withdrawn');
    // the signed record: same versions, same hashes, same medicines (the confirmed fact is part of it)
    const after = JSON.parse(await snapshot(s)) as unknown[][];
    const beforeParsed = JSON.parse(before) as unknown[][];
    expect(after[0]).toEqual(beforeParsed[0]);
    expect(after[1]).toEqual(beforeParsed[1]);
    expect(after[3]).toEqual(beforeParsed[3]);
  });
});
