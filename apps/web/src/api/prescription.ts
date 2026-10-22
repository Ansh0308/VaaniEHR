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
  safety: { configured: boolean; blocked: number; message: string };
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
