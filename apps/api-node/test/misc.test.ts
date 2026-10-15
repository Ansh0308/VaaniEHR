// Small units: consent notices, seed data shape, password hashing, new config settings, simulated-data guard.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hashPassword, makeDummyHash, verifyPassword } from '../src/auth/password.js';
import { ConfigError, loadConfig } from '../src/config/env.js';
import { CONSENT_SCOPES, createNoticeStore, NOTICE_LANGUAGES } from '../src/consent/notices.js';
import { assertAllSimulated, RealDataError } from '../src/db/simulatedGuard.js';
import { loadSeedData } from '../src/seed/seedDev.js';
import { baseEnv, testConfig } from './helpers.js';

describe('consent notices (versioned files)', () => {
  const store = createNoticeStore();

  it('every version has both languages, each version string matches its content', () => {
    expect(store.versions().length).toBeGreaterThan(0);
    for (const version of store.versions()) {
      for (const language of NOTICE_LANGUAGES) {
        const notice = store.get(version, language);
        expect(notice, `${version}/${language}`).not.toBeNull();
        expect(notice?.version).toBe(version);
        expect(notice?.language).toBe(language);
        for (const scope of CONSENT_SCOPES) {
          expect(notice?.scopes[scope].label.length).toBeGreaterThan(0);
          expect(notice?.scopes[scope].description.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('the legal wording is a placeholder, and Gujarati is flagged needs-review', () => {
    for (const version of store.versions()) {
      expect(store.get(version, 'en')?.status).toBe('PLACEHOLDER');
      expect(store.get(version, 'en')?.body).toMatch(/PLACEHOLDER/);
      expect(store.get(version, 'gu')?.status).toBe('PLACEHOLDER');
      expect(store.get(version, 'gu')?.needsReview).toBe(true);
    }
  });

  it('the Gujarati notice really is Gujarati script', () => {
    expect(store.get('0.1', 'gu')?.body).toMatch(/[઀-૿]/);
  });

  it('unknown version or language is null; latest is the highest version', () => {
    expect(store.get('9.9', 'en')).toBeNull();
    expect(store.latestVersion()).toBe(store.versions().at(-1));
  });
});

describe('dev seed data (acted/simulated only)', () => {
  const seed = loadSeedData();

  it('has the agreed shape: 1 clinic, 1 admin, 2 doctors, 1 staff, 1 researcher, 15 patients', () => {
    expect(seed.clinics).toHaveLength(1);
    const count = (role: string) => seed.users.filter((u) => u.role === role).length;
    expect([count('admin'), count('doctor'), count('staff'), count('researcher')]).toEqual([
      1, 2, 1, 1,
    ]);
    expect(seed.patients).toHaveLength(15);
  });

  it('every row has a source and nothing looks like a real contact or credential', () => {
    for (const row of [...seed.clinics, ...seed.users, ...seed.patients]) {
      expect(row.source).toBe('FAKE_FOR_TEST');
    }
    for (const u of seed.users) {
      expect(u.email.endsWith('@example.invalid')).toBe(true);
      expect(Object.keys(u)).not.toContain('password');
    }
    const raw = readFileSync(new URL('../../../seed/dev/users.json', import.meta.url), 'utf8');
    expect(raw.toLowerCase()).not.toMatch(/password|hash|secret/);
  });

  it('patients: Gujarati names, unique 10-digit non-dialable phones, fake allergy labels, two without a dob', () => {
    const phones = new Set(seed.patients.map((p) => p.phone));
    expect(phones.size).toBe(15);
    for (const p of seed.patients) {
      expect(p.phone).toMatch(/^0\d{9}$/); // starts with 0: not a valid Indian mobile number
      expect(p.name).toMatch(/[઀-૿]/);
      for (const allergy of p.allergies) expect(allergy).toMatch(/\(FAKE\)$/);
    }
    expect(seed.patients.filter((p) => p.dob === null)).toHaveLength(2);
    expect(seed.patients.some((p) => p.allergies.length > 0)).toBe(true);
    expect(seed.patients.some((p) => p.allergies.length === 0)).toBe(true);
  });

  it('every patient and user belongs to the one seeded clinic', () => {
    const clinic = seed.clinics[0]?.id;
    for (const row of [...seed.users, ...seed.patients]) expect(row.clinicId).toBe(clinic);
  });
});

describe('password hashing', () => {
  it('hashes with the requested bcrypt cost, verifies, and rejects a wrong password', async () => {
    const hash = await hashPassword('correct horse battery staple', 4);
    expect(hash).toMatch(/^\$2[aby]\$04\$/);
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });
  it('two hashes of the same password differ (random salt)', async () => {
    expect(await hashPassword('same', 4)).not.toBe(await hashPassword('same', 4));
  });
  it('the dummy hash is a valid bcrypt hash that no real password matches', async () => {
    const dummy = await makeDummyHash(4);
    expect(dummy).toMatch(/^\$2[aby]\$04\$/);
    expect(await verifyPassword('', dummy)).toBe(false);
  });
});

describe('login hardening configuration', () => {
  it('defaults mirror ClinicOS: 10 requests / 15 min per IP, 5 failures lock for 15 min, cost 12', () => {
    const c = loadConfig({ ...baseEnv, NODE_ENV: 'development' });
    expect(c.loginRateLimitMax).toBe(10);
    expect(c.loginRateWindowMs).toBe(15 * 60_000);
    expect(c.lockoutMaxFailures).toBe(5);
    expect(c.lockoutMs).toBe(15 * 60_000);
    expect(c.bcryptCost).toBe(12);
    expect(c.trustProxy).toBe(false);
  });
  it('a weak bcrypt cost is refused outside tests', () => {
    expect(() => loadConfig({ ...baseEnv, NODE_ENV: 'development', BCRYPT_COST: '4' })).toThrow(
      ConfigError,
    );
    expect(testConfig({ BCRYPT_COST: '4' }).bcryptCost).toBe(4);
  });
  it('SIMULATED_DATA_ONLY=false is still refused (ADR-D16)', () => {
    expect(() => testConfig({ SIMULATED_DATA_ONLY: 'false' })).toThrow(/SIMULATED_DATA_ONLY/);
  });
});

describe('simulated-data start-up guard (ADR-D16)', () => {
  const adapter = (n: number) => ({ countNonSimulated: async () => n }) as never;
  it('passes when every row is simulated', async () => {
    await expect(assertAllSimulated(adapter(0))).resolves.toBeUndefined();
  });
  it('refuses when any row is not simulated', async () => {
    await expect(assertAllSimulated(adapter(1))).rejects.toBeInstanceOf(RealDataError);
    await expect(assertAllSimulated(adapter(3))).rejects.toThrow(/3 directory row/);
  });
});
