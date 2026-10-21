// Mutation-style tests for the concept-link guards (the by-hand break-tests, kept). A checker looks for six violations:
// suggestions served without consent, another doctor reading them, the system setting a link by itself, an unknown concept
// accepted, a link staying fresh after its words changed, and a stale or unconfirmed link feeding the question engine.
// On the real code it finds none. For each guard we REPLACE it with a broken version (vi.doMock) and require the checker
// to find the violation. Toy words only.
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Harness } from './db/helpers.js';

type Mutation =
  | 'none'
  | 'no-consent-check'
  | 'no-session-scoping'
  | 'suggestion-writes-link'
  | 'unknown-concept-accepted'
  | 'edit-keeps-link-fresh'
  | 'unconfirmed-link-feeds-engine';

async function build(mutation: Mutation) {
  vi.resetModules();
  for (const m of [
    '../src/consent/service.js',
    '../src/sessions/service.js',
    '../src/concepts/service.js',
    '../src/pathways/service.js',
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
  if (mutation === 'suggestion-writes-link') {
    vi.doMock('../src/concepts/service.js', async (original) => {
      const real = await original<typeof import('../src/concepts/service.js')>();
      return {
        ...real,
        // the suggestion read also CONFIRMS the first suggestion: the system sets a link by itself
        suggestForSession: async (
          db: { query: (sql: string, v?: unknown[]) => Promise<unknown> },
          ...rest: never[]
        ) => {
          const out = await (
            real.suggestForSession as (...a: unknown[]) => Promise<{
              byFact: Record<string, { conceptId: string }[]>;
            }>
          )(db, ...rest);
          for (const [factId, list] of Object.entries(out.byFact)) {
            await db.query(
              `UPDATE extracted_fact SET concept_id = $2, concept_status = 'confirmed',
                      concept_confirmed_by = confirmed_by, concept_confirmed_at = now() WHERE id = $1`,
              [factId, list[0]?.conceptId],
            );
          }
          return out;
        },
      };
    });
  }
  if (mutation === 'unknown-concept-accepted') {
    vi.doMock('../src/concepts/service.js', async (original) => {
      const real = await original<typeof import('../src/concepts/service.js')>();
      return { ...real, conceptExists: () => true };
    });
  }
  if (mutation === 'edit-keeps-link-fresh') {
    vi.doMock('../src/concepts/service.js', async (original) => {
      const real = await original<typeof import('../src/concepts/service.js')>();
      return { ...real, markLinkStaleOnEdit: async () => undefined };
    });
  }
  if (mutation === 'unconfirmed-link-feeds-engine') {
    vi.doMock('../src/pathways/service.js', async (original) => {
      const real = await original<typeof import('../src/pathways/service.js')>();
      return {
        ...real,
        // the fact query no longer insists on a CONFIRMED link
        computeState: (
          db: { query: (sql: string, v?: unknown[]) => Promise<never> },
          ...rest: never[]
        ) =>
          (real.computeState as (...a: unknown[]) => unknown)(
            {
              query: (sql: string, v?: unknown[]) =>
                db.query(sql.replace("AND concept_status = 'confirmed'", ''), v),
            },
            ...rest,
          ),
      };
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
  const call = (method: 'get' | 'post' | 'patch', token: string, path: string, body?: object) => {
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
  const factId = (
    await h.db.owner.query<{ id: string }>(
      `INSERT INTO extracted_fact (session_id, clinic_id, type, value, source, status, pipeline, confirmed_at,
         confirmed_by) VALUES ($1,$2,'symptom','toy symptom one','manual','confirmed','manual', now(), $3) RETURNING id`,
      [session, clinicId, doctorId],
    )
  ).rows[0]?.id as string;

  // 1) no consent on record: nothing may be suggested
  if ((await call('get', doctor, '/concept-suggestions')).status < 400) {
    found.push('suggestions served without consent');
  }
  await grant('audio');
  await grant('ai_processing');
  // 2) another doctor must not see this session's suggestions
  if ((await call('get', doctor2, '/concept-suggestions')).status !== 404) {
    found.push("another doctor could read the session's suggestions");
  }
  // 3) reading suggestions must change nothing: a link is the doctor's decision alone
  await call('get', doctor, '/concept-suggestions');
  const after = await h.db.owner.query('SELECT concept_id FROM extracted_fact WHERE id = $1', [
    factId,
  ]);
  if (after.rows[0]?.concept_id !== null) found.push('the system set a link by itself');
  await h.db.owner.query(
    "UPDATE extracted_fact SET concept_id = NULL, concept_status = 'none', concept_confirmed_by = NULL, concept_confirmed_at = NULL WHERE id = $1",
    [factId],
  );
  // 4) a concept that is not in the list must be refused
  if (
    (await call('post', doctor, `/facts/${factId}/concept`, { conceptId: 'not_in_the_list' }))
      .status < 400
  ) {
    found.push('an unknown concept was accepted');
  }
  await h.db.owner.query(
    "UPDATE extracted_fact SET concept_id = NULL, concept_status = 'none', concept_confirmed_by = NULL, concept_confirmed_at = NULL WHERE id = $1",
    [factId],
  );
  // 5) changing the words must make the link stale
  await call('post', doctor, `/facts/${factId}/concept`, { conceptId: 'toy_c_toy_symptom_1' });
  const edited = await call('patch', doctor, `/facts/${factId}`, {
    action: 'edit',
    value: 'toy symptom two',
  });
  if (edited.body.data?.conceptStatus !== 'stale')
    found.push('a link stayed fresh after its words changed');
  // 6) a stale link must not feed the question engine (the first question is still about symptom 1)
  const next = await call('get', doctor, '/questions/next');
  if (next.body.data?.slot !== 'toy_symptom_1')
    found.push('a stale or unconfirmed link fed the engine');
  return found;
}

const open: Harness[] = [];
afterEach(async () => {
  while (open.length) await open.pop()?.close();
  vi.resetModules();
});

describe('the unmodified concept guards hold', () => {
  it('finds no violation', async () => {
    const { helpers, h } = await build('none');
    open.push(h);
    expect(await violations(helpers, h)).toEqual([]);
  });
});

describe('each concept guard, when broken, is caught', () => {
  it.each([
    ['no-consent-check', 'suggestions served without consent'],
    ['no-session-scoping', "another doctor could read the session's suggestions"],
    ['suggestion-writes-link', 'the system set a link by itself'],
    ['unknown-concept-accepted', 'an unknown concept was accepted'],
    ['edit-keeps-link-fresh', 'a link stayed fresh after its words changed'],
    ['unconfirmed-link-feeds-engine', 'a stale or unconfirmed link fed the engine'],
  ] as const)('%s', async (mutation, expected) => {
    const { helpers, h } = await build(mutation);
    open.push(h);
    expect(await violations(helpers, h)).toContain(expected);
  });
});
