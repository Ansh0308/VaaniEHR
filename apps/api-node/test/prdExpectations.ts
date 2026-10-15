import type { Role } from '../src/auth/types.js';

/**
 * PRD section 2.2 (capabilities) and section 4 (page roles), written out by hand and independently of
 * src/auth/permissions.ts. Consent: PRD 4 / Journey A say staff + doctor, 2.2 says staff/admin: the union is used
 * (ADR-D20, PRD_ERRATA).
 */
export const PRD_EXPECTED: Record<string, readonly Role[] | 'public' | 'authenticated'> = {
  'POST /auth/login': 'public',
  'POST /auth/logout': 'authenticated',
  'GET /auth/me': 'authenticated',
  'GET /consent/notice': 'authenticated',
  'POST /patients/lookup': ['doctor', 'staff', 'admin'],
  'POST /patients': ['staff', 'admin'],
  'GET /patients/:id': ['doctor', 'staff', 'admin'],
  'PUT /patients/:id/clinical-profile': ['staff', 'admin'],
  'POST /sessions': ['doctor'],
  'GET /sessions': ['doctor'], // "my sessions": PRD 2.2 only doctors record consultations (ADR-D21)
  'GET /sessions/:id': ['doctor', 'staff', 'admin'],
  'GET /sessions/:id/consent': ['doctor', 'staff', 'admin'],
  'POST /sessions/:id/consent': ['doctor', 'staff', 'admin'],
  'POST /sessions/:id/consent/withdraw': ['doctor', 'staff', 'admin'],
  'GET /audit': ['admin', 'researcher'],
  'GET /audit/verify': ['admin'],
  'POST /audit/export': ['admin'], // PG-16 CSV export: admin only (ADR-D21)
};
