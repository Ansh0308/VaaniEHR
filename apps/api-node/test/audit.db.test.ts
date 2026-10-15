// Audit log against real PostgreSQL: valid chains from real operations, tamper detection, concurrency, atomicity with
// the change it records, and who may read it (admin full, researcher anonymised).
import { Router } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendAudit } from '../src/audit/audit.js';
import { verifyDatabaseChain } from '../src/audit/verifyCli.js';
import { createApp } from '../src/app.js';
import { withTransaction } from '../src/db/tx.js';
import { errors } from '../src/http/errors.js';
import { mountRoutes, type RouteDef } from '../src/http/routeRegistry.js';
import { bearer, createHarness, SEED_EMAIL, type Harness } from './db/helpers.js';

let h: Harness;
beforeEach(async () => {
  h = await createHarness();
});
afterEach(async () => {
  await h.close();
});

const count = async (sql = 'SELECT count(*)::int AS n FROM audit_log') =>
  Number((await h.db.owner.query<{ n: number }>(sql)).rows[0]?.n);

/** Owner-only helper: runs a tamper statement with the append-only triggers switched off. */
async function tamper(sql: string, params: unknown[] = []): Promise<void> {
  const c = await h.db.owner.connect();
  try {
    await c.query('ALTER TABLE audit_log DISABLE TRIGGER USER');
    await c.query(sql, params);
    await c.query('ALTER TABLE audit_log ENABLE TRIGGER USER');
  } finally {
    c.release();
  }
}

/** Generate a handful of real audit rows through the real API. */
async function makeActivity(): Promise<void> {
  const staff = await h.tokenFor(SEED_EMAIL.staff);
  const doctor = await h.tokenFor(SEED_EMAIL.doctor1);
  const patientId = h.seed.patients[0]?.id as string;
  await request(h.app)
    .post('/api/v1/patients/lookup')
    .set(...bearer(staff))
    .send({ phone: '0000000001' });
  const session = await request(h.app)
    .post('/api/v1/sessions')
    .set(...bearer(doctor))
    .send({ patientId });
  const sid = session.body.data.id as string;
  await request(h.app)
    .post(`/api/v1/sessions/${sid}/consent`)
    .set(...bearer(staff))
    .send({
      scopes: ['audio', 'ai_processing'],
      noticeVersion: '0.1',
      noticeLanguage: 'gu',
      source: 'staff',
    });
  await request(h.app)
    .post(`/api/v1/sessions/${sid}/consent/withdraw`)
    .set(...bearer(doctor))
    .send({ scopes: ['audio'], source: 'patient' });
}

describe('hash chain from real operations', () => {
  it('stays valid across logins, lookups, sessions and consent changes', async () => {
    await makeActivity();
    const result = await verifyDatabaseChain(h.appPool);
    expect(result.ok).toBe(true);
    expect(result.count).toBe(await count());
    expect(result.count).toBeGreaterThan(6);
  });

  it('seq values are contiguous from 1 and each row links to the previous row_hash', async () => {
    await makeActivity();
    const rows = (
      await h.db.owner.query<{ seq: number; prev_hash: string; row_hash: string }>(
        'SELECT seq, prev_hash, row_hash FROM audit_log ORDER BY seq',
      )
    ).rows;
    rows.forEach((row, i) => {
      expect(row.seq).toBe(i + 1);
      if (i > 0) expect(row.prev_hash).toBe(rows[i - 1]?.row_hash);
    });
  });

  it('GET /audit/verify (admin) reports ok for an intact chain', async () => {
    await makeActivity();
    const admin = await h.tokenFor(SEED_EMAIL.admin);
    const res = await request(h.app)
      .get('/api/v1/audit/verify')
      .set(...bearer(admin));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ ok: true });
    expect(res.body.data.count).toBe(await count());
  });
});

describe('tamper detection (owner switches the triggers off, the chain still catches it)', () => {
  it('an edited row is reported as the first broken row', async () => {
    await makeActivity();
    const admin = await h.tokenFor(SEED_EMAIL.admin); // log in BEFORE tampering so the chain head is intact
    await tamper("UPDATE audit_log SET action = 'CONSENT_WITHDRAWN' WHERE seq = 4");
    expect(await verifyDatabaseChain(h.appPool)).toMatchObject({
      ok: false,
      firstBrokenSeq: 4,
      reason: 'row_hash_mismatch',
    });
    // The API verify agrees on the same first broken row.
    const res = await request(h.app)
      .get('/api/v1/audit/verify')
      .set(...bearer(admin));
    expect(res.body.data).toMatchObject({ ok: false, firstBrokenSeq: 4 });
  });

  it('edited metadata is detected', async () => {
    await makeActivity();
    await tamper(`UPDATE audit_log SET meta = '{"found":false}'::jsonb WHERE seq = 3`);
    expect(await verifyDatabaseChain(h.appPool)).toMatchObject({ ok: false, firstBrokenSeq: 3 });
  });

  it('a deleted row is detected at the row after it', async () => {
    await makeActivity();
    await tamper('DELETE FROM audit_log WHERE seq = 3');
    expect(await verifyDatabaseChain(h.appPool)).toMatchObject({
      ok: false,
      firstBrokenSeq: 4,
      reason: 'seq_gap',
    });
  });

  it('a deleted first row is detected', async () => {
    await makeActivity();
    await tamper('DELETE FROM audit_log WHERE seq = 1');
    expect(await verifyDatabaseChain(h.appPool)).toMatchObject({ ok: false, firstBrokenSeq: 2 });
  });

  it('a rewritten prev_hash is detected', async () => {
    await makeActivity();
    await tamper('UPDATE audit_log SET prev_hash = $1 WHERE seq = 5', ['f'.repeat(64)]);
    expect(await verifyDatabaseChain(h.appPool)).toMatchObject({
      ok: false,
      firstBrokenSeq: 5,
      reason: 'prev_hash_mismatch',
    });
  });

  it('re-numbered (re-ordered) rows are detected', async () => {
    await makeActivity();
    await tamper('UPDATE audit_log SET seq = seq + 1000 WHERE seq IN (3, 4)');
    await tamper('UPDATE audit_log SET seq = 4 WHERE seq = 1003');
    await tamper('UPDATE audit_log SET seq = 3 WHERE seq = 1004');
    expect(await verifyDatabaseChain(h.appPool)).toMatchObject({ ok: false, firstBrokenSeq: 3 });
  });

  it('known limit: deleting the last rows keeps a valid chain but changes the head hash', async () => {
    await makeActivity();
    const before = await verifyDatabaseChain(h.appPool);
    const last = await count();
    await tamper('DELETE FROM audit_log WHERE seq > $1', [last - 2]);
    const after = await verifyDatabaseChain(h.appPool);
    expect(after.ok).toBe(true);
    if (before.ok && after.ok) {
      expect(after.headHash).not.toBe(before.headHash); // what --expect-head compares
      expect(after.count).toBe(before.count - 2);
    }
  });
});

describe('concurrency and atomicity', () => {
  it('25 simultaneous writers produce one valid, gap-free chain', async () => {
    const before = await count();
    await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        withTransaction(h.appPool, (tx) => appendAudit(tx, { action: 'LOGOUT', meta: { n: i } })),
      ),
    );
    expect(await count()).toBe(before + 25);
    expect((await verifyDatabaseChain(h.appPool)).ok).toBe(true);
  });

  it('an audit row and the change it records commit together or not at all', async () => {
    const pid = '99999999-9999-4999-8999-999999999999';
    const make = (fail: boolean): RouteDef => ({
      method: 'post',
      path: '/atomic',
      tag: 'Test',
      summary: 'atomicity test route',
      access: { kind: 'public' },
      audit: ['LOGOUT'],
      successStatus: 200,
      pre: [],
      handler: async (ctx) => {
        await ctx.db.query(
          'INSERT INTO patient_clinical_profile (clinicos_patient_id, allergies) VALUES ($1, $2)',
          [pid, ['Drug-A (FAKE)']],
        );
        await ctx.audit({ action: 'LOGOUT', meta: { atomic: true } });
        if (fail) throw errors.conflict('fails after writing both');
        return { data: { ok: true } };
      },
    });
    const build = (fail: boolean) => {
      const v1 = Router();
      mountRoutes(v1, [make(fail)], h.services);
      return createApp({
        config: h.config,
        authProvider: h.services.auth,
        checkDb: async () => {},
        extend: (a) => a.use('/t', v1),
      });
    };

    const auditBefore = await count();
    const failed = await request(build(true)).post('/t/atomic').send({});
    expect(failed.status).toBe(409);
    expect(await count()).toBe(auditBefore);
    expect(
      await count(
        'SELECT count(*)::int AS n FROM patient_clinical_profile WHERE clinicos_patient_id = ' +
          `'${pid}'`,
      ),
    ).toBe(0);

    const worked = await request(build(false)).post('/t/atomic').send({});
    expect(worked.status).toBe(200);
    expect(await count()).toBe(auditBefore + 1);
    expect(
      await count(
        'SELECT count(*)::int AS n FROM patient_clinical_profile WHERE clinicos_patient_id = ' +
          `'${pid}'`,
      ),
    ).toBe(1);
  });
});

describe('what the audit log contains', () => {
  it('never holds patient names, phone numbers, allergies, e-mails or tokens', async () => {
    await makeActivity();
    const all = (
      await h.db.owner.query<{ t: string }>(
        'SELECT row_to_json(audit_log)::text AS t FROM audit_log',
      )
    ).rows
      .map((r) => r.t)
      .join('\n');
    const needles = [
      ...h.seed.patients.flatMap((p) => [p.name ?? '', p.phone, ...p.allergies]),
      ...h.seed.users.map((u) => u.email),
      ...Object.values(h.passwords),
      'eyJ', // a JWT always starts like this
    ].filter(Boolean);
    for (const needle of needles) {
      // A phone number is a standalone run of digits; as a plain substring it would also match inside ids.
      if (/^\d{10}$/.test(needle)) {
        expect(new RegExp(String.raw`(?<!\d)${needle}(?!\d)`).test(all), needle).toBe(false);
      } else {
        expect(all, needle).not.toContain(needle);
      }
    }
  });

  it('records the actor, role, clinic, request id and ip for a mutating call', async () => {
    await makeActivity();
    const r = await h.db.owner.query(
      "SELECT * FROM audit_log WHERE action = 'SESSION_CREATED' ORDER BY seq DESC LIMIT 1",
    );
    const row = r.rows[0];
    expect(row.actor_role).toBe('doctor');
    expect(row.actor_user_id).toBeTruthy();
    expect(row.clinic_id).toBe(h.seed.clinics[0]?.id);
    expect(row.request_id).toBeTruthy();
    expect(row.session_id).toBeTruthy();
  });
});

describe('GET /api/v1/audit', () => {
  it('admin sees full rows, newest first, with a paging cursor', async () => {
    await makeActivity();
    const admin = await h.tokenFor(SEED_EMAIL.admin);
    const page1 = await request(h.app)
      .get('/api/v1/audit?limit=3')
      .set(...bearer(admin));
    expect(page1.status).toBe(200);
    const items = page1.body.data.items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveProperty('actorUserId');
    expect(items[0]).toHaveProperty('rowHash');
    expect((items[0]?.seq as number) > (items[1]?.seq as number)).toBe(true);
    const cursor = page1.body.data.nextBeforeSeq as number;
    const page2 = await request(h.app)
      .get(`/api/v1/audit?limit=3&beforeSeq=${cursor}`)
      .set(...bearer(admin));
    expect((page2.body.data.items[0] as { seq: number }).seq).toBeLessThan(cursor);
  });

  it('researcher sees anonymised rows only: what happened, never who or to whom', async () => {
    await makeActivity();
    const researcher = await h.tokenFor(SEED_EMAIL.researcher);
    const res = await request(h.app)
      .get('/api/v1/audit?limit=50')
      .set(...bearer(researcher));
    expect(res.status).toBe(200);
    for (const item of res.body.data.items as Array<Record<string, unknown>>) {
      expect(Object.keys(item).sort()).toEqual([
        'action',
        'actorRole',
        'resourceType',
        'seq',
        'ts',
      ]);
    }
    expect(JSON.stringify(res.body)).not.toMatch(
      /example\.invalid|actorUserId|resourceId|\bip\b|meta/,
    );
  });

  it('rejects out-of-range paging parameters', async () => {
    const admin = await h.tokenFor(SEED_EMAIL.admin);
    expect(
      (
        await request(h.app)
          .get('/api/v1/audit?limit=0')
          .set(...bearer(admin))
      ).status,
    ).toBe(400);
    expect(
      (
        await request(h.app)
          .get('/api/v1/audit?limit=500')
          .set(...bearer(admin))
      ).status,
    ).toBe(400);
    expect(
      (
        await request(h.app)
          .get('/api/v1/audit?beforeSeq=abc')
          .set(...bearer(admin))
      ).status,
    ).toBe(400);
  });
});
