import type { Role } from '../src/auth/types.js';

/**
 * PRD section 2.2 (capabilities) and section 4 (page roles), written out by hand and independently of
 * src/auth/permissions.ts. Consent: PRD 4 / Journey A say staff + doctor, 2.2 says staff/admin: the union is used
 * (ADR-D20, PRD_ERRATA).
 */
export const PRD_EXPECTED: Record<
  string,
  readonly Role[] | 'public' | 'authenticated' | 'service'
> = {
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
  // only the session's own doctor starts recording (PRD 2.2); consent is checked again inside the route
  'POST /sessions/:id/asr-token': ['doctor'],
  // saved transcripts: the session's own doctor only (ADR-D28); saving also needs consent at that moment
  'GET /sessions/:id/transcript': ['doctor'],
  // extracted facts: the session's own doctor only (ADR-D29)
  'GET /sessions/:id/facts': ['doctor'],
  'POST /sessions/:id/facts': ['doctor'],
  'PATCH /sessions/:id/facts/:factId': ['doctor'],
  'PUT /sessions/:id/transcript/segments': ['doctor'],
  'POST /sessions/:id/transcript/confirm': ['doctor'],
  // pathway questions and candidate conditions: the session's own doctor only (ADR-D34)
  'GET /sessions/:id/questions/next': ['doctor'],
  'POST /sessions/:id/questions/:eventId/action': ['doctor'],
  'GET /sessions/:id/candidates': ['doctor'],
  'POST /sessions/:id/candidates/select': ['doctor'],
  'POST /sessions/:id/candidates/select/undo': ['doctor'],
  'GET /sessions/:id/pathway-record': ['doctor'],
  // pathway viewer (PG-14): read-only, doctors and admins, configuration data (not clinic data)
  'GET /pathways': ['doctor', 'admin'],
  'GET /pathways/:id': ['doctor', 'admin'],
  // INTERNAL routes for asr-py: signed requests only; no user token of any role is accepted (ADR-D26)
  'POST /internal/audio-assets': 'service',
  'POST /internal/audio-assets/:id/deleted': 'service',
  'GET /internal/sessions/:id/consent-status': 'service',
  'GET /internal/sessions/:id/transcript-segments': 'service',
  'POST /internal/sessions/:id/facts': 'service',
  'POST /sessions/:id/consent/withdraw': ['doctor', 'staff', 'admin'],
  'GET /audit': ['admin', 'researcher'],
  'GET /audit/verify': ['admin'],
  'POST /audit/export': ['admin'], // PG-16 CSV export: admin only (ADR-D21)
  // Medicine master (FR-F5): reference data every role may read; admins write (ADR-D23). Written by hand from the PRD.
  'GET /medicines': ['doctor', 'staff', 'admin', 'researcher'],
  'GET /medicines/:id': ['doctor', 'staff', 'admin', 'researcher'],
  'POST /medicines': ['admin'],
  'PATCH /medicines/:id': ['admin'],
  'POST /medicines/:id/retire': ['admin'],
  'POST /medicines/:id/restore': ['admin'],
  'POST /medicines/:id/brands': ['admin'],
  'POST /medicines/:id/brands/:brandId/retire': ['admin'],
  'GET /medicines/categories': ['doctor', 'staff', 'admin', 'researcher'],
  // Prescription templates (FR-F5-04, PG-13: admin and doctor). Resource rules (personal / clinic-wide) are tested in
  // templates.db.test.ts and clinic-isolation.db.test.ts.
  'GET /templates': ['doctor', 'admin'],
  'GET /templates/:id': ['doctor', 'admin'],
  'GET /templates/:id/load': ['doctor', 'admin'],
  'POST /templates': ['doctor', 'admin'],
  'PUT /templates/:id': ['doctor', 'admin'],
  'POST /templates/:id/retire': ['doctor', 'admin'],
  'POST /templates/:id/restore': ['doctor', 'admin'],
};
