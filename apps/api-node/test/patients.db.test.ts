// Patients (ClinicOS stand-in through the adapter + VaaniEHR-owned allergy profile) and sessions.
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bearer, createHarness, SEED_EMAIL, type Harness } from './db/helpers.js';

let h: Harness;
let staff: string;
let doctor: string;
let doctor2: string;
let admin: string;

const OTHER_CLINIC = '5eed0000-0000-4000-8000-0000000000c2';

beforeEach(async () => {
  h = await createHarness();
  [staff, doctor, doctor2, admin] = await Promise.all([
    h.tokenFor(SEED_EMAIL.staff),
    h.tokenFor(SEED_EMAIL.doctor1),
    h.tokenFor(SEED_EMAIL.doctor2),
    h.tokenFor(SEED_EMAIL.admin),
  ]);
});
afterEach(async () => {
  await h.close();
});

const api = (method: 'get' | 'post' | 'put', path: string, token: string) =>
  request(h.app)
    [method](`/api/v1${path}`)
    .set(...bearer(token));
const auditActions = async () =>
  (
    await h.db.owner.query<{ action: string }>('SELECT action FROM audit_log ORDER BY seq')
  ).rows.map((r) => r.action);

describe('POST /patients/lookup', () => {
  it('finds a seeded patient and returns their allergy list', async () => {
    const res = await api('post', '/patients/lookup', staff).send({ phone: '0000000003' });
    expect(res.status).toBe(200);
    expect(res.body.data.found).toBe(true);
    expect(res.body.data.patient).toMatchObject({
      phone: '0000000003',
      isSimulated: true,
      allergies: ['Drug-B (FAKE)', 'Food-X (FAKE)'],
    });
  });

  it('"not found" is a normal 200 answer like ClinicOS, not a 404', async () => {
    const res = await api('post', '/patients/lookup', staff).send({ phone: '0000000099' });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ found: false });
  });

  it('accepts typed formatting but needs exactly 10 digits', async () => {
    expect(
      (await api('post', '/patients/lookup', staff).send({ phone: '00000-00001' })).status,
    ).toBe(200);
    expect(
      (await api('post', '/patients/lookup', staff).send({ phone: ' 00000 00001 ' })).status,
    ).toBe(200);
    // +91 prefixes would silently turn into the wrong number under ClinicOS's "first 10 digits" rule: refuse instead
    expect(
      (await api('post', '/patients/lookup', staff).send({ phone: '+91 98765 43210' })).status,
    ).toBe(400);
    expect((await api('post', '/patients/lookup', staff).send({ phone: '12345' })).status).toBe(
      400,
    );
    expect((await api('post', '/patients/lookup', staff).send({})).status).toBe(400);
  });

  it('is audited without the phone number', async () => {
    await api('post', '/patients/lookup', staff).send({ phone: '0000000001' });
    const row = (await h.db.owner.query("SELECT * FROM audit_log WHERE action = 'PATIENT_LOOKUP'"))
      .rows[0];
    expect(row.meta).toEqual({ found: true });
    expect(row.resource_id).toBe(h.seed.patients[0]?.id);
    expect(JSON.stringify(row)).not.toMatch(/(?<!\d)0000000001(?!\d)/);
  });

  it('never finds a patient of another clinic', async () => {
    await h.db.owner.query(
      `INSERT INTO mock_clinicos_patient (clinic_id, phone, name) VALUES ($1, '0000000777', 'Other Clinic Patient')`,
      [OTHER_CLINIC],
    );
    const res = await api('post', '/patients/lookup', staff).send({ phone: '0000000777' });
    expect(res.body.data).toEqual({ found: false });
  });
});

describe('POST /patients', () => {
  const body = {
    phone: '0000000500',
    name: 'Fake New Patient',
    dob: '1990-05-17',
    gender: 'female',
  };

  it('registers a patient (201), marked simulated, with an empty allergy list', async () => {
    const res = await api('post', '/patients', staff).send(body);
    expect(res.status).toBe(201);
    expect(res.body.data.created).toBe(true);
    expect(res.body.data.patient).toMatchObject({
      phone: '0000000500',
      dob: '1990-05-17',
      optInMsg: true,
      isSimulated: true,
      allergies: [],
    });
    const row = (
      await h.db.owner.query(
        "SELECT is_simulated FROM mock_clinicos_patient WHERE phone = '0000000500'",
      )
    ).rows[0];
    expect(row.is_simulated).toBe(true);
    expect(await auditActions()).toContain('PATIENT_CREATED');
  });

  it('an existing phone in the clinic returns the existing patient (200, created=false), like ClinicOS', async () => {
    const first = await api('post', '/patients', staff).send(body);
    const again = await api('post', '/patients', admin).send({ ...body, name: 'Different Name' });
    expect(again.status).toBe(200);
    expect(again.body.data.created).toBe(false);
    expect(again.body.data.patient.id).toBe(first.body.data.patient.id);
    expect(again.body.data.patient.name).toBe('Fake New Patient'); // not overwritten
  });

  it('accepts a patient with only a phone (ClinicOS quick-create)', async () => {
    const res = await api('post', '/patients', staff).send({ phone: '0000000501' });
    expect(res.status).toBe(201);
    expect(res.body.data.patient).toMatchObject({ name: null, dob: null, gender: null });
  });

  it.each([
    ['future date of birth', { dob: '2999-01-01' }],
    ['malformed date of birth', { dob: '17/05/1990' }],
    ['impossible date of birth', { dob: '1990-13-45' }],
    ['over-long name', { name: 'x'.repeat(201) }],
    ['over-long gender', { gender: 'x'.repeat(11) }],
    ['bad e-mail', { email: 'not-an-email' }],
    ['non-boolean opt-in', { optInMsg: 'yes' }],
  ])('rejects %s (400)', async (_label, extra) => {
    const res = await api('post', '/patients', staff).send({ phone: '0000000502', ...extra });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('doctors cannot register patients (PG-03 is staff and admin): 403', async () => {
    expect((await api('post', '/patients', doctor).send(body)).status).toBe(403);
  });
});

describe('GET /patients/:id and the allergy profile', () => {
  const pid = () => h.seed.patients[2]?.id as string;

  it('doctor, staff and admin can read a patient; the id must be a UUID', async () => {
    for (const token of [doctor, staff, admin]) {
      expect((await api('get', `/patients/${pid()}`, token)).status).toBe(200);
    }
    expect((await api('get', '/patients/not-a-uuid', staff)).status).toBe(400);
    expect((await api('get', '/patients/5eed0000-0000-4000-8000-00000000ffff', staff)).status).toBe(
      404,
    );
  });

  it('a patient of another clinic is "not found", not "forbidden"', async () => {
    const other = (
      await h.db.owner.query<{ id: string }>(
        `INSERT INTO mock_clinicos_patient (clinic_id, phone) VALUES ($1, '0000000888') RETURNING id`,
        [OTHER_CLINIC],
      )
    ).rows[0]?.id as string;
    expect((await api('get', `/patients/${other}`, staff)).status).toBe(404);
    expect(
      (await api('put', `/patients/${other}/clinical-profile`, staff).send({ allergies: [] }))
        .status,
    ).toBe(404);
  });

  it('staff replace the allergy list; duplicates collapse; doctors can read it but not write it', async () => {
    const put = await api('put', `/patients/${pid()}/clinical-profile`, staff).send({
      allergies: ['Drug-Z (FAKE)', 'Drug-Z (FAKE)', 'Food-Q (FAKE)'],
    });
    expect(put.status).toBe(200);
    expect(put.body.data.allergies).toEqual(['Drug-Z (FAKE)', 'Food-Q (FAKE)']);
    const read = await api('get', `/patients/${pid()}`, doctor);
    expect(read.body.data.allergies).toEqual(['Drug-Z (FAKE)', 'Food-Q (FAKE)']);
    expect(
      (await api('put', `/patients/${pid()}/clinical-profile`, doctor).send({ allergies: [] }))
        .status,
    ).toBe(403);
    const cleared = await api('put', `/patients/${pid()}/clinical-profile`, admin).send({
      allergies: [],
    });
    expect(cleared.body.data.allergies).toEqual([]);
  });

  it('records who changed the list, and audits the count only (never the allergies)', async () => {
    await api('put', `/patients/${pid()}/clinical-profile`, staff).send({
      allergies: ['Drug-Z (FAKE)'],
    });
    const profile = (
      await h.db.owner.query(
        'SELECT updated_by FROM patient_clinical_profile WHERE clinicos_patient_id = $1',
        [pid()],
      )
    ).rows[0];
    expect(profile.updated_by).toBe(h.seed.users.find((u) => u.role === 'staff')?.id);
    const row = (
      await h.db.owner.query("SELECT * FROM audit_log WHERE action = 'PATIENT_PROFILE_UPDATED'")
    ).rows[0];
    expect(row.meta).toEqual({ count: 1 });
    expect(JSON.stringify(row)).not.toContain('Drug-Z');
  });

  it.each([
    ['an empty entry', ['']],
    ['a blank entry', ['   ']],
    ['an over-long entry', ['x'.repeat(201)]],
    ['more than 50 entries', Array.from({ length: 51 }, (_, i) => `Item-${i} (FAKE)`)],
  ])('rejects %s (400)', async (_label, allergies) => {
    expect(
      (await api('put', `/patients/${pid()}/clinical-profile`, staff).send({ allergies })).status,
    ).toBe(400);
  });
});

describe('sessions', () => {
  const patientId = () => h.seed.patients[0]?.id as string;

  it('a doctor opens a session and becomes its doctor (201)', async () => {
    const res = await api('post', '/sessions', doctor).send({ patientId: patientId() });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      patientId: patientId(),
      doctorId: h.seed.users.find((u) => u.email === SEED_EMAIL.doctor1)?.id,
      clinicId: h.seed.clinics[0]?.id,
      status: 'created',
      endedAt: null,
    });
    expect(await auditActions()).toContain('SESSION_CREATED');
  });

  it('staff and admin cannot open a session (PRD 2.2: only doctors record consultations)', async () => {
    expect((await api('post', '/sessions', staff).send({ patientId: patientId() })).status).toBe(
      403,
    );
    expect((await api('post', '/sessions', admin).send({ patientId: patientId() })).status).toBe(
      403,
    );
  });

  it('refuses an unknown patient, a patient of another clinic, and a bad id', async () => {
    expect(
      (
        await api('post', '/sessions', doctor).send({
          patientId: '5eed0000-0000-4000-8000-00000000ffff',
        })
      ).status,
    ).toBe(404);
    const other = (
      await h.db.owner.query<{ id: string }>(
        `INSERT INTO mock_clinicos_patient (clinic_id, phone) VALUES ($1, '0000000999') RETURNING id`,
        [OTHER_CLINIC],
      )
    ).rows[0]?.id as string;
    expect((await api('post', '/sessions', doctor).send({ patientId: other })).status).toBe(404);
    expect((await api('post', '/sessions', doctor).send({ patientId: 'nope' })).status).toBe(400);
    expect((await api('post', '/sessions', doctor).send({})).status).toBe(400);
  });

  it('a doctor sees only their own sessions; staff and admin see the clinic; other clinics see nothing', async () => {
    const created = await api('post', '/sessions', doctor).send({ patientId: patientId() });
    const id = created.body.data.id as string;
    expect((await api('get', `/sessions/${id}`, doctor)).status).toBe(200);
    expect((await api('get', `/sessions/${id}`, doctor2)).status).toBe(404); // same clinic, other doctor
    expect((await api('get', `/sessions/${id}`, staff)).status).toBe(200);
    expect((await api('get', `/sessions/${id}`, admin)).status).toBe(200);
    await h.db.owner.query(
      'UPDATE consultation_session SET clinicos_clinic_id = $1 WHERE id = $2',
      [OTHER_CLINIC, id],
    );
    expect((await api('get', `/sessions/${id}`, staff)).status).toBe(404);
  });

  it('GET /sessions/:id includes the consent state, initially all off', async () => {
    const created = await api('post', '/sessions', doctor).send({ patientId: patientId() });
    const res = await api('get', `/sessions/${created.body.data.id}`, doctor);
    expect(res.body.data.consent).toMatchObject({
      recordingAllowed: false,
      whatsappAllowed: false,
    });
  });
});
