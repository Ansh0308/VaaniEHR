// Erasure requests through the API (PG-20; Phase 12B Run 2, ADR-D45): who may do what, the queue, and what completing removes
// and keeps. The safer default is tested explicitly: the SIGNED visit record (versions, hashes, the facts and medicines it rests
// on), the audit log and the consent events stay; everything else about the patient goes. Fake data only.
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serviceSignature } from '../src/auth/serviceAuth.js';
import { resetSignThrottle } from '../src/visits/service.js';
import { bearer, createHarness, SEED_EMAIL, type Harness } from './db/helpers.js';
import { TEST_INTERNAL_SECRET } from './helpers.js';

const PREFIX = '/api/v1';
let h: Harness;
let admin: string;
let doctor: string;
let staff: string;
let clinicId: string;
let doctorId: string;
let staffId: string;
let adminId: string;
let patients: string[];
let medicineId: string;

const owner = (sql: string, p: unknown[] = []) => h.db.owner.query(sql, p);
const PW = () => h.passwords[SEED_EMAIL.doctor1] as string;
const api = (method: 'get' | 'post', path: string, token: string, body?: object) => {
  const r = request(h.app)
    [method](`${PREFIX}${path}`)
    .set(...bearer(token));
  return body ? r.send(body) : r;
};
const service = (path: string) => {
  const ts = Math.floor(Date.now() / 1000);
  return request(h.app)
    .get(`${PREFIX}${path}`)
    .set('X-Service-Timestamp', String(ts))
    .set(
      'X-Service-Signature',
      serviceSignature(TEST_INTERNAL_SECRET, ts, 'get', `${PREFIX}${path}`, ''),
    );
};
const count = async (sql: string, p: unknown[] = []) => Number((await owner(sql, p)).rows[0]?.n);
const sessionOf = async (patientId: string, doctorToken = true): Promise<string> =>
  (
    await owner(
      `INSERT INTO consultation_session (clinicos_patient_id, clinicos_doctor_id, clinicos_clinic_id) VALUES ($1,$2,$3) RETURNING id`,
      [patientId, doctorToken ? doctorId : doctorId, clinicId],
    )
  ).rows[0]?.id as string;
const consent = (s: string, scope: string, granted = true) =>
  owner(
    `INSERT INTO consent_event (session_id, clinic_id, scope, granted, notice_version, notice_language, source,
       recorded_by_user_id, recorded_by_role, ts) VALUES ($1,$2,$3,$4,'0.1','en','staff',$5,'staff',now())`,
    [s, clinicId, scope, granted, staffId],
  );
const asset = async (s: string): Promise<string> => {
  const id = randomUUID();
  const ts = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({
    assetId: id,
    sessionId: s,
    storageKey: `${id}.vaud`,
    durationS: 10,
    bytes: 100,
    retentionUntil: '2027-12-31T00:00:00Z',
  });
  const res = await request(h.app)
    .post(`${PREFIX}/internal/audio-assets`)
    .set('Content-Type', 'application/json')
    .set('X-Service-Timestamp', String(ts))
    .set(
      'X-Service-Signature',
      serviceSignature(TEST_INTERNAL_SECRET, ts, 'post', `${PREFIX}/internal/audio-assets`, body),
    )
    .send(body);
  expect(res.status).toBe(201);
  return id;
};
const signedSession = async (patientId: string): Promise<string> => {
  resetSignThrottle();
  const s = await sessionOf(patientId);
  await owner(
    `INSERT INTO extracted_fact (session_id, clinic_id, type, value, source, status, pipeline, confirmed_at, confirmed_by)
     VALUES ($1,$2,'symptom','toy signed symptom','manual','confirmed','manual',now(),$3)`,
    [s, clinicId, doctorId],
  );
  await api('post', `/sessions/${s}/prescription/items`, doctor, {
    medicineId,
    frequency: 'BD',
    duration: '5 days',
    dose: '1 tablet',
  });
  expect(
    (
      await api('post', `/sessions/${s}/sign`, doctor, {
        password: PW(),
        safetyNotRunAcknowledged: true,
      })
    ).status,
  ).toBe(201);
  return s;
};
const signedSnapshot = async (s: string) =>
  JSON.stringify([
    (
      await owner(
        'SELECT status, current_version, signed_at FROM visit_record WHERE session_id = $1',
        [s],
      )
    ).rows,
    (
      await owner(
        'SELECT version, content_hash, signed_at FROM visit_record_version WHERE session_id = $1 ORDER BY version',
        [s],
      )
    ).rows,
    (
      await owner(
        `SELECT value FROM extracted_fact WHERE session_id = $1 AND status = 'confirmed' ORDER BY created_at`,
        [s],
      )
    ).rows,
    (
      await owner(
        'SELECT name, frequency FROM prescription_item WHERE session_id = $1 ORDER BY position',
        [s],
      )
    ).rows,
  ]);

/** Everything about one patient that an erasure should reach, plus a signed visit. Returns the two session ids. */
async function fill(patientId: string): Promise<{ signed: string; unsigned: string }> {
  const signed = await signedSession(patientId);
  const unsigned = await sessionOf(patientId);
  for (const s of [signed, unsigned]) {
    for (const scope of ['audio', 'ai_processing', 'whatsapp']) await consent(s, scope);
    await asset(s);
  }
  // signed session: draft work after signing is impossible, so only derived exports exist
  await owner(
    `INSERT INTO fhir_bundle (session_id, clinic_id, version, kind, bundle, status, not_validated_reason, ig_version, created_by)
     VALUES ($1,$2,1,'op_consult','{}'::jsonb,'not_validated','validator not configured','6.5.0',$3)`,
    [signed, clinicId, doctorId],
  );
  const summary = (
    await owner(
      `INSERT INTO whatsapp_summary (session_id, clinic_id, patient_id, version, params, text_gu, text_en, phrase_table_version, template_name, created_by)
       VALUES ($1,$2,$3,1,'{}'::jsonb,'x','x','0.1','t',$4) RETURNING id`,
      [signed, clinicId, patientId, doctorId],
    )
  ).rows[0]?.id as string;
  await owner(
    `INSERT INTO whatsapp_message (summary_id, session_id, clinic_id, patient_id, template, status, provider, recipient_last4, recipient_hash, text_hash, created_by)
     VALUES ($1,$2,$3,$4,'t','sent','mock','1234',$5,$5,$6)`,
    [summary, signed, clinicId, patientId, 'a'.repeat(64), doctorId],
  );
  // unsigned session: confirmed and draft transcript, confirmed and heard facts, prescription, pathway rows
  const seg = async (status: 'draft' | 'confirmed', seq: number) =>
    (
      await owner(
        `INSERT INTO transcript_segment (session_id, clinic_id, seq, speaker, original_text, status, engine, engine_version, confirmed_at, confirmed_by)
         VALUES ($1,$2,$3,'patient','toy words','${status}','mock','1', ${status === 'confirmed' ? 'now()' : 'NULL'}, ${status === 'confirmed' ? '$4' : 'NULL'}) RETURNING id`,
        status === 'confirmed' ? [unsigned, clinicId, seq, doctorId] : [unsigned, clinicId, seq],
      )
    ).rows[0]?.id as string;
  const confirmedSeg = await seg('confirmed', 0);
  const draftSeg = await seg('draft', 1);
  const fact = (segId: string, status: string, value: string, confirmed: boolean) =>
    owner(
      `INSERT INTO extracted_fact (session_id, clinic_id, type, value, source, source_segment_id, span_start, span_end, evidence_quote, match_type, segment_text_hash, status, pipeline, confirmed_at, confirmed_by)
       VALUES ($1,$2,'symptom',$3,'extracted',$4,0,3,'toy','exact',$5,$6,'grounded',${confirmed ? 'now()' : 'NULL'},${confirmed ? '$7' : 'NULL'})`,
      confirmed
        ? [unsigned, clinicId, value, segId, 'b'.repeat(64), status, doctorId]
        : [unsigned, clinicId, value, segId, 'b'.repeat(64), status],
    );
  await fact(confirmedSeg, 'confirmed', 'toy confirmed unsigned', true);
  await fact(draftSeg, 'heard', 'toy heard unsigned', false);
  await owner(
    `INSERT INTO extracted_fact (session_id, clinic_id, type, value, source, status, pipeline, confirmed_at, confirmed_by)
     VALUES ($1,$2,'symptom','toy manual unsigned','manual','confirmed','manual',now(),$3)`,
    [unsigned, clinicId, doctorId],
  );
  await api('post', `/sessions/${unsigned}/prescription/items`, doctor, {
    medicineId,
    frequency: 'OD',
    duration: '3 days',
    dose: '1 tablet',
  });
  await owner(
    `INSERT INTO question_event (session_id, clinic_id, pathway_id, pathway_version, node_id, slot, kind, status, acted_at, acted_by)
     VALUES ($1,$2,'toy_condition_b',1,'q3','toy_redflag_1','red_flag','acknowledged',now(),$3),
            ($1,$2,'toy_condition_a',1,'q1','toy_symptom_1','question','suggested',NULL,NULL)`,
    [unsigned, clinicId, doctorId],
  );
  await owner(
    `INSERT INTO candidate (session_id, clinic_id, kind, not_listed, not_listed_text, selected_by, selected_at)
     VALUES ($1,$2,'selected',true,'toy',$3,now())`,
    [unsigned, clinicId, doctorId],
  );
  // the patient: ABHA rows and the clinical profile
  await owner(
    `INSERT INTO abha_link (patient_id, clinic_id, abha_address, abha_number_hash, mode, verified_at, verified_by, attested_by, attested_at)
     VALUES ($1,$2,'mock.success@mock.invalid',$3,'mock',now(),$4,$4,now())`,
    [patientId, clinicId, 'c'.repeat(64), staffId],
  );
  await owner(
    `INSERT INTO abha_txn (patient_id, clinic_id, provider_txn, mode, kind, attested_by, created_by, expires_at)
     VALUES ($1,$2,'t','mock','abha_number',$3,$3, now() + interval '10 minutes')`,
    [patientId, clinicId, staffId],
  );
  await owner(
    `INSERT INTO patient_clinical_profile (clinicos_patient_id, allergies, updated_by) VALUES ($1, ARRAY['Toy-Allergy (FAKE)'], $2)
     ON CONFLICT (clinicos_patient_id) DO UPDATE SET allergies = EXCLUDED.allergies`,
    [patientId, staffId],
  );
  return { signed, unsigned };
}

beforeAll(async () => {
  h = await createHarness();
  admin = await h.tokenFor(SEED_EMAIL.admin);
  doctor = await h.tokenFor(SEED_EMAIL.doctor1);
  staff = await h.tokenFor(SEED_EMAIL.staff);
  clinicId = h.seed.clinics[0]?.id as string;
  doctorId = h.seed.users.find((u) => u.email === SEED_EMAIL.doctor1)?.id as string;
  staffId = h.seed.users.find((u) => u.email === SEED_EMAIL.staff)?.id as string;
  adminId = h.seed.users.find((u) => u.email === SEED_EMAIL.admin)?.id as string;
  patients = (
    await owner('SELECT id FROM mock_clinicos_patient WHERE clinic_id = $1 ORDER BY id LIMIT 4', [
      clinicId,
    ])
  ).rows.map((r) => r.id as string);
  medicineId = (
    await owner(
      `INSERT INTO medicine_master (generic_name, strength, dose_form, source, source_page) VALUES ('toy-medicine-er','10 mg','tablet','TOY-LIST 1',5) RETURNING id`,
    )
  ).rows[0]?.id as string;
}, 60_000);
afterAll(async () => {
  await h.close();
});

describe('who may do what', () => {
  it('staff and admin record a request, a doctor may not, a second open request is refused, an unknown patient is 404', async () => {
    const [p] = patients as [string];
    expect(
      (await api('post', '/privacy/requests', doctor, { patientId: p, channel: 'phone' })).status,
    ).toBe(403);
    const made = await api('post', '/privacy/requests', staff, {
      patientId: p,
      channel: 'in_person',
      note: 'toy note',
    });
    expect(made.status).toBe(201);
    expect(made.body.data).toMatchObject({
      status: 'received',
      channel: 'in_person',
      requestedByRole: 'staff',
      patientId: p,
    });
    expect(
      (await api('post', '/privacy/requests', admin, { patientId: p, channel: 'phone' })).status,
    ).toBe(409);
    expect(
      (await api('post', '/privacy/requests', staff, { patientId: randomUUID(), channel: 'phone' }))
        .status,
    ).toBe(404);
    expect(
      (await api('post', '/privacy/requests', staff, { patientId: p, channel: 'carrier-pigeon' }))
        .status,
    ).toBe(400);
    expect(
      (await api('post', '/privacy/requests', staff, { patientId: p, channel: 'phone', extra: 1 }))
        .status,
    ).toBe(400);
    const id = made.body.data.id as string;
    // only an admin reviews, refuses, completes or reads the impact
    for (const [m, path, body] of [
      ['post', `/privacy/requests/${id}/review`, {}],
      ['post', `/privacy/requests/${id}/refuse`, { reason: 'because' }],
      ['post', `/privacy/requests/${id}/complete`, { confirm: true }],
      ['get', `/privacy/requests/${id}/impact`, undefined],
    ] as const) {
      expect((await api(m, path, staff, body as object)).status, path).toBe(403);
      expect((await api(m, path, doctor, body as object)).status, path).toBe(403);
    }
    const audit = (await owner(`SELECT meta FROM audit_log WHERE action = 'ERASURE_REQUESTED'`))
      .rows;
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0]?.meta)).not.toContain('toy note');
  });
  it('staff see the requests they recorded; an admin sees all; a status filter works', async () => {
    const [, second] = patients as [string, string];
    const byAdmin = await api('post', '/privacy/requests', admin, {
      patientId: second,
      channel: 'written',
    });
    expect(byAdmin.status).toBe(201);
    const staffList = await api('get', '/privacy/requests', staff);
    expect(staffList.body.data.items.map((r: { patientId: string }) => r.patientId)).toEqual([
      patients[0],
    ]);
    const adminList = await api('get', '/privacy/requests', admin);
    expect(adminList.body.data.items).toHaveLength(2);
    expect(
      (await api('get', '/privacy/requests?status=completed', admin)).body.data.items,
    ).toHaveLength(0);
    expect((await api('get', '/privacy/requests?status=nope', admin)).status).toBe(400);
  });
});

describe('the queue', () => {
  it('goes received, in review, then refused with a reason; a decided request cannot change; a new one may follow', async () => {
    const [, second] = patients as [string, string];
    const id = (await owner(`SELECT id FROM erasure_request WHERE patient_id = $1`, [second]))
      .rows[0]?.id as string;
    expect(
      (await api('post', `/privacy/requests/${id}/complete`, admin, { confirm: true })).status,
    ).toBe(409); // not reviewed yet
    expect((await api('post', `/privacy/requests/${id}/review`, admin, {})).body.data.status).toBe(
      'in_review',
    );
    expect((await api('post', `/privacy/requests/${id}/review`, admin, {})).status).toBe(409);
    expect(
      (await api('post', `/privacy/requests/${id}/refuse`, admin, { reason: '' })).status,
    ).toBe(400);
    const refused = await api('post', `/privacy/requests/${id}/refuse`, admin, {
      reason: 'toy reason: the request came from someone else',
    });
    expect(refused.body.data).toMatchObject({
      status: 'refused',
      refusalReason: 'toy reason: the request came from someone else',
    });
    expect(
      (await api('post', `/privacy/requests/${id}/refuse`, admin, { reason: 'again please' }))
        .status,
    ).toBe(409);
    expect(
      (await api('post', `/privacy/requests/${id}/complete`, admin, { confirm: true })).status,
    ).toBe(409);
    const audit = (await owner(`SELECT meta FROM audit_log WHERE action = 'ERASURE_REFUSED'`)).rows;
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0]?.meta)).not.toContain('someone else');
    expect(
      (await api('post', '/privacy/requests', staff, { patientId: second, channel: 'phone' }))
        .status,
    ).toBe(201);
    // the database refuses edits the API never makes: backwards moves, deletes, a changed patient
    const app = new pg.Pool({ connectionString: h.db.appUrl, max: 1 });
    const attempts = [
      `UPDATE erasure_request SET status = 'received' WHERE id = '${id}'`,
      `UPDATE erasure_request SET status = 'in_review' WHERE id = '${id}'`,
      `DELETE FROM erasure_request WHERE id = '${id}'`,
      `UPDATE erasure_request SET patient_id = '${randomUUID()}' WHERE status = 'received'`,
    ];
    for (const sql of attempts) await expect(app.query(sql), sql).rejects.toThrow();
    await app.end();
  });
});

describe('completing a request', () => {
  let signed: string;
  let unsigned: string;
  let requestId: string;
  let before: string;
  let withdrawnBefore: number;
  let auditBefore: number;

  it('refuses without the confirmation and shows what would happen first', async () => {
    const p = patients[2] as string;
    ({ signed, unsigned } = await fill(p));
    before = await signedSnapshot(signed);
    requestId = (
      await api('post', '/privacy/requests', staff, { patientId: p, channel: 'written' })
    ).body.data.id as string;
    const impact = await api('get', `/privacy/requests/${requestId}/impact`, admin);
    expect(impact.status).toBe(200);
    expect(impact.body.data.counts).toMatchObject({
      sessions: 2,
      signedVisitsKept: 1,
      audioRecordingsToDelete: 2,
      prescriptionRowsToRemove: 1,
      abhaRowsToRemove: 2,
      clinicalProfileRowsToRemove: 1,
    });
    expect(impact.body.data.counts.factsToRemove).toBeGreaterThanOrEqual(3);
    expect((await api('post', `/privacy/requests/${requestId}/review`, admin, {})).status).toBe(
      200,
    );
    expect((await api('post', `/privacy/requests/${requestId}/complete`, admin, {})).status).toBe(
      400,
    );
    expect(
      (await api('post', `/privacy/requests/${requestId}/complete`, admin, { confirm: false }))
        .status,
    ).toBe(400);
    expect(
      await count('SELECT count(*)::int AS n FROM extracted_fact WHERE session_id = $1', [
        unsigned,
      ]),
    ).toBeGreaterThan(0); // nothing happened
    withdrawnBefore = await count(
      `SELECT count(*)::int AS n FROM consent_event WHERE granted = false AND session_id IN ($1,$2)`,
      [signed, unsigned],
    );
    auditBefore = await count('SELECT count(*)::int AS n FROM audit_log');
  });

  it('removes what is not part of a signed record, keeps the signed record, the consent events and the audit log', async () => {
    const p = patients[2] as string;
    const done = await api('post', `/privacy/requests/${requestId}/complete`, admin, {
      confirm: true,
    });
    expect(done.status).toBe(200);
    expect(done.body.data.status).toBe('completed');
    const result = done.body.data.result as Record<string, number>;
    expect(result).toMatchObject({
      sessions: 2,
      signedVisitsKept: 1,
      prescriptionRowsRemoved: 1,
      abhaRowsRemoved: 2,
      clinicalProfileRowsRemoved: 1,
      audioRecordingsPendingDeletion: 2,
    });
    expect(result.consentWithdrawals).toBe(6);
    // gone: the unsigned session's working data
    for (const table of [
      'transcript_segment',
      'extracted_fact',
      'prescription_item',
      'question_event',
      'candidate',
    ]) {
      expect(
        await count(`SELECT count(*)::int AS n FROM ${table} WHERE session_id = $1`, [unsigned]),
        table,
      ).toBe(0);
    }
    // gone: derived exports of the signed record, ABHA rows, the clinical profile
    for (const table of ['fhir_bundle', 'whatsapp_summary', 'whatsapp_message']) {
      expect(
        await count(`SELECT count(*)::int AS n FROM ${table} WHERE session_id = $1`, [signed]),
        table,
      ).toBe(0);
    }
    expect(await count('SELECT count(*)::int AS n FROM abha_link WHERE patient_id = $1', [p])).toBe(
      0,
    );
    expect(await count('SELECT count(*)::int AS n FROM abha_txn WHERE patient_id = $1', [p])).toBe(
      0,
    );
    expect(
      await count(
        'SELECT count(*)::int AS n FROM patient_clinical_profile WHERE clinicos_patient_id = $1',
        [p],
      ),
    ).toBe(0);
    // kept: the signed record exactly as it was
    expect(await signedSnapshot(signed)).toBe(before);
    expect(
      await count(
        `SELECT count(*)::int AS n FROM visit_record WHERE session_id = $1 AND status = 'signed'`,
        [signed],
      ),
    ).toBe(1);
    // kept: consent events (more of them, none deleted) and the audit log (only grew)
    expect(
      await count(
        `SELECT count(*)::int AS n FROM consent_event WHERE granted = false AND session_id IN ($1,$2)`,
        [signed, unsigned],
      ),
    ).toBe(withdrawnBefore + 6);
    expect(await count('SELECT count(*)::int AS n FROM audit_log')).toBeGreaterThan(auditBefore);
    // kept: the patient's own record (ClinicOS data) and the session rows
    expect(
      await count('SELECT count(*)::int AS n FROM mock_clinicos_patient WHERE id = $1', [p]),
    ).toBe(1);
    expect(
      await count(
        'SELECT count(*)::int AS n FROM consultation_session WHERE clinicos_patient_id = $1',
        [p],
      ),
    ).toBe(2);
  });

  it('withdrew all consent, so the speech service deletes the audio at its next run; the audio rows stay as metadata', async () => {
    for (const s of [signed, unsigned]) {
      const state = await service(`/internal/sessions/${s}/consent-status`);
      expect(state.body.data.scopes).toMatchObject({ audio: false, ai_processing: false });
    }
    expect(
      await count('SELECT count(*)::int AS n FROM audio_asset WHERE session_id IN ($1,$2)', [
        signed,
        unsigned,
      ]),
    ).toBe(2);
  });

  it('is audited with counts only, and the request cannot be completed twice', async () => {
    const rows = (
      await owner(`SELECT meta, actor_role FROM audit_log WHERE action = 'ERASURE_COMPLETED'`)
    ).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actor_role).toBe('admin');
    expect(rows[0]?.meta).toMatchObject({ signedVisitsKept: 1, sessions: 2 });
    expect(JSON.stringify(rows)).not.toMatch(/toy|Allergy|mock\.success/);
    expect(
      (
        await owner(
          `SELECT count(*)::int AS n FROM audit_log WHERE action = 'CONSENT_WITHDRAWN' AND meta->>'source' = 'erasure'`,
        )
      ).rows[0]?.n,
    ).toBe(2);
    expect(
      (await api('post', `/privacy/requests/${requestId}/complete`, admin, { confirm: true }))
        .status,
    ).toBe(409);
    const status = (
      await owner('SELECT status, decided_by FROM erasure_request WHERE id = $1', [requestId])
    ).rows[0];
    expect(status).toMatchObject({ status: 'completed', decided_by: adminId });
  });

  it('did not touch another patient', async () => {
    const other = patients[3] as string;
    const { signed: s2, unsigned: u2 } = await fill(other);
    const snap = await signedSnapshot(s2);
    const factsBefore = await count(
      'SELECT count(*)::int AS n FROM extracted_fact WHERE session_id = $1',
      [u2],
    );
    expect(factsBefore).toBeGreaterThan(0);
    // patient 2 was erased above; patient 3 (never requested) is intact
    expect(await signedSnapshot(s2)).toBe(snap);
    expect(
      await count('SELECT count(*)::int AS n FROM abha_link WHERE patient_id = $1', [other]),
    ).toBe(1);
    expect(
      await count(
        'SELECT count(*)::int AS n FROM patient_clinical_profile WHERE clinicos_patient_id = $1',
        [other],
      ),
    ).toBe(1);
  });
});

describe('the database guards behind it', () => {
  it('the erasure exception never reaches a signed visit: even with the flag on, signed facts and transcript stay', async () => {
    const p = patients[0] as string;
    const s = await signedSession(p);
    const app = new pg.Pool({ connectionString: h.db.appUrl, max: 1 });
    const client = await app.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('vaani.erasure', 'on', true)");
      await expect(
        client.query('DELETE FROM extracted_fact WHERE session_id = $1', [s]),
      ).rejects.toThrow();
      await client.query('ROLLBACK');
      await client.query('BEGIN');
      await client.query("SELECT set_config('vaani.erasure', 'on', true)");
      await expect(
        client.query('DELETE FROM prescription_item WHERE session_id = $1', [s]),
      ).rejects.toThrow();
      await client.query('ROLLBACK');
    } finally {
      client.release();
      await app.end();
    }
    // and without the flag a confirmed fact of an unsigned session still cannot be deleted by the app role
    const u = await sessionOf(p);
    await owner(
      `INSERT INTO extracted_fact (session_id, clinic_id, type, value, source, status, pipeline, confirmed_at, confirmed_by)
       VALUES ($1,$2,'symptom','toy','manual','confirmed','manual',now(),$3)`,
      [u, clinicId, doctorId],
    );
    const plain = new pg.Pool({ connectionString: h.db.appUrl, max: 1 });
    await expect(
      plain.query('DELETE FROM extracted_fact WHERE session_id = $1', [u]),
    ).rejects.toThrow(/confirmed fact cannot be deleted/);
    await plain.end();
  });
});
