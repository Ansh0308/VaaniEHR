// Mutation-style tests for the sign-off guards (Phase 8 Run 1, ADR-D38; the by-hand break-tests, kept). A checker looks for
// the violations a broken guard would allow: signing past each named blocker, signing without the safety acknowledgement
// or with the safety interface skipped, signing with a wrong password, another doctor signing, content changing after
// signing (through the API and through the database), a wrong content hash, and an unaudited amendment. On the real code it
// finds none. For each guard we REPLACE it with a broken version (vi.doMock, or a dropped trigger) and require the checker
// to find the violation. Fake medicine names and toy words only.
import { createHash } from 'node:crypto';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Harness } from './db/helpers.js';

type Mutation =
  | 'none'
  | 'no-unconfirmed-blocker'
  | 'no-red-flag-blocker'
  | 'no-working-condition-blocker'
  | 'no-consent-check'
  | 'no-safety-acknowledgement'
  | 'safety-skipped'
  | 'safety-error-ignored'
  | 'no-password-check'
  | 'no-session-scoping'
  | 'no-app-lock'
  | 'no-db-trigger'
  | 'no-facts-trigger'
  | 'wrong-hash'
  | 'amendment-not-audited';

const MOCKED = [
  '../src/consent/service.js',
  '../src/sessions/service.js',
  '../src/visits/service.js',
  '../src/http/routeRegistry.js',
  '../src/audit/audit.js',
] as const;

const without = (code: string) => async (original: () => Promise<unknown>) => {
  const real = (await original()) as typeof import('../src/visits/service.js');
  return {
    ...real,
    evaluateDraft: async (...args: Parameters<typeof real.evaluateDraft>) => {
      const out = await real.evaluateDraft(...args);
      return { ...out, blockers: out.blockers.filter((b) => b.code !== code) };
    },
  };
};

async function build(mutation: Mutation) {
  vi.resetModules();
  for (const m of MOCKED) vi.doUnmock(m);
  if (mutation === 'no-unconfirmed-blocker') {
    vi.doMock('../src/visits/service.js', without('unconfirmed_facts') as never);
  }
  if (mutation === 'no-red-flag-blocker') {
    vi.doMock('../src/visits/service.js', without('red_flag_unacknowledged') as never);
  }
  if (mutation === 'no-working-condition-blocker') {
    vi.doMock('../src/visits/service.js', without('no_working_condition') as never);
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
  if (mutation === 'no-safety-acknowledgement') {
    vi.doMock('../src/visits/service.js', async (original) => {
      const real = await original<typeof import('../src/visits/service.js')>();
      return {
        ...real,
        // the acknowledgement is never demanded
        requireSafetyAcknowledgement: () => ({
          safetyConfigured: false,
          safetyNotRunAcknowledged: true,
        }),
      };
    });
  }
  if (mutation === 'safety-skipped') {
    vi.doMock('../src/visits/service.js', async (original) => {
      const real = await original<typeof import('../src/visits/service.js')>();
      return {
        ...real,
        // the safety interface is never asked
        runSafety: async () => ({ configured: false, blocked: 0, message: '' }),
      };
    });
  }
  if (mutation === 'safety-error-ignored') {
    vi.doMock('../src/visits/service.js', async (original) => {
      const real = await original<typeof import('../src/visits/service.js')>();
      return {
        ...real,
        // an engine ERROR is read as "no alerts"
        requireSafetyAcknowledgement: (safety: { error?: boolean }, ack: boolean) =>
          (real.requireSafetyAcknowledgement as (...a: unknown[]) => unknown)(
            { ...safety, error: false },
            ack,
          ),
      };
    });
  }
  if (mutation === 'no-password-check') {
    vi.doMock('../src/visits/service.js', async (original) => {
      const real = await original<typeof import('../src/visits/service.js')>();
      return { ...real, checkSignPassword: async () => undefined };
    });
  }
  if (mutation === 'wrong-hash') {
    vi.doMock('../src/visits/service.js', async (original) => {
      const real = await original<typeof import('../src/visits/service.js')>();
      return { ...real, hashContent: () => 'a'.repeat(64) };
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
  if (mutation === 'no-app-lock') {
    vi.doMock('../src/http/routeRegistry.js', async (original) => {
      const real = await original<typeof import('../src/http/routeRegistry.js')>();
      return {
        ...real,
        permRoute: (permission: never, def: { lockedWhenSigned?: boolean }) =>
          (real.permRoute as (p: unknown, d: unknown) => unknown)(permission, {
            ...def,
            lockedWhenSigned: false,
          }),
      };
    });
  }
  if (mutation === 'amendment-not-audited') {
    vi.doMock('../src/audit/audit.js', async (original) => {
      const real = await original<typeof import('../src/audit/audit.js')>();
      return {
        ...real,
        appendAudit: async (db: never, entry: { action: string }) =>
          entry.action === 'VISIT_AMENDED'
            ? undefined
            : (real.appendAudit as (...a: unknown[]) => unknown)(db, entry),
      };
    });
  }
  const helpers = await import('./db/helpers.js');
  const h = await helpers.createHarness();
  if (mutation === 'no-db-trigger') {
    await h.db.owner.query('DROP TRIGGER prescription_item_guard ON prescription_item');
  }
  if (mutation === 'no-facts-trigger') {
    await h.db.owner.query('DROP TRIGGER extracted_fact_signed_guard ON extracted_fact');
  }
  return { helpers, h };
}

const canonical = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(canonical).join(',')}]`
    : v && typeof v === 'object'
      ? `{${Object.keys(v as object)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
          .join(',')}}`
      : JSON.stringify(v);

/** What a broken guard would let through. Empty means every guard held. */
async function violations(
  helpers: typeof import('./db/helpers.js'),
  h: Harness,
): Promise<string[]> {
  const found: string[] = [];
  const doctor = await h.tokenFor(helpers.SEED_EMAIL.doctor1);
  const doctor2 = await h.tokenFor(helpers.SEED_EMAIL.doctor2);
  const password = h.passwords[helpers.SEED_EMAIL.doctor1] as string;
  const password2 = h.passwords[helpers.SEED_EMAIL.doctor2] as string;
  const doctorId = h.seed.users.find((u) => u.email === helpers.SEED_EMAIL.doctor1)?.id as string;
  const staffId = h.seed.users.find((u) => u.email === helpers.SEED_EMAIL.staff)?.id;
  const clinicId = h.seed.clinics[0]?.id as string;
  const patient = (
    await h.db.owner.query<{ id: string }>(
      'SELECT id FROM mock_clinicos_patient WHERE clinic_id = $1 LIMIT 1',
      [clinicId],
    )
  ).rows[0]?.id;
  const owner = (sql: string, p: unknown[] = []) => h.db.owner.query(sql, p);
  const medicine = (
    await owner(
      `INSERT INTO medicine_master (generic_name, strength, dose_form, source, source_page)
       VALUES ('toy-medicine-mut','50 mg','tablet','TOY-LIST 1',3) RETURNING id`,
    )
  ).rows[0]?.id as string;

  const fresh = async () => {
    const session = (
      await owner(
        `INSERT INTO consultation_session (clinicos_patient_id, clinicos_doctor_id, clinicos_clinic_id)
         VALUES ($1,$2,$3) RETURNING id`,
        [patient, doctorId, clinicId],
      )
    ).rows[0]?.id as string;
    const grant = async () => {
      for (const scope of ['audio', 'ai_processing'])
        await owner(
          `INSERT INTO consent_event (session_id, clinic_id, scope, granted, notice_version, notice_language, source,
             recorded_by_user_id, recorded_by_role, ts) VALUES ($1,$2,$3,true,'0.1','en','staff',$4,'staff',now())`,
          [session, clinicId, scope, staffId],
        );
    };
    const call = (
      method: 'get' | 'post' | 'patch',
      path: string,
      body?: object,
      token = doctor,
    ) => {
      const r = request(h.app)
        [method](`/api/v1/sessions/${session}${path}`)
        .set(...helpers.bearer(token));
      return body ? r.send(body) : r;
    };
    const sign = (over: object = {}, token = doctor, pw = password) =>
      call('post', '/sign', { password: pw, safetyNotRunAcknowledged: true, ...over }, token);
    return { session, grant, call, sign };
  };
  const stored = async (session: string) =>
    (await owner('SELECT 1 FROM visit_record WHERE session_id = $1', [session])).rowCount;
  const manualFact = (session: string, status: string, concept: string | null = null) =>
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

  // 1) an unconfirmed fact
  {
    const s = await fresh();
    await manualFact(s.session, 'heard');
    if ((await s.sign()).status === 201) found.push('signed with an unconfirmed fact');
  }
  // 2) an unacknowledged red flag
  {
    const s = await fresh();
    await owner(
      `INSERT INTO question_event (session_id, clinic_id, pathway_id, pathway_version, node_id, slot, kind, status)
       VALUES ($1,$2,'toy_condition_b',1,'q3','toy_redflag_1','red_flag','suggested')`,
      [s.session, clinicId],
    );
    // consent and a working condition are in place, so the red flag is the only thing in the way
    await s.grant();
    await owner(
      `INSERT INTO candidate (session_id, clinic_id, kind, pathway_id, pathway_version, selected_by, selected_at)
       VALUES ($1,$2,'selected','toy_condition_a',1,$3,now())`,
      [s.session, clinicId, doctorId],
    );
    if ((await s.sign()).status === 201) found.push('signed with an unacknowledged red flag');
  }
  // 3) a pathway ran but no working condition was chosen
  {
    const s = await fresh();
    await s.grant();
    await owner(
      `INSERT INTO question_event (session_id, clinic_id, pathway_id, pathway_version, node_id, slot, kind, status,
         acted_at, acted_by) VALUES ($1,$2,'toy_condition_a',1,'q1','toy_symptom_1','question','dismissed',now(),$3)`,
      [s.session, clinicId, doctorId],
    );
    if ((await s.sign()).status === 201)
      found.push('signed with no working condition after a pathway ran');
  }
  // 4) AI content (a confirmed concept link) with no consent on record
  {
    const s = await fresh();
    await manualFact(s.session, 'confirmed', 'toy_c_toy_symptom_1');
    if ((await s.sign()).status === 201) found.push('signed AI content without consent');
  }
  // 5) no safety acknowledgement
  {
    const s = await fresh();
    if ((await s.sign({ safetyNotRunAcknowledged: false })).status === 201)
      found.push('signed without the safety acknowledgement');
  }
  // 6) the safety interface must always be asked, and a blocked alert must refuse
  {
    const s = await fresh();
    const original = h.services.safety;
    let asked = 0;
    h.services.safety = {
      run: async () => {
        asked += 1;
        return { configured: true, blocked: 1, message: 'toy engine' };
      },
    };
    try {
      const res = await s.sign({ safetyNotRunAcknowledged: true });
      if (asked === 0 || res.status === 201) found.push('the safety interface was skipped');
    } finally {
      h.services.safety = original;
    }
  }
  // 6b) an engine that reports an ERROR must block signing (fail closed)
  {
    const s = await fresh();
    const original = h.services.safety;
    h.services.safety = {
      run: async () => ({
        configured: true,
        blocked: 0,
        error: true,
        message: 'toy engine failed',
      }),
    };
    try {
      if ((await s.sign({ safetyNotRunAcknowledged: false })).status === 201)
        found.push('signed while the safety engine reported an error');
    } finally {
      h.services.safety = original;
    }
  }
  // 7) a wrong password
  {
    const s = await fresh();
    if ((await s.sign({}, doctor, 'not the password')).status === 201)
      found.push('signed with a wrong password');
  }
  // 8) another doctor (right password for THEIR account) signing this doctor's session
  {
    const s = await fresh();
    const res = await s.sign({}, doctor2, password2);
    if (res.status === 201 || ((await stored(s.session)) ?? 0) > 0)
      found.push('another doctor could sign this visit');
  }
  // 9) after signing: the API refuses changes, the database refuses changes, the hash matches the content
  {
    const s = await fresh();
    await manualFact(s.session, 'confirmed');
    await s.call('post', '/prescription/items', {
      medicineId: medicine,
      frequency: 'OD',
      duration: '2 days',
    });
    const signed = await s.sign();
    if (signed.status === 201) {
      const add = await s.call('post', '/prescription/items', {
        medicineId: medicine,
        frequency: 'BD',
        duration: '1 day',
      });
      if (add.status !== 409) found.push('the API changed a signed prescription');
      let dbChanged: boolean;
      try {
        const r = await h.appPool.query(
          "UPDATE prescription_item SET duration = '9 days' WHERE session_id = $1",
          [s.session],
        );
        dbChanged = (r.rowCount ?? 0) > 0;
      } catch {
        dbChanged = false;
      }
      if (dbChanged) found.push('the database changed a signed prescription');
      let factChanged: boolean;
      try {
        const r = await h.appPool.query(
          "UPDATE extracted_fact SET value = 'changed' WHERE session_id = $1",
          [s.session],
        );
        factChanged = (r.rowCount ?? 0) > 0;
      } catch {
        factChanged = false;
      }
      if (factChanged) found.push('the database changed a fact of a signed visit');
      const expected = createHash('sha256')
        .update(canonical(signed.body.data.content))
        .digest('hex');
      const row = (
        await owner('SELECT content_hash FROM visit_record_version WHERE session_id = $1', [
          s.session,
        ])
      ).rows[0];
      if (row?.content_hash !== expected)
        found.push('the stored hash does not match the signed content');
      // 10) an amendment must be audited
      const amend = await s.call('post', '/amend', {
        password,
        safetyNotRunAcknowledged: true,
        reason: 'toy reason',
        medicines: [],
      });
      const audited = (
        await owner("SELECT 1 FROM audit_log WHERE action = 'VISIT_AMENDED' AND session_id = $1", [
          s.session,
        ])
      ).rowCount;
      if (amend.status !== 201 || audited !== 1) found.push('an amendment was not audited');
    }
  }
  return found;
}

const open: Harness[] = [];
afterEach(async () => {
  while (open.length) await open.pop()?.close();
  vi.resetModules();
});

describe('the unmodified sign-off guards hold', () => {
  it('finds no violation', async () => {
    const { helpers, h } = await build('none');
    open.push(h);
    expect(await violations(helpers, h)).toEqual([]);
  });
});

describe('each sign-off guard, when broken, is caught', () => {
  it.each([
    ['no-unconfirmed-blocker', 'signed with an unconfirmed fact'],
    ['no-red-flag-blocker', 'signed with an unacknowledged red flag'],
    ['no-working-condition-blocker', 'signed with no working condition after a pathway ran'],
    ['no-consent-check', 'signed AI content without consent'],
    ['no-safety-acknowledgement', 'signed without the safety acknowledgement'],
    ['safety-skipped', 'the safety interface was skipped'],
    ['safety-error-ignored', 'signed while the safety engine reported an error'],
    ['no-password-check', 'signed with a wrong password'],
    ['no-session-scoping', 'another doctor could sign this visit'],
    ['no-app-lock', 'the API changed a signed prescription'],
    ['no-db-trigger', 'the database changed a signed prescription'],
    ['no-facts-trigger', 'the database changed a fact of a signed visit'],
    ['wrong-hash', 'the stored hash does not match the signed content'],
    ['amendment-not-audited', 'an amendment was not audited'],
  ] as const)('%s', async (mutation, expected) => {
    const { helpers, h } = await build(mutation);
    open.push(h);
    expect(await violations(helpers, h)).toContain(expected);
  });
});
