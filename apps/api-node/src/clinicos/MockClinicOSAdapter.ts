// In-memory ClinicOS stand-in (FR-F13-02: standalone mode / mock adapter). It reproduces the response shapes and
// quirks VERIFIED in docs/CLINICOS_INTEGRATION_FACTS.md - not the PRD's idealised contract:
//  - lookup "not found" is HTTP 200 { success:true, data:{ found:false } }, not 404 (Q4b)
//  - /api/auth/me returns 200 with `status` even for suspended/pending users (Q1c)
//  - bad/expired token => 401 { success:false, error:"Invalid or expired token. Please log in again." } (Q1b)
//  - /api/auth/* is rate limited (10 per 15 min per IP, 429 body from Q1d) - opt-in here (ADR-D12)
//  - phone is reduced to its first 10 digits (Q4b); staff/admin/doctor only; pending doctor/staff get 403
// All data here is FAKE (Hard Rule 1).
import type {
  ClinicOSClient,
  ClinicOSLookupData,
  ClinicOSPatientSummary,
  ClinicOSResponse,
  ClinicOSUserSummary,
} from './types.js';

const MSG = {
  noAuth: 'Not authenticated. Please log in.',
  badToken: 'Invalid or expired token. Please log in again.',
  rateLimited: 'Too many requests from this IP, please try again after 15 minutes.',
  suspended: 'Your account has been suspended. Contact your clinic admin.',
  pending: 'Your account is pending approval from your clinic admin.',
  forbidden: 'You do not have permission to access this resource.',
  phoneRequired: 'Phone number is required',
} as const;

export interface MockClinicOSOptions {
  /** token -> user. Unknown tokens behave like tampered/expired tokens. */
  users: Record<string, ClinicOSUserSummary>;
  patients: ClinicOSPatientSummary[];
  /** If set, the (max+1)-th /api/auth/* call returns 429, mirroring ClinicOS authLimiter (ADR-D12). */
  authRateLimitMax?: number;
}

const err = <T>(status: number, error: string): ClinicOSResponse<T> => ({
  status,
  body: { success: false, error },
});

export class MockClinicOSAdapter implements ClinicOSClient {
  private authCalls = 0;

  constructor(private readonly options: MockClinicOSOptions) {}

  async me(token: string | null) {
    this.authCalls += 1;
    const limit = this.options.authRateLimitMax;
    if (limit !== undefined && this.authCalls > limit) {
      return err<{ user: ClinicOSUserSummary }>(429, MSG.rateLimited);
    }
    if (!token) return err<{ user: ClinicOSUserSummary }>(401, MSG.noAuth);
    const user = this.options.users[token];
    if (!user) return err<{ user: ClinicOSUserSummary }>(401, MSG.badToken);
    return { status: 200, body: { success: true as const, data: { user } } };
  }

  async lookupPatient(token: string | null, phone: string | undefined) {
    type Data = ClinicOSLookupData;
    if (!token) return err<Data>(401, MSG.noAuth);
    const user = this.options.users[token];
    if (!user) return err<Data>(401, MSG.badToken);
    // rbac(): suspended blocked first, then pending doctor/staff, then role allow-list
    if (user.status === 'suspended') return err<Data>(403, MSG.suspended);
    if ((user.role === 'doctor' || user.role === 'staff') && user.status === 'pending') {
      return err<Data>(403, MSG.pending);
    }
    if (!['staff', 'admin', 'doctor'].includes(user.role)) return err<Data>(403, MSG.forbidden);
    if (!phone) return err<Data>(400, MSG.phoneRequired);

    const normalised = phone.toString().replace(/\D/g, '').slice(0, 10);
    const patient = this.options.patients.find((p) => p.phone === normalised);
    if (!patient)
      return { status: 200, body: { success: true as const, data: { found: false as const } } };
    return {
      status: 200,
      body: { success: true as const, data: { found: true as const, patient } },
    };
  }
}

// ---- default FAKE fixtures ----
const CLINIC = {
  clinicId: 'c0ffee00-0000-4000-8000-0000000000c1',
  clinicName: 'Fake Clinic (simulated)',
  clinicCode: 'CLIN-TEST',
};

export const MOCK_TOKENS = {
  doctorApproved: 'mock-clinicos-token-doctor',
  staffPending: 'mock-clinicos-token-staff-pending',
  adminSuspended: 'mock-clinicos-token-admin-suspended',
  patientRole: 'mock-clinicos-token-patient',
} as const;

export function createDefaultMock(options: Partial<MockClinicOSOptions> = {}): MockClinicOSAdapter {
  const users: Record<string, ClinicOSUserSummary> = {
    [MOCK_TOKENS.doctorApproved]: {
      id: 'd0c70000-0000-4000-8000-000000000001',
      name: 'Dr. Fake Doctor',
      email: 'doctor@example.invalid',
      role: 'doctor',
      status: 'approved',
      ...CLINIC,
    },
    [MOCK_TOKENS.staffPending]: {
      id: '57aff000-0000-4000-8000-000000000002',
      name: 'Fake Staff Member',
      email: 'staff@example.invalid',
      role: 'staff',
      status: 'pending',
      ...CLINIC,
    },
    [MOCK_TOKENS.adminSuspended]: {
      id: 'ad310000-0000-4000-8000-000000000003',
      name: 'Fake Admin',
      email: 'admin@example.invalid',
      role: 'admin',
      status: 'suspended',
      ...CLINIC,
    },
    [MOCK_TOKENS.patientRole]: {
      id: 'ba710000-0000-4000-8000-000000000004',
      name: 'Fake Patient Account',
      email: 'patient@example.invalid',
      role: 'patient',
      status: 'approved',
      clinicId: null,
      clinicName: null,
      clinicCode: null,
    },
  };
  const patients: ClinicOSPatientSummary[] = [
    {
      id: '9a710000-0000-4000-8000-000000000011',
      name: 'Fake Patient One',
      phone: '9000000001',
      dob: '1990-01-15',
      gender: 'female', // free text in the real API
      visitCount: 2,
      lastVisit: '2026-09-30T10:00:00.000Z',
      outstandingBalance: 0,
      hasActiveToken: false,
      activeTokenId: null,
      tokenNumber: null,
      createdAt: '2026-01-10T09:00:00.000Z',
    },
    {
      // dob and name missing: the real quick-create allows this (PRD_ERRATA 28) - age is unknown.
      id: '9a710000-0000-4000-8000-000000000012',
      name: null,
      phone: '9000000002',
      dob: null,
      gender: null,
      visitCount: 0,
      lastVisit: null,
      outstandingBalance: 0,
      hasActiveToken: true,
      activeTokenId: '70c00000-0000-4000-8000-000000000021',
      tokenNumber: 7,
      createdAt: '2026-10-14T08:30:00.000Z',
    },
  ];
  return new MockClinicOSAdapter({ users, patients, ...options });
}
