// Development seed: ACTED / SIMULATED data only (Hard Rule 1). Reads seed/dev/*.json (every row has a source).
// Run as the DATABASE OWNER (MIGRATION_DATABASE_URL), never as vaani_app: `npm run seed:dev`.
//  - refuses to run when NODE_ENV=production or SIMULATED_DATA_ONLY is not "true";
//  - generates random passwords for new users and writes them ONLY to the git-ignored data/dev-credentials.json
//    (never printed, never committed); existing users keep their password unless --reset-passwords is given;
//  - is safe to run twice (upserts by id).
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';
import { appendAudit } from '../audit/audit.js';
import { hashPassword } from '../auth/password.js';
import '../db/types.js';
import { withTransaction } from '../db/tx.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '..', '..', '..', '..');
export const SEED_DIR = join(REPO_ROOT, 'seed', 'dev');
/** DEV_CREDENTIALS_FILE lets a throwaway run (the e2e test) keep its logins out of the real file. */
export const CREDENTIALS_FILE =
  process.env.DEV_CREDENTIALS_FILE ?? join(REPO_ROOT, 'data', 'dev-credentials.json');

export interface SeedClinic {
  id: string;
  name: string;
  code: string;
  source: string;
}
export interface SeedUser {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'doctor' | 'staff' | 'researcher';
  status: 'approved' | 'pending' | 'rejected' | 'suspended';
  clinicId: string;
  registrationNo?: string;
  source: string;
}
export interface SeedPatient {
  id: string;
  clinicId: string;
  phone: string;
  name: string | null;
  dob: string | null;
  gender: string | null;
  allergies: string[];
  source: string;
}
export interface SeedData {
  clinics: SeedClinic[];
  users: SeedUser[];
  patients: SeedPatient[];
}

export function loadSeedData(dir: string = SEED_DIR): SeedData {
  const read = <T>(file: string): T => JSON.parse(readFileSync(join(dir, file), 'utf8')) as T;
  return {
    clinics: read<SeedClinic[]>('clinic.json'),
    users: read<SeedUser[]>('users.json'),
    patients: read<SeedPatient[]>('patients.json'),
  };
}

export interface SeedOptions {
  bcryptCost: number;
  resetPasswords?: boolean;
  /** Existing credentials (email -> password) to keep; new ones are added. */
  credentials?: Record<string, string>;
}

export interface SeedResult {
  /** email -> plaintext password, ONLY for users created or reset in this run. Never print these. */
  credentials: Record<string, string>;
  clinics: number;
  users: number;
  patients: number;
}

export async function applySeed(
  pool: pg.Pool,
  data: SeedData,
  options: SeedOptions,
): Promise<SeedResult> {
  const credentials: Record<string, string> = {};

  await withTransaction(pool, async (tx) => {
    for (const c of data.clinics) {
      await tx.query(
        `INSERT INTO mock_clinicos_clinic (id, name, code, is_simulated) VALUES ($1,$2,$3,true)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, code = EXCLUDED.code, is_simulated = true`,
        [c.id, c.name, c.code],
      );
    }

    for (const u of data.users) {
      const existing = await tx.query('SELECT 1 FROM mock_clinicos_user WHERE id = $1', [u.id]);
      const isNew = existing.rowCount === 0;
      if (isNew || options.resetPasswords) {
        const password = randomBytes(18).toString('base64url'); // 24 chars, high entropy
        credentials[u.email] = password;
        const hash = await hashPassword(password, options.bcryptCost);
        await tx.query(
          `INSERT INTO mock_clinicos_user (id, name, email, password_hash, role, status, clinic_id, is_simulated)
           VALUES ($1,$2,$3,$4,$5,$6,$7,true)
           ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email,
             password_hash = EXCLUDED.password_hash, role = EXCLUDED.role, status = EXCLUDED.status,
             clinic_id = EXCLUDED.clinic_id, is_simulated = true, updated_at = now()`,
          [u.id, u.name, u.email, hash, u.role, u.status, u.clinicId],
        );
      } else {
        await tx.query(
          `UPDATE mock_clinicos_user SET name = $2, role = $3, status = $4, clinic_id = $5, is_simulated = true,
             updated_at = now() WHERE id = $1`,
          [u.id, u.name, u.role, u.status, u.clinicId],
        );
      }
      if (u.role === 'doctor') {
        await tx.query(
          `INSERT INTO doctor_profile (clinicos_user_id, registration_no, researcher_flag)
           VALUES ($1, $2, false)
           ON CONFLICT (clinicos_user_id) DO UPDATE SET registration_no = EXCLUDED.registration_no, updated_at = now()`,
          [u.id, u.registrationNo ?? null],
        );
      }
    }

    for (const p of data.patients) {
      await tx.query(
        `INSERT INTO mock_clinicos_patient (id, clinic_id, phone, name, dob, gender, opt_in_msg, is_simulated)
         VALUES ($1,$2,$3,$4,$5,$6,true,true)
         ON CONFLICT (id) DO UPDATE SET clinic_id = EXCLUDED.clinic_id, phone = EXCLUDED.phone,
           name = EXCLUDED.name, dob = EXCLUDED.dob, gender = EXCLUDED.gender, is_simulated = true,
           updated_at = now()`,
        [p.id, p.clinicId, p.phone, p.name, p.dob, p.gender],
      );
      await tx.query(
        `INSERT INTO patient_clinical_profile (clinicos_patient_id, allergies) VALUES ($1,$2)
         ON CONFLICT (clinicos_patient_id) DO UPDATE SET allergies = EXCLUDED.allergies, updated_at = now()`,
        [p.id, p.allergies],
      );
    }

    // Hard Rule 1: a row that is not simulated can never exist after seeding.
    const bad = await tx.query<{ n: number }>(
      `SELECT (SELECT count(*) FROM mock_clinicos_patient WHERE NOT is_simulated)
            + (SELECT count(*) FROM mock_clinicos_user WHERE NOT is_simulated)
            + (SELECT count(*) FROM mock_clinicos_clinic WHERE NOT is_simulated) AS n`,
    );
    if (Number(bad.rows[0]?.n) > 0)
      throw new Error('seed left non-simulated rows; refusing to commit');

    await appendAudit(tx, {
      action: 'SEED_APPLIED',
      resourceType: 'seed',
      resourceId: 'dev',
      meta: {
        clinics: data.clinics.length,
        users: data.users.length,
        patients: data.patients.length,
        generatedLogins: Object.keys(credentials).length,
      },
    });
  });

  return {
    credentials,
    clinics: data.clinics.length,
    users: data.users.length,
    patients: data.patients.length,
  };
}

/** Merges new credentials into data/dev-credentials.json (git-ignored). */
export function saveCredentials(
  newCredentials: Record<string, string>,
  file = CREDENTIALS_FILE,
): void {
  let all: Record<string, string> = {};
  if (existsSync(file)) all = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>;
  Object.assign(all, newCredentials);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(all, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const problems: string[] = [];
  if (process.env.NODE_ENV === 'production') problems.push('NODE_ENV=production is not allowed');
  if ((process.env.SIMULATED_DATA_ONLY ?? 'true') !== 'true') {
    problems.push('SIMULATED_DATA_ONLY must be "true"');
  }
  const ownerUrl = process.env.MIGRATION_DATABASE_URL;
  if (!ownerUrl) problems.push('MIGRATION_DATABASE_URL is not set (run npm run setup:env)');
  if (problems.length > 0) {
    console.error(`seed:dev refused:\n  - ${problems.join('\n  - ')}`);
    process.exit(1);
  }
  const pool = new pg.Pool({ connectionString: ownerUrl as string, max: 2 });
  const cost = Number(process.env.BCRYPT_COST ?? 12);
  applySeed(pool, loadSeedData(), {
    bcryptCost: cost,
    resetPasswords: process.argv.includes('--reset-passwords'),
  })
    .then((result) => {
      saveCredentials(result.credentials);
      const created = Object.keys(result.credentials).length;
      console.log(
        `seeded: ${result.clinics} clinic, ${result.users} users, ${result.patients} patients (all simulated).`,
      );
      console.log(
        created > 0
          ? `${created} password(s) written to data/dev-credentials.json (git-ignored; not printed).`
          : 'no new passwords generated (users already existed; use --reset-passwords to regenerate).',
      );
    })
    .catch((err: Error) => {
      console.error(`seed failed: ${err.message}`);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
