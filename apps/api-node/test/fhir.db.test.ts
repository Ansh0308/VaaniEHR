// FHIR bundles of a signed visit through the API (Phase 9A, ADR-D40): build and store, validator verdicts (valid, invalid,
// not validated), export only when valid, a signed visit staying signed, amendments as new bundle versions, doctor versus admin
// views, the database guard on a stored bundle, audit with counts only. The validator is replaced by a fake here; the real
// validator runs in `npm run fhir:check` and the CI job. Fake data only.
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { summariseOutcome, type FhirValidator } from '../src/fhir/validator.js';
import { resetSignThrottle } from '../src/visits/service.js';
import { bearer, createHarness, SEED_EMAIL, type Harness } from './db/helpers.js';

let h: Harness;
let doctor: string;
let doctor2: string;
let admin: string;
let staff: string;
let clinicId: string;
let doctorId: string;
let patientId: string;
let medA: string;

const PW = () => h.passwords[SEED_EMAIL.doctor1] as string;
const owner = (sql: string, p: unknown[] = []) => h.db.owner.query(sql, p);
const call = (
  method: 'get' | 'post',
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

const validOutcome = {
  resourceType: 'OperationOutcome',
  issue: [{ severity: 'information', details: { text: 'All OK' } }],
};
const badOutcome = {
  resourceType: 'OperationOutcome',
  issue: [
    {
      severity: 'error',
      expression: ['Bundle.entry[0].resource.subject'],
      details: { text: 'Composition.subject: minimum required = 1' },
    },
    {
      severity: 'warning',
      expression: ['Bundle.entry[1]'],
      details: { text: 'a warning that is kept' },
    },
  ],
};
const notRun = {
  status: 'not_validated' as const,
  errors: 0,
  warnings: 0,
  information: 0,
  issues: [],
  outcome: null,
  validatorVersion: null,
  message: 'The FHIR validator could not be reached or timed out.',
};
let calls = 0;
const fake = (mode: () => 'valid' | 'invalid' | 'down'): FhirValidator => ({
  validate: async () => {
    calls += 1;
    const m = mode();
    if (m === 'down') return notRun;
    return summariseOutcome(m === 'valid' ? validOutcome : badOutcome, '7.0.3');
  },
});

const newSigned = async (withMedicine = true): Promise<string> => {
  resetSignThrottle();
  const s = (
    await owner(
      `INSERT INTO consultation_session (clinicos_patient_id, clinicos_doctor_id, clinicos_clinic_id, started_at, ended_at)
       VALUES ($1,$2,$3,'2026-10-22T04:00:00Z','2026-10-22T04:20:00Z') RETURNING id`,
      [patientId, doctorId, clinicId],
    )
  ).rows[0]?.id as string;
  await owner(
    `INSERT INTO extracted_fact (session_id, clinic_id, type, value, negated, source, status, pipeline, confirmed_at, confirmed_by)
     VALUES ($1,$2,'symptom','toy symptom',true,'manual','confirmed','manual',now(),$3)`,
    [s, clinicId, doctorId],
  );
  if (withMedicine) {
    await call('post', s, '/prescription/items', {
      medicineId: medA,
      frequency: 'BD',
      duration: '5 days',
    });
  }
  const res = await call('post', s, '/sign', { password: PW(), safetyNotRunAcknowledged: true });
  expect(res.status).toBe(201);
  return s;
};

beforeAll(async () => {
  h = await createHarness();
  doctor = await h.tokenFor(SEED_EMAIL.doctor1);
  doctor2 = await h.tokenFor(SEED_EMAIL.doctor2);
  admin = await h.tokenFor(SEED_EMAIL.admin);
  staff = await h.tokenFor(SEED_EMAIL.staff);
  clinicId = h.seed.clinics[0]?.id as string;
  doctorId = h.seed.users.find((u) => u.email === SEED_EMAIL.doctor1)?.id as string;
  patientId = (
    await owner('SELECT id FROM mock_clinicos_patient WHERE clinic_id = $1 LIMIT 1', [clinicId])
  ).rows[0]?.id as string;
  medA = (
    await owner(
      `INSERT INTO medicine_master (generic_name, strength, dose_form, source, source_page)
       VALUES ('toy-medicine-fhir','10 mg','tablet','TOY-LIST 1',5) RETURNING id`,
    )
  ).rows[0]?.id as string;
});
afterAll(async () => {
  await h.close();
});

const mode = { current: 'valid' as 'valid' | 'invalid' | 'down' };
const withValidator = () => {
  h.services.fhirValidator = fake(() => mode.current);
};

describe('building and storing', () => {
  it('builds an OPConsultRecord and a PrescriptionRecord for a signed visit and stores the verdict', async () => {
    withValidator();
    mode.current = 'valid';
    const s = await newSigned();
    const res = await call('post', s, '/fhir', {});
    expect(res.status).toBe(201);
    const b = res.body.data;
    expect(b).toMatchObject({ currentVersion: 1, version: 1, versions: [1] });
    expect(b.bundles.map((x: { kind: string }) => x.kind)).toEqual(['op_consult', 'prescription']);
    expect(b.bundles[0]).toMatchObject({
      status: 'valid',
      errorCount: 0,
      exportable: true,
      igVersion: '6.5.0',
    });
    const op = b.bundles[0].bundle;
    expect(op.resourceType).toBe('Bundle');
    expect(op.entry[0].resource.meta.profile[0]).toMatch(/OPConsultRecord$/);
    const patient = op.entry.find(
      (e: { resource: { resourceType: string } }) => e.resource.resourceType === 'Patient',
    ).resource;
    expect(patient.identifier[0].value).toBe(patientId);
    const stored = (
      await owner(
        'SELECT status, validator_version FROM fhir_bundle WHERE session_id = $1 ORDER BY kind',
        [s],
      )
    ).rows;
    expect(stored).toEqual([
      { status: 'valid', validator_version: '7.0.3' },
      { status: 'valid', validator_version: '7.0.3' },
    ]);
  });

  it('a visit without medicines gets no prescription bundle', async () => {
    withValidator();
    const s = await newSigned(false);
    const res = await call('post', s, '/fhir', {});
    expect(res.body.data.bundles.map((x: { kind: string }) => x.kind)).toEqual(['op_consult']);
  });

  it('is refused for a visit that is not signed, and asking again keeps the stored verdict without asking the validator', async () => {
    withValidator();
    const draft = (
      await owner(
        `INSERT INTO consultation_session (clinicos_patient_id, clinicos_doctor_id, clinicos_clinic_id) VALUES ($1,$2,$3) RETURNING id`,
        [patientId, doctorId, clinicId],
      )
    ).rows[0]?.id as string;
    expect((await call('post', draft, '/fhir', {})).status).toBe(409);
    const s = await newSigned();
    await call('post', s, '/fhir', {});
    const before = calls;
    const again = await call('post', s, '/fhir', {});
    expect(again.status).toBe(201);
    expect(calls).toBe(before);
    expect(again.body.data.bundles).toHaveLength(2);
  });

  it('audits with versions and counts only, never the bundle', async () => {
    withValidator();
    mode.current = 'valid';
    const s = await newSigned();
    await call('post', s, '/fhir', {});
    const row = (
      await owner(
        "SELECT meta FROM audit_log WHERE action = 'FHIR_GENERATED' AND session_id = $1",
        [s],
      )
    ).rows[0];
    expect(row?.meta).toEqual({
      version: 1,
      bundleCount: 2,
      validCount: 2,
      invalidCount: 0,
      notValidatedCount: 0,
    });
  });
});

describe('verdicts and export', () => {
  it('an invalid bundle is stored with its errors AND warnings; the visit stays signed; export is refused', async () => {
    withValidator();
    mode.current = 'invalid';
    const s = await newSigned();
    const res = await call('post', s, '/fhir', {});
    const op = res.body.data.bundles[0];
    expect(op).toMatchObject({
      status: 'invalid',
      errorCount: 1,
      warningCount: 1,
      exportable: false,
    });
    expect(op.issues).toEqual([
      {
        severity: 'error',
        path: 'Bundle.entry[0].resource.subject',
        message: 'Composition.subject: minimum required = 1',
      },
      { severity: 'warning', path: 'Bundle.entry[1]', message: 'a warning that is kept' },
    ]);
    const visit = await call('get', s, '/visit');
    expect(visit.status).toBe(200);
    expect(visit.body.data.version).toBe(1);
    expect(
      (await owner('SELECT status FROM visit_record WHERE session_id = $1', [s])).rows[0]?.status,
    ).toBe('signed');
    const exp = await call('post', s, '/fhir/export', { kind: 'op_consult' });
    expect(exp.status).toBe(409);
  });

  it('a validator that is down gives not_validated with its reason, no retry, export refused; revalidate asks once more', async () => {
    withValidator();
    mode.current = 'down';
    const s = await newSigned();
    const before = calls;
    const res = await call('post', s, '/fhir', {});
    expect(calls - before).toBe(2); // one attempt per bundle, no loop
    expect(res.body.data.bundles[0]).toMatchObject({
      status: 'not_validated',
      exportable: false,
      notValidatedReason: 'The FHIR validator could not be reached or timed out.',
    });
    expect((await call('post', s, '/fhir/export', { kind: 'op_consult' })).status).toBe(409);
    mode.current = 'valid';
    const again = await call('post', s, '/fhir', { revalidate: true });
    expect(again.body.data.bundles.map((x: { status: string }) => x.status)).toEqual([
      'valid',
      'valid',
    ]);
    // a verdict of valid is never overwritten by a later request
    mode.current = 'invalid';
    const keep = await call('post', s, '/fhir', { revalidate: true });
    expect(keep.body.data.bundles.map((x: { status: string }) => x.status)).toEqual([
      'valid',
      'valid',
    ]);
  });

  it('a valid bundle can be exported as a file body; the export is audited', async () => {
    withValidator();
    mode.current = 'valid';
    const s = await newSigned();
    await call('post', s, '/fhir', {});
    const exp = await call('post', s, '/fhir/export', { kind: 'prescription' });
    expect(exp.status).toBe(200);
    expect(exp.body.data.filename).toBe(`visit-${s}-v1-prescription.json`);
    expect(exp.body.data.bundle.type).toBe('document');
    const row = (
      await owner("SELECT meta FROM audit_log WHERE action = 'FHIR_EXPORTED' AND session_id = $1", [
        s,
      ])
    ).rows[0];
    expect(row?.meta).toEqual({ version: 1, kind: 'prescription' });
    expect(
      (await call('post', s, '/fhir/export', { kind: 'prescription', version: 9 })).status,
    ).toBe(404);
  });
});

describe('amendments, roles and the database guard', () => {
  it('an amendment gets its own bundle version for the same visit; the first version is untouched', async () => {
    withValidator();
    mode.current = 'valid';
    const s = await newSigned();
    await call('post', s, '/fhir', {});
    const amend = await call('post', s, '/amend', {
      password: PW(),
      safetyNotRunAcknowledged: true,
      reason: 'toy reason',
      medicines: [{ medicineId: medA, frequency: 'OD', duration: '2 days' }],
    });
    expect(amend.status).toBe(201);
    const v2 = await call('post', s, '/fhir', {});
    expect(v2.body.data).toMatchObject({ currentVersion: 2, version: 2, versions: [1, 2] });
    const bundle = v2.body.data.bundles[0].bundle;
    expect(bundle.meta.versionId).toBe('2');
    const v1 = await call('get', s, '/fhir?version=1');
    expect(v1.body.data.bundles[0].bundle.meta.versionId).toBe('1');
    expect(v1.body.data.bundles[0].bundle.identifier).toEqual(bundle.identifier);
  });

  it('the doctor sees the bundle, the admin sees the verdict and errors but not the bundle, others are refused', async () => {
    withValidator();
    mode.current = 'invalid';
    const s = await newSigned();
    await call('post', s, '/fhir', {});
    const asDoctor = await call('get', s, '/fhir');
    expect(asDoctor.body.data.bundles[0].bundle).not.toBeNull();
    const asAdmin = await call('get', s, '/fhir', undefined, admin);
    expect(asAdmin.status).toBe(200);
    expect(asAdmin.body.data.bundles[0]).toMatchObject({
      status: 'invalid',
      errorCount: 1,
      bundle: null,
    });
    expect(asAdmin.body.data.bundles[0].issues).toHaveLength(2);
    expect((await call('get', s, '/fhir', undefined, staff)).status).toBe(403);
    expect((await call('post', s, '/fhir', {}, admin)).status).toBe(403);
    expect((await call('post', s, '/fhir/export', { kind: 'op_consult' }, admin)).status).toBe(403);
    expect((await call('get', s, '/fhir', undefined, doctor2)).status).toBe(404);
  });

  it('the database refuses to change or delete a stored bundle, but allows its verdict to be filled in', async () => {
    withValidator();
    mode.current = 'valid';
    const s = await newSigned();
    await call('post', s, '/fhir', {});
    const q = (sql: string) => h.appPool.query(sql, [s]);
    await expect(
      q("UPDATE fhir_bundle SET bundle = '{}'::jsonb WHERE session_id = $1"),
    ).rejects.toThrow(/cannot be changed/);
    await expect(q('DELETE FROM fhir_bundle WHERE session_id = $1')).rejects.toThrow(
      /permission denied|cannot be deleted/,
    );
    await expect(
      q('UPDATE fhir_bundle SET warning_count = 3 WHERE session_id = $1'),
    ).resolves.toBeTruthy();
  });

  it('refuses a verdict that does not fit: valid without validator output, or not validated without a reason', async () => {
    const s = await newSigned();
    const ins = (status: string, errors: number, output: string | null, reason: string | null) =>
      owner(
        `INSERT INTO fhir_bundle (session_id, clinic_id, version, kind, bundle, status, error_count, validator_output, not_validated_reason, ig_version, created_by)
         VALUES ($1,$2,7,'op_consult','{}'::jsonb,$3,$4,$5::jsonb,$6,'6.5.0',$7)`,
        [s, clinicId, status, errors, output, reason, doctorId],
      );
    await expect(ins('valid', 0, null, null)).rejects.toThrow(/fhir_bundle_valid_has_output/);
    await expect(ins('not_validated', 0, null, null)).rejects.toThrow(
      /fhir_bundle_not_validated_has_reason/,
    );
    await expect(ins('invalid', 0, '{}', null)).rejects.toThrow(/fhir_bundle_invalid_has_errors/);
  });
});
