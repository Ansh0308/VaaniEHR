// Shapes of the REAL ClinicOS REST API, verified from its code (docs/CLINICOS_INTEGRATION_FACTS.md).
// ClinicOS envelope: { success: true, data } or { success: false, error: "<string>" }.
// NOTE: this differs from VaaniEHR's own error envelope (error is a plain string there).

export interface ClinicOSUserSummary {
  id: string;
  name: string;
  email: string;
  role: 'patient' | 'admin' | 'doctor' | 'staff';
  /** pending | approved | rejected | suspended. /api/auth/me returns 200 for ALL of these (Facts Q1c). */
  status: 'pending' | 'approved' | 'rejected' | 'suspended';
  clinicId: string | null;
  clinicName: string | null;
  clinicCode: string | null;
}

export interface ClinicOSPatientSummary {
  id: string;
  name: string | null;
  phone: string;
  dob: string | null; // DATEONLY, nullable (Facts Q4a)
  gender: string | null; // free text STRING(10), nullable (PRD_ERRATA 27)
  visitCount: number;
  lastVisit: string | null;
  outstandingBalance: number;
  hasActiveToken: boolean;
  activeTokenId: string | null;
  tokenNumber: number | null;
  createdAt: string;
}

export type ClinicOSEnvelope<T> = { success: true; data: T } | { success: false; error: string };

export interface ClinicOSResponse<T> {
  status: number;
  body: ClinicOSEnvelope<T>;
}

export type ClinicOSLookupData =
  { found: false } | { found: true; patient: ClinicOSPatientSummary };

/** The slice of the ClinicOS API VaaniEHR will use (Phase 12 real client; Phase 1.1 mock only). */
export interface ClinicOSClient {
  /** GET /api/auth/me */
  me(token: string | null): Promise<ClinicOSResponse<{ user: ClinicOSUserSummary }>>;
  /** POST /api/patients/lookup  (note: not found is HTTP 200 with { found: false }) */
  lookupPatient(
    token: string | null,
    phone: string | undefined,
  ): Promise<ClinicOSResponse<ClinicOSLookupData>>;
}
