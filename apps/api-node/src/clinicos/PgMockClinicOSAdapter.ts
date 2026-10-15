// Stand-in ClinicOS directory backed by the mock_clinicos_* tables. FAKE data only (Hard Rule 1).
// This file (and the seed/migrations) are the only code allowed to name those tables.
import type { QueryResultRow } from 'pg';
import '../db/types.js';
import type { Role } from '../auth/types.js';
import type { Queryable } from '../db/tx.js';
import {
  normalisePhone,
  type ClinicOSAdapter,
  type DevLoginSource,
  type DirectoryPatient,
  type DirectoryUser,
  type NewPatientInput,
  type UserStatus,
} from './ClinicOSAdapter.js';

interface UserRow extends QueryResultRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: UserStatus;
  clinic_id: string | null;
  is_simulated: boolean;
  password_hash?: string;
}

interface PatientRow extends QueryResultRow {
  id: string;
  clinic_id: string | null;
  phone: string;
  name: string | null;
  email: string | null;
  dob: string | null;
  gender: string | null;
  opt_in_msg: boolean;
  is_simulated: boolean;
  created_at: Date;
}

const toUser = (r: UserRow): DirectoryUser => ({
  id: r.id,
  name: r.name,
  email: r.email,
  role: r.role,
  status: r.status,
  clinicId: r.clinic_id,
  isSimulated: r.is_simulated,
});

const toPatient = (r: PatientRow): DirectoryPatient => ({
  id: r.id,
  clinicId: r.clinic_id,
  phone: r.phone,
  name: r.name,
  email: r.email,
  dob: r.dob,
  gender: r.gender,
  optInMsg: r.opt_in_msg,
  isSimulated: r.is_simulated,
  createdAt: r.created_at.toISOString(),
});

export class PgMockClinicOSAdapter implements ClinicOSAdapter, DevLoginSource {
  constructor(private readonly db: Queryable) {}

  async getUser(id: string): Promise<DirectoryUser | null> {
    const r = await this.db.query<UserRow>('SELECT * FROM mock_clinicos_user WHERE id = $1', [id]);
    const row = r.rows[0];
    return row ? toUser(row) : null;
  }

  async findLoginByEmail(email: string) {
    const r = await this.db.query<UserRow>(
      'SELECT * FROM mock_clinicos_user WHERE lower(email) = lower($1)',
      [email.trim()],
    );
    const row = r.rows[0];
    return row?.password_hash ? { ...toUser(row), passwordHash: row.password_hash } : null;
  }

  async getPatient(clinicId: string, id: string): Promise<DirectoryPatient | null> {
    const r = await this.db.query<PatientRow>(
      'SELECT * FROM mock_clinicos_patient WHERE id = $1 AND clinic_id = $2',
      [id, clinicId],
    );
    const row = r.rows[0];
    return row ? toPatient(row) : null;
  }

  async lookupPatientByPhone(clinicId: string, phone: string): Promise<DirectoryPatient | null> {
    const r = await this.db.query<PatientRow>(
      'SELECT * FROM mock_clinicos_patient WHERE phone = $1 AND clinic_id = $2',
      [normalisePhone(phone), clinicId],
    );
    const row = r.rows[0];
    return row ? toPatient(row) : null;
  }

  async createPatient(clinicId: string, input: NewPatientInput) {
    const phone = normalisePhone(input.phone);
    const existing = await this.lookupPatientByPhone(clinicId, phone);
    if (existing) return { patient: existing, created: false };
    const r = await this.db.query<PatientRow>(
      `INSERT INTO mock_clinicos_patient (clinic_id, phone, name, dob, gender, email, opt_in_msg, is_simulated)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true)
       RETURNING *`,
      [
        clinicId,
        phone,
        input.name ?? null,
        input.dob ?? null,
        input.gender ?? null,
        input.email ?? null,
        input.optInMsg ?? true, // ClinicOS: true unless exactly false
      ],
    );
    const row = r.rows[0];
    if (!row) throw new Error('patient insert returned no row');
    return { patient: toPatient(row), created: true };
  }

  async countNonSimulated(): Promise<number> {
    const r = await this.db.query<{ n: number }>(
      `SELECT (SELECT count(*) FROM mock_clinicos_patient WHERE NOT is_simulated)
            + (SELECT count(*) FROM mock_clinicos_user WHERE NOT is_simulated)
            + (SELECT count(*) FROM mock_clinicos_clinic WHERE NOT is_simulated) AS n`,
    );
    return Number(r.rows[0]?.n ?? 0);
  }
}
