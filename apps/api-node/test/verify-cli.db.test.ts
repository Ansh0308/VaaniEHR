// The verify-audit-chain command (`npm run verify:audit`), run for real as a separate process against a test database.
// This is what docs/AUDIT_CHAIN.md describes: --expect-head / --expect-count catch rows deleted from the END of the log,
// which the chain alone cannot see.
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bearer, createHarness, SEED_EMAIL, type Harness } from './db/helpers.js';

let h: Harness;
beforeEach(async () => {
  h = await createHarness();
  // some real activity so the log has several rows
  const staff = await h.tokenFor(SEED_EMAIL.staff);
  for (let i = 0; i < 4; i += 1) {
    await request(h.app)
      .post('/api/v1/patients/lookup')
      .set(...bearer(staff))
      .send({ phone: '0000000001' });
  }
});
afterEach(async () => {
  await h.close();
});

function verify(...args: string[]): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/audit/verifyCli.ts', ...args], {
      cwd: join(__dirname, '..'),
      env: { ...process.env, DATABASE_URL: h.db.appUrl },
    });
    let out = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (out += d.toString()));
    child.on('exit', (code) => resolve({ code, out }));
  });
}

/** Reads "N row(s)" and the head hash the way an operator would copy them from the screen. */
async function record(): Promise<{ count: number; head: string }> {
  const r = await verify();
  expect(r.code).toBe(0);
  const count = Number(/audit chain OK: (\d+) row/.exec(r.out)?.[1]);
  const head = /head hash: ([0-9a-f]{64})/.exec(r.out)?.[1] as string;
  expect(count).toBeGreaterThan(4);
  expect(head).toBeTruthy();
  return { count, head };
}

describe('npm run verify:audit', () => {
  it('prints the row count and the head hash for an intact chain (exit 0)', async () => {
    const r = await verify();
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/audit chain OK: \d+ row\(s\), head seq \d+/);
    expect(r.out).toMatch(/head hash: [0-9a-f]{64}/);
  });

  it('passes when the recorded head hash and count still match', async () => {
    const { count, head } = await record();
    const r = await verify('--expect-head', head, '--expect-count', String(count));
    expect(r.code).toBe(0);
  });

  it('fails when the count or the head hash differs from the recorded values', async () => {
    const { count } = await record();
    expect((await verify('--expect-count', String(count + 1))).code).toBe(1);
    expect((await verify('--expect-head', 'f'.repeat(64))).code).toBe(1);
  });

  it('a growing log is fine on a plain verify but no longer matches an OLD recorded head (record again after real use)', async () => {
    const { count, head } = await record();
    const staff = await h.tokenFor(SEED_EMAIL.staff);
    await request(h.app)
      .post('/api/v1/patients/lookup')
      .set(...bearer(staff))
      .send({ phone: '0000000002' });
    expect((await verify()).code).toBe(0);
    expect((await verify('--expect-count', String(count))).code).toBe(1);
    expect((await verify('--expect-head', head)).code).toBe(1);
  });

  it('why the recorded values matter: rows deleted from the END leave a valid chain that only --expect-* catches', async () => {
    const { count, head } = await record();
    const c = await h.db.owner.connect();
    try {
      await c.query('ALTER TABLE audit_log DISABLE TRIGGER USER');
      await c.query('DELETE FROM audit_log WHERE seq > $1', [count - 2]);
      await c.query('ALTER TABLE audit_log ENABLE TRIGGER USER');
    } finally {
      c.release();
    }
    const plain = await verify();
    expect(plain.code).toBe(0); // the chain alone cannot see it
    expect(plain.out).toContain(`${count - 2} row(s)`);
    const byCount = await verify('--expect-count', String(count));
    expect(byCount.code).toBe(1);
    const byHead = await verify('--expect-head', head);
    expect(byHead.code).toBe(1);
    expect(byHead.out).toMatch(/rows may have been removed/);
  });

  it('reports the first broken row when the chain itself is broken (exit 1)', async () => {
    const c = await h.db.owner.connect();
    try {
      await c.query('ALTER TABLE audit_log DISABLE TRIGGER USER');
      await c.query("UPDATE audit_log SET action = 'LOGOUT' WHERE seq = 3");
      await c.query('ALTER TABLE audit_log ENABLE TRIGGER USER');
    } finally {
      c.release();
    }
    const r = await verify();
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/AUDIT CHAIN BROKEN at seq 3 \(row_hash_mismatch\)/);
  });

  it('exits 2 when the database cannot be reached', async () => {
    const child = await new Promise<{ code: number | null; out: string }>((resolve) => {
      const p = spawn(process.execPath, ['--import', 'tsx', 'src/audit/verifyCli.ts'], {
        cwd: join(__dirname, '..'),
        env: { ...process.env, DATABASE_URL: 'postgres://nobody:wrong@127.0.0.1:1/none' },
      });
      let out = '';
      p.stderr.on('data', (d: Buffer) => (out += d.toString()));
      p.on('exit', (code) => resolve({ code, out }));
    });
    expect(child.code).toBe(2);
    expect(child.out).toMatch(/could not read the audit log/);
  });
});
