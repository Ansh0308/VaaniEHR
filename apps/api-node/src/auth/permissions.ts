// The single permissions table (PRD section 2.2 and section 4 page roles). Every route declares exactly one
// permission id from here (or is explicitly 'public' / 'authenticated'); requirePermission() reads only this table.
// Deliberate deviation (ADR-D20, PRD_ERRATA): consent is capturable by staff, admin AND doctor, because PRD section 4
// (PG-05: staff, doctor) and Journey A step 2 say so while section 2.2 says staff/admin only.
import type { Role } from './types.js';

export const PERMISSIONS = {
  // patients (PG-03: staff, admin register; clinic doctors need to read to start a consultation)
  'patient.lookup': ['doctor', 'staff', 'admin'],
  'patient.read': ['doctor', 'staff', 'admin'],
  'patient.create': ['staff', 'admin'],
  'patient.clinicalProfile.write': ['staff', 'admin'],
  // sessions (PRD 2.2: only doctors record consultations; staff and admin may open a session to capture consent)
  'session.create': ['doctor'],
  'session.read': ['doctor', 'staff', 'admin'],
  // the signed-in doctor's OWN sessions only (the handler also filters by doctor and clinic)
  'session.listMine': ['doctor'],
  // speech service access (Phase 4A): only the session's own doctor starts recording (PRD 2.2)
  'asr.token': ['doctor'],

  // saved transcripts (Phase 4B Run 2): the session's own doctor only
  'transcript.read': ['doctor'],
  'transcript.write': ['doctor'],

  // extracted facts (Phase 5A): the session's own doctor only
  'fact.read': ['doctor'],
  'fact.write': ['doctor'],

  // pathway questions and candidate conditions (Phase 6A): the session's own doctor only
  'question.read': ['doctor'],
  'question.act': ['doctor'],
  'candidate.read': ['doctor'],
  'candidate.select': ['doctor'],

  // consent (F1, PG-05)
  'consent.read': ['doctor', 'staff', 'admin'],
  'consent.grant': ['doctor', 'staff', 'admin'],
  'consent.withdraw': ['doctor', 'staff', 'admin'],
  // audit log (PRD 2.2: admin; researcher read-only and anonymised)
  'audit.read': ['admin', 'researcher'],
  'audit.verify': ['admin'],
  // CSV export (ADR-D21): admin only. The researcher reads anonymised rows on screen but cannot take a file away.
  'audit.export': ['admin'],
  // medicine master (FR-F5-01..05): every signed-in role reads it (the researcher too: it is public reference data);
  // only admins write. Retire, never delete (ADR-D23).
  'medicine.read': ['doctor', 'staff', 'admin', 'researcher'],
  'medicine.write': ['admin'],
  // prescription templates (FR-F5-04, PG-13: admin and doctor). Staff and researcher have no use for them. Beyond this
  // table the handlers apply resource rules: personal templates are visible to their owner only, a clinic-wide one is
  // editable by its owner or an admin (ADR-D24).
  'template.read': ['doctor', 'admin'],
  'template.write': ['doctor', 'admin'],
} as const satisfies Record<string, readonly Role[]>;

export type PermissionId = keyof typeof PERMISSIONS;

export function roleHasPermission(role: Role, permission: PermissionId): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

/** Roles that may sign in at all. `patient` exists but is unused, so it has no permissions and cannot log in. */
export const LOGIN_ROLES: readonly Role[] = ['doctor', 'staff', 'admin', 'researcher'];
