// Mutation-style probes for erasure (Phase 12B Run 2, ADR-D45; the by-hand break-tests, kept). A checker looks for what a broken
// erasure would do: leave consent granted (so the audio would never be deleted), touch another patient's data, change a signed
// record. On the real code it finds none. For each rule we REPLACE it with a broken version (vi.doMock) and require the checker
// to notice. Fake data only.
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

type Mutation = 'none' | 'no-consent-withdrawal' | 'scope-too-wide';
const MOCKED = ['../src/consent/routes.js', '../src/db/tx.js'] as const;

async function violations(mutation: Mutation): Promise<string[]> {
  vi.resetModules();
  for (const m of MOCKED) vi.doUnmock(m);
  if (mutation === 'no-consent-withdrawal') {
    vi.doMock('../src/consent/routes.js', async (original) => ({
      ...(await original<typeof import('../src/consent/routes.js')>()),
      withdrawEverythingForPatient: async () => [],
    }));
  }
  if (mutation === 'scope-too-wide') {
    vi.doMock('../src/db/tx.js', async (original) => {
      const real = await original<typeof import('../src/db/tx.js')>();
      return {
        ...real,
        withTransaction: (pool: never, fn: (db: never) => Promise<unknown>) =>
          real.withTransaction(pool, (db) =>
            fn({
              ...db,
              query: (sql: unknown, ...rest: unknown[]) =>
                (db.query as (...a: unknown[]) => Promise<unknown>)(
                  String(sql).replace(
                    'DELETE FROM extracted_fact WHERE session_id = $1',
                    'DELETE FROM extracted_fact WHERE $1::uuid IS NOT NULL',
                  ),
                  ...rest,
                ),
            } as never),
          ),
      };
    });
  }
  const { createHarness, SEED_EMAIL, bearer } = await import('./db/helpers.js');
  const { serviceSignature } = await import('../src/auth/serviceAuth.js');
  const { TEST_INTERNAL_SECRET } = await import('./helpers.js');
  const { resetSignThrottle } = await import('../src/visits/service.js');
  const h = await createHarness();
  const found: string[] = [];
  try {
    const owner = (sql: string, p: unknown[] = []) => h.db.owner.query(sql, p);
    const admin = await h.tokenFor(SEED_EMAIL.admin);
    const staff = await h.tokenFor(SEED_EMAIL.staff);
    const doctor = await h.tokenFor(SEED_EMAIL.doctor1);
    const clinicId = h.seed.clinics[0]?.id as string;
    const doctorId = h.seed.users.find((u) => u.email === SEED_EMAIL.doctor1)?.id as string;
    const staffId = h.seed.users.find((u) => u.email === SEED_EMAIL.staff)?.id as string;
    const [a, b] = (
      await owner('SELECT id FROM mock_clinicos_patient WHERE clinic_id = $1 ORDER BY id LIMIT 2', [
        clinicId,
      ])
    ).rows.map((r) => r.id as string) as [string, string];
    const medicine = (
      await owner(
        `INSERT INTO medicine_master (generic_name, strength, dose_form, source, source_page) VALUES ('toy-medicine-em','10 mg','tablet','TOY-LIST 1',5) RETURNING id`,
      )
    ).rows[0]?.id as string;
    const session = async (patient: string) =>
      (
        await owner(
          `INSERT INTO consultation_session (clinicos_patient_id, clinicos_doctor_id, clinicos_clinic_id) VALUES ($1,$2,$3) RETURNING id`,
          [patient, doctorId, clinicId],
        )
      ).rows[0]?.id as string;
    const fact = (s: string) =>
      owner(
        `INSERT INTO extracted_fact (session_id, clinic_id, type, value, source, status, pipeline, confirmed_at, confirmed_by)
         VALUES ($1,$2,'symptom','toy','manual','confirmed','manual',now(),$3)`,
        [s, clinicId, doctorId],
      );
    resetSignThrottle();
    const signed = await session(a);
    await fact(signed);
    await request(h.app)
      .post(`/api/v1/sessions/${signed}/prescription/items`)
      .set(...bearer(doctor))
      .send({ medicineId: medicine, frequency: 'BD', duration: '5 days', dose: '1 tablet' });
    await request(h.app)
      .post(`/api/v1/sessions/${signed}/sign`)
      .set(...bearer(doctor))
      .send({ password: h.passwords[SEED_EMAIL.doctor1], safetyNotRunAcknowledged: true });
    const unsigned = await session(a);
    await fact(unsigned);
    await owner(
      `INSERT INTO consent_event (session_id, clinic_id, scope, granted, notice_version, notice_language, source, recorded_by_user_id, recorded_by_role, ts)
       VALUES ($1,$2,'audio',true,'0.1','en','staff',$3,'staff',now())`,
      [unsigned, clinicId, staffId],
    );
    const other = await session(b);
    await fact(other);
    const snapshot = async () =>
      JSON.stringify([
        (
          await owner('SELECT content_hash FROM visit_record_version WHERE session_id = $1', [
            signed,
          ])
        ).rows,
        (
          await owner('SELECT count(*)::int AS n FROM extracted_fact WHERE session_id = $1', [
            signed,
          ])
        ).rows,
      ]);
    const before = await snapshot();
    const id = (
      await request(h.app)
        .post('/api/v1/privacy/requests')
        .set(...bearer(staff))
        .send({ patientId: a, channel: 'phone' })
    ).body.data.id as string;
    await request(h.app)
      .post(`/api/v1/privacy/requests/${id}/review`)
      .set(...bearer(admin))
      .send({});
    const done = await request(h.app)
      .post(`/api/v1/privacy/requests/${id}/complete`)
      .set(...bearer(admin))
      .send({ confirm: true });
    if (done.status !== 200) found.push(`the request was not completed (${done.status})`);
    const ts = Math.floor(Date.now() / 1000);
    const path = `/api/v1/internal/sessions/${unsigned}/consent-status`;
    const state = await request(h.app)
      .get(path)
      .set('X-Service-Timestamp', String(ts))
      .set('X-Service-Signature', serviceSignature(TEST_INTERNAL_SECRET, ts, 'get', path, ''));
    if (state.body?.data?.scopes?.audio === true)
      found.push('audio consent is still granted after the erasure');
    if (
      Number(
        (
          await owner('SELECT count(*)::int AS n FROM extracted_fact WHERE session_id = $1', [
            other,
          ])
        ).rows[0]?.n,
      ) === 0
    ) {
      found.push("another patient's facts were removed");
    }
    if ((await snapshot()) !== before) found.push('the signed record changed');
  } finally {
    await h.close();
  }
  return found;
}

afterEach(() => {
  vi.resetModules();
});

describe('erasure guard mutations', () => {
  it('the real code has no violations', async () => {
    expect(await violations('none')).toEqual([]);
  }, 90_000);
  it('the checker notices when consent is not withdrawn', async () => {
    expect(await violations('no-consent-withdrawal')).toContain(
      'audio consent is still granted after the erasure',
    );
  }, 90_000);
  it("a deletion that reaches beyond the patient is noticed: the database guard refuses it (the signed record's facts are protected) and the checker sees the failure", async () => {
    const found = await violations('scope-too-wide');
    expect(found.length).toBeGreaterThan(0);
    expect(found.some((f) => /was not completed|another patient|signed record/.test(f))).toBe(true);
  }, 90_000);
});
