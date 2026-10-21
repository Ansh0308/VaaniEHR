// Pathway questions and candidate conditions (ADR-D34): rules only, doctor only, consent at call time, ids and counts in
// the audit log, the withdrawal rule, and the database guards. TOY pathways only (status test, fake words).
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createHarness, SEED_EMAIL, type Harness } from './db/helpers.js';

let h: Harness;
let doctor: string;
let doctor2: string;
let staff: string;
let sessionId: string;
let clinicId: string;
let doctorId: string;

const api = (path: string, session = sessionId) => `/api/v1/sessions/${session}${path}`;
const call = (
  method: 'get' | 'post',
  path: string,
  body?: object,
  token = doctor,
  session = sessionId,
) => {
  const r = request(h.app)
    [method](api(path, session))
    .set(...bearer(token));
  return body ? r.send(body) : r;
};
const next = async (lang = 'en') => {
  const res = await call('get', `/questions/next?lang=${lang}`);
  if (!res.body.data) throw new Error(`next failed ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data;
};
const record = (scope: string, granted = true, session = sessionId) =>
  h.db.owner.query(
    `INSERT INTO consent_event (session_id, clinic_id, scope, granted, notice_version, notice_language, source,
       recorded_by_user_id, recorded_by_role, ts)
     VALUES ($1,$2,$3,$4,'0.1','en','staff',$5,'staff',now())`,
    [session, clinicId, scope, granted, h.seed.users.find((u) => u.email === SEED_EMAIL.staff)?.id],
  );
/** a doctor-confirmed fact that carries a toy concept id (stands in for a fact the linker will tag later) */
const confirmedFact = (concept: string, negated = false, status = 'confirmed') =>
  h.db.owner.query(
    `INSERT INTO extracted_fact (session_id, clinic_id, type, value, negated, source, status, pipeline,
       confirmed_at, confirmed_by, concept_id)
     VALUES ($1,$2,'symptom','toy fact',$3,'manual',$4,'manual', $5, $6, $7)`,
    [
      sessionId,
      clinicId,
      negated,
      status,
      status === 'confirmed' ? new Date() : null,
      doctorId,
      concept,
    ],
  );
const newSession = async () =>
  (
    await h.db.owner.query<{ id: string }>(
      `INSERT INTO consultation_session (clinicos_patient_id, clinicos_doctor_id, clinicos_clinic_id)
       VALUES ($1, $2, $3) RETURNING id`,
      [
        (
          await h.db.owner.query<{ id: string }>(
            'SELECT id FROM mock_clinicos_patient WHERE clinic_id = $1 LIMIT 1',
            [clinicId],
          )
        ).rows[0]?.id,
        doctorId,
        clinicId,
      ],
    )
  ).rows[0]?.id as string;
const auditRows = async (action: string) =>
  (
    await h.db.owner.query(
      'SELECT meta, resource_id FROM audit_log WHERE action = $1 AND session_id = $2 ORDER BY seq',
      [action, sessionId],
    )
  ).rows;

beforeAll(async () => {
  h = await createHarness();
  doctor = await h.tokenFor(SEED_EMAIL.doctor1);
  doctor2 = await h.tokenFor(SEED_EMAIL.doctor2);
  staff = await h.tokenFor(SEED_EMAIL.staff);
  clinicId = h.seed.clinics[0]?.id as string;
  doctorId = h.seed.users.find((u) => u.email === SEED_EMAIL.doctor1)?.id as string;
  sessionId = await newSession();
  await record('audio');
  await record('ai_processing');
});
afterAll(async () => {
  await h.close();
});

describe('the next question', () => {
  it('suggests the heaviest shared question first, with a reason, and records one open event', async () => {
    const d = await next();
    expect(d).toMatchObject({
      outcome: 'QUESTION',
      pathwayId: 'toy_condition_a',
      pathwayVersion: 1,
      nodeId: 'toy_condition_a/q1',
      slot: 'toy_symptom_1',
      eventStatus: 'suggested',
      questionsUsed: 0,
      questionCap: 8,
    });
    expect(d.ask).toMatch(/toy symptom 1/);
    expect(d.reasonText).toBeTruthy();
    const again = await next();
    expect(again.eventId).toBe(d.eventId); // reading again does not create a second suggestion
    const rows = await h.db.owner.query('SELECT * FROM question_event WHERE session_id = $1', [
      sessionId,
    ]);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({ pathway_id: 'toy_condition_a', pathway_version: 1 });
  });

  it('speaks the requested language', async () => {
    expect((await next('gu')).ask).toMatch(/^\[TOY-GU\]/);
    expect((await call('get', '/questions/next?lang=fr')).status).toBe(400);
  });

  it('only CONFIRMED facts with a known concept id feed the engine', async () => {
    await confirmedFact('toy_c_toy_symptom_1', false, 'heard'); // not confirmed: ignored
    await confirmedFact('some_unmapped_concept'); // confirmed but not in the slot map: ignored
    expect((await next()).nodeId).toBe('toy_condition_a/q1');
    await confirmedFact('toy_c_toy_symptom_1'); // now confirmed
    const d = await next();
    expect(d.outcome).toBe('QUESTION');
    expect(d.slot).not.toBe('toy_symptom_1'); // never asks an answered slot
  });

  it('a confirmed red-flag slot gives a red flag; it must be acknowledged, not asked or dismissed', async () => {
    await confirmedFact('toy_c_toy_redflag_1');
    const d = await next();
    expect(d).toMatchObject({ outcome: 'RED_FLAG', eventStatus: 'suggested' });
    expect(d.redFlags).toEqual(['toy_condition_b/q3']);
    expect(d.ask).toBeNull();
    const wrong = await call('post', `/questions/${d.eventId}/action`, { action: 'dismissed' });
    expect(wrong.status).toBe(400);
    const ok = await call('post', `/questions/${d.eventId}/action`, { action: 'acknowledged' });
    expect(ok.status).toBe(200);
    expect(
      (await call('post', `/questions/${d.eventId}/action`, { action: 'acknowledged' })).status,
    ).toBe(409);
    const again = await next();
    expect(again).toMatchObject({
      outcome: 'RED_FLAG',
      eventId: d.eventId,
      eventStatus: 'acknowledged',
    });
    expect((await auditRows('RED_FLAG_ACKNOWLEDGED'))[0]?.meta).toEqual({
      pathwayId: 'toy_condition_b',
      nodeId: 'q3',
    });
  });
});

describe('acting on a suggested question', () => {
  let s2: string;
  beforeAll(async () => {
    s2 = await newSession();
    await record('audio', true, s2);
    await record('ai_processing', true, s2);
  });
  const next2 = async () => (await call('get', '/questions/next', undefined, doctor, s2)).body.data;

  it('asked / dismissed / snoozed are recorded, audited with ids only, and change what comes next', async () => {
    const first = await next2();
    const r = await call(
      'post',
      `/questions/${first.eventId}/action`,
      { action: 'dismissed' },
      doctor,
      s2,
    );
    expect(r.body.data).toEqual({ id: first.eventId, status: 'dismissed' });
    const second = await next2();
    expect(second.nodeId).not.toBe(first.nodeId);
    expect(second.questionsUsed).toBe(1);
    await call('post', `/questions/${second.eventId}/action`, { action: 'snoozed' }, doctor, s2);
    const third = await next2();
    expect(third.nodeId).not.toBe(second.nodeId); // snoozed: hidden for now
    expect(third.questionsUsed).toBe(1); // and not counted towards the cap
    const rows = await h.db.owner.query(
      "SELECT meta FROM audit_log WHERE action = 'QUESTION_ACTED' AND session_id = $1 ORDER BY seq",
      [s2],
    );
    expect(rows.rows.map((x) => x.meta.questionAction)).toEqual(['dismissed', 'snoozed']);
    for (const x of rows.rows) {
      expect(Object.keys(x.meta).sort()).toEqual(['nodeId', 'pathwayId', 'questionAction']);
    }
  });

  it('refuses a handled event, an acknowledge on a question, an unknown event and another session', async () => {
    const q = await next2();
    expect(
      (await call('post', `/questions/${q.eventId}/action`, { action: 'acknowledged' }, doctor, s2))
        .status,
    ).toBe(400);
    await call('post', `/questions/${q.eventId}/action`, { action: 'asked' }, doctor, s2);
    expect(
      (await call('post', `/questions/${q.eventId}/action`, { action: 'asked' }, doctor, s2))
        .status,
    ).toBe(409);
    expect(
      (await call('post', `/questions/${randomUUID()}/action`, { action: 'asked' }, doctor, s2))
        .status,
    ).toBe(404);
    // an event of s2 cannot be acted on through the main session
    expect((await call('post', `/questions/${q.eventId}/action`, { action: 'asked' })).status).toBe(
      404,
    );
    expect(
      (await call('post', `/questions/${q.eventId}/action`, { action: 'bogus' }, doctor, s2))
        .status,
    ).toBe(400);
    expect(
      (await call('post', `/questions/${q.eventId}/action`, { action: 'asked', x: 1 }, doctor, s2))
        .status,
    ).toBe(400);
  });

  it('a snoozed question returns after a newer confirmed fact', async () => {
    const s3 = await newSession();
    await record('audio', true, s3);
    await record('ai_processing', true, s3);
    const get = async () => (await call('get', '/questions/next', undefined, doctor, s3)).body.data;
    const q = await get();
    await call('post', `/questions/${q.eventId}/action`, { action: 'snoozed' }, doctor, s3);
    expect((await get()).nodeId).not.toBe(q.nodeId);
    await h.db.owner.query(
      `INSERT INTO extracted_fact (session_id, clinic_id, type, value, source, status, pipeline, confirmed_at,
         confirmed_by, concept_id) VALUES ($1,$2,'symptom','toy','manual','confirmed','manual', now() + interval '1 second', $3, 'toy_c_toy_symptom_6')`,
      [s3, clinicId, doctorId],
    );
    expect((await get()).nodeId).toBe(q.nodeId);
  });
});

describe('candidates and the working condition', () => {
  it('lists up to three candidates with evidence for and against, a source and a notice; no diagnosis wording', async () => {
    const res = await call('get', '/candidates');
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.candidates.length).toBeGreaterThan(0);
    expect(d.candidates.length).toBeLessThanOrEqual(3);
    expect(d.candidates[0].rank).toBe(1);
    expect(d.candidates[0].evidenceFor.length).toBeGreaterThan(0);
    expect(d.candidates[0].source.doc).toMatch(/TOY/);
    expect(d.notice).toMatch(/not a diagnosis/);
    expect(d.selected).toBeNull();
    expect(JSON.stringify(res.body).replace(/not a diagnosis/, '')).not.toMatch(
      /diagnos|confirmed condition/i,
    );
    const derived = await h.db.owner.query(
      "SELECT rank, pathway_version FROM candidate WHERE session_id = $1 AND kind = 'derived' ORDER BY rank",
      [sessionId],
    );
    expect(derived.rows.length).toBe(d.candidates.length);
    await call('get', '/candidates');
    const again = await h.db.owner.query(
      "SELECT count(*)::int AS n FROM candidate WHERE session_id = $1 AND kind = 'derived'",
      [sessionId],
    );
    expect(again.rows[0]?.n).toBe(derived.rows.length); // the snapshot is replaced, not piled up
  });

  it('the doctor chooses a working condition; a later choice supersedes the earlier one; the note is never audited', async () => {
    const bad = await call('post', '/candidates/select', {
      pathwayId: 'toy_condition_a',
      version: 9,
    });
    expect(bad.status).toBe(400);
    expect(
      (await call('post', '/candidates/select', { pathwayId: 'nope', version: 1 })).status,
    ).toBe(400);
    expect((await call('post', '/candidates/select', {})).status).toBe(400);
    expect((await call('post', '/candidates/select', { notListed: true, text: '' })).status).toBe(
      400,
    );
    const one = await call('post', '/candidates/select', {
      pathwayId: 'toy_condition_a',
      version: 1,
    });
    expect(one.status).toBe(201);
    expect(one.body.data).toMatchObject({
      notListed: false,
      pathwayId: 'toy_condition_a',
      title: 'Toy condition A',
    });
    const two = await call('post', '/candidates/select', {
      notListed: true,
      text: 'a private toy note',
    });
    expect(two.status).toBe(201);
    expect(two.body.data).toMatchObject({
      notListed: true,
      pathwayId: null,
      text: 'a private toy note',
    });
    const read = (await call('get', '/candidates')).body.data;
    expect(read.selected).toMatchObject({ notListed: true });
    const rows = await h.db.owner.query(
      "SELECT superseded_at FROM candidate WHERE session_id = $1 AND kind = 'selected' ORDER BY created_at",
      [sessionId],
    );
    expect(rows.rows.map((r) => r.superseded_at !== null)).toEqual([true, false]);
    const audit = await auditRows('CANDIDATE_SELECTED');
    expect(audit.map((a) => a.meta)).toEqual([
      { notListed: false, pathwayId: 'toy_condition_a', pathwayVersion: 1 },
      { notListed: true },
    ]);
    expect(JSON.stringify(audit)).not.toMatch(/private toy note/);
  });
});

describe('who may call, and consent at call time', () => {
  const routes: [string, 'get' | 'post', string, object | undefined][] = [
    ['next', 'get', '/questions/next', undefined],
    ['action', 'post', `/questions/${randomUUID()}/action`, { action: 'asked' }],
    ['candidates', 'get', '/candidates', undefined],
    ['select', 'post', '/candidates/select', { notListed: true, text: 'x' }],
  ];
  it("only the session's own doctor: another doctor and staff are refused", async () => {
    for (const [, method, path, body] of routes) {
      expect((await call(method, path, body, doctor2)).status).toBe(404);
      expect((await call(method, path, body, staff)).status).toBe(403);
    }
  });
  it('without both consents every route says CONSENT_REQUIRED', async () => {
    const bare = await newSession();
    await record('audio', true, bare);
    for (const [, method, path, body] of routes) {
      const res = await call(method, path, body, doctor, bare);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('CONSENT_REQUIRED');
    }
  });
});

describe('what the doctor panels need (Phase 6C)', () => {
  let s6: string;
  beforeAll(async () => {
    s6 = await newSession();
    await record('audio', true, s6);
    await record('ai_processing', true, s6);
  });
  const on = (method: 'get' | 'post', path: string, body?: object) =>
    call(method, path, body, doctor, s6);

  it('the next question names its pathway, its status and whether any loaded pathway is not active', async () => {
    const d = (await on('get', '/questions/next')).body.data;
    expect(d).toMatchObject({
      pathwayTitle: 'Toy condition A',
      pathwayStatus: 'test',
      notActive: true,
    });
  });

  it('each piece of evidence points at the confirmed fact that set its slot; candidates carry their status', async () => {
    const inserted = await h.db.owner.query<{ id: string }>(
      `INSERT INTO extracted_fact (session_id, clinic_id, type, value, negated, source, status, pipeline,
         confirmed_at, confirmed_by, concept_id)
       VALUES ($1,$2,'symptom','toy fact',false,'manual','confirmed','manual', now(), $3, 'toy_c_toy_symptom_1')
       RETURNING id`,
      [s6, clinicId, doctorId],
    );
    const factId = inserted.rows[0]?.id;
    const d = (await on('get', '/candidates')).body.data;
    const a = d.candidates.find((c: { pathwayId: string }) => c.pathwayId === 'toy_condition_a');
    expect(a.status).toBe('test');
    expect(a.evidenceFor[0]).toMatchObject({ slot: 'toy_symptom_1', factId });
    expect(d.notActive).toBe(true);
  });

  it('undo clears the working condition, keeps the old row as history, is audited and needs consent', async () => {
    expect((await on('post', '/candidates/select/undo', {})).status).toBe(409); // nothing to undo yet
    await on('post', '/candidates/select', { pathwayId: 'toy_condition_a', version: 1 });
    const done = await on('post', '/candidates/select/undo', {});
    expect(done.status).toBe(200);
    expect((await on('get', '/candidates')).body.data.selected).toBeNull();
    const rows = await h.db.owner.query(
      "SELECT superseded_at FROM candidate WHERE session_id = $1 AND kind = 'selected'",
      [s6],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.superseded_at).not.toBeNull();
    const audit = await h.db.owner.query(
      "SELECT meta FROM audit_log WHERE action = 'CANDIDATE_SELECTION_UNDONE' AND session_id = $1",
      [s6],
    );
    expect(audit.rows.map((r) => r.meta)).toEqual([{}]);
    const bare = await newSession();
    expect((await call('post', '/candidates/select/undo', {}, doctor, bare)).body.error.code).toBe(
      'CONSENT_REQUIRED',
    );
  });
});

describe('withdrawal and the database guards', () => {
  it('deletes suggested questions and the derived shortlist; keeps the acknowledged red flag and the working condition', async () => {
    const before = await h.db.owner.query(
      'SELECT status FROM question_event WHERE session_id = $1 ORDER BY created_at',
      [sessionId],
    );
    expect(before.rows.length).toBeGreaterThan(1);
    const res = await call('post', '/consent/withdraw', { source: 'patient' });
    expect(res.status).toBe(200);
    const q = await h.db.owner.query('SELECT status FROM question_event WHERE session_id = $1', [
      sessionId,
    ]);
    expect(q.rows.map((r) => r.status)).toEqual(['acknowledged']);
    const c = await h.db.owner.query('SELECT kind FROM candidate WHERE session_id = $1', [
      sessionId,
    ]);
    expect(c.rows.map((r) => r.kind).sort()).toEqual(['selected', 'selected']);
    const audit = await auditRows('PATHWAY_DATA_DELETED');
    expect(Object.keys(audit[0]?.meta).sort()).toEqual(['candidateCount', 'questionCount']);
    const facts = await h.db.owner.query(
      "SELECT count(*)::int AS n FROM extracted_fact WHERE session_id = $1 AND status = 'confirmed'",
      [sessionId],
    );
    expect(facts.rows[0]?.n).toBeGreaterThan(0); // the confirmed facts are the doctor's and stay
    expect((await call('get', '/questions/next')).body.error.code).toBe('CONSENT_REQUIRED');
  });

  it('the runtime role cannot delete a selected choice or an acknowledged red flag, or rewrite identities', async () => {
    const run = (sql: string, params: unknown[] = []) =>
      h.appPool.query(sql, params).then(
        () => 'ok',
        (e: Error) => e.message,
      );
    expect(
      await run("DELETE FROM candidate WHERE session_id = $1 AND kind = 'selected'", [sessionId]),
    ).toMatch(/cannot be deleted/);
    expect(
      await run("DELETE FROM question_event WHERE session_id = $1 AND status = 'acknowledged'", [
        sessionId,
      ]),
    ).toMatch(/cannot be deleted/);
    expect(
      await run(
        "UPDATE candidate SET pathway_id = 'toy_condition_c' WHERE session_id = $1 AND kind = 'selected' AND NOT not_listed",
        [sessionId],
      ),
    ).toMatch(/cannot be rewritten/);
    expect(
      await run('UPDATE question_event SET node_id = $2 WHERE session_id = $1', [sessionId, 'q9']),
    ).toMatch(/identity/);
    expect(
      await run('UPDATE question_event SET status = $2, acted_at = now() WHERE session_id = $1', [
        sessionId,
        'asked',
      ]),
    ).toMatch(/acted-on|status_fits_kind/);
  });

  it('the database refuses a malformed row', async () => {
    const bad = await h.db.owner
      .query(
        `INSERT INTO candidate (session_id, clinic_id, kind, not_listed, selected_by, selected_at)
         VALUES ($1,$2,'selected',false,$3,now())`,
        [sessionId, clinicId, doctorId],
      )
      .then(
        () => 'inserted',
        (e: Error) => e.message,
      );
    expect(bad).toMatch(/candidate_selected_shape/);
  });
});

describe('the kept record after withdrawal (Phase 6C)', () => {
  it("is readable without consent and holds only the doctor's own decisions", async () => {
    const res = await call('get', '/pathway-record');
    expect(res.status).toBe(200);
    expect(res.body.data.acknowledgedRedFlags).toHaveLength(1);
    expect(res.body.data.acknowledgedRedFlags[0]).toMatchObject({ pathwayId: 'toy_condition_b' });
    expect(res.body.data.selected).toMatchObject({ notListed: true });
    // while the suggestions themselves stay refused
    expect((await call('get', '/questions/next')).body.error.code).toBe('CONSENT_REQUIRED');
    expect((await call('get', '/candidates')).body.error.code).toBe('CONSENT_REQUIRED');
  });
  it('another doctor cannot read it', async () => {
    expect((await call('get', '/pathway-record', undefined, doctor2)).status).toBe(404);
  });
});
