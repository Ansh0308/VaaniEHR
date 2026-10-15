// Seed script and the "never real data" start-up guard (Hard Rule 1, ADR-D16).
import { spawn } from 'node:child_process';
import { createServer as createNetServer, type AddressInfo } from 'node:net';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { verifyDatabaseChain } from '../src/audit/verifyCli.js';
import { assertAllSimulated, RealDataError } from '../src/db/simulatedGuard.js';
import { applySeed } from '../src/seed/seedDev.js';
import { createHarness, SEED_EMAIL, type Harness } from './db/helpers.js';

let h: Harness;
beforeEach(async () => {
  h = await createHarness();
});
afterEach(async () => {
  await h.close();
});

const n = async (sql: string) => Number((await h.db.owner.query<{ n: number }>(sql)).rows[0]?.n);

describe('seed:dev', () => {
  it('loads 1 clinic, 5 users (admin, 2 doctors, staff, researcher) and 15 patients', async () => {
    expect(await n('SELECT count(*)::int AS n FROM mock_clinicos_clinic')).toBe(1);
    expect(await n('SELECT count(*)::int AS n FROM mock_clinicos_user')).toBe(5);
    expect(await n('SELECT count(*)::int AS n FROM mock_clinicos_patient')).toBe(15);
    const roles = (
      await h.db.owner.query<{ role: string; c: number }>(
        'SELECT role, count(*)::int AS c FROM mock_clinicos_user GROUP BY role ORDER BY role',
      )
    ).rows;
    expect(roles).toEqual([
      { role: 'admin', c: 1 },
      { role: 'doctor', c: 2 },
      { role: 'researcher', c: 1 },
      { role: 'staff', c: 1 },
    ]);
  });

  it('marks everything simulated, gives each doctor a fake profile, and 15 allergy profiles', async () => {
    expect(
      await n('SELECT count(*)::int AS n FROM mock_clinicos_patient WHERE NOT is_simulated'),
    ).toBe(0);
    expect(
      await n('SELECT count(*)::int AS n FROM mock_clinicos_user WHERE NOT is_simulated'),
    ).toBe(0);
    const profiles = (
      await h.db.owner.query('SELECT * FROM doctor_profile ORDER BY registration_no')
    ).rows;
    expect(profiles.map((p) => p.registration_no)).toEqual(['FAKE-REG-0001', 'FAKE-REG-0002']);
    expect(profiles.every((p) => p.researcher_flag === false)).toBe(true);
    expect(await n('SELECT count(*)::int AS n FROM patient_clinical_profile')).toBe(15);
    expect(
      await n(
        'SELECT count(*)::int AS n FROM patient_clinical_profile WHERE cardinality(allergies) > 0',
      ),
    ).toBeGreaterThan(5);
  });

  it('stores bcrypt hashes only, never a password; generated passwords are long and distinct', async () => {
    const hashes = (
      await h.db.owner.query<{ password_hash: string }>(
        'SELECT password_hash FROM mock_clinicos_user',
      )
    ).rows;
    for (const row of hashes) expect(row.password_hash).toMatch(/^\$2[aby]\$/);
    const passwords = Object.values(h.passwords);
    expect(passwords).toHaveLength(5);
    expect(new Set(passwords).size).toBe(5);
    for (const p of passwords) expect(p.length).toBeGreaterThanOrEqual(24);
  });

  it('is safe to run twice: same rows, no new passwords, old logins still work, chain valid', async () => {
    const again = await applySeed(h.db.owner, h.seed, { bcryptCost: 4 });
    expect(again.credentials).toEqual({});
    expect(await n('SELECT count(*)::int AS n FROM mock_clinicos_patient')).toBe(15);
    expect(await n('SELECT count(*)::int AS n FROM mock_clinicos_user')).toBe(5);
    expect(await n("SELECT count(*)::int AS n FROM audit_log WHERE action = 'SEED_APPLIED'")).toBe(
      2,
    );
    const login = await request(h.app)
      .post('/api/v1/auth/login')
      .send({ email: SEED_EMAIL.admin, password: h.passwords[SEED_EMAIL.admin] });
    expect(login.status).toBe(200);
    expect((await verifyDatabaseChain(h.appPool)).ok).toBe(true);
  });

  it('--reset-passwords issues new passwords and the old ones stop working', async () => {
    const reset = await applySeed(h.db.owner, h.seed, { bcryptCost: 4, resetPasswords: true });
    expect(Object.keys(reset.credentials)).toHaveLength(5);
    const old = await request(h.app)
      .post('/api/v1/auth/login')
      .send({ email: SEED_EMAIL.admin, password: h.passwords[SEED_EMAIL.admin] });
    expect(old.status).toBe(401);
    const fresh = await request(h.app)
      .post('/api/v1/auth/login')
      .send({ email: SEED_EMAIL.admin, password: reset.credentials[SEED_EMAIL.admin] });
    expect(fresh.status).toBe(200);
  });

  it('records one SEED_APPLIED audit row with counts only', async () => {
    const row = (await h.db.owner.query("SELECT meta FROM audit_log WHERE action = 'SEED_APPLIED'"))
      .rows[0];
    expect(row.meta).toMatchObject({ clinics: 1, users: 5, patients: 15 });
    expect(JSON.stringify(row.meta)).not.toMatch(/example\.invalid|password/i);
  });
});

describe('real-data guard (any is_simulated=false row)', () => {
  it('assertAllSimulated passes for seeded data and refuses once a patient is not simulated', async () => {
    await expect(assertAllSimulated(h.services.directory)).resolves.toBeUndefined();
    await h.db.owner.query(
      "UPDATE mock_clinicos_patient SET is_simulated = false WHERE phone = '0000000007'",
    );
    await expect(assertAllSimulated(h.services.directory)).rejects.toBeInstanceOf(RealDataError);
  });

  it('also covers users and clinics', async () => {
    await h.db.owner.query(
      "UPDATE mock_clinicos_user SET is_simulated = false WHERE role = 'admin'",
    );
    await expect(assertAllSimulated(h.services.directory)).rejects.toThrow(/1 directory row/);
    await h.db.owner.query('UPDATE mock_clinicos_user SET is_simulated = true');
    await h.db.owner.query('UPDATE mock_clinicos_clinic SET is_simulated = false');
    await expect(assertAllSimulated(h.services.directory)).rejects.toBeInstanceOf(RealDataError);
  });

  it('the seed itself can never leave a non-simulated row', async () => {
    await h.db.owner.query('UPDATE mock_clinicos_patient SET is_simulated = false');
    await applySeed(h.db.owner, h.seed, { bcryptCost: 4 });
    expect(
      await n('SELECT count(*)::int AS n FROM mock_clinicos_patient WHERE NOT is_simulated'),
    ).toBe(0);
  });
});

describe('the real server process', () => {
  const root = join(__dirname, '..');
  /** Starts src/server.ts for real; resolves with its exit code and output, or kills it once it is listening. */
  /** Ask the OS for a free port (avoids Windows reserved and busy port ranges). */
  function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const probe = createNetServer();
      probe.on('error', reject);
      probe.listen(0, '127.0.0.1', () => {
        const { port } = probe.address() as AddressInfo;
        probe.close(() => resolve(port));
      });
    });
  }
  async function runServer(): Promise<{ code: number | null; out: string; listening: boolean }> {
    const port = await freePort();
    return new Promise((resolve) => {
      const child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
        cwd: root,
        env: {
          ...process.env,
          NODE_ENV: 'development',
          PORT: String(port),
          DATABASE_URL: h.db.appUrl,
          AUTH_PROVIDER: 'dev',
          DEV_AUTH_SECRET: 'start-up-test-only-secret-0123456789abcdef-0123',
          SIMULATED_DATA_ONLY: 'true',
        },
      });
      let out = '';
      let listening = false;
      const timer = setTimeout(() => child.kill(), 40_000);
      const take = (d: Buffer) => {
        out += d.toString();
        if (out.includes('api_listening')) {
          listening = true;
          child.kill();
        }
      };
      child.stdout.on('data', take);
      child.stderr.on('data', take);
      child.on('exit', (code) => {
        clearTimeout(timer);
        resolve({ code, out, listening });
      });
    });
  }

  it('refuses to start when any directory row is not simulated', async () => {
    await h.db.owner.query(
      "UPDATE mock_clinicos_patient SET is_simulated = false WHERE phone = '0000000002'",
    );
    const result = await runServer();
    expect(result.listening).toBe(false);
    expect(result.code).toBe(1);
    expect(result.out).toContain('Refusing to start');
  }, 60_000);

  it('starts normally when all data is simulated', async () => {
    const result = await runServer();
    expect(result.out).toContain('api_listening');
    expect(result.listening).toBe(true);
  }, 60_000);
});
