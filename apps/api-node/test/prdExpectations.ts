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
  // prescription rows, sign-off, signed record and amendments: the session's own doctor only (ADR-D38)
  'GET /sessions/:id/prescription': ['doctor'],
  'POST /sessions/:id/prescription/items': ['doctor'],
  'PATCH /sessions/:id/prescription/items/:itemId': ['doctor'],
  'DELETE /sessions/:id/prescription/items/:itemId': ['doctor'],
  'POST /sessions/:id/prescription/apply-template': ['doctor'],
  'GET /sessions/:id/sign-readiness': ['doctor'],
  'POST /sessions/:id/sign': ['doctor'],
  'POST /sessions/:id/amend': ['doctor'],
  'GET /sessions/:id/visit': ['doctor'],
  'GET /sessions/:id/visit/versions': ['doctor'],
  'GET /sessions/:id/visit/versions/:version': ['doctor'],
  'GET /sessions/:id/sign-preview': ['doctor'],
  'GET /sessions/:id/previous-visits': ['doctor'],
  // FHIR bundles of a signed visit (F8): the doctor builds and exports; the admin reads the verdict and the errors (ADR-D40)
  'GET /sessions/:id/fhir': ['doctor', 'admin'],
  'POST /sessions/:id/fhir': ['doctor'],
  'POST /sessions/:id/fhir/export': ['doctor'],
  // WhatsApp summary of a signed visit (F10): the session's own doctor; the Meta webhook is public (signature-checked)
  'GET /sessions/:id/whatsapp': ['doctor'],
  'POST /sessions/:id/whatsapp/summary': ['doctor'],
  'POST /sessions/:id/whatsapp/approve': ['doctor'],
  'POST /sessions/:id/whatsapp/send': ['doctor'],
  'GET /webhooks/whatsapp': 'public',
  'POST /webhooks/whatsapp': 'public',
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
  // concept links (ADR-D37): the session's own doctor only
  'GET /sessions/:id/concept-suggestions': ['doctor'],
  'POST /sessions/:id/facts/:factId/concept': ['doctor'],
  'DELETE /sessions/:id/facts/:factId/concept': ['doctor'],
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
