// Prescription rows (PG-08), sign-off, immutability, amendments and history (Phase 8 Run 1, ADR-D38).
// Fake medicine names and toy words only. The server decides every blocker; the safety engine does not exist (Phase 7),
// so signing needs the explicit acknowledgement "Safety checks were not run".
import { createHash, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resetSignThrottle } from '../src/visits/service.js';
import { bearer, createHarness, SEED_EMAIL, type Harness } from './db/helpers.js';

let h: Harness;
let doctor: string;
let doctor2: string;
let staff: string;
let clinicId: string;
let doctorId: string;
let medA: string;
let medRetired: string;

const PW = () => h.passwords[SEED_EMAIL.doctor1] as string;
const call = (
  method: 'get' | 'post' | 'patch' | 'delete',
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
const owner = (sql: string, params: unknown[] = []) => h.db.owner.query(sql, params);

const newSession = async (): Promise<string> => {
  const patient = (
    await owner('SELECT id FROM mock_clinicos_patient WHERE clinic_id = $1 LIMIT 1', [clinicId])
  ).rows[0]?.id;
  return (
    await owner(
      `INSERT INTO consultation_session (clinicos_patient_id, clinicos_doctor_id, clinicos_clinic_id)
       VALUES ($1, $2, $3) RETURNING id`,
      [patient, doctorId, clinicId],
    )
  ).rows[0]?.id as string;
};
const consent = (session: string, scope: string, granted = true) =>
  owner(
    `INSERT INTO consent_event (session_id, clinic_id, scope, granted, notice_version, notice_language, source,
       recorded_by_user_id, recorded_by_role, ts)
     VALUES ($1,$2,$3,$4,'0.1','en','staff',$5,'staff',now())`,
    [session, clinicId, scope, granted, h.seed.users.find((u) => u.email === SEED_EMAIL.staff)?.id],
  );
const fact = (
  session: string,
  status: 'heard' | 'confirmed' | 'stale',
  concept: string | null = null,
) =>
  owner(
    `INSERT INTO extracted_fact (session_id, clinic_id, type, value, source, status, pipeline, confirmed_at,
       confirmed_by, concept_id, concept_status, concept_confirmed_by, concept_confirmed_at)
     VALUES ($1,$2,'symptom','toy fact','manual',$3,'manual',$4,$5,$6,$7,$5,$4)`,
    [
      session,
      clinicId,
      status,
      status === 'confirmed' ? new Date() : null,
      doctorId,
      concept,
      concept ? 'confirmed' : 'none',
    ],
  );
const redFlag = (session: string, status: 'suggested' | 'acknowledged') =>
  owner(
    `INSERT INTO question_event (session_id, clinic_id, pathway_id, pathway_version, node_id, slot, kind, status,
       acted_at, acted_by)
     VALUES ($1,$2,'toy_condition_b',1,'q3','toy_redflag_1','red_flag',$3,$4,$5)`,
    [
      session,
      clinicId,
      status,
      status === 'suggested' ? null : new Date(),
      status === 'suggested' ? null : doctorId,
    ],
  );
const asked = (session: string) =>
  owner(
    `INSERT INTO question_event (session_id, clinic_id, pathway_id, pathway_version, node_id, slot, kind, status,
       acted_at, acted_by)
     VALUES ($1,$2,'toy_condition_a',1,'q1','toy_symptom_1','question','dismissed',now(),$3)`,
    [session, clinicId, doctorId],
  );
const selectCondition = (session: string) =>
  owner(
    `INSERT INTO candidate (session_id, clinic_id, kind, pathway_id, pathway_version, selected_by, selected_at)
     VALUES ($1,$2,'selected','toy_condition_a',1,$3,now())`,
    [session, clinicId, doctorId],
  );
const mkMedicine = async (name: string, retired = false): Promise<string> =>
  (
    await owner(
      `INSERT INTO medicine_master (generic_name, strength, dose_form, source, source_page, retired_at)
       VALUES ($1,'100 mg','tablet','TOY-LIST 1',7,$2) RETURNING id`,
      [name, retired ? new Date() : null],
    )
  ).rows[0]?.id as string;

const goodRow = (over: object = {}) => ({
  medicineId: medA,
  frequency: 'BD',
  duration: '5 days',
  ...over,
});
const addRow = (session: string, over: object = {}) =>
  call('post', session, '/prescription/items', goodRow(over));
const sign = (session: string, over: object = {}, token = doctor) =>
  call(
    'post',
    session,
    '/sign',
    { password: PW(), safetyNotRunAcknowledged: true, ...over },
    token,
  );
const auditOf = async (action: string, session: string) =>
  (
    await owner(
      'SELECT meta, actor_user_id FROM audit_log WHERE action = $1 AND session_id = $2 ORDER BY seq',
      [action, session],
    )
  ).rows;

beforeAll(async () => {
  h = await createHarness();
  doctor = await h.tokenFor(SEED_EMAIL.doctor1);
  doctor2 = await h.tokenFor(SEED_EMAIL.doctor2);
  staff = await h.tokenFor(SEED_EMAIL.staff);
  clinicId = h.seed.clinics[0]?.id as string;
  doctorId = h.seed.users.find((u) => u.email === SEED_EMAIL.doctor1)?.id as string;
  medA = await mkMedicine('toy-medicine-alpha');
  medRetired = await mkMedicine('toy-medicine-retired', true);
});
afterAll(async () => {
  await h.close();
});

describe('prescription rows', () => {
  it('adds a master row: generic name, strength and form come from the master, the source is kept', async () => {
    const s = await newSession();
    const res = await addRow(s, { dose: '1 tablet', note: 'after food' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      source: 'master',
      name: 'toy-medicine-alpha',
      strength: '100 mg',
      doseForm: 'tablet',
      dose: '1 tablet',
      frequency: 'BD',
      duration: '5 days',
      note: 'after food',
      masterSource: 'TOY-LIST 1',
      masterSourcePage: 7,
      masterReviewStatus: 'not_reviewed',
      incomplete: false,
    });
    expect((await auditOf('PRESCRIPTION_ITEM_ADDED', s))[0]?.meta).toEqual({ source: 'master' });
  });

  it('the "Not in master list" fallback needs a name and is flagged free_text', async () => {
    const s = await newSession();
    expect((await addRow(s, { medicineId: null })).status).toBe(400);
    const res = await addRow(s, {
      medicineId: null,
      name: 'toy hand-typed medicine',
      strength: '5 ml',
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      source: 'free_text',
      medicineId: null,
      name: 'toy hand-typed medicine',
      masterSource: null,
      masterReviewStatus: null,
    });
  });

  it('the server validates required fields, frequency codes and the master list', async () => {
    const s = await newSession();
    expect((await addRow(s, { frequency: 'EVERY_HOUR' })).status).toBe(400);
    expect((await addRow(s, { duration: '' })).status).toBe(400);
    expect((await addRow(s, { frequency: undefined })).status).toBe(400);
    expect((await addRow(s, { medicineId: randomUUID() })).status).toBe(400);
    expect((await addRow(s, { medicineId: medRetired })).status).toBe(400);
    expect((await addRow(s, { unknownField: 1 })).status).toBe(400);
    expect((await call('get', s, '/prescription')).body.data.rows).toHaveLength(0);
  });

  it('every field can be edited before signing; a master name cannot be renamed', async () => {
    const s = await newSession();
    const id = (await addRow(s)).body.data.id as string;
    const res = await call('patch', s, `/prescription/items/${id}`, {
      strength: '200 mg',
      frequency: 'TDS',
      duration: '3 days',
      note: null,
    });
    expect(res.body.data).toMatchObject({
      strength: '200 mg',
      frequency: 'TDS',
      duration: '3 days',
      note: null,
    });
    expect((await call('patch', s, `/prescription/items/${id}`, { name: 'x' })).status).toBe(400);
    expect((await call('patch', s, `/prescription/items/${id}`, {})).status).toBe(400);
    expect((await auditOf('PRESCRIPTION_ITEM_EDITED', s))[0]?.meta).toEqual({ fieldCount: 4 });
    expect((await call('delete', s, `/prescription/items/${id}`)).status).toBe(200);
    expect((await call('delete', s, `/prescription/items/${id}`)).status).toBe(404);
    expect(await auditOf('PRESCRIPTION_ITEM_REMOVED', s)).toHaveLength(1);
  });

  it('applies a template as editable rows; a line without frequency or duration is flagged incomplete', async () => {
    const s = await newSession();
    const t = (
      await owner(
        `INSERT INTO med_template (name, owner_user_id, clinic_id, visibility) VALUES ('toy template',$1,$2,'personal')
         RETURNING id`,
        [doctorId, clinicId],
      )
    ).rows[0]?.id as string;
    await owner(
      `INSERT INTO med_template_item (template_id, medicine_id, position, dose, frequency, duration, instructions)
       VALUES ($1,$2,0,'1 tablet','OD','7 days','toy note'), ($1,$2,1,NULL,NULL,NULL,NULL)`,
      [t, medA],
    );
    const res = await call('post', s, '/prescription/apply-template', { templateId: t });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ added: 2, skippedRetired: 0 });
    const [full, partial] = res.body.data.rows;
    expect(full).toMatchObject({
      frequency: 'OD',
      duration: '7 days',
      fromTemplateId: t,
      incomplete: false,
    });
    expect(partial).toMatchObject({ frequency: null, duration: null, incomplete: true });
    // the doctor completes it
    const fixed = await call('patch', s, `/prescription/items/${partial.id}`, {
      frequency: 'BD',
      duration: '2 days',
    });
    expect(fixed.body.data.incomplete).toBe(false);
    expect((await auditOf('PRESCRIPTION_TEMPLATE_APPLIED', s))[0]?.meta).toEqual({
      addedCount: 2,
      skippedRetiredCount: 0,
    });
    // another doctor's personal template is not visible
    const s2 = await newSession();
    expect(
      (await call('post', s2, '/prescription/apply-template', { templateId: t }, doctor2)).status,
    ).toBe(404);
  });

  it('is doctor only, the session’s own doctor, and works with no consent at all (the manual path)', async () => {
    const s = await newSession(); // no consent recorded
    expect((await addRow(s)).status).toBe(201);
    expect((await call('post', s, '/prescription/items', goodRow(), staff)).status).toBe(403);
    expect((await call('get', s, '/prescription', undefined, staff)).status).toBe(403);
    expect((await call('get', s, '/prescription', undefined, doctor2)).status).toBe(404);
    expect((await call('post', s, '/prescription/items', goodRow(), doctor2)).status).toBe(404);
  });
});

describe('sign-off: the server names every blocker', () => {
  it('a plain visit with NO medicine rows signs (no medicines is not a blocker)', async () => {
    const s = await newSession();
    const ready = (await call('get', s, '/sign-readiness')).body.data;
    expect(ready).toMatchObject({
      signed: false,
      blockers: [],
      medicineCount: 0,
      currentVersion: null,
      safety: { configured: false, blocked: 0 },
    });
    const res = await sign(s);
    expect(res.status).toBe(201);
    expect(res.body.data.content.medicines).toEqual([]);
  });

  it('unconfirmed (heard or stale) facts block, with the count', async () => {
    const s = await newSession();
    await fact(s, 'heard');
    await fact(s, 'stale');
    await fact(s, 'confirmed');
    const res = await sign(s);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: 'SIGN_BLOCKED',
      details: { blockers: [{ code: 'unconfirmed_facts', count: 2 }] },
    });
    expect((await call('get', s, '/visit')).status).toBe(404); // nothing was stored
  });

  it('an unacknowledged red flag blocks; acknowledged clears it', async () => {
    const s = await newSession();
    await redFlag(s, 'suggested');
    const res = await sign(s);
    expect(res.body.error.details.blockers).toEqual(
      expect.arrayContaining([{ code: 'red_flag_unacknowledged', count: 1 }]),
    );
    await owner(
      `UPDATE question_event SET status = 'acknowledged', acted_at = now(), acted_by = $2 WHERE session_id = $1`,
      [s, doctorId],
    );
    expect(
      (await call('get', s, '/sign-readiness')).body.data.blockers.map(
        (b: { code: string }) => b.code,
      ),
    ).not.toContain('red_flag_unacknowledged');
  });

  it('a working condition is needed only when a pathway ran; "not listed" counts as a choice', async () => {
    const s = await newSession();
    await consent(s, 'audio');
    await consent(s, 'ai_processing');
    await asked(s);
    const blocked = await sign(s);
    expect(blocked.body.error.details.blockers).toEqual([
      { code: 'no_working_condition', count: 1 },
    ]);
    await owner(
      `INSERT INTO candidate (session_id, clinic_id, kind, not_listed, not_listed_text, selected_by, selected_at)
       VALUES ($1,$2,'selected',true,'toy free note',$3,now())`,
      [s, clinicId, doctorId],
    );
    const res = await sign(s);
    expect(res.status).toBe(201);
    expect(res.body.data.content.workingCondition).toEqual({
      kind: 'not_listed',
      text: 'toy free note',
    });
  });

  it('AI content without consent blocks; manual-only content does not', async () => {
    const s = await newSession(); // no consent
    await fact(s, 'confirmed', 'toy_c_toy_symptom_1'); // a doctor-confirmed concept link = AI content
    const res = await sign(s);
    expect(res.body.error.details.blockers).toEqual([{ code: 'consent_missing', count: 1 }]);
    await consent(s, 'audio');
    await consent(s, 'ai_processing');
    expect((await sign(s)).status).toBe(201);
    // consent granted and then withdrawn again
    const s2 = await newSession();
    await consent(s2, 'audio');
    await consent(s2, 'ai_processing');
    await consent(s2, 'ai_processing', false);
    await fact(s2, 'confirmed', 'toy_c_toy_symptom_1');
    expect((await sign(s2)).body.error.details.blockers[0].code).toBe('consent_missing');
    // a manual fact with no concept link is the doctor's own and needs no AI consent
    const s3 = await newSession();
    await fact(s3, 'confirmed');
    expect((await sign(s3)).status).toBe(201);
  });

  it('an incomplete medicine row (template line without frequency/duration) blocks', async () => {
    const s = await newSession();
    await owner(
      `INSERT INTO prescription_item (session_id, clinic_id, position, medicine_id, name, source, created_by)
       VALUES ($1,$2,0,$3,'toy-medicine-alpha','master',$4)`,
      [s, clinicId, medA, doctorId],
    );
    const res = await sign(s);
    expect(res.body.error.details.blockers).toEqual([{ code: 'incomplete_medicine', count: 1 }]);
  });

  it('a refused sign-off is audited (ids and counts) even though nothing was stored', async () => {
    const s = await newSession();
    await fact(s, 'heard');
    await sign(s);
    const rows = await auditOf('VISIT_SIGN_REFUSED', s);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.meta).toEqual({ cause: 'blocked', blockerCount: 1 });
  });
});

describe('sign-off: safety acknowledgement and password', () => {
  it('refuses without the acknowledgement "Safety checks were not run" and stores nothing', async () => {
    const s = await newSession();
    const res = await sign(s, { safetyNotRunAcknowledged: false });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('SAFETY_ACK_REQUIRED');
    expect((await auditOf('VISIT_SIGN_REFUSED', s))[0]?.meta).toMatchObject({
      cause: 'safety_acknowledgement',
    });
    expect((await owner('SELECT 1 FROM visit_record WHERE session_id = $1', [s])).rowCount).toBe(0);
  });

  it('the safety interface is always asked, and a configured engine with blocked alerts refuses', async () => {
    const s = await newSession();
    const calls: unknown[] = [];
    const original = h.services.safety;
    h.services.safety = {
      run: async (input) => {
        calls.push(input);
        return { configured: true, blocked: 1, message: 'toy engine' };
      },
    };
    try {
      await addRow(s);
      const res = await sign(s, { safetyNotRunAcknowledged: true });
      expect(res.status).toBe(409);
      expect(calls).toHaveLength(1);
      expect((calls[0] as { medicines: unknown[] }).medicines).toHaveLength(1);
      h.services.safety = {
        run: async () => ({ configured: true, blocked: 0, message: 'toy engine' }),
      };
      const ok = await sign(s, { safetyNotRunAcknowledged: false }); // a configured engine needs no acknowledgement
      expect(ok.status).toBe(201);
      expect(ok.body.data).toMatchObject({
        safetyConfigured: true,
        safetyNotRunAcknowledged: false,
      });
    } finally {
      h.services.safety = original;
    }
  });

  it('a wrong password is refused (403, not 401), audited, and locks signing after five tries', async () => {
    resetSignThrottle();
    const s = await newSession();
    for (let i = 0; i < 5; i += 1) {
      const res = await sign(s, { password: 'not the password' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('INVALID_PASSWORD');
    }
    expect((await auditOf('VISIT_SIGN_REFUSED', s)).every((r) => r.meta.cause === 'password')).toBe(
      true,
    );
    const locked = await sign(s); // even the right password is refused while locked
    expect(locked.status).toBe(429);
    resetSignThrottle();
    expect((await sign(s)).status).toBe(201);
  });

  it("another doctor's password does not sign", async () => {
    resetSignThrottle();
    const s = await newSession();
    const res = await sign(s, { password: h.passwords[SEED_EMAIL.doctor2] });
    expect(res.status).toBe(403);
    resetSignThrottle();
  });
});

describe('a signed visit', () => {
  let s: string;
  let first: { content: Record<string, unknown>; contentHash: string; version: number };

  beforeAll(async () => {
    resetSignThrottle();
    s = await newSession();
    await consent(s, 'audio');
    await consent(s, 'ai_processing');
    await fact(s, 'confirmed', 'toy_c_toy_symptom_1');
    await fact(s, 'confirmed');
    await selectCondition(s);
    await addRow(s, { dose: '1 tablet' });
    await addRow(s, { medicineId: null, name: 'toy hand-typed medicine' });
    const res = await sign(s);
    expect(res.status).toBe(201);
    first = res.body.data;
  });

  it('stores the exact snapshot with a SHA-256 over its sorted-key JSON', async () => {
    expect(first.version).toBe(1);
    const c = first.content as {
      facts: unknown[];
      medicines: { source: string; masterSource: string | null }[];
      workingCondition: unknown;
      aiContentIncluded: boolean;
      consent: unknown;
    };
    expect(c.facts).toHaveLength(2);
    expect(c.medicines.map((m) => m.source)).toEqual(['master', 'free_text']);
    expect(c.medicines[0]?.masterSource).toBe('TOY-LIST 1');
    expect(c.workingCondition).toEqual({
      kind: 'pathway',
      pathwayId: 'toy_condition_a',
      version: 1,
    });
    expect(c.aiContentIncluded).toBe(true);
    expect(c.consent).toEqual({ audio: true, aiProcessing: true });
    const canon = (v: unknown): string =>
      Array.isArray(v)
        ? `[${v.map(canon).join(',')}]`
        : v && typeof v === 'object'
          ? `{${Object.keys(v as object)
              .sort()
              .map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`)
              .join(',')}}`
          : JSON.stringify(v);
    expect(first.contentHash).toBe(createHash('sha256').update(canon(first.content)).digest('hex'));
    const stored = (
      await owner(
        'SELECT content_hash, safety_not_run_acknowledged FROM visit_record_version WHERE session_id = $1',
        [s],
      )
    ).rows[0];
    expect(stored).toMatchObject({
      content_hash: first.contentHash,
      safety_not_run_acknowledged: true,
    });
  });

  it('shows the "Safety checks were not run" flag on the record', async () => {
    const v = (await call('get', s, '/visit')).body.data;
    expect(v).toMatchObject({
      safetyConfigured: false,
      safetyNotRunAcknowledged: true,
      version: 1,
      kind: 'signed',
    });
  });

  it('audits the sign-off with ids and counts only', async () => {
    const [row] = await auditOf('VISIT_SIGNED', s);
    expect(row?.actor_user_id).toBe(doctorId);
    expect(row?.meta).toEqual({
      version: 1,
      factCount: 2,
      medicineCount: 2,
      safetyNotRun: true,
      aiContent: true,
    });
    expect(JSON.stringify(row?.meta)).not.toMatch(/toy/);
  });

  it('cannot be signed again (session_not_draft)', async () => {
    const res = await sign(s);
    expect(res.status).toBe(409);
    expect(res.body.error.details.blockers).toEqual(
      expect.arrayContaining([{ code: 'session_not_draft', count: 1 }]),
    );
  });

  it('refuses every content change through the API (409 VISIT_SIGNED)', async () => {
    const id = (await call('get', s, '/prescription')).body.data.rows[0].id as string;
    const attempts = [
      call('post', s, '/prescription/items', goodRow()),
      call('patch', s, `/prescription/items/${id}`, { duration: '1 day' }),
      call('delete', s, `/prescription/items/${id}`),
      call('post', s, '/facts', { type: 'symptom', value: 'late fact' }),
      call('post', s, '/prescription/apply-template', { templateId: randomUUID() }),
    ];
    for (const r of await Promise.all(attempts)) {
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('VISIT_SIGNED');
    }
    expect((await call('get', s, '/prescription')).body.data).toMatchObject({ locked: true });
  });

  it('the database refuses changes by the app role (trigger, second guard)', async () => {
    const q = (sql: string, p: unknown[] = []) => h.appPool.query(sql, p);
    await expect(
      q("UPDATE prescription_item SET duration = '1 day' WHERE session_id = $1", [s]),
    ).rejects.toThrow(/signed visit cannot be changed/);
    await expect(q('DELETE FROM prescription_item WHERE session_id = $1', [s])).rejects.toThrow(
      /signed visit cannot be changed/,
    );
    await expect(
      q(
        `INSERT INTO prescription_item (session_id, clinic_id, position, name, source, created_by)
         VALUES ($1,$2,9,'x','free_text',$3)`,
        [s, clinicId, doctorId],
      ),
    ).rejects.toThrow(/signed visit cannot be changed/);
    await expect(
      q("UPDATE visit_record_version SET content_hash = repeat('0',64) WHERE session_id = $1", [s]),
    ).rejects.toThrow(/permission denied|cannot be changed or deleted/);
    await expect(q('DELETE FROM visit_record_version WHERE session_id = $1', [s])).rejects.toThrow(
      /permission denied|cannot be changed or deleted/,
    );
    await expect(q('DELETE FROM visit_record WHERE session_id = $1', [s])).rejects.toThrow(
      /permission denied|cannot be deleted/,
    );
    await expect(
      q("UPDATE visit_record SET status = 'draft' WHERE session_id = $1", [s]),
    ).rejects.toThrow(/cannot go back to draft/);
  });

  it('the database requires a safety flag and a reason on an amendment', async () => {
    const v = (await owner('SELECT id FROM visit_record WHERE session_id = $1', [s])).rows[0]?.id;
    const ins = (
      kind: string,
      version: number,
      reason: string | null,
      configured: boolean,
      ack: boolean,
    ) =>
      owner(
        `INSERT INTO visit_record_version (visit_id, session_id, clinic_id, version, kind, content, content_hash,
           safety_configured, safety_not_run_acknowledged, reason, signed_by)
         VALUES ($1,$2,$3,$4,$5,'{}',repeat('a',64),$6,$7,$8,$9)`,
        [v, s, clinicId, version, kind, configured, ack, reason, doctorId],
      );
    await expect(ins('amendment', 2, null, false, true)).rejects.toThrow(
      /visit_version_amendment_has_reason/,
    );
    await expect(ins('amendment', 2, 'why', false, false)).rejects.toThrow(
      /visit_version_safety_acknowledged/,
    );
  });

  describe('amendments and history', () => {
    const amend = (over: object = {}, token = doctor, session = s) =>
      call(
        'post',
        session,
        '/amend',
        {
          password: PW(),
          safetyNotRunAcknowledged: true,
          reason: 'wrong duration typed',
          medicines: [goodRow({ duration: '3 days' })],
          ...over,
        },
        token,
      );

    it('needs a reason, the password and the safety acknowledgement', async () => {
      resetSignThrottle();
      expect((await amend({ reason: '' })).status).toBe(400);
      expect((await amend({ reason: undefined })).status).toBe(400);
      expect((await amend({ safetyNotRunAcknowledged: false })).body.error.code).toBe(
        'SAFETY_ACK_REQUIRED',
      );
      expect((await amend({ password: 'nope' })).body.error.code).toBe('INVALID_PASSWORD');
      expect((await amend({}, staff)).status).toBe(403);
      expect((await amend({}, doctor2)).status).toBe(404);
      expect((await auditOf('VISIT_AMEND_REFUSED', s)).map((r) => r.meta.cause)).toEqual([
        'safety_acknowledgement',
        'password',
      ]);
      resetSignThrottle();
    });

    it('is refused for a visit that is not signed', async () => {
      const draft = await newSession();
      expect((await amend({}, doctor, draft)).status).toBe(409);
    });

    it('adds version 2 with its reason, keeps version 1 exactly, and audits without the reason text', async () => {
      const res = await amend();
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        version: 2,
        kind: 'amendment',
        reason: 'wrong duration typed',
      });
      expect(res.body.data.content.amendedFrom).toBe(1);
      expect(res.body.data.content.medicines).toHaveLength(1);
      expect(res.body.data.content.facts).toEqual(first.content.facts); // facts carried over unchanged
      expect(res.body.data.contentHash).not.toBe(first.contentHash);
      const v1 = (await call('get', s, '/visit/versions/1')).body.data;
      expect(v1.contentHash).toBe(first.contentHash);
      expect(v1.content).toEqual(first.content);
      expect((await call('get', s, '/visit')).body.data.version).toBe(2);
      const [row] = await auditOf('VISIT_AMENDED', s);
      expect(row?.meta).toEqual({ version: 2, medicineCount: 1 });
    });

    it('lists the history oldest first, without content, and 404s an unknown version', async () => {
      const list = (await call('get', s, '/visit/versions')).body.data.versions;
      expect(list.map((v: { version: number; kind: string }) => [v.version, v.kind])).toEqual([
        [1, 'signed'],
        [2, 'amendment'],
      ]);
      expect(list[0]).not.toHaveProperty('content');
      expect((await call('get', s, '/visit/versions/9')).status).toBe(404);
      expect((await call('get', s, '/visit/versions', undefined, doctor2)).status).toBe(404);
      expect((await call('get', s, '/visit/versions', undefined, staff)).status).toBe(403);
    });

    it('an amendment validates the medicine rows like the builder does', async () => {
      resetSignThrottle();
      expect((await amend({ medicines: [goodRow({ frequency: 'X' })] })).status).toBe(400);
      expect((await amend({ medicines: [goodRow({ medicineId: medRetired })] })).status).toBe(400);
    });
  });
});

describe('after consent is withdrawn (OCI-016)', () => {
  it('a signed record is kept and still readable; the current content is not touched', async () => {
    resetSignThrottle();
    const s = await newSession();
    await consent(s, 'audio');
    await consent(s, 'ai_processing');
    await fact(s, 'confirmed', 'toy_c_toy_symptom_1');
    const signed = await sign(s);
    expect(signed.status).toBe(201);
    const withdrawn = await request(h.app)
      .post(`/api/v1/sessions/${s}/consent/withdraw`)
      .set(...bearer(doctor))
      .send({ scopes: ['ai_processing'], source: 'patient' });
    expect([200, 201]).toContain(withdrawn.status);
    const v = await call('get', s, '/visit');
    expect(v.status).toBe(200);
    expect(v.body.data.contentHash).toBe(signed.body.data.contentHash);
    // the doctor can still correct a medicine: an amendment does not process anything with AI
    const amended = await call('post', s, '/amend', {
      password: PW(),
      safetyNotRunAcknowledged: true,
      reason: 'fix after withdrawal',
      medicines: [],
    });
    expect(amended.status).toBe(201);
  });
});
