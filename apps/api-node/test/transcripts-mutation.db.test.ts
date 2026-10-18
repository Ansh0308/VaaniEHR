// Mutation-style tests for the transcript guards (the break-tests that were first done by hand, now permanent).
// An invariant checker looks for three violations: saving without consent, reading another doctor's session, and draft
// text surviving a consent withdrawal. On the real code it finds none. For each guard we then REPLACE that guard with a
// broken version (vi.doMock) and require the checker to find the violation: if a guard is ever weakened or the checker
// goes blind, this file fails. Fake words only.
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Harness } from './db/helpers.js';

type Mutation = 'none' | 'no-consent-check' | 'no-session-scoping' | 'drafts-survive-withdrawal';

async function build(mutation: Mutation) {
  vi.resetModules();
  vi.doUnmock('../src/consent/service.js');
  vi.doUnmock('../src/sessions/service.js');
  vi.doUnmock('../src/transcripts/routes.js');
  if (mutation === 'no-consent-check') {
    vi.doMock('../src/consent/service.js', async (original) => {
      const real = await original<typeof import('../src/consent/service.js')>();
      return {
        ...real,
        // consent is reported as granted whatever is on record: the guard is gone
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
        // any session is visible to anyone: no clinic and no doctor filter
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
  if (mutation === 'drafts-survive-withdrawal') {
    vi.doMock('../src/transcripts/routes.js', async (original) => {
      const real = await original<typeof import('../src/transcripts/routes.js')>();
      return { ...real, deleteDraftSegments: async () => 0 };
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
      [
        patient.rows[0]?.id,
        h.seed.users.find((u) => u.email === helpers.SEED_EMAIL.doctor1)?.id,
        clinicId,
      ],
    )
  ).rows[0]?.id as string;
  const call = (method: 'get' | 'put' | 'post', token: string, path: string, body?: object) => {
    const req = request(h.app)
      [method](`/api/v1/sessions/${session}${path}`)
      .set(...helpers.bearer(token));
    return body ? req.send(body) : req;
  };
  const segment = {
    seq: 0,
    speaker: 'unknown',
    originalText: 'fixture words',
    editedText: null,
    language: null,
    startMs: null,
    endMs: null,
    engine: 'mock',
    engineVersion: null,
  }; // fmt: skip
  const grant = (scope: string, granted: boolean) =>
    h.db.owner.query(
      `INSERT INTO consent_event (session_id, clinic_id, scope, granted, notice_version, notice_language, source,
         recorded_by_user_id, recorded_by_role, ts)
       VALUES ($1,$2,$3,$4,'0.1','en','staff',$5,'staff',now())`,
      [session, clinicId, scope, granted, staffId],
    );

  // 1) saving with no consent on record must be refused
  if ((await call('put', doctor, '/transcript/segments', { segments: [segment] })).status < 400) {
    found.push('saved without consent');
  }
  await grant('audio', true);
  await grant('ai_processing', true);
  await call('put', doctor, '/transcript/segments', { segments: [segment] });
  // 2) another doctor must not see this doctor's session
  if ((await call('get', doctor2, '/transcript')).status !== 404) {
    found.push("another doctor could read the session's transcript");
  }
  // 3) withdrawal must delete the unconfirmed draft text
  await call('post', doctor, '/consent/withdraw', { source: 'patient' });
  const left = await h.db.owner.query(
    "SELECT count(*)::int AS n FROM transcript_segment WHERE session_id = $1 AND status = 'draft'",
    [session],
  );
  if ((left.rows[0]?.n as number) > 0) found.push('draft text survived the withdrawal');
  return found;
}

const open: Harness[] = [];
afterEach(async () => {
  while (open.length) await open.pop()?.close();
  vi.resetModules();
});

describe('the unmodified guards hold', () => {
  it('finds no violation', async () => {
    const { helpers, h } = await build('none');
    open.push(h);
    expect(await violations(helpers, h)).toEqual([]);
  });
});

describe('each guard, when broken, is caught', () => {
  it.each([
    ['no-consent-check', 'saved without consent'],
    ['no-session-scoping', "another doctor could read the session's transcript"],
    ['drafts-survive-withdrawal', 'draft text survived the withdrawal'],
  ] as const)('%s', async (mutation, expected) => {
    const { helpers, h } = await build(mutation);
    open.push(h);
    expect(await violations(helpers, h)).toContain(expected);
  });
});
