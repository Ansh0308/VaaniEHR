// Failed (and successful) logins must leave no raw e-mail address and no password anywhere: not in the audit log, not in
// the lockout table, not in the application log. Known users are recorded by user id; unknown e-mails by nothing at all.
import { createHash } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emailReference } from '../src/auth/routes.js';
import { hashPassword } from '../src/auth/password.js';
import { createHarness, SEED_EMAIL, type Harness } from './db/helpers.js';

let h: Harness;
beforeEach(async () => {
  h = await createHarness();
});
afterEach(async () => {
  vi.restoreAllMocks();
  delete process.env.LOG_IN_TESTS;
  await h.close();
});

const login = (email: string, password: string) =>
  request(h.app).post('/api/v1/auth/login').send({ email, password });

// Distinctive secrets so a plain substring search is meaningful.
const WRONG_PASSWORDS = [
  'Wr0ng-Pa$$word-alpha-7731',
  'ખોટો-પાસવર્ડ-9917', // Gujarati script
  'p@ss with spaces & "quotes" 4410',
];
const UNKNOWN_EMAIL = 'someone.unknown+tag@nowhere-domain.example.invalid';

describe('failed logins leave no e-mail address or password behind', () => {
  it('every failure path stores only a reason (and the user id when the account is known)', async () => {
    // 1. wrong password, known account
    await login(SEED_EMAIL.staff, WRONG_PASSWORDS[0] as string);
    // 2. unknown e-mail
    await login(UNKNOWN_EMAIL, WRONG_PASSWORDS[1] as string);
    // 3. correct password but account not approved
    await h.db.owner.query("UPDATE mock_clinicos_user SET status = 'pending' WHERE email = $1", [
      SEED_EMAIL.doctor2,
    ]);
    await login(SEED_EMAIL.doctor2, h.passwords[SEED_EMAIL.doctor2] as string);
    // 4. correct password but a role that cannot sign in
    await h.db.owner.query(
      `INSERT INTO mock_clinicos_user (name, email, password_hash, role, status, clinic_id)
       VALUES ('Fake Patient', 'patient.login@example.invalid', $1, 'patient', 'approved', $2)`,
      [await hashPassword('Patient-Login-Pw-5521', 4), h.seed.clinics[0]?.id],
    );
    await login('patient.login@example.invalid', 'Patient-Login-Pw-5521');
    // 5. locked account (five wrong passwords, then one more)
    for (let i = 0; i < 5; i += 1) await login(SEED_EMAIL.admin, WRONG_PASSWORDS[2] as string);
    await login(SEED_EMAIL.admin, h.passwords[SEED_EMAIL.admin] as string);

    const rows = (
      await h.db.owner.query("SELECT * FROM audit_log WHERE action = 'LOGIN_FAILED' ORDER BY seq")
    ).rows;
    expect(rows.length).toBe(1 + 1 + 1 + 1 + 5 + 1);
    for (const row of rows) {
      expect(Object.keys(row.meta), `seq ${row.seq}`).toEqual(['reason']);
      expect(typeof row.meta.reason).toBe('string');
      expect(row.resource_id).toBeNull(); // nothing that names an address
    }
    const reasons = new Set(rows.map((r) => r.meta.reason));
    expect([...reasons].sort()).toEqual(
      ['account_locked', 'invalid_credentials', 'role_not_allowed', 'status_pending'].sort(),
    );

    // the unknown e-mail is attributed to nobody; known accounts only by their user id
    const unknown = rows.find(
      (r) => r.actor_user_id === null && r.meta.reason === 'invalid_credentials',
    );
    expect(unknown).toBeTruthy();
    const staffRow = rows.find((r) => r.actor_role === 'staff');
    expect(staffRow?.actor_user_id).toBe(h.seed.users.find((u) => u.role === 'staff')?.id);
  });

  it('no table holds a raw e-mail, its local part, its domain or any password that was tried', async () => {
    await login(SEED_EMAIL.staff, WRONG_PASSWORDS[0] as string);
    await login(UNKNOWN_EMAIL, WRONG_PASSWORDS[1] as string);
    await login(SEED_EMAIL.researcher, WRONG_PASSWORDS[2] as string);
    // a successful login too: it must not store the address or the password either
    await login(SEED_EMAIL.doctor1, h.passwords[SEED_EMAIL.doctor1] as string);

    const dump = JSON.stringify([
      (await h.db.owner.query('SELECT * FROM audit_log')).rows,
      (await h.db.owner.query('SELECT * FROM login_lockout')).rows,
      (await h.db.owner.query('SELECT * FROM revoked_token')).rows,
    ]);
    const forbidden = [
      UNKNOWN_EMAIL,
      'someone.unknown',
      'nowhere-domain',
      SEED_EMAIL.staff,
      SEED_EMAIL.researcher,
      SEED_EMAIL.doctor1,
      'example.invalid',
      ...WRONG_PASSWORDS,
      h.passwords[SEED_EMAIL.doctor1] as string,
    ];
    for (const needle of forbidden) expect(dump, needle).not.toContain(needle);
  });

  it('the application log never gets the address or the password either', async () => {
    process.env.LOG_IN_TESTS = 'true'; // the logger is silent under test unless asked
    const written: string[] = [];
    const grab = (chunk: unknown) => {
      written.push(String(chunk));
      return true;
    };
    vi.spyOn(process.stdout, 'write').mockImplementation(grab as never);
    vi.spyOn(process.stderr, 'write').mockImplementation(grab as never);
    vi.spyOn(console, 'error').mockImplementation((...a) => void written.push(a.join(' ')));
    vi.spyOn(console, 'warn').mockImplementation((...a) => void written.push(a.join(' ')));
    vi.spyOn(console, 'log').mockImplementation((...a) => void written.push(a.join(' ')));

    await login(UNKNOWN_EMAIL, WRONG_PASSWORDS[0] as string);
    await login(SEED_EMAIL.staff, WRONG_PASSWORDS[1] as string);
    await request(h.app).post('/api/v1/auth/login').send({ email: UNKNOWN_EMAIL }); // validation error path

    const everything = written.join('\n');
    for (const needle of [UNKNOWN_EMAIL, 'someone.unknown', SEED_EMAIL.staff, ...WRONG_PASSWORDS]) {
      expect(everything, needle).not.toContain(needle);
    }
  });
});

describe('the lockout reference is not reversible', () => {
  it('is a keyed HMAC of the e-mail, not a plain hash that could be recomputed by guessing addresses', async () => {
    await login(SEED_EMAIL.staff, WRONG_PASSWORDS[0] as string);
    const stored = (await h.db.owner.query('SELECT email_hash FROM login_lockout')).rows[0]
      ?.email_hash as string;
    expect(stored).toMatch(/^[0-9a-f]{64}$/);

    const plainSha = createHash('sha256').update(SEED_EMAIL.staff).digest('hex');
    expect(stored).not.toBe(plainSha); // an attacker with a list of addresses cannot match it
    expect(stored).toBe(emailReference(h.services.lockoutKey, SEED_EMAIL.staff));
    expect(stored).not.toBe(emailReference('a-different-key', SEED_EMAIL.staff));
  });

  it('is the same for the same address in any letter case, so the lockout cannot be dodged by changing case', async () => {
    expect(emailReference('k', 'Staff@Example.Invalid ')).toBe(
      emailReference('k', 'staff@example.invalid'),
    );
    for (let i = 0; i < 5; i += 1)
      await login(SEED_EMAIL.staff.toUpperCase(), WRONG_PASSWORDS[0] as string);
    const locked = await login(SEED_EMAIL.staff, h.passwords[SEED_EMAIL.staff] as string);
    expect(locked.status).toBe(429);
  });
});
