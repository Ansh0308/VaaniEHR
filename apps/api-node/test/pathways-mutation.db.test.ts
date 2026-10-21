// Mutation-style tests for the pathway guards (permanent version of the by-hand break-tests, like the transcript ones).
// An invariant checker looks for five violations: questions served without consent, another doctor reading the
// session's questions, an UNCONFIRMED fact feeding the engine, a confirmed red-flag slot not raising a red flag, and
// suggestions surviving a consent withdrawal. On the real code it finds none. For each guard we REPLACE that guard with a
// broken version (vi.doMock) and require the checker to find the violation. Toy pathways and fake words only.
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Harness } from './db/helpers.js';

type Mutation =
  | 'none'
  | 'no-consent-check'
  | 'no-session-scoping'
  | 'unconfirmed-facts-count'
  | 'red-flag-ignored'
  | 'suggestions-survive-withdrawal';

async function build(mutation: Mutation) {
  vi.resetModules();
  for (const m of [
    '../src/consent/service.js',
    '../src/sessions/service.js',
    '../src/pathways/service.js',
    '../src/pathways/rules.js',
  ]) {
    vi.doUnmock(m);
  }
  if (mutation === 'no-consent-check') {
    vi.doMock('../src/consent/service.js', async (original) => {
      const real = await original<typeof import('../src/consent/service.js')>();
      return {
        ...real,
        getEffectiveConsent: async (db: never, id: string) => ({
          ...(await real.getEffectiveConsent(db, id)),
          recordingAllowed: true,
        }),
      };
    });
  }
  if (mutation === 'no-session-scoping') {
    vi.doMock('../src/sessions/service.js', async (original) => {
      const real = await original<typeof import('../src/sessions/service.js')>();
      return {
        ...real,
        loadSession: async (
          db: { query: (sql: string, values: unknown[]) => Promise<{ rows: unknown[] }> },
          _auth: unknown,
          id: string,
        ) => {
          const r = await db.query('SELECT * FROM consultation_session WHERE id = $1', [id]);
          return r.rows[0] ? real.toSession(r.rows[0] as never) : null;
        },
      };
    });
  }
  if (mutation === 'unconfirmed-facts-count') {
    // two layers hold this rule (the query and the slot mapping); the mutation removes both
    vi.doMock('../src/pathways/rules.js', async (original) => {
      const real = await original<typeof import('../src/pathways/rules.js')>();
      return {
        ...real,
        factsToSlots: (facts: { status: string }[], map: never) =>
          (real.factsToSlots as (...a: unknown[]) => unknown)(
            facts.map((f) => ({ ...f, status: 'confirmed' })),
            map,
          ),
      };
    });
    vi.doMock('../src/pathways/service.js', async (original) => {
      const real = await original<typeof import('../src/pathways/service.js')>();
      return {
        ...real,
        // the fact query no longer insists on status = 'confirmed'
        computeState: (
          db: { query: (sql: string, v?: unknown[]) => Promise<never> },
          ...rest: never[]
        ) =>
          (real.computeState as (...a: unknown[]) => unknown)(
            {
              query: (sql: string, v?: unknown[]) =>
                db.query(
                  sql.replace(
                    "AND status = 'confirmed' AND concept_status = 'confirmed' AND concept_id",
                    'AND concept_id',
                  ),
                  v,
                ),
            },
            ...rest,
          ),
      };
    });
  }
  if (mutation === 'red-flag-ignored') {
    vi.doMock('../src/pathways/rules.js', async (original) => {
      const real = await original<typeof import('../src/pathways/rules.js')>();
      return {
        ...real,
        runEngine: (pathways: import('../src/pathways/rules.js').Pathway[], ...rest: never[]) =>
          (real.runEngine as (...a: unknown[]) => unknown)(
            // every red-flag condition is stripped: the engine can no longer raise one
            JSON.parse(JSON.stringify(pathways), (k, v) => (k === 'red_flag_if' ? undefined : v)),
            ...rest,
          ),
      };
    });
  }
  if (mutation === 'suggestions-survive-withdrawal') {
    vi.doMock('../src/pathways/service.js', async (original) => {
      const real = await original<typeof import('../src/pathways/service.js')>();
      return { ...real, deleteDerivedPathwayRows: async () => ({ questions: 0, candidates: 0 }) };
    });
  }
  const helpers = await import('./db/helpers.js');
  return { helpers, h: await helpers.createHarness() };
}

/** What a broken guard would let through. Empty means every guard held. */
async function violations(
  helpers: typeof import('./db/helpers.js'),
  h: Harness,
): Promise<string[]> {
  const found: string[] = [];
  const doctor = await h.tokenFor(helpers.SEED_EMAIL.doctor1);
  const doctor2 = await h.tokenFor(helpers.SEED_EMAIL.doctor2);
  const doctorId = h.seed.users.find((u) => u.email === helpers.SEED_EMAIL.doctor1)?.id;
  const staffId = h.seed.users.find((u) => u.email === helpers.SEED_EMAIL.staff)?.id;
  const clinicId = h.seed.clinics[0]?.id as string;
  const patient = await h.db.owner.query<{ id: string }>(
    'SELECT id FROM mock_clinicos_patient WHERE clinic_id = $1 LIMIT 1',
    [clinicId],
  );
  const session = (
    await h.db.owner.query<{ id: string }>(
      `INSERT INTO consultation_session (clinicos_patient_id, clinicos_doctor_id, clinicos_clinic_id)
       VALUES ($1, $2, $3) RETURNING id`,
      [patient.rows[0]?.id, doctorId, clinicId],
    )
  ).rows[0]?.id as string;
  const call = (method: 'get' | 'post', token: string, path: string, body?: object) => {
    const req = request(h.app)
      [method](`/api/v1/sessions/${session}${path}`)
      .set(...helpers.bearer(token));
    return body ? req.send(body) : req;
  };
  const grant = (scope: string) =>
    h.db.owner.query(
      `INSERT INTO consent_event (session_id, clinic_id, scope, granted, notice_version, notice_language, source,
         recorded_by_user_id, recorded_by_role, ts)
       VALUES ($1,$2,$3,true,'0.1','en','staff',$4,'staff',now())`,
      [session, clinicId, scope, staffId],
    );
  const fact = (concept: string, status: string) =>
    h.db.owner.query(
      `INSERT INTO extracted_fact (session_id, clinic_id, type, value, source, status, pipeline, confirmed_at,
         confirmed_by, concept_id, concept_status, concept_confirmed_by, concept_confirmed_at)
       VALUES ($1,$2,'symptom','toy fact','manual',$3,'manual',$4,$5,$6,'confirmed',$5, now())`,
      [session, clinicId, status, status === 'confirmed' ? new Date() : null, doctorId, concept],
    );

  // 1) no consent on record: no question may be served
  if ((await call('get', doctor, '/questions/next')).status < 400) {
    found.push('questions served without consent');
  }
  await grant('audio');
  await grant('ai_processing');
  // 2) another doctor must not see this doctor's session
  if ((await call('get', doctor2, '/questions/next')).status !== 404) {
    found.push("another doctor could read the session's questions");
  }
  // 3) a HEARD (unconfirmed) red-flag fact must not move the engine
  await fact('toy_c_toy_redflag_1', 'heard');
  if ((await call('get', doctor, '/questions/next')).body.data?.outcome === 'RED_FLAG') {
    found.push('an unconfirmed fact fed the engine');
  }
  // 4) a CONFIRMED red-flag fact must raise a red flag
  await fact('toy_c_toy_redflag_1', 'confirmed');
  if ((await call('get', doctor, '/questions/next')).body.data?.outcome !== 'RED_FLAG') {
    found.push('a confirmed red flag was not raised');
  }
  // 5) withdrawal must delete the unacknowledged suggestions
  await call('post', doctor, '/consent/withdraw', { source: 'patient' });
  const left = await h.db.owner.query(
    "SELECT count(*)::int AS n FROM question_event WHERE session_id = $1 AND status <> 'acknowledged'",
    [session],
  );
  if ((left.rows[0]?.n as number) > 0) found.push('suggestions survived the withdrawal');
  return found;
}

const open: Harness[] = [];
afterEach(async () => {
  while (open.length) await open.pop()?.close();
  vi.resetModules();
});

describe('the unmodified pathway guards hold', () => {
  it('finds no violation', async () => {
    const { helpers, h } = await build('none');
    open.push(h);
    expect(await violations(helpers, h)).toEqual([]);
  });
});

describe('each pathway guard, when broken, is caught', () => {
  it.each([
    ['no-consent-check', 'questions served without consent'],
    ['no-session-scoping', "another doctor could read the session's questions"],
    ['unconfirmed-facts-count', 'an unconfirmed fact fed the engine'],
    ['red-flag-ignored', 'a confirmed red flag was not raised'],
    ['suggestions-survive-withdrawal', 'suggestions survived the withdrawal'],
  ] as const)('%s', async (mutation, expected) => {
    const { helpers, h } = await build(mutation);
    open.push(h);
    expect(await violations(helpers, h)).toContain(expected);
  });
});
