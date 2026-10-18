// Saved transcripts (ADR-D28): consent at save time, draft/confirmed, immutability of confirmed text, the withdrawal
// rule, and that the audit log never holds transcript text. Fake words only.
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createHarness, SEED_EMAIL, type Harness } from './db/helpers.js';

let h: Harness;
let doctor: string;
let doctor2: string;
let staff: string;
let sessionId: string;
let clinicId: string;

const url = (suffix = '') => `/api/v1/sessions/${sessionId}/transcript${suffix}`;
const get = (token: string) =>
  request(h.app)
    .get(url())
    .set(...bearer(token));
const put = (token: string, segments: object[]) =>
  request(h.app)
    .put(url('/segments'))
    .set(...bearer(token))
    .send({ segments });
const confirm = (token: string) =>
  request(h.app)
    .post(url('/confirm'))
    .set(...bearer(token));
const seg = (seq: number, over: object = {}) => ({
  seq,
  speaker: 'unknown',
  originalText: `fixture words number ${seq}`,
  editedText: null,
  language: 'gu-IN',
  startMs: seq * 1000,
  endMs: seq * 1000 + 900,
  engine: 'mock',
  engineVersion: '1.0',
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
const withdraw = (token: string) =>
  request(h.app)
    .post(`/api/v1/sessions/${sessionId}/consent/withdraw`)
    .set(...bearer(token))
    .send({ source: 'patient' });

beforeAll(async () => {
  h = await createHarness();
  doctor = await h.tokenFor(SEED_EMAIL.doctor1);
  doctor2 = await h.tokenFor(SEED_EMAIL.doctor2);
  staff = await h.tokenFor(SEED_EMAIL.staff);
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

describe('saving needs consent at that moment', () => {
  it('is refused without audio + ai_processing consent, then works once both are on record', async () => {
    expect((await put(doctor, [seg(0)])).body.error.code).toBe('CONSENT_REQUIRED');
    await record('audio');
    expect((await put(doctor, [seg(0)])).status).toBe(403);
    await record('ai_processing');
    const ok = await put(doctor, [seg(0), seg(1)]);
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ draftCount: 2, confirmedCount: 0 });
  });
});

describe('autosave', () => {
  it('updates by sequence number, keeps the engine text, and an edit equal to it is not an edit', async () => {
    await put(doctor, [seg(0, { speaker: 'doctor', editedText: 'doctor corrected this' })]);
    let rows = (await get(doctor)).body.data.segments;
    expect(rows[0]).toMatchObject({
      speaker: 'doctor',
      editedText: 'doctor corrected this',
      text: 'doctor corrected this',
      originalText: 'fixture words number 0',
      status: 'draft',
    });
    // a client that sends different "original" text cannot rewrite what the engine said
    await put(doctor, [
      seg(0, { originalText: 'rewritten original', editedText: 'fixture words number 0' }),
    ]);
    rows = (await get(doctor)).body.data.segments;
    expect(rows[0]).toMatchObject({ originalText: 'fixture words number 0', editedText: null });
    expect(rows).toHaveLength(2);
  });

  it('checks the body strictly', async () => {
    expect((await put(doctor, [])).status).toBe(400);
    expect((await put(doctor, [seg(0), seg(0)])).status).toBe(400);
    expect((await put(doctor, [seg(0, { speaker: 'nurse' })])).status).toBe(400);
    expect((await put(doctor, [seg(0, { extra: true })])).status).toBe(400);
    expect((await put(doctor, [seg(0, { originalText: 'x'.repeat(4001) })])).status).toBe(400);
    expect(
      (
        await put(
          doctor,
          Array.from({ length: 201 }, (_, i) => seg(i)),
        )
      ).status,
    ).toBe(400);
  });
});

describe('who may use it', () => {
  it("only the session's own doctor: staff 403, another doctor 404", async () => {
    expect((await get(staff)).status).toBe(403);
    expect((await get(doctor2)).status).toBe(404);
    expect((await put(doctor2, [seg(0)])).status).toBe(404);
    expect((await confirm(doctor2)).status).toBe(404);
  });
});

describe('confirming', () => {
  it('turns drafts into confirmed text that can no longer be changed or deleted, even by the database role', async () => {
    const res = await confirm(doctor);
    expect(res.body.data).toMatchObject({ draftCount: 0, confirmedCount: 2 });
    expect(res.body.data.segments.every((s: { confirmedAt: string | null }) => s.confirmedAt)).toBe(
      true,
    );
    expect((await confirm(doctor)).status).toBe(409); // nothing left to confirm
    expect((await put(doctor, [seg(0, { speaker: 'patient' })])).status).toBe(409);
    const app = new pg.Pool({ connectionString: h.db.appUrl, max: 1 });
    const attempt = (sql: string) =>
      app.query(sql, [sessionId]).then(
        () => 'allowed',
        (e: Error) => e.message,
      );
    expect(
      await attempt("UPDATE transcript_segment SET edited_text = 'x' WHERE session_id = $1"),
    ).toMatch(/confirmed/);
    expect(await attempt('DELETE FROM transcript_segment WHERE session_id = $1')).toMatch(
      /confirmed/,
    );
    await app.end();
  });

  it('a draft segment keeps its engine text even if the database is asked to change it', async () => {
    await put(doctor, [seg(5)]);
    const app = new pg.Pool({ connectionString: h.db.appUrl, max: 1 });
    const message = await app
      .query(
        "UPDATE transcript_segment SET original_text = 'changed' WHERE session_id = $1 AND seq = 5",
        [sessionId],
      )
      .then(
        () => 'allowed',
        (e: Error) => e.message,
      );
    await app.end();
    expect(message).toMatch(/cannot be changed/);
  });
});

describe('withdrawal (ADR-D28)', () => {
  it('deletes unconfirmed draft text, keeps confirmed text, audits a count, and saving is refused afterwards', async () => {
    expect((await get(doctor)).body.data).toMatchObject({ draftCount: 1, confirmedCount: 2 });
    const res = await withdraw(doctor);
    expect(res.status).toBe(200);
    const after = (await get(doctor)).body.data;
    expect(after).toMatchObject({ draftCount: 0, confirmedCount: 2 });
    const audit = await h.db.owner.query(
      "SELECT meta FROM audit_log WHERE action = 'TRANSCRIPT_DRAFT_DELETED' AND session_id = $1",
      [sessionId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]?.meta).toEqual({ segmentCount: 1, factCount: 0 });
    expect((await put(doctor, [seg(9)])).body.error.code).toBe('CONSENT_REQUIRED');
    expect((await confirm(doctor)).status).toBe(403);
  });
});

describe('what the audit log holds', () => {
  it('counts and ids only: no transcript text in any transcript audit row', async () => {
    const rows = await h.db.owner.query(
      "SELECT action, resource_type, meta FROM audit_log WHERE action LIKE 'TRANSCRIPT_%'",
    );
    expect(rows.rows.length).toBeGreaterThanOrEqual(4);
    const all = JSON.stringify(rows.rows);
    expect(all).not.toMatch(/fixture words|corrected|rewritten/);
    for (const row of rows.rows) expect(Object.keys(row.meta ?? {})).toContain('segmentCount');
  });

  it('unknown sessions are "not found"', async () => {
    expect(
      (
        await request(h.app)
          .get(`/api/v1/sessions/${randomUUID()}/transcript`)
          .set(...bearer(doctor))
      ).status,
    ).toBe(404);
  });
});
