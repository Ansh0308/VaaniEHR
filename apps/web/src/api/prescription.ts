// Shapes of the prescription and sign-off responses (see apps/api-node/openapi.json). Fake data in tests.
import type { FrequencyCode } from './templates';

export interface PrescriptionRow {
  id: string;
  position: number;
  medicineId: string | null;
  name: string;
  /** 'free_text' = typed by hand because the medicine is not in the master list: flagged on the row */
  source: 'master' | 'free_text';
  strength: string | null;
  doseForm: string | null;
  dose: string | null;
  frequency: FrequencyCode | null;
  duration: string | null;
  note: string | null;
  fromTemplateId: string | null;
  masterSource: string | null;
  masterSourcePage: number | null;
  masterSourcePagePrinted: number | null;
  masterReviewStatus: 'reviewed' | 'not_reviewed' | null;
  /** frequency or duration is still empty (a template line): the visit cannot be signed */
  incomplete: boolean;
}

export interface PrescriptionList {
  rows: PrescriptionRow[];
  locked: boolean;
}

/** What the doctor types for a new row. medicineId null = the "Not in master list" fallback (then a name is needed). */
export interface RowDraft {
  medicineId: string | null;
  name?: string;
  strength?: string | null;
  doseForm?: string | null;
  dose?: string | null;
  frequency: FrequencyCode;
  duration: string;
  note?: string | null;
}

export interface RowPatch {
  name?: string;
  strength?: string | null;
  doseForm?: string | null;
  dose?: string | null;
  frequency?: FrequencyCode;
  duration?: string;
  note?: string | null;
}

export const BLOCKER_CODES = [
  'session_not_draft',
  'unconfirmed_facts',
  'red_flag_unacknowledged',
  'consent_missing',
  'no_working_condition',
  'incomplete_medicine',
] as const;
export type BlockerCode = (typeof BLOCKER_CODES)[number];
export interface Blocker {
  code: BlockerCode;
  count: number;
}

export interface SignReadiness {
  signed: boolean;
  blockers: Blocker[];
  medicineCount: number;
  safety: { configured: boolean; blocked: number; message: string; error?: boolean };
  currentVersion: number | null;
}

export interface VisitVersion {
  version: number;
  kind: 'signed' | 'amendment';
  contentHash: string;
  safetyConfigured: boolean;
  safetyNotRunAcknowledged: boolean;
  reason: string | null;
  signedBy: string;
  signedAt: string;
  content: Record<string, unknown>;
}

export interface PreviewFact {
  id: string;
  type: string;
  value: string;
  negated: boolean;
  uncertain: boolean;
  status: 'heard' | 'confirmed' | 'rejected' | 'stale';
  /** 'extracted' = proposed by the engine; 'manual' = typed by the doctor (no engine version exists) */
  source: 'extracted' | 'manual';
  edited: boolean;
  originalValue: string | null;
  originalNegated: boolean | null;
  originalUncertain: boolean | null;
  evidenceQuote: string | null;
  conceptConfirmed: boolean;
}

export interface TemplateLine {
  templateName: string;
  dose: string | null;
  frequency: string | null;
  duration: string | null;
  instructions: string | null;
}

export interface PreviewMedicine {
  id: string;
  name: string;
  source: 'master' | 'free_text';
  strength: string | null;
  doseForm: string | null;
  dose: string | null;
  frequency: string | null;
  duration: string | null;
  note: string | null;
  incomplete: boolean;
  /** the template's line when the row came from a template; null = doctor-entered */
  templateOriginal: TemplateLine | null;
}

export interface Preview {
  facts: PreviewFact[];
  workingCondition: {
    kind: 'pathway' | 'not_listed';
    pathwayId: string | null;
    version: number | null;
    text: string | null;
    engineRank: number | null;
  } | null;
  engineCandidates: Array<{ pathwayId: string; version: number; rank: number }>;
  medicines: PreviewMedicine[];
}

export interface PreviousVisit {
  sessionId: string;
  signedAt: string;
  currentVersion: number;
  medicineCount: number;
  factCount: number;
  safetyNotRun: boolean;
}

/** One medicine line of a signed snapshot (apps/api-node/src/visits/repository.ts). */
export interface SignedMedicine {
  position: number;
  medicineId: string | null;
  name: string;
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

export interface SignedContent {
  schema: 1;
  sessionId: string;
  signedAt: string;
  facts: SignedFact[];
  workingCondition:
    | { kind: 'pathway'; pathwayId: string; version: number }
    | { kind: 'not_listed'; text: string }
    | null;
  medicines: SignedMedicine[];
  consent: { audio: boolean; aiProcessing: boolean };
  aiContentIncluded: boolean;
  amendedFrom: number | null;
}

export interface VersionSummary {
  version: number;
  kind: 'signed' | 'amendment';
  contentHash: string;
  safetyConfigured: boolean;
  safetyNotRunAcknowledged: boolean;
  reason: string | null;
  signedBy: string;
  signedAt: string;
}

export interface SignedVisit extends VersionSummary {
  content: SignedContent;
}
