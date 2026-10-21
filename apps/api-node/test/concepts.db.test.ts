// Concept links for facts (ADR-D37): suggestions from the UNREVIEWED draft list, the doctor's confirm and clear, the stale
// rules, the question engine's use of confirmed links only, consent, scoping and the audit log. Toy words only.
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { textHash } from '../src/facts/text.js';
import { bearer, createHarness, SEED_EMAIL, type Harness } from './db/helpers.js';

let h: Harness;
let doctor: string;
let doctor2: string;
let clinicId: string;
let doctorId: string;
let sessionId: string;

const call = (
  method: 'get' | 'post' | 'put' | 'patch' | 'delete',
  path: string,
  body?: object,
  token = doctor,
  session = sessionId,
) => {
  const r = request(h.app)
    [method](`/api/v1/sessions/${session}${path}`)
    .set(...bearer(token));
  return body ? r.send(body) : r;
};
const record = (scope: string, session = sessionId, granted = true) =>
  h.db.owner.query(
    `INSERT INTO consent_event (session_id, clinic_id, scope, granted, notice_version, notice_language, source,
       recorded_by_user_id, recorded_by_role, ts)
     VALUES ($1,$2,$3,$4,'0.1','en','staff',$5,'staff',now())`,
    [session, clinicId, scope, granted, h.seed.users.find((u) => u.email === SEED_EMAIL.staff)?.id],
  );
const newSession = async (consent = true) => {
  const patient = await h.db.owner.query<{ id: string }>(
    'SELECT id FROM mock_clinicos_patient WHERE clinic_id = $1 LIMIT 1',
    [clinicId],
  );
  const id = (
    await h.db.owner.query<{ id: string }>(
      `INSERT INTO consultation_session (clinicos_patient_id, clinicos_doctor_id, clinicos_clinic_id)
       VALUES ($1, $2, $3) RETURNING id`,
      [patient.rows[0]?.id, doctorId, clinicId],
    )
  ).rows[0]?.id as string;
  if (consent) {
    await record('audio', id);
    await record('ai_processing', id);
  }
  return id;
};
/** a manual fact (typed by the doctor): symptom by default, confirmed or heard */
const fact = async (
  value: string,
  over: { type?: string; status?: string; session?: string } = {},
) =>
  (
    await h.db.owner.query<{ id: string }>(
      `INSERT INTO extracted_fact (session_id, clinic_id, type, value, source, status, pipeline, confirmed_at,
         confirmed_by) VALUES ($1,$2,$3,$4,'manual',$5,'manual', $6, $7) RETURNING id`,
      [
        over.session ?? sessionId,
        clinicId,
        over.type ?? 'symptom',
        value,
        over.status ?? 'confirmed',
        (over.status ?? 'confirmed') === 'confirmed' ? new Date() : null,
        doctorId,
      ],
    )
  ).rows[0]?.id as string;
const row = async (id: string) =>
  (await h.db.owner.query('SELECT * FROM extracted_fact WHERE id = $1', [id])).rows[0];
const audit = async (action: string, session = sessionId) =>
  (
    await h.db.owner.query(
      'SELECT meta FROM audit_log WHERE action = $1 AND session_id = $2 ORDER BY seq',
      [action, session],
    )
  ).rows.map((r) => r.meta);

beforeAll(async () => {
  h = await createHarness();
  doctor = await h.tokenFor(SEED_EMAIL.doctor1);
  doctor2 = await h.tokenFor(SEED_EMAIL.doctor2);
  clinicId = h.seed.clinics[0]?.id as string;
  doctorId = h.seed.users.find((u) => u.email === SEED_EMAIL.doctor1)?.id as string;
  sessionId = await newSession();
});
afterAll(async () => {
  await h.close();
});

describe('suggestions', () => {
  it('are up to three per fact, labelled unreviewed, carry no score, and are never stored', async () => {
    const exact = await fact('toy symptom one');
    const shared = await fact('toy shared word', { status: 'heard' });
    const none = await fact('something unknown');
    const res = await call('get', '/concept-suggestions');
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.listLoaded).toBe(true);
    // the exact match first; a near word ("toy symptom two") may follow as a fuzzy suggestion
    expect(d.byFact[exact][0]).toEqual({
      conceptId: 'toy_c_toy_symptom_1',
      label: 'toy symptom one',
      reviewStatus: 'unreviewed',
    });
    expect(d.byFact[exact].length).toBeLessThanOrEqual(3);
    // a tie is NOT dropped: the doctor chooses
    expect(d.byFact[shared].map((s: { conceptId: string }) => s.conceptId)).toEqual([
      'toy_c_toy_symptom_5',
      'toy_c_toy_symptom_6',
    ]);
    expect(d.byFact[none]).toBeUndefined();
    expect(JSON.stringify(d)).not.toMatch(/score|percent|confidence/i);
    for (const id of [exact, shared, none]) {
      expect(await row(id)).toMatchObject({ concept_id: null, concept_status: 'none' }); // a read writes nothing
    }
  });
  it('only symptoms get suggestions; a rejected fact gets none; the labels follow the language', async () => {
    const duration = await fact('toy symptom one', { type: 'duration' });
    const rejected = await fact('toy symptom two', { status: 'rejected' });
    const gu = (await call('get', '/concept-suggestions?lang=gu')).body.data;
    expect(gu.byFact[duration]).toBeUndefined();
    expect(gu.byFact[rejected]).toBeUndefined();
    const some = Object.values(gu.byFact).flat() as { label: string }[];
    expect(some.some((s) => s.label.startsWith('[TOY-GU]'))).toBe(true);
    expect((await call('get', '/concept-suggestions?lang=fr')).status).toBe(400);
  });
  it("need consent at the moment of the call, and the session must be the doctor's own", async () => {
    const bare = await newSession(false);
    expect(
      (await call('get', '/concept-suggestions', undefined, doctor, bare)).body.error.code,
    ).toBe('CONSENT_REQUIRED');
    expect((await call('get', '/concept-suggestions', undefined, doctor2)).status).toBe(404);
  });
});

describe('confirming and clearing a link', () => {
  it('the doctor confirms: the link, who and when are stored and audited; the facts list shows it', async () => {
    const id = await fact('toy symptom one');
    const res = await call('post', `/facts/${id}/concept`, { conceptId: 'toy_c_toy_symptom_1' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      conceptId: 'toy_c_toy_symptom_1',
      conceptStatus: 'confirmed',
      snomedId: null,
    });
    expect(res.body.data.conceptConfirmedAt).toBeTruthy();
    expect(await row(id)).toMatchObject({ concept_confirmed_by: doctorId, snomed_id: null });
    expect((await audit('FACT_CONCEPT_CONFIRMED')).at(-1)).toEqual({
      conceptId: 'toy_c_toy_symptom_1',
    });
    const list = (await call('get', '/facts')).body.data.facts;
    expect(list.find((f: { id: string }) => f.id === id).conceptStatus).toBe('confirmed');
    // a linked fact is not suggested to again
    expect((await call('get', '/concept-suggestions')).body.data.byFact[id]).toBeUndefined();
    expect(
      (await call('get', '/concept-suggestions')).body.data.conceptLabels.toy_c_toy_symptom_1,
    ).toBe('toy symptom one');
  });
  it('refuses an unknown concept, a non-symptom, a rejected fact, an unknown fact and extra fields', async () => {
    const id = await fact('toy symptom one');
    expect(
      (await call('post', `/facts/${id}/concept`, { conceptId: 'not_in_the_list' })).status,
    ).toBe(400);
    expect(
      (await call('post', `/facts/${id}/concept`, { conceptId: 'c001', extra: 1 })).status,
    ).toBe(400);
    const duration = await fact('x', { type: 'duration' });
    expect(
      (await call('post', `/facts/${duration}/concept`, { conceptId: 'toy_c_toy_symptom_1' }))
        .status,
    ).toBe(400);
    const rejected = await fact('x', { status: 'rejected' });
    expect(
      (await call('post', `/facts/${rejected}/concept`, { conceptId: 'toy_c_toy_symptom_1' }))
        .status,
    ).toBe(409);
    expect(
      (await call('post', `/facts/${randomUUID()}/concept`, { conceptId: 'toy_c_toy_symptom_1' }))
        .status,
    ).toBe(404);
    expect(await row(id)).toMatchObject({ concept_id: null });
  });
  it('clearing removes the link and is audited; clearing nothing is a conflict', async () => {
    const id = await fact('toy symptom two');
    expect((await call('delete', `/facts/${id}/concept`)).status).toBe(409);
    await call('post', `/facts/${id}/concept`, { conceptId: 'toy_c_toy_symptom_2' });
    const res = await call('delete', `/facts/${id}/concept`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ conceptId: null, conceptStatus: 'none' });
    expect(await row(id)).toMatchObject({ concept_confirmed_by: null, concept_confirmed_at: null });
    expect((await audit('FACT_CONCEPT_CLEARED')).at(-1)).toEqual({
      conceptId: 'toy_c_toy_symptom_2',
    });
  });
  it('needs consent, and another doctor cannot link a fact of this session', async () => {
    const id = await fact('toy symptom one');
    const bare = await newSession(false);
    const other = await fact('toy symptom one', { session: bare });
    expect(
      (
        await call(
          'post',
          `/facts/${other}/concept`,
          { conceptId: 'toy_c_toy_symptom_1' },
          doctor,
          bare,
        )
      ).body.error.code,
    ).toBe('CONSENT_REQUIRED');
    expect(
      (await call('post', `/facts/${id}/concept`, { conceptId: 'toy_c_toy_symptom_1' }, doctor2))
        .status,
    ).toBe(404);
    expect((await call('delete', `/facts/${id}/concept`, undefined, doctor2)).status).toBe(404);
  });
  it('the database refuses a link without a doctor, and a link status that disagrees with the concept', async () => {
    const id = await fact('toy symptom one');
    const attempt = (sql: string) =>
      h.db.owner.query(sql, [id]).then(
        () => 'ok',
        (e: Error) => e.message,
      );
    expect(
      await attempt(
        "UPDATE extracted_fact SET concept_id = 'x', concept_status = 'confirmed' WHERE id = $1",
      ),
    ).toMatch(/concept_who/);
    expect(await attempt("UPDATE extracted_fact SET concept_id = 'x' WHERE id = $1")).toMatch(
      /concept_consistent/,
    );
    expect(
      await attempt("UPDATE extracted_fact SET concept_status = 'stale' WHERE id = $1"),
    ).toMatch(/concept_consistent/);
  });
});

describe('a link goes stale when the words change', () => {
  it('editing the value makes the link stale; the doctor confirms it again', async () => {
    const id = await fact('toy symptom one');
    await call('post', `/facts/${id}/concept`, { conceptId: 'toy_c_toy_symptom_1' });
    const edited = await call('patch', `/facts/${id}`, {
      action: 'edit',
      value: 'toy symptom two',
    });
    expect(edited.body.data).toMatchObject({
      value: 'toy symptom two',
      conceptStatus: 'stale',
      conceptId: 'toy_c_toy_symptom_1',
    });
    // a stale link is suggested again, from the NEW words
    const s = (await call('get', '/concept-suggestions')).body.data.byFact[id];
    expect(s[0].conceptId).toBe('toy_c_toy_symptom_2');
    const again = await call('post', `/facts/${id}/concept`, { conceptId: 'toy_c_toy_symptom_2' });
    expect(again.body.data).toMatchObject({
      conceptStatus: 'confirmed',
      conceptId: 'toy_c_toy_symptom_2',
    });
  });
  it('editing only the flags keeps the link; confirming without a change keeps it', async () => {
    const id = await fact('toy symptom one');
    await call('post', `/facts/${id}/concept`, { conceptId: 'toy_c_toy_symptom_1' });
    const flag = await call('patch', `/facts/${id}`, { action: 'edit', uncertain: true });
    expect(flag.body.data.conceptStatus).toBe('confirmed');
    const same = await call('patch', `/facts/${id}`, { action: 'edit', value: 'toy symptom one' });
    expect(same.body.data.conceptStatus).toBe('confirmed');
  });
  it('a change in the source text makes the fact AND its link stale', async () => {
    const text = 'the patient has toy symptom one';
    const put = (t: string) =>
      call('put', '/transcript/segments', {
        segments: [
          {
            seq: 0,
            speaker: 'unknown',
            originalText: text,
            editedText: t === text ? null : t,
            language: 'en-IN',
            startMs: 0,
            endMs: 900,
            engine: 'mock',
            engineVersion: '1.0',
          },
        ],
      });
    expect((await put(text)).status).toBe(200);
    const seg = (
      await h.db.owner.query<{ id: string }>(
        'SELECT id FROM transcript_segment WHERE session_id = $1 AND seq = 0',
        [sessionId],
      )
    ).rows[0]?.id;
    const id = (
      await h.db.owner.query<{ id: string }>(
        `INSERT INTO extracted_fact (session_id, clinic_id, type, value, source, source_segment_id, span_start, span_end,
           evidence_quote, match_type, segment_text_hash, pipeline, status)
         VALUES ($1,$2,'symptom','toy symptom one','extracted',$3,16,31,'toy symptom one','exact',$4,'grounded','heard') RETURNING id`,
        [sessionId, clinicId, seg, textHash(text)],
      )
    ).rows[0]?.id as string;
    await call('post', `/facts/${id}/concept`, { conceptId: 'toy_c_toy_symptom_1' });
    expect((await row(id)).concept_status).toBe('confirmed');
    expect((await put('the patient has something else now')).status).toBe(200);
    expect(await row(id)).toMatchObject({
      status: 'stale',
      concept_status: 'stale',
      concept_id: 'toy_c_toy_symptom_1',
    });
  });
});

describe('the question engine uses only links the doctor has confirmed', () => {
  it('a confirmed fact with a confirmed link feeds the pathway; no link, a stale link or a heard fact do not', async () => {
    const s = await newSession();
    const next = async () => (await call('get', '/questions/next', undefined, doctor, s)).body.data;
    expect((await next()).slot).toBe('toy_symptom_1'); // nothing known: the first question
    const id = await fact('toy symptom one', { session: s });
    expect((await next()).slot).toBe('toy_symptom_1'); // confirmed fact, but no link
    await call('post', `/facts/${id}/concept`, { conceptId: 'toy_c_toy_symptom_1' }, doctor, s);
    expect((await next()).slot).not.toBe('toy_symptom_1'); // now the slot is known
    await call('patch', `/facts/${id}`, { action: 'edit', value: 'toy symptom two' }, doctor, s);
    expect((await next()).slot).toBe('toy_symptom_1'); // the link is stale: ignored again
    await call('post', `/facts/${id}/concept`, { conceptId: 'toy_c_toy_symptom_1' }, doctor, s);
    await h.db.owner.query(
      "UPDATE extracted_fact SET status = 'heard', confirmed_at = NULL WHERE id = $1",
      [id],
    );
    expect((await next()).slot).toBe('toy_symptom_1'); // a fact that is not confirmed does not count
  });
});

describe('withdrawal', () => {
  it('a confirmed fact keeps its link; an unconfirmed fact and its link are deleted', async () => {
    const s = await newSession();
    const confirmed = await fact('toy symptom one', { session: s });
    const heard = await fact('toy symptom two', { session: s, status: 'heard' });
    await call(
      'post',
      `/facts/${confirmed}/concept`,
      { conceptId: 'toy_c_toy_symptom_1' },
      doctor,
      s,
    );
    await call('post', `/facts/${heard}/concept`, { conceptId: 'toy_c_toy_symptom_2' }, doctor, s);
    expect((await call('post', '/consent/withdraw', { source: 'patient' }, doctor, s)).status).toBe(
      200,
    );
    expect(await row(confirmed)).toMatchObject({
      concept_id: 'toy_c_toy_symptom_1',
      concept_status: 'confirmed',
    });
    expect(await row(heard)).toBeUndefined();
    expect((await call('get', '/concept-suggestions', undefined, doctor, s)).body.error.code).toBe(
      'CONSENT_REQUIRED',
    );
  });
});

describe('the list file', () => {
  it('when it is missing, the screen is told and nothing is suggested or linked', async () => {
    const harness = await createHarness({ CONCEPTS_FILE: '/no/such/concepts.json' });
    try {
      const token = await harness.tokenFor(SEED_EMAIL.doctor1);
      const staffId = harness.seed.users.find((u) => u.email === SEED_EMAIL.staff)?.id;
      const clinic = harness.seed.clinics[0]?.id as string;
      const patient = await harness.db.owner.query<{ id: string }>(
        'SELECT id FROM mock_clinicos_patient WHERE clinic_id = $1 LIMIT 1',
        [clinic],
      );
      const doctorUser = harness.seed.users.find((u) => u.email === SEED_EMAIL.doctor1)?.id;
      const sid = (
        await harness.db.owner.query<{ id: string }>(
          'INSERT INTO consultation_session (clinicos_patient_id, clinicos_doctor_id, clinicos_clinic_id) VALUES ($1,$2,$3) RETURNING id',
          [patient.rows[0]?.id, doctorUser, clinic],
        )
      ).rows[0]?.id as string;
      for (const scope of ['audio', 'ai_processing']) {
        await harness.db.owner.query(
          `INSERT INTO consent_event (session_id, clinic_id, scope, granted, notice_version, notice_language, source,
             recorded_by_user_id, recorded_by_role, ts) VALUES ($1,$2,$3,true,'0.1','en','staff',$4,'staff',now())`,
          [sid, clinic, scope, staffId],
        );
      }
      const fid = (
        await harness.db.owner.query<{ id: string }>(
          `INSERT INTO extracted_fact (session_id, clinic_id, type, value, source, status, pipeline, confirmed_at, confirmed_by)
           VALUES ($1,$2,'symptom','toy symptom one','manual','confirmed','manual', now(), $3) RETURNING id`,
          [sid, clinic, doctorUser],
        )
      ).rows[0]?.id as string;
      const get = await request(harness.app)
        .get(`/api/v1/sessions/${sid}/concept-suggestions`)
        .set(...bearer(token));
      expect(get.body.data).toEqual({ listLoaded: false, byFact: {}, conceptLabels: {} });
      const post = await request(harness.app)
        .post(`/api/v1/sessions/${sid}/facts/${fid}/concept`)
        .set(...bearer(token))
        .send({ conceptId: 'toy_c_toy_symptom_1' });
      expect(post.status).toBe(409);
    } finally {
      await harness.close();
    }
  });
});
