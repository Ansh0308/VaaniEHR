// The speech-service token (Phase 4A): minted only after the server has confirmed audio + AI-processing consent.
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ASR_TOKEN_TTL_SECONDS } from '../src/asr/token.js';
import { bearer, createHarness, SEED_EMAIL, type Harness } from './db/helpers.js';
import { TEST_INTERNAL_SECRET } from './helpers.js';

let h: Harness;
let doctor: string;
let doctor2: string;
let staff: string;
let sessionId: string;
let clinicId: string;

const mint = (token: string, id: string) =>
  request(h.app)
    .post(`/api/v1/sessions/${id}/asr-token`)
    .set(...bearer(token));
const record = async (scope: string, granted = true) => {
  const staffId = h.seed.users.find((u) => u.email === SEED_EMAIL.staff)?.id;
  await h.db.owner.query(
    `INSERT INTO consent_event (session_id, clinic_id, scope, granted, notice_version, notice_language, source,
       recorded_by_user_id, recorded_by_role, ts)
     VALUES ($1,$2,$3,$4,'0.1','en','staff',$5,'staff',now())`,
    [sessionId, clinicId, scope, granted, staffId],
  );
};
const decode = (token: string) => {
  const [payload, signature] = token.split('.') as [string, string];
  return {
    claims: JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >,
    valid:
      createHmac('sha256', TEST_INTERNAL_SECRET).update(payload).digest('base64url') === signature,
  };
};

beforeAll(async () => {
  h = await createHarness();
  doctor = await h.tokenFor(SEED_EMAIL.doctor1);
  doctor2 = await h.tokenFor(SEED_EMAIL.doctor2);
  staff = await h.tokenFor(SEED_EMAIL.staff);
  clinicId = h.seed.clinics[0]?.id as string;
  const patient = await h.db.owner.query<{ id: string }>(
    'SELECT id FROM mock_clinicos_patient WHERE clinic_id = $1 LIMIT 1',
    [clinicId],
  );
  sessionId = (
    await h.db.owner.query<{ id: string }>(
      `INSERT INTO consultation_session (clinicos_patient_id, clinicos_doctor_id, clinicos_clinic_id)
       VALUES ($1, $2, $3) RETURNING id`,
      [patient.rows[0]?.id, h.seed.users.find((u) => u.email === SEED_EMAIL.doctor1)?.id, clinicId],
    )
  ).rows[0]?.id as string;
});
afterAll(async () => {
  await h.close();
});

describe('POST /sessions/:id/asr-token', () => {
  it('is refused until BOTH audio and ai_processing are on record (403 CONSENT_REQUIRED)', async () => {
    expect((await mint(doctor, sessionId)).body.error.code).toBe('CONSENT_REQUIRED');
    await record('audio');
    expect((await mint(doctor, sessionId)).status).toBe(403);
  });

  it('is issued when both are on record: signed, 2 minutes, bound to this session, ids only', async () => {
    await record('ai_processing');
    const res = await mint(doctor, sessionId);
    expect(res.status).toBe(200);
    expect(res.body.data.expiresInSeconds).toBe(ASR_TOKEN_TTL_SECONDS);
    const { claims, valid } = decode(res.body.data.token);
    expect(valid).toBe(true);
    expect(claims).toMatchObject({
      v: 1,
      aud: 'asr-py',
      sid: sessionId,
      scopes: ['ai_processing', 'audio'],
    });
    expect((claims.exp as number) - (claims.iat as number)).toBe(ASR_TOKEN_TTL_SECONDS);
    expect(Object.keys(claims).sort()).toEqual([
      'aud',
      'cid',
      'exp',
      'iat',
      'jti',
      'scopes',
      'sid',
      'uid',
      'v',
    ]);
    expect(decode((await mint(doctor, sessionId)).body.data.token).claims.jti).not.toBe(claims.jti);
  });

  it('is refused again after consent is withdrawn', async () => {
    await record('audio', false);
    expect((await mint(doctor, sessionId)).body.error.code).toBe('CONSENT_REQUIRED');
    await record('audio');
  });

  it("only the session's own doctor may ask: staff 403, another doctor 404", async () => {
    expect((await mint(staff, sessionId)).status).toBe(403);
    expect((await mint(doctor2, sessionId)).status).toBe(404);
  });

  it('writes an audit row with ids only', async () => {
    const rows = await h.db.owner.query(
      `SELECT resource_type, resource_id, meta FROM audit_log WHERE action = 'ASR_TOKEN_ISSUED' ORDER BY seq DESC LIMIT 1`,
    );
    expect(rows.rows[0]).toMatchObject({ resource_type: 'session', resource_id: sessionId });
    expect(JSON.stringify(rows.rows[0]?.meta ?? {})).not.toMatch(/token/i);
  });
});

describe('when the shared secret is not configured', () => {
  it('the route says "not ready" (503) instead of minting an unsigned token', async () => {
    const bare = await createHarness({ INTERNAL_SERVICE_SECRET: '' });
    try {
      const t = await bare.tokenFor(SEED_EMAIL.doctor1);
      const res = await request(bare.app)
        .post(`/api/v1/sessions/${sessionId}/asr-token`)
        .set(...bearer(t));
      expect(res.status).toBe(503);
    } finally {
      await bare.close();
    }
  });
});
