// Clinic isolation: a user of clinic A can neither read nor write clinic B's patients, sessions, consent events or
// audit rows, through EVERY endpoint in the route registry - and the other way round.
// The attacker always uses a role that IS allowed on the route (admin where possible, since staff/admin are
// clinic-wide), so what stops the request is the clinic boundary, not RBAC.
// A new route fails the coverage test at the bottom until it is added to ISOLATION or NOT_CLINIC_SCOPED.
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/auth/password.js';
import { allRoutes } from '../src/routes/index.js';
import { bearer, createHarness, SEED_EMAIL, type Harness } from './db/helpers.js';

const CLINIC_B = '5eed0000-0000-4000-8000-0000000000b2';
const B_PASSWORD = 'clinic-b-test-password-123';

interface World {
  name: 'A' | 'B';
  clinicId: string;
  tokens: { admin: string; doctor: string; staff: string; researcher: string };
  userIds: string[];
  patientId: string;
  phone: string;
  sessionId: string;
  allergy: string;
}

let h: Harness;
let A: World;
let B: World;

const call = (method: 'get' | 'post' | 'put', path: string, token: string, body?: object) => {
  const r = request(h.app)
    [method](`/api/v1${path}`)
    .set(...bearer(token));
  return body ? r.send(body) : r;
};
const one = async (sql: string, params: unknown[] = []) =>
  (await h.db.owner.query(sql, params)).rows[0];

async function populate(
  world: Omit<World, 'patientId' | 'sessionId'>,
  phone: string,
): Promise<World> {
  const created = await call('post', '/patients', world.tokens.staff, {
    phone,
    name: `Fake ${world.name}`,
  });
  const patientId = created.body.data.patient.id as string;
  await call('put', `/patients/${patientId}/clinical-profile`, world.tokens.staff, {
    allergies: [world.allergy],
  });
  const session = await call('post', '/sessions', world.tokens.doctor, { patientId });
  const sessionId = session.body.data.id as string;
  await call('post', `/sessions/${sessionId}/consent`, world.tokens.staff, {
    scopes: ['audio', 'ai_processing'],
    noticeVersion: '0.1',
    noticeLanguage: 'en',
    source: 'staff',
  });
  return { ...world, patientId, sessionId };
}

beforeAll(async () => {
  h = await createHarness();
  const clinicA = h.seed.clinics[0]?.id as string;

  // ---- clinic B: a second clinic with its own users, created directly as the database owner
  await h.db.owner.query(
    "INSERT INTO mock_clinicos_clinic (id, name, code) VALUES ($1, 'Fake Clinic B (simulated)', 'FAKE-CLINIC-B')",
    [CLINIC_B],
  );
  const hash = await hashPassword(B_PASSWORD, 4);
  const bUsers: Array<[string, string]> = [
    ['admin', 'admin.b@example.invalid'],
    ['doctor', 'doctor.b@example.invalid'],
    ['staff', 'staff.b@example.invalid'],
    ['researcher', 'researcher.b@example.invalid'],
  ];
  const bIds: string[] = [];
  const bTokens: Record<string, string> = {};
  for (const [role, email] of bUsers) {
    const row = await one(
      `INSERT INTO mock_clinicos_user (name, email, password_hash, role, status, clinic_id)
       VALUES ($1, $2, $3, $4, 'approved', $5) RETURNING id`,
      [`Fake ${role} B`, email, hash, role, CLINIC_B],
    );
    bIds.push(row.id as string);
    const res = await request(h.app)
      .post('/api/v1/auth/login')
      .send({ email, password: B_PASSWORD });
    bTokens[role] = res.body.data.accessToken as string;
  }

  const aTokens = {
    admin: await h.tokenFor(SEED_EMAIL.admin),
    doctor: await h.tokenFor(SEED_EMAIL.doctor1),
    staff: await h.tokenFor(SEED_EMAIL.staff),
    researcher: await h.tokenFor(SEED_EMAIL.researcher),
  };

  A = await populate(
    {
      name: 'A',
      clinicId: clinicA,
      tokens: aTokens,
      userIds: h.seed.users.map((u) => u.id),
      phone: '0000000901',
      allergy: 'Drug-A (FAKE)',
    },
    '0000000901',
  );
  B = await populate(
    {
      name: 'B',
      clinicId: CLINIC_B,
      tokens: bTokens as World['tokens'],
      userIds: bIds,
      phone: '0000000902',
      allergy: 'Drug-B (FAKE)',
    },
    '0000000902',
  );
});
afterAll(async () => {
  await h.close();
});

/** Everything about a world that an attacker must not be able to change. */
async function snapshot(w: World) {
  return {
    allergies: (
      await one('SELECT allergies FROM patient_clinical_profile WHERE clinicos_patient_id = $1', [
        w.patientId,
      ])
    ).allergies,
    patients: (
      await one('SELECT count(*)::int AS n FROM mock_clinicos_patient WHERE clinic_id = $1', [
        w.clinicId,
      ])
    ).n,
    sessions: (
      await one(
        'SELECT count(*)::int AS n FROM consultation_session WHERE clinicos_clinic_id = $1',
        [w.clinicId],
      )
    ).n,
    consentEvents: (
      await one('SELECT count(*)::int AS n FROM consent_event WHERE clinic_id = $1', [w.clinicId])
    ).n,
    recording: (await call('get', `/sessions/${w.sessionId}/consent`, w.tokens.admin)).body.data
      .recordingAllowed,
  };
}

/** The attacker (clinic X) goes after the victim (clinic Y). Each case asserts the request is refused or empty. */
const ISOLATION: Record<string, (x: World, y: World) => Promise<void>> = {
  'POST /patients/lookup': async (x, y) => {
    const res = await call('post', '/patients/lookup', x.tokens.staff, { phone: y.phone });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ found: false }); // exists only in the other clinic
  },
  'POST /patients': async (x, y) => {
    // Same phone number in another clinic is a different patient: the victim's record is never returned or changed.
    const res = await call('post', '/patients', x.tokens.staff, {
      phone: y.phone,
      name: 'Attacker Copy',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.created).toBe(true);
    expect(res.body.data.patient.id).not.toBe(y.patientId);
    expect(res.body.data.patient.allergies).toEqual([]); // nothing of the victim's profile leaks
    const mine = await one('SELECT clinic_id FROM mock_clinicos_patient WHERE id = $1', [
      res.body.data.patient.id,
    ]);
    expect(mine.clinic_id).toBe(x.clinicId);
    await h.db.owner.query('DELETE FROM mock_clinicos_patient WHERE id = $1', [
      res.body.data.patient.id,
    ]);
  },
  'GET /patients/:id': async (x, y) => {
    expect((await call('get', `/patients/${y.patientId}`, x.tokens.doctor)).status).toBe(404);
    expect((await call('get', `/patients/${y.patientId}`, x.tokens.admin)).status).toBe(404);
  },
  'PUT /patients/:id/clinical-profile': async (x, y) => {
    const res = await call('put', `/patients/${y.patientId}/clinical-profile`, x.tokens.admin, {
      allergies: ['Tampered (FAKE)'],
    });
    expect(res.status).toBe(404);
  },
  'POST /sessions': async (x, y) => {
    const res = await call('post', '/sessions', x.tokens.doctor, { patientId: y.patientId });
    expect(res.status).toBe(404);
  },
  'GET /sessions/:id': async (x, y) => {
    expect((await call('get', `/sessions/${y.sessionId}`, x.tokens.admin)).status).toBe(404);
    expect((await call('get', `/sessions/${y.sessionId}`, x.tokens.staff)).status).toBe(404);
    expect((await call('get', `/sessions/${y.sessionId}`, x.tokens.doctor)).status).toBe(404);
  },
  'GET /sessions/:id/consent': async (x, y) => {
    for (const role of ['admin', 'staff', 'doctor'] as const) {
      expect((await call('get', `/sessions/${y.sessionId}/consent`, x.tokens[role])).status).toBe(
        404,
      );
    }
  },
  'POST /sessions/:id/consent': async (x, y) => {
    const body = {
      scopes: ['whatsapp'],
      noticeVersion: '0.1',
      noticeLanguage: 'en',
      source: 'staff',
    };
    for (const role of ['admin', 'staff', 'doctor'] as const) {
      expect(
        (await call('post', `/sessions/${y.sessionId}/consent`, x.tokens[role], body)).status,
      ).toBe(404);
    }
  },
  'POST /sessions/:id/consent/withdraw': async (x, y) => {
    for (const role of ['admin', 'staff', 'doctor'] as const) {
      const res = await call('post', `/sessions/${y.sessionId}/consent/withdraw`, x.tokens[role], {
        source: 'patient',
      });
      expect(res.status).toBe(404);
    }
  },
  'GET /audit': async (x, y) => {
    const readAll = async (token: string) => {
      const items: Array<Record<string, unknown>> = [];
      let cursor: number | null | undefined;
      do {
        const res = await call(
          'get',
          `/audit?limit=100${cursor ? `&beforeSeq=${cursor}` : ''}`,
          token,
        );
        expect(res.status).toBe(200);
        items.push(...res.body.data.items);
        cursor = res.body.data.nextBeforeSeq;
      } while (cursor);
      return items;
    };
    const mine = Number(
      (await one('SELECT count(*)::int AS n FROM audit_log WHERE clinic_id = $1', [x.clinicId])).n,
    );
    const theirs = Number(
      (await one('SELECT count(*)::int AS n FROM audit_log WHERE clinic_id = $1', [y.clinicId])).n,
    );
    expect(theirs).toBeGreaterThan(0); // the test is only meaningful if the victim has audit rows

    const adminRows = await readAll(x.tokens.admin);
    expect(adminRows).toHaveLength(mine);
    for (const row of adminRows) {
      expect(row.clinicId).toBe(x.clinicId);
      expect(y.userIds).not.toContain(row.actorUserId);
      expect([y.patientId, y.sessionId]).not.toContain(row.resourceId);
      expect(row.sessionId).not.toBe(y.sessionId);
    }
    // the researcher sees the same set, anonymised, and still nothing of the other clinic
    const researcherRows = await readAll(x.tokens.researcher);
    expect(researcherRows).toHaveLength(mine);
    expect(JSON.stringify(researcherRows)).not.toContain(y.clinicId);
  },
  'GET /sessions': async (x, y) => {
    const res = await call('get', '/sessions?limit=50', x.tokens.doctor);
    expect(res.status).toBe(200);
    const items = res.body.data.items as Array<{ id: string; clinicId: string; patientId: string }>;
    expect(items.length).toBeGreaterThan(0); // the attacker has their own sessions: the list is not just empty
    for (const item of items) {
      expect(item.clinicId).toBe(x.clinicId);
      expect(item.id).not.toBe(y.sessionId);
      expect(item.patientId).not.toBe(y.patientId);
    }
  },
  'POST /audit/export': async (x, y) => {
    const mine = Number(
      (await one('SELECT count(*)::int AS n FROM audit_log WHERE clinic_id = $1', [x.clinicId])).n,
    );
    const res = await call('post', '/audit/export', x.tokens.admin, {});
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(Number(res.headers['x-exported-rows'])).toBe(mine); // only this clinic's rows
    const text = res.text;
    for (const secret of [y.clinicId, y.patientId, y.sessionId, ...y.userIds, y.phone, y.allergy]) {
      expect(text, String(secret)).not.toContain(String(secret));
    }
  },
  'GET /audit/verify': async (x) => {
    const res = await call('get', '/audit/verify', x.tokens.admin);
    expect(res.status).toBe(200);
    // the chain is shared by all clinics: no counts, head hash or sequence numbers of other clinics are exposed
    expect(Object.keys(res.body.data)).toEqual(['ok']);
    expect(res.body.data.ok).toBe(true);
  },
};

/** Routes whose data is the caller's own user or global static text, so there is no other clinic's data to reach. */
const NOT_CLINIC_SCOPED = [
  'POST /auth/login',
  'POST /auth/logout',
  'GET /auth/me',
  'GET /consent/notice',
];

describe.each([
  ['clinic A attacks clinic B', () => [A, B] as const],
  ['clinic B attacks clinic A', () => [B, A] as const],
])('%s', (_label, pair) => {
  for (const [key, attack] of Object.entries(ISOLATION)) {
    it(`${key}: refused or empty, and nothing of the victim changes`, async () => {
      const [x, y] = pair();
      const before = await snapshot(y);
      await attack(x, y);
      expect(await snapshot(y)).toEqual(before);
    });
  }
});

describe('the world is really two clinics', () => {
  it('each clinic can use its own data through the same endpoints (the refusals above are not a broken setup)', async () => {
    for (const w of [A, B]) {
      expect((await call('get', `/patients/${w.patientId}`, w.tokens.doctor)).status).toBe(200);
      expect((await call('get', `/sessions/${w.sessionId}`, w.tokens.admin)).status).toBe(200);
      const consent = await call('get', `/sessions/${w.sessionId}/consent`, w.tokens.staff);
      expect(consent.body.data.recordingAllowed).toBe(true);
      const found = await call('post', '/patients/lookup', w.tokens.staff, { phone: w.phone });
      expect(found.body.data.found).toBe(true);
      expect(found.body.data.patient.allergies).toEqual([w.allergy]);
    }
  });

  it('/auth/me never shows another clinic', async () => {
    const meA = await call('get', '/auth/me', A.tokens.admin);
    const meB = await call('get', '/auth/me', B.tokens.admin);
    expect(meA.body.data.user.clinicId).toBe(A.clinicId);
    expect(meB.body.data.user.clinicId).toBe(B.clinicId);
  });
});

describe('coverage: every route is accounted for', () => {
  it('every registry route has an isolation case or is explicitly not clinic-scoped', () => {
    const registry = allRoutes(h.config).map((r) => `${r.method.toUpperCase()} ${r.path}`);
    expect([...Object.keys(ISOLATION), ...NOT_CLINIC_SCOPED].sort()).toEqual([...registry].sort());
  });
});
