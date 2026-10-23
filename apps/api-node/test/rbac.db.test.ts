// RBAC matrix: EVERY role x EVERY endpoint, against the real app and database.
// Expected results come from test/prdExpectations.ts (PRD 2.2 / section 4, written by hand), not from permissions.ts,
// so a typo in either place is caught. Also proves every successful mutating call wrote an audit row.
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ROLES, type Role } from '../src/auth/types.js';
import { allRoutes } from '../src/routes/index.js';
import { isMutating, type RouteDef } from '../src/http/routeRegistry.js';
import { bearer, createHarness, SEED_EMAIL, type Harness } from './db/helpers.js';
import { PRD_EXPECTED } from './prdExpectations.js';

let h: Harness;
let sessionId: string;
let patientId: string;
let medicineId: string;
let brandId: string;
let templateId: string;
let consentedSessionId: string;
let tplMedicineId: string;
const tokens: Partial<Record<Role | 'anonymous', string>> = {};

beforeAll(async () => {
  h = await createHarness();
  patientId = h.seed.patients[0]?.id as string;
  const clinicId = h.seed.clinics[0]?.id as string;

  tokens.doctor = await h.tokenFor(SEED_EMAIL.doctor1); // owns the fixture session below
  tokens.staff = await h.tokenFor(SEED_EMAIL.staff);
  tokens.admin = await h.tokenFor(SEED_EMAIL.admin);
  tokens.researcher = await h.tokenFor(SEED_EMAIL.researcher);

  // A patient-role account cannot log in, but a token for one must still get nothing.
  const patientUser = (
    await h.db.owner.query<{ id: string }>(
      `INSERT INTO mock_clinicos_user (name, email, password_hash, role, status, clinic_id)
       VALUES ('Fake Patient Account', 'patientacct@example.invalid', 'x', 'patient', 'approved', $1) RETURNING id`,
      [clinicId],
    )
  ).rows[0]?.id as string;
  patientUserId = patientUser;
  tokens.patient = await freshToken('patient');

  medicineId = (
    await h.db.owner.query<{ id: string }>(
      `INSERT INTO medicine_master (generic_name, source) VALUES ('Drug-R (FAKE)', 'rbac test fixture') RETURNING id`,
    )
  ).rows[0]?.id as string;
  brandId = (
    await h.db.owner.query<{ id: string }>(
      `INSERT INTO medicine_brand (medicine_id, brand_name, source) VALUES ($1, 'Brand-R (FAKE)', 'rbac test fixture') RETURNING id`,
      [medicineId],
    )
  ).rows[0]?.id as string;

  tplMedicineId = (
    await h.db.owner.query<{ id: string }>(
      `INSERT INTO medicine_master (generic_name, source) VALUES ('Drug-T (FAKE)', 'rbac test fixture') RETURNING id`,
    )
  ).rows[0]?.id as string;
  // a clinic-wide template owned by the doctor: the doctor (owner) and an admin may edit it
  templateId = (
    await h.db.owner.query<{ id: string }>(
      `INSERT INTO med_template (name, owner_user_id, clinic_id, visibility)
       VALUES ('RBAC demo template (FAKE)', $1, $2, 'clinic') RETURNING id`,
      [h.seed.users.find((u) => u.email === SEED_EMAIL.doctor1)?.id, clinicId],
    )
  ).rows[0]?.id as string;
  await h.db.owner.query(
    `INSERT INTO med_template_item (template_id, medicine_id, position, frequency) VALUES ($1, $2, 0, 'OD')`,
    [templateId, tplMedicineId],
  );

  // a second session whose audio + AI-processing consent is already on record, for the speech-token route
  consentedSessionId = (
    await h.db.owner.query<{ id: string }>(
      `INSERT INTO consultation_session (clinicos_patient_id, clinicos_doctor_id, clinicos_clinic_id)
       VALUES ($1, $2, $3) RETURNING id`,
      [patientId, h.seed.users.find((u) => u.email === SEED_EMAIL.doctor1)?.id, clinicId],
    )
  ).rows[0]?.id as string;
  for (const scope of ['audio', 'ai_processing']) {
    await h.db.owner.query(
      `INSERT INTO consent_event (session_id, clinic_id, scope, granted, notice_version, notice_language, source,
         recorded_by_user_id, recorded_by_role, ts)
       VALUES ($1,$2,$3,true,'0.1','en','staff',$4,'staff',now())`,
      [
        consentedSessionId,
        clinicId,
        scope,
        h.seed.users.find((u) => u.email === SEED_EMAIL.staff)?.id,
      ],
    );
  }

  sessionId = (
    await h.db.owner.query<{ id: string }>(
      `INSERT INTO consultation_session (clinicos_patient_id, clinicos_doctor_id, clinicos_clinic_id)
       VALUES ($1, $2, $3) RETURNING id`,
      [patientId, h.seed.users.find((u) => u.email === SEED_EMAIL.doctor1)?.id, clinicId],
    )
  ).rows[0]?.id as string;
});
afterAll(async () => {
  await h.close();
});

interface Call {
  path: string;
  body?: Record<string, unknown>;
}
const fixture = (route: RouteDef): Call => {
  const key = `${route.method.toUpperCase()} ${route.path}`;
  const consentGrant = {
    scopes: ['audio'],
    noticeVersion: '0.1',
    noticeLanguage: 'en',
    source: 'staff',
  };
  const calls: Record<string, Call> = {
    'POST /auth/login': {
      path: '/auth/login',
      body: { email: 'nobody@example.invalid', password: 'x' },
    },
    'POST /auth/logout': { path: '/auth/logout' },
    'GET /auth/me': { path: '/auth/me' },
    'GET /consent/notice': { path: '/consent/notice' },
    'POST /patients/lookup': { path: '/patients/lookup', body: { phone: '0000000001' } },
    'POST /patients': { path: '/patients', body: { phone: '0000000601' } },
    'GET /patients/:id': { path: `/patients/${patientId}` },
    'PUT /patients/:id/clinical-profile': {
      path: `/patients/${patientId}/clinical-profile`,
      body: { allergies: ['Drug-A (FAKE)'] },
    },
    'POST /sessions': { path: '/sessions', body: { patientId } },
    'GET /sessions': { path: '/sessions' },
    'GET /sessions/:id': { path: `/sessions/${sessionId}` },
    'GET /sessions/:id/consent': { path: `/sessions/${sessionId}/consent` },
    'POST /internal/audio-assets': {
      path: '/internal/audio-assets',
      body: {
        assetId: sessionId,
        sessionId,
        storageKey: 'x',
        durationS: 1,
        bytes: 1,
        retentionUntil: '2027-01-01T00:00:00Z',
      },
    },
    'POST /internal/audio-assets/:id/deleted': {
      path: `/internal/audio-assets/${sessionId}/deleted`,
      body: { reason: 'manual' },
    },
    'GET /internal/sessions/:id/consent-status': {
      path: `/internal/sessions/${sessionId}/consent-status`,
    },
    'GET /sessions/:id/facts': { path: `/sessions/${consentedSessionId}/facts` },
    'POST /sessions/:id/facts': {
      path: `/sessions/${consentedSessionId}/facts`,
      body: { type: 'symptom', value: 'fixture symptom' },
    },
    'PATCH /sessions/:id/facts/:factId': {
      path: `/sessions/${consentedSessionId}/facts/${consentedSessionId}`,
      body: { action: 'reject' },
    },
    'GET /internal/sessions/:id/transcript-segments': {
      path: `/internal/sessions/${consentedSessionId}/transcript-segments`,
    },
    'POST /internal/sessions/:id/facts': {
      path: `/internal/sessions/${consentedSessionId}/facts`,
      body: {
        runId: consentedSessionId,
        pipeline: 'grounded',
        model: 'mock',
        droppedUngrounded: 0,
        facts: [],
      },
    },
    'POST /sessions/:id/candidates/select/undo': {
      path: `/sessions/${consentedSessionId}/candidates/select/undo`,
      body: {},
    },
    'GET /sessions/:id/pathway-record': {
      path: `/sessions/${consentedSessionId}/pathway-record`,
    },
    'GET /sessions/:id/concept-suggestions': {
      path: `/sessions/${consentedSessionId}/concept-suggestions`,
    },
    'POST /sessions/:id/facts/:factId/concept': {
      path: `/sessions/${consentedSessionId}/facts/${consentedSessionId}/concept`,
      body: { conceptId: 'x' },
    },
    'DELETE /sessions/:id/facts/:factId/concept': {
      path: `/sessions/${consentedSessionId}/facts/${consentedSessionId}/concept`,
    },
    'GET /sessions/:id/prescription': { path: `/sessions/${consentedSessionId}/prescription` },
    'POST /sessions/:id/prescription/items': {
      path: `/sessions/${consentedSessionId}/prescription/items`,
      body: { medicineId: null, name: 'rbac fixture medicine', frequency: 'OD', duration: '1 day' },
    },
    'PATCH /sessions/:id/prescription/items/:itemId': {
      path: `/sessions/${consentedSessionId}/prescription/items/00000000-0000-4000-8000-000000000001`,
      body: { duration: '2 days' },
    },
    'DELETE /sessions/:id/prescription/items/:itemId': {
      path: `/sessions/${consentedSessionId}/prescription/items/00000000-0000-4000-8000-000000000001`,
    },
    'POST /sessions/:id/prescription/apply-template': {
      path: `/sessions/${consentedSessionId}/prescription/apply-template`,
      body: { templateId: '00000000-0000-4000-8000-000000000001' },
    },
    'GET /sessions/:id/sign-readiness': { path: `/sessions/${consentedSessionId}/sign-readiness` },
    'POST /sessions/:id/sign': {
      path: `/sessions/${consentedSessionId}/sign`,
      body: { password: h.passwords[SEED_EMAIL.doctor1], safetyNotRunAcknowledged: true },
    },
    'POST /sessions/:id/amend': {
      path: `/sessions/${consentedSessionId}/amend`,
      body: {
        password: h.passwords[SEED_EMAIL.doctor1],
        safetyNotRunAcknowledged: true,
        reason: 'rbac fixture',
        medicines: [],
      },
    },
    'GET /sessions/:id/visit': { path: `/sessions/${consentedSessionId}/visit` },
    'GET /sessions/:id/visit/versions': { path: `/sessions/${consentedSessionId}/visit/versions` },
    'GET /sessions/:id/visit/versions/:version': {
      path: `/sessions/${consentedSessionId}/visit/versions/1`,
    },
    'GET /sessions/:id/sign-preview': { path: `/sessions/${consentedSessionId}/sign-preview` },
    'GET /sessions/:id/previous-visits': {
      path: `/sessions/${consentedSessionId}/previous-visits`,
    },
    'GET /sessions/:id/fhir': { path: `/sessions/${consentedSessionId}/fhir` },
    'POST /sessions/:id/fhir': { path: `/sessions/${consentedSessionId}/fhir`, body: {} },
    'POST /sessions/:id/fhir/export': {
      path: `/sessions/${consentedSessionId}/fhir/export`,
      body: { kind: 'op_consult' },
    },
    'GET /pathways': { path: '/pathways' },
    'GET /pathways/:id': { path: '/pathways/toy_condition_a' },
    'GET /sessions/:id/questions/next': { path: `/sessions/${consentedSessionId}/questions/next` },
    'POST /sessions/:id/questions/:eventId/action': {
      path: `/sessions/${consentedSessionId}/questions/${consentedSessionId}/action`,
      body: { action: 'asked' },
    },
    'GET /sessions/:id/candidates': { path: `/sessions/${consentedSessionId}/candidates` },
    'POST /sessions/:id/candidates/select': {
      path: `/sessions/${consentedSessionId}/candidates/select`,
      body: { notListed: true, text: 'fixture note' },
    },
    'GET /sessions/:id/transcript': { path: `/sessions/${consentedSessionId}/transcript` },
    'PUT /sessions/:id/transcript/segments': {
      path: `/sessions/${consentedSessionId}/transcript/segments`,
      body: {
        segments: [
          {
            seq: 0,
            speaker: 'unknown',
            originalText: 'rbac fixture words',
            editedText: null,
            language: 'en-IN',
            startMs: 0,
            endMs: 900,
            engine: 'mock',
            engineVersion: '1.0',
          },
        ],
      },
    },
    'POST /sessions/:id/transcript/confirm': {
      path: `/sessions/${consentedSessionId}/transcript/confirm`,
    },
    'POST /sessions/:id/asr-token': { path: `/sessions/${consentedSessionId}/asr-token` },
    'POST /sessions/:id/consent': { path: `/sessions/${sessionId}/consent`, body: consentGrant },
    'POST /sessions/:id/consent/withdraw': {
      path: `/sessions/${sessionId}/consent/withdraw`,
      body: { source: 'patient' },
    },
    'GET /audit': { path: '/audit' },
    'GET /audit/verify': { path: '/audit/verify' },
    'POST /audit/export': { path: '/audit/export', body: {} },
    'GET /medicines': { path: '/medicines?q=drug' },
    'GET /medicines/:id': { path: `/medicines/${medicineId}` },
    'POST /medicines': {
      path: '/medicines',
      body: { genericName: 'Drug-N (FAKE)', source: 'rbac test' },
    },
    'PATCH /medicines/:id': { path: `/medicines/${medicineId}`, body: { strength: '5 mg' } },
    'POST /medicines/:id/retire': { path: `/medicines/${medicineId}/retire` },
    'POST /medicines/:id/restore': { path: `/medicines/${medicineId}/restore` },
    'POST /medicines/:id/brands': {
      path: `/medicines/${medicineId}/brands`,
      body: { brandName: 'Brand-N (FAKE)', source: 'rbac test' },
    },
    'GET /medicines/categories': { path: '/medicines/categories' },
    'GET /templates': { path: '/templates' },
    'GET /templates/:id': { path: `/templates/${templateId}` },
    'GET /templates/:id/load': { path: `/templates/${templateId}/load` },
    'POST /templates': {
      path: '/templates',
      body: {
        name: 'RBAC new template (FAKE)',
        visibility: 'personal',
        items: [{ medicineId: tplMedicineId, frequency: 'BD' }],
      },
    },
    'PUT /templates/:id': {
      path: `/templates/${templateId}`,
      body: {
        name: 'RBAC demo template (FAKE)',
        visibility: 'clinic',
        items: [{ medicineId: tplMedicineId, frequency: 'TDS' }],
      },
    },
    'POST /templates/:id/retire': { path: `/templates/${templateId}/retire` },
    'POST /templates/:id/restore': { path: `/templates/${templateId}/restore` },
    'POST /medicines/:id/brands/:brandId/retire': {
      path: `/medicines/${medicineId}/brands/${brandId}/retire`,
    },
  };
  const call = calls[key];
  if (!call) throw new Error(`rbac.db.test: no request fixture for ${key}; add one`);
  return call;
};

const actors: Array<Role | 'anonymous'> = ['anonymous', ...ROLES];

const LOGIN_EMAIL: Record<string, string> = {
  doctor: SEED_EMAIL.doctor1,
  staff: SEED_EMAIL.staff,
  admin: SEED_EMAIL.admin,
  researcher: SEED_EMAIL.researcher,
};
let patientUserId = '';
/** A new token for a role: through the real login for the four login roles, issued directly for the unused patient. */
async function freshToken(role: Role): Promise<string> {
  const email = LOGIN_EMAIL[role];
  if (email) return h.tokenFor(email);
  const issued = await h.services.tokens?.issueToken({
    sub: patientUserId,
    role: 'patient',
    clinicId: h.seed.clinics[0]?.id as string,
    devUser: true,
  });
  return issued?.accessToken as string;
}

const send = (route: RouteDef, actor: Role | 'anonymous') => {
  const call = fixture(route);
  let req = request(h.app)[route.method](`/api/v1${call.path}`);
  const token = tokens[actor];
  if (token) req = req.set(...bearer(token));
  return call.body ? req.send(call.body) : req;
};

const auditCount = async () =>
  Number(
    (await h.db.owner.query<{ n: number }>('SELECT count(*)::int AS n FROM audit_log')).rows[0]?.n,
  );

describe('role x endpoint matrix', () => {
  // The route list is only known once the harness exists, so build the cases lazily inside one test per route.
  for (const key of Object.keys(PRD_EXPECTED)) {
    it(`${key}`, async () => {
      const route = allRoutes(h.config).find((r) => `${r.method.toUpperCase()} ${r.path}` === key);
      expect(route, `route ${key} is not registered`).toBeTruthy();
      if (!route) return;
      const expected = PRD_EXPECTED[key];
      if (!expected) throw new Error(`no expectation for ${key}`);

      for (const actor of actors) {
        // a logged-out token must not be reused by the next actor: logout is checked last
        const before = await auditCount();
        const res = await send(route, actor);
        const label = `${key} as ${actor} -> ${res.status}`;

        if (expected === 'service') {
          // internal route: a user token (any role) or no token is simply not a service signature
          expect(res.status, label).toBe(401);
        } else if (expected === 'public') {
          // public: nobody is refused for their ROLE (a bad login is 401, never 403)
          expect(res.status, label).not.toBe(403);
        } else if (actor === 'anonymous') {
          expect(res.status, label).toBe(401);
        } else if (expected === 'authenticated') {
          expect([401, 403], label).not.toContain(res.status);
        } else if (expected.includes(actor as Role)) {
          expect([401, 403], label).not.toContain(res.status);
        } else {
          expect(res.status, label).toBe(403);
          // a refused request changes nothing
          expect(await auditCount(), `${label} must not audit`).toBe(before);
        }

        // every successful mutating call is audited (central wrapper guarantee, checked end to end)
        if (isMutating(route.method) && res.status >= 200 && res.status < 300) {
          expect(await auditCount(), `${label} wrote no audit row`).toBeGreaterThan(before);
        }

        if (key === 'POST /auth/logout' && res.status === 200) {
          // that token is now revoked (correct); give this actor a fresh one so later routes keep working
          tokens[actor as Role] = await freshToken(actor as Role);
        }
      }
    });
  }

  it('the patient role (unused) gets 403 on every permission-protected endpoint', async () => {
    for (const route of allRoutes(h.config)) {
      if (route.access.kind !== 'permission') continue;
      const res = await send(route, 'patient');
      expect(res.status, `${route.method} ${route.path}`).toBe(403);
    }
  });

  it('every registered route has an expectation, and every expectation a route', () => {
    const registered = allRoutes(h.config).map((r) => `${r.method.toUpperCase()} ${r.path}`);
    expect(registered.sort()).toEqual(Object.keys(PRD_EXPECTED).sort());
  });

  it('unknown /api/v1 routes are a clean 404 for anyone', async () => {
    for (const actor of ['anonymous', 'doctor'] as const) {
      let req = request(h.app).get('/api/v1/does-not-exist');
      const token = tokens[actor];
      if (token) req = req.set(...bearer(token));
      const res = await req;
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
  });
});
