// The ONLY way VaaniEHR reads or writes ClinicOS-owned data (users, patients, clinics).
//
// Standalone phases: implemented by PgMockClinicOSAdapter over the mock_clinicos_* stand-in tables (ADR-D20).
// Phase 12: replaced by a REST implementation that calls ClinicOS with the doctor's own token (ADR-D4, ADR-D14);
// the mock tables are then dropped. No other module may touch a mock_clinicos_* table (test: clinicos-boundary).
//
// Shapes mirror what ClinicOS really returns (docs/CLINICOS_INTEGRATION_FACTS.md): 10-digit phone, `name`, `dob`,
// free-text `gender`, `optInMsg`. ClinicOS has no allergies or consent fields; VaaniEHR owns those.
import type { Role } from '../auth/types.js';

export type UserStatus = 'pending' | 'approved' | 'rejected' | 'suspended';

export interface DirectoryUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: UserStatus;
  clinicId: string | null;
  isSimulated: boolean;
}

export interface DirectoryPatient {
  id: string;
  clinicId: string | null;
  /** Exactly 10 digits (ClinicOS keeps the first 10 digits; India only). */
  phone: string;
  name: string | null;
  email: string | null;
  /** 'YYYY-MM-DD' or null (ClinicOS quick-create may omit it). */
  dob: string | null;
  /** Free text, up to 10 characters in ClinicOS. */
  gender: string | null;
  optInMsg: boolean;
  isSimulated: boolean;
  createdAt: string;
}

export interface NewPatientInput {
  phone: string;
  name?: string | undefined;
  dob?: string | undefined;
  gender?: string | undefined;
  email?: string | undefined;
  optInMsg?: boolean | undefined;
}

export interface ClinicOSAdapter {
  getUser(id: string): Promise<DirectoryUser | null>;
  /** Scoped to the clinic, like ClinicOS (a patient of another clinic is "not found"). */
  getPatient(clinicId: string, id: string): Promise<DirectoryPatient | null>;
  lookupPatientByPhone(clinicId: string, phone: string): Promise<DirectoryPatient | null>;
  /** Like ClinicOS: an existing phone in the clinic returns the existing patient with created=false. */
  createPatient(
    clinicId: string,
    input: NewPatientInput,
  ): Promise<{ patient: DirectoryPatient; created: boolean }>;
  /** Number of directory rows not marked simulated; start-up refuses to run if this is not 0 (ADR-D16). */
  countNonSimulated(): Promise<number>;
}

/** Standalone-only: password login against the stand-in user table. Does not exist in Phase 12. */
export interface DevLoginSource {
  findLoginByEmail(email: string): Promise<(DirectoryUser & { passwordHash: string }) | null>;
}

/** ClinicOS keeps the first 10 digits of whatever was typed (CLINICOS_INTEGRATION_FACTS Q4b). */
export function normalisePhone(input: string): string {
  return input.replace(/\D/g, '').slice(0, 10);
}
