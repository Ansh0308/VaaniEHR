// Extracted facts (ADR-D29): evidence constraints, internal submission checks, doctor review, staleness, the withdrawal
// rule and what the audit log holds. Fake words only.
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serviceSignature } from '../src/auth/serviceAuth.js';
import { textHash } from '../src/facts/text.js';
import { bearer, createHarness, SEED_EMAIL, type Harness } from './db/helpers.js';
import { TEST_INTERNAL_SECRET } from './helpers.js';

let h: Harness;
let doctor: string;
let doctor2: string;
let staff: string;
let sessionId: string;
let clinicId: string;
const SEG0 = 'Patient has fever since two days';
const SEG1 = 'No cough at all';
const ids: Record<number, string> = {};

const api = (path: string) => `/api/v1/sessions/${sessionId}${path}`;
const asDoctor = (
  method: 'get' | 'post' | 'put' | 'patch',
  path: string,
  body?: object,
  token = doctor,
) => {
  const r = request(h.app)
    [method](api(path))
    .set(...bearer(token));
  return body ? r.send(body) : r;
};
function internal(method: 'get' | 'post', path: string, body?: object) {
  const raw = body ? JSON.stringify(body) : '';
  const ts = Math.floor(Date.now() / 1000);
  const full = `/api/v1${path}`;
  const r = request(h.app)
    [method](full)
    .set('X-Service-Timestamp', String(ts))
    .set('X-Service-Signature', serviceSignature(TEST_INTERNAL_SECRET, ts, method, full, raw));
  return body ? r.set('Content-Type', 'application/json').send(raw) : r;
}
const fact = (seg: number, quote: string, over: object = {}) => {
  const text = seg === 0 ? SEG0 : SEG1;
  const start = text.indexOf(quote);
  return {
    segmentId: ids[seg],
    type: 'symptom',
    value: quote.toLowerCase(),
    negated: false,
    uncertain: false,
    speaker: 'patient',
    spanStart: start,
    spanEnd: start + quote.length,
    evidenceQuote: quote,
    matchType: 'exact',
    segmentTextHash: textHash(text),
    ...over,
  };
};
const submit = (facts: object[], extra: object = {}) =>
  internal('post', `/internal/sessions/${sessionId}/facts`, {
    runId: randomUUID(),
    pipeline: 'grounded',
    model: 'mock-model',
    droppedUngrounded: 2,
    facts,
    ...extra,
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
const segment = (seq: number, text: string, over: object = {}) => ({
  seq,
  speaker: 'unknown',
  originalText: text,
  editedText: null,
  language: 'en-IN',
  startMs: 0,
  endMs: 900,
  engine: 'mock',
  engineVersion: '1.0',
  ...over,
}); // fmt: skip
const facts = async (status?: string) =>
  (await asDoctor('get', status ? `/facts?status=${status}` : '/facts')).body.data;
const row = async (id: string) =>
  (await h.db.owner.query('SELECT * FROM extracted_fact WHERE id = $1', [id])).rows[0];

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
  await record('audio');
  await record('ai_processing');
  await asDoctor('put', '/transcript/segments', { segments: [segment(0, SEG0), segment(1, SEG1)] });
  const segs = (await internal('get', `/internal/sessions/${sessionId}/transcript-segments`)).body
    .data.segments;
  for (const s of segs) ids[s.seq] = s.segmentId;
});
afterAll(async () => {
  await h.close();
});

describe('the database refuses an extracted fact without its evidence', () => {
  const base = `INSERT INTO extracted_fact (session_id, clinic_id, type, value, source, source_segment_id, span_start, span_end, evidence_quote, match_type, segment_text_hash, pipeline) VALUES `;
  const hash = 'a'.repeat(64);
  const attempt = (
    segmentId: string | null,
    start: number | null,
    end: number | null,
    quote: string | null,
  ) =>
    h.db.owner
      .query(`${base} ($1,$2,'symptom','x','extracted',$3,$4,$5,$6,'exact',$7,'grounded')`, [
        sessionId,
        clinicId,
        segmentId,
        start,
        end,
        quote,
        hash,
      ])
      .then(
        () => 'inserted',
        (e: Error) => e.message,
      );
  it('no segment, no span, an empty span, no quote: each is refused; a complete one is accepted', async () => {
    for (const bad of [
      await attempt(null, 0, 3, 'abc'),
      await attempt(ids[0] as string, null, 3, 'abc'),
      await attempt(ids[0] as string, 5, 5, 'abc'),
      await attempt(ids[0] as string, 0, 3, null),
    ])
      expect(bad).toMatch(/extracted_fact_needs_evidence|violates/);
    expect(await attempt(ids[0] as string, 0, 3, 'Pat')).toBe('inserted');
    await h.db.owner.query("DELETE FROM extracted_fact WHERE value = 'x'");
  });
  it('a manual fact needs no span, but it is flagged manual', async () => {
    const r = await h.db.owner.query(
      "INSERT INTO extracted_fact (session_id, clinic_id, type, value, source, pipeline) VALUES ($1,$2,'symptom','m','manual','manual') RETURNING id",
      [sessionId, clinicId],
    );
    expect(r.rows).toHaveLength(1);
    await h.db.owner.query("DELETE FROM extracted_fact WHERE value = 'm'");
  });
});

describe('the internal routes', () => {
  it('give the model only ids, order, speaker and text', async () => {
    const res = await internal('get', `/internal/sessions/${sessionId}/transcript-segments`);
    expect(res.body.data.segments).toHaveLength(2);
    expect(Object.keys(res.body.data.segments[0]).sort()).toEqual([
      'segmentId',
      'seq',
      'speaker',
      'text',
    ]);
    expect(JSON.stringify(res.body)).not.toMatch(new RegExp(`${clinicId}|${sessionId}`));
  });

  it('accept grounded facts as "heard", and skip duplicates, stale hashes, wrong spans and foreign segments', async () => {
    const res = await submit([
      fact(0, 'fever'),
      fact(0, 'two days', { type: 'duration', value: '2 days' }),
      fact(1, 'No cough', { negated: true, value: 'cough' }),
      fact(0, 'fever'), // duplicate within the run
      fact(0, 'fever', { segmentTextHash: 'b'.repeat(64) }), // text changed since the model read it
      fact(0, 'fever', { spanStart: 1, spanEnd: 6 }), // span does not cover the quote
      fact(0, 'fever', { segmentId: randomUUID() }), // not a segment of this session
    ]);
    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({
      inserted: 3,
      duplicates: 1,
      staleRejected: 1,
      invalidRejected: 2,
    });
    expect((await facts()).heardCount).toBe(3);
    const again = await submit([
      fact(0, 'fever'),
      fact(0, 'two days', { type: 'duration', value: '2 days' }),
    ]);
    expect(again.body.data).toMatchObject({ inserted: 0, duplicates: 2 });
  });

  it('refuse a user token, and need consent now', async () => {
    expect(
      (
        await request(h.app)
          .post(`/api/v1/internal/sessions/${sessionId}/facts`)
          .set(...bearer(doctor))
          .send({})
      ).status,
    ).toBe(401);
  });
});

describe('doctor review', () => {
  it('confirm, edit (original kept), reject, and a manual fact', async () => {
    const heard = (await facts('heard')).facts;
    const fever = heard.find((f: { evidenceQuote: string }) => f.evidenceQuote === 'fever');
    const days = heard.find((f: { type: string }) => f.type === 'duration');
    const cough = heard.find((f: { evidenceQuote: string }) => f.evidenceQuote === 'No cough');
    expect(
      (await asDoctor('patch', `/facts/${fever.id}`, { action: 'confirm' })).body.data.status,
    ).toBe('confirmed');
    const edited = (
      await asDoctor('patch', `/facts/${days.id}`, {
        action: 'edit',
        value: '3 days',
        uncertain: true,
      })
    ).body.data;
    expect(edited).toMatchObject({
      value: '3 days',
      uncertain: true,
      edited: true,
      originalValue: '2 days',
      status: 'confirmed',
    });
    expect(
      (await asDoctor('patch', `/facts/${cough.id}`, { action: 'reject' })).body.data.status,
    ).toBe('rejected');
    const manual = await asDoctor('post', '/facts', {
      type: 'allergy',
      value: 'none known',
      negated: true,
    });
    expect(manual.status).toBe(201);
    expect(manual.body.data).toMatchObject({
      source: 'manual',
      status: 'confirmed',
      spanStart: null,
      evidenceQuote: null,
    });
    expect(
      (await asDoctor('patch', `/facts/${days.id}`, { action: 'confirm', value: 'x' })).status,
    ).toBe(400);
  });

  it('only the own doctor; staff 403, another doctor 404', async () => {
    expect((await asDoctor('get', '/facts', undefined, staff)).status).toBe(403);
    expect((await asDoctor('get', '/facts', undefined, doctor2)).status).toBe(404);
  });

  it('a re-run of the pipeline never touches confirmed or rejected facts', async () => {
    const before = (await facts()).facts.map((f: { id: string; status: string; value: string }) => [
      f.id,
      f.status,
      f.value,
    ]);
    await submit([fact(0, 'fever'), fact(1, 'No cough', { negated: true, value: 'cough' })]);
    const after = (await facts()).facts.map((f: { id: string; status: string; value: string }) => [
      f.id,
      f.status,
      f.value,
    ]);
    expect(after).toEqual(before);
  });
});

describe('staleness', () => {
  it('a changed segment makes its facts stale, never rewritten; re-confirm needs the quote to still be there', async () => {
    const res = await asDoctor('put', '/transcript/segments', {
      segments: [segment(0, SEG0, { editedText: 'Patient has FEVER since three days' })],
    });
    expect(res.status).toBe(200);
    const stale = (await facts('stale')).facts;
    expect(stale.map((f: { evidenceQuote: string }) => f.evidenceQuote).sort()).toEqual([
      'fever',
      'two days',
    ]);
    expect(stale.every((f: { value: string }) => ['fever', '3 days'].includes(f.value))).toBe(true); // values untouched
    const audit = await h.db.owner.query(
      "SELECT meta FROM audit_log WHERE action = 'TRANSCRIPT_SAVED' AND session_id = $1 ORDER BY seq DESC LIMIT 1",
      [sessionId],
    );
    expect(audit.rows[0]?.meta).toEqual({ segmentCount: 1, staleFactCount: 2 });
    const days = stale.find((f: { type: string }) => f.type === 'duration');
    expect((await asDoctor('patch', `/facts/${days.id}`, { action: 'confirm' })).status).toBe(409); // "two days" is gone
    const fever = stale.find((f: { type: string }) => f.type === 'symptom');
    expect((await asDoctor('patch', `/facts/${fever.id}`, { action: 'confirm' })).status).toBe(409); // case changed: "fever" is gone
    await asDoctor('put', '/transcript/segments', {
      segments: [segment(0, SEG0, { editedText: 'Patient has fever since three days' })],
    });
    expect(
      (await asDoctor('patch', `/facts/${fever.id}`, { action: 'confirm' })).body.data,
    ).toMatchObject({ status: 'confirmed' });
    expect(await row(fever.id)).toMatchObject({
      segment_text_hash: textHash('Patient has fever since three days'),
    });
  });
});

describe('database guards on the runtime role', () => {
  it('evidence cannot be rewritten and a confirmed fact cannot be deleted', async () => {
    const app = new pg.Pool({ connectionString: h.db.appUrl, max: 1 });
    const run = (sql: string) =>
      app.query(sql, [sessionId]).then(
        () => 'allowed',
        (e: Error) => e.message,
      );
    expect(
      await run("UPDATE extracted_fact SET evidence_quote = 'changed' WHERE session_id = $1"),
    ).toMatch(/cannot be changed/);
    expect(await run("UPDATE extracted_fact SET type = 'allergy' WHERE session_id = $1")).toMatch(
      /cannot be changed/,
    );
    expect(
      await run("DELETE FROM extracted_fact WHERE session_id = $1 AND status = 'confirmed'"),
    ).toMatch(/confirmed fact cannot be deleted/);
    await app.end();
  });
});

describe('withdrawal', () => {
  it('deletes unconfirmed facts and draft text; keeps confirmed facts, which record that their segment is gone', async () => {
    const before = await facts();
    const confirmed = before.facts.filter((f: { status: string }) => f.status === 'confirmed');
    expect(confirmed.length).toBeGreaterThan(0);
    const res = await request(h.app)
      .post(api('/consent/withdraw'))
      .set(...bearer(doctor))
      .send({ source: 'patient' });
    expect(res.status).toBe(200);
    const after = await facts();
    expect(after.facts.map((f: { id: string }) => f.id).sort()).toEqual(
      confirmed.map((f: { id: string }) => f.id).sort(),
    );
    expect(after.heardCount + after.rejectedCount + after.staleCount).toBe(0);
    const linked = await h.db.owner.query(
      "SELECT source_segment_id, segment_deleted_at FROM extracted_fact WHERE source = 'extracted'",
    );
    expect(
      linked.rows.every((r) => r.source_segment_id === null && r.segment_deleted_at !== null),
    ).toBe(true);
    const audit = await h.db.owner.query(
      "SELECT meta FROM audit_log WHERE action = 'TRANSCRIPT_DRAFT_DELETED' AND session_id = $1",
      [sessionId],
    );
    expect(Object.keys(audit.rows[0]?.meta).sort()).toEqual(['factCount', 'segmentCount']);
  });

  it('after withdrawal nothing can be saved or extracted', async () => {
    expect(
      (await asDoctor('post', '/facts', { type: 'symptom', value: 'x' })).body.error.code,
    ).toBe('CONSENT_REQUIRED');
    expect((await submit([fact(1, 'No cough')])).status).toBe(403);
    expect(
      (await internal('get', `/internal/sessions/${sessionId}/transcript-segments`)).status,
    ).toBe(403);
  });
});

describe('what the audit log holds', () => {
  it('counts and fact TYPES only: no fact text, no quote, no segment text', async () => {
    const rows = await h.db.owner.query(
      "SELECT meta FROM audit_log WHERE action LIKE 'FACT%' OR action LIKE 'TRANSCRIPT_%'",
    );
    expect(rows.rows.length).toBeGreaterThanOrEqual(8);
    expect(JSON.stringify(rows.rows)).not.toMatch(/fever|cough|days|none known|Patient/i);
  });
});
