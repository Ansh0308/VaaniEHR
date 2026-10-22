// Phase 8 Run 2 server pieces (ADR-D39): the sign preview (engine original beside the doctor's final, "doctor-entered"
// where no engine version exists), previous visits, and the SafetyChecks ERROR state (signing is refused, fail closed).
// Fake names and toy words only.
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resetSignThrottle } from '../src/visits/service.js';
import { bearer, createHarness, SEED_EMAIL, type Harness } from './db/helpers.js';

let h: Harness;
let doctor: string;
let doctor2: string;
let clinicId: string;
let doctorId: string;
let patientId: string;
let medA: string;

const PW = () => h.passwords[SEED_EMAIL.doctor1] as string;
const owner = (sql: string, p: unknown[] = []) => h.db.owner.query(sql, p);
const call = (
  method: 'get' | 'post' | 'patch',
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
const newSession = async (): Promise<string> =>
  (
    await owner(
      `INSERT INTO consultation_session (clinicos_patient_id, clinicos_doctor_id, clinicos_clinic_id)
       VALUES ($1,$2,$3) RETURNING id`,
      [patientId, doctorId, clinicId],
    )
  ).rows[0]?.id as string;
const sign = (s: string, over: object = {}) =>
  call('post', s, '/sign', { password: PW(), safetyNotRunAcknowledged: true, ...over });

beforeAll(async () => {
  h = await createHarness();
  doctor = await h.tokenFor(SEED_EMAIL.doctor1);
  doctor2 = await h.tokenFor(SEED_EMAIL.doctor2);
  clinicId = h.seed.clinics[0]?.id as string;
  doctorId = h.seed.users.find((u) => u.email === SEED_EMAIL.doctor1)?.id as string;
  patientId = (
    await owner('SELECT id FROM mock_clinicos_patient WHERE clinic_id = $1 LIMIT 1', [clinicId])
  ).rows[0]?.id as string;
  medA = (
    await owner(
      `INSERT INTO medicine_master (generic_name, strength, dose_form, source, source_page)
       VALUES ('toy-medicine-run2','10 mg','tablet','TOY-LIST 1',5) RETURNING id`,
    )
  ).rows[0]?.id as string;
});
afterAll(async () => {
  await h.close();
});

describe('sign preview', () => {
  it('shows the engine original beside the doctor final, and doctor-entered where there is none', async () => {
    const s = await newSession();
    // an engine fact the doctor edited (the segment was deleted, so the fact keeps its quote)
    await owner(
      `INSERT INTO extracted_fact (session_id, clinic_id, type, value, negated, source, status, pipeline, original_value,
         original_negated, edited, evidence_quote, span_start, span_end, segment_text_hash, match_type,
         segment_deleted_at, confirmed_at, confirmed_by)
       VALUES ($1,$2,'symptom','toy final words',true,'extracted','confirmed','grounded','toy engine words',false,true,
         'toy quote',0,9,repeat('a',64),'exact',now(),now(),$3)`,
      [s, clinicId, doctorId],
    );
    await owner(
      `INSERT INTO extracted_fact (session_id, clinic_id, type, value, source, status, pipeline, confirmed_at, confirmed_by)
       VALUES ($1,$2,'duration','2 days toy','manual','confirmed','manual',now(),$3)`,
      [s, clinicId, doctorId],
    );
    const p = (await call('get', s, '/sign-preview')).body.data;
    const engine = p.facts.find((f: { source: string }) => f.source === 'extracted');
    expect(engine).toMatchObject({
      value: 'toy final words',
      originalValue: 'toy engine words',
      originalNegated: false,
      negated: true,
      evidenceQuote: 'toy quote',
      edited: true,
    });
    const manual = p.facts.find((f: { source: string }) => f.source === 'manual');
    expect(manual).toMatchObject({ originalValue: null, evidenceQuote: null });
    expect(p.workingCondition).toBeNull();
  });

  it('a template row carries the template line it came from; a hand-chosen row carries none', async () => {
    const s = await newSession();
    const t = (
      await owner(
        `INSERT INTO med_template (name, owner_user_id, clinic_id, visibility) VALUES ('toy template',$1,$2,'personal') RETURNING id`,
        [doctorId, clinicId],
      )
    ).rows[0]?.id as string;
    await owner(
      `INSERT INTO med_template_item (template_id, medicine_id, position, dose, frequency, duration, instructions)
       VALUES ($1,$2,0,'1 tablet','OD','7 days','toy note')`,
      [t, medA],
    );
    await call('post', s, '/prescription/apply-template', { templateId: t });
    // the doctor edits the template row and adds two more
    const first = (await call('get', s, '/prescription')).body.data.rows[0].id as string;
    await call('patch', s, `/prescription/items/${first}`, { duration: '3 days' });
    await call('post', s, '/prescription/items', {
      medicineId: medA,
      frequency: 'BD',
      duration: '3 days',
    });
    await call('post', s, '/prescription/items', {
      medicineId: null,
      name: 'hand typed',
      frequency: 'OD',
      duration: '1 day',
    });
    const rows = (await call('get', s, '/sign-preview')).body.data.medicines;
    expect(rows[0]).toMatchObject({ duration: '3 days' });
    expect(rows[0].templateOriginal).toEqual({
      templateName: 'toy template',
      dose: '1 tablet',
      frequency: 'OD',
      duration: '7 days',
      instructions: 'toy note',
    });
    expect(rows[1].templateOriginal).toBeNull();
    expect(rows[2]).toMatchObject({ source: 'free_text', templateOriginal: null });
  });

  it('shows the working condition as selected and its rank among the engine candidates', async () => {
    const s = await newSession();
    await owner(
      `INSERT INTO candidate (session_id, clinic_id, kind, pathway_id, pathway_version, rank, score)
       VALUES ($1,$2,'derived','toy_condition_a',1,2,0.5)`,
      [s, clinicId],
    );
    await owner(
      `INSERT INTO candidate (session_id, clinic_id, kind, pathway_id, pathway_version, selected_by, selected_at)
       VALUES ($1,$2,'selected','toy_condition_a',1,$3,now())`,
      [s, clinicId, doctorId],
    );
    const p = (await call('get', s, '/sign-preview')).body.data;
    expect(p.workingCondition).toMatchObject({
      kind: 'pathway',
      pathwayId: 'toy_condition_a',
      engineRank: 2,
    });
    expect(p.engineCandidates).toEqual([{ pathwayId: 'toy_condition_a', version: 1, rank: 2 }]);
  });

  it('is for the session own doctor only', async () => {
    const s = await newSession();
    expect((await call('get', s, '/sign-preview', undefined, doctor2)).status).toBe(404);
    expect((await call('get', randomUUID(), '/sign-preview')).status).toBe(404);
  });
});

describe('previous visits', () => {
  it('lists this doctor signed visits for the same patient, newest first, not the current one', async () => {
    resetSignThrottle();
    const a = await newSession();
    const b = await newSession();
    const current = await newSession();
    expect((await sign(a)).status).toBe(201);
    await call('post', b, '/prescription/items', {
      medicineId: medA,
      frequency: 'OD',
      duration: '2 days',
    });
    expect((await sign(b)).status).toBe(201);
    const ids = (s: string, token = doctor) => call('get', s, '/previous-visits', undefined, token);
    const list = (await ids(current)).body.data.visits;
    expect(list.map((v: { sessionId: string }) => v.sessionId)).toEqual([b, a]);
    expect(list[0]).toMatchObject({
      currentVersion: 1,
      medicineCount: 1,
      factCount: 0,
      safetyNotRun: true,
    });
    expect((await ids(b)).body.data.visits.map((v: { sessionId: string }) => v.sessionId)).toEqual([
      a,
    ]);
    expect((await ids(current, doctor2)).status).toBe(404);
  });
});

describe('SafetyChecks ERROR state', () => {
  const withSafety = async (
    run: () => Promise<{ configured: boolean; blocked: number; message: string; error?: boolean }>,
    body: () => Promise<void>,
  ) => {
    const original = h.services.safety;
    h.services.safety = { run };
    try {
      await body();
    } finally {
      h.services.safety = original;
    }
  };

  it('an engine that reports an error blocks signing with a clear message, and nothing is stored', async () => {
    resetSignThrottle();
    const s = await newSession();
    await withSafety(
      async () => ({ configured: true, blocked: 0, error: true, message: 'toy engine failed' }),
      async () => {
        const res = await sign(s);
        expect(res.status).toBe(503);
        expect(res.body.error.code).toBe('SAFETY_ERROR');
        expect(res.body.error.message).toMatch(/safety checks failed to run/);
        // the acknowledgement does not get around an error
        expect((await sign(s, { safetyNotRunAcknowledged: true })).status).toBe(503);
        expect(
          (await owner('SELECT 1 FROM visit_record WHERE session_id = $1', [s])).rowCount,
        ).toBe(0);
        const ready = (await call('get', s, '/sign-readiness')).body.data;
        expect(ready.safety).toMatchObject({ configured: true, error: true });
      },
    );
    const refused = (
      await owner(
        "SELECT meta FROM audit_log WHERE action = 'VISIT_SIGN_REFUSED' AND session_id = $1",
        [s],
      )
    ).rows;
    expect(refused.length).toBe(2);
    expect(refused.every((r) => r.meta.cause === 'safety_error')).toBe(true);
  });

  it('an engine that throws is the same error state, never no alerts', async () => {
    resetSignThrottle();
    const s = await newSession();
    await withSafety(
      async () => {
        throw new Error('boom');
      },
      async () => {
        expect((await sign(s)).body.error.code).toBe('SAFETY_ERROR');
        expect((await call('get', s, '/sign-readiness')).body.data.safety.error).toBe(true);
      },
    );
  });

  it('an amendment is refused in the same way', async () => {
    resetSignThrottle();
    const s = await newSession();
    expect((await sign(s)).status).toBe(201);
    await withSafety(
      async () => ({ configured: true, blocked: 0, error: true, message: 'x' }),
      async () => {
        const res = await call('post', s, '/amend', {
          password: PW(),
          safetyNotRunAcknowledged: true,
          reason: 'toy reason',
          medicines: [],
        });
        expect(res.body.error.code).toBe('SAFETY_ERROR');
      },
    );
    expect((await call('get', s, '/visit')).body.data.version).toBe(1);
  });
});

describe('database guard on the facts and transcript of a signed visit (migration 0015)', () => {
  it('the app role cannot insert, change or delete them; consent withdrawal still can', async () => {
    resetSignThrottle();
    const s = await newSession();
    for (const scope of ['audio', 'ai_processing']) {
      await owner(
        `INSERT INTO consent_event (session_id, clinic_id, scope, granted, notice_version, notice_language, source,
           recorded_by_user_id, recorded_by_role, ts) VALUES ($1,$2,$3,true,'0.1','en','staff',$4,'staff',now())`,
        [s, clinicId, scope, doctorId],
      );
    }
    await owner(
      `INSERT INTO extracted_fact (session_id, clinic_id, type, value, source, status, pipeline, confirmed_at, confirmed_by)
       VALUES ($1,$2,'duration','2 days toy','manual','confirmed','manual',now(),$3)`,
      [s, clinicId, doctorId],
    );
    await owner(
      `INSERT INTO extracted_fact (session_id, clinic_id, type, value, source, status, pipeline)
       VALUES ($1,$2,'duration','rejected toy','manual','rejected','manual')`,
      [s, clinicId],
    );
    await owner(
      `INSERT INTO transcript_segment (session_id, clinic_id, seq, original_text, engine)
       VALUES ($1,$2,0,'toy draft words','mock')`,
      [s, clinicId],
    );
    expect((await sign(s)).status).toBe(201);
    const q = (sql: string, p: unknown[] = []) => h.appPool.query(sql, p);
    const refused = /facts and transcript of a signed visit/;
    await expect(
      q("UPDATE extracted_fact SET value = 'x' WHERE session_id = $1", [s]),
    ).rejects.toThrow(refused);
    await expect(q('DELETE FROM extracted_fact WHERE session_id = $1', [s])).rejects.toThrow(
      /facts and transcript of a signed visit|confirmed fact cannot be deleted/,
    );
    await expect(
      q(
        `INSERT INTO extracted_fact (session_id, clinic_id, type, value, source, status, pipeline)
         VALUES ($1,$2,'duration','late','manual','heard','manual')`,
        [s, clinicId],
      ),
    ).rejects.toThrow(refused);
    await expect(
      q("UPDATE transcript_segment SET edited_text = 'x' WHERE session_id = $1", [s]),
    ).rejects.toThrow(refused);
    await expect(q('DELETE FROM transcript_segment WHERE session_id = $1', [s])).rejects.toThrow(
      refused,
    );
    // another session of the same doctor is not affected
    const other = await newSession();
    await expect(
      q(
        `INSERT INTO extracted_fact (session_id, clinic_id, type, value, source, status, pipeline)
         VALUES ($1,$2,'duration','fine','manual','heard','manual')`,
        [other, clinicId],
      ),
    ).resolves.toBeTruthy();
    // consent withdrawal after signing: the draft segment and the rejected fact go, the confirmed fact stays
    const res = await request(h.app)
      .post(`/api/v1/sessions/${s}/consent/withdraw`)
      .set(...bearer(doctor))
      .send({ scopes: ['ai_processing'], source: 'patient' });
    expect(res.status).toBe(200);
    const left = (await owner('SELECT value FROM extracted_fact WHERE session_id = $1', [s])).rows;
    expect(left).toEqual([{ value: '2 days toy' }]);
    expect(
      (await owner('SELECT 1 FROM transcript_segment WHERE session_id = $1', [s])).rowCount,
    ).toBe(0);
    // and the flag is off again afterwards
    await expect(
      q("UPDATE extracted_fact SET value = 'x' WHERE session_id = $1", [s]),
    ).rejects.toThrow(refused);
  });
});
