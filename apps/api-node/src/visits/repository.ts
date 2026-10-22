// The VisitRepository interface (Phase 8, FR-F7-03, FR-F13-01): where a signed visit record lives. Callers (the sign and
// amend routes) only ever see this interface. Today's implementation is standalone Postgres; in Phase 12 a ClinicOS-backed
// one replaces it without touching the callers. `db` is the open transaction of the request, so the record and its audit
// entry commit together.
import type { Queryable } from '../db/tx.js';

export interface SignedMedicine {
  position: number;
  medicineId: string | null;
  name: string;
  /** 'master' = chosen from the medicine master; 'free_text' = the flagged "Not in master list" fallback */
  source: 'master' | 'free_text';
  strength: string | null;
  doseForm: string | null;
  dose: string | null;
  frequency: string;
  duration: string;
  note: string | null;
  masterSource: string | null;
  masterSourcePage: number | null;
}

export interface SignedFact {
  id: string;
  type: string;
  value: string;
  negated: boolean;
  uncertain: boolean;
  speaker: string | null;
  source: 'extracted' | 'manual';
  sourceSegmentSeq: number | null;
  evidenceQuote: string | null;
  edited: boolean;
  originalValue: string | null;
  conceptId: string | null;
  conceptStatus: string;
}

export type SignedWorkingCondition =
  { kind: 'pathway'; pathwayId: string; version: number } | { kind: 'not_listed'; text: string };

/** Exactly what the doctor signed. Hashed; never edited. */
export interface SignedContent {
  schema: 1;
  sessionId: string;
  patientRef: string;
  doctorId: string;
  signedAt: string;
  facts: SignedFact[];
  workingCondition: SignedWorkingCondition | null;
  medicines: SignedMedicine[];
  consent: { audio: boolean; aiProcessing: boolean };
  /** extracted facts, concept links or a pathway-based working condition are part of this record */
  aiContentIncluded: boolean;
  /** set on amendments: the version this one was made from */
  amendedFrom: number | null;
}

export interface VisitVersion {
  version: number;
  kind: 'signed' | 'amendment';
  content: SignedContent;
  contentHash: string;
  safetyConfigured: boolean;
  safetyNotRunAcknowledged: boolean;
  reason: string | null;
  signedBy: string;
  signedAt: string;
}

export type VersionSummary = Omit<VisitVersion, 'content'>;

export interface VisitRecord {
  id: string;
  sessionId: string;
  status: 'draft' | 'signed';
  currentVersion: number;
  patientRef: string;
  doctorId: string;
  signedAt: string | null;
}

export interface NewVersion {
  clinicId: string;
  sessionId: string;
  content: SignedContent;
  contentHash: string;
  safetyConfigured: boolean;
  safetyNotRunAcknowledged: boolean;
  signedBy: string;
}

export interface VisitRepository {
  findBySession(db: Queryable, clinicId: string, sessionId: string): Promise<VisitRecord | null>;
  /** draft -> signed: creates the record and version 1 */
  createSigned(
    db: Queryable,
    input: NewVersion & { patientRef: string; doctorId: string },
  ): Promise<VisitVersion>;
  /** a new version with a reason; the earlier versions are kept as they are */
  addAmendment(db: Queryable, input: NewVersion & { reason: string }): Promise<VisitVersion>;
  /** the given version, or the current one */
  getVersion(
    db: Queryable,
    clinicId: string,
    sessionId: string,
    version?: number,
  ): Promise<VisitVersion | null>;
  listVersions(db: Queryable, clinicId: string, sessionId: string): Promise<VersionSummary[]>;
}
