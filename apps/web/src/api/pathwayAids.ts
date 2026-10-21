// Types for the doctor-side pathway aids (Phase 6C): the next suggested question, the candidate conditions, and the kept
// record. The API sends numbers (scores) that the screen never shows: no percentage and no confidence figure anywhere.
export type PathwayStatus = 'test' | 'draft' | 'active';
export type Outcome = 'QUESTION' | 'RED_FLAG' | 'ABSTAIN' | 'COMPLETE';
export type PathwayLang = 'en' | 'gu' | 'hi';

export interface NextQuestion {
  outcome: Outcome;
  eventId: string | null;
  eventStatus: string | null;
  nodeId: string | null;
  pathwayId: string | null;
  pathwayVersion: number | null;
  pathwayTitle: string | null;
  pathwayStatus: PathwayStatus | null;
  /** true when any loaded pathway is not active (a test or draft pathway is in play) */
  notActive: boolean;
  slot: string | null;
  ask: string | null;
  reasonText: string;
  redFlags: string[];
  questionsUsed: number;
  questionCap: number;
  slotConflicts: string[];
}

export interface Evidence {
  ruleId: string;
  slot: string;
  nodeId: string | null;
  /** the confirmed fact that set this slot (looked up in the facts list), if any */
  factId: string | null;
}

export interface CandidateView {
  rank: number;
  pathwayId: string;
  version: number;
  title: string;
  status: PathwayStatus;
  evidenceFor: Evidence[];
  evidenceAgainst: Evidence[];
  source: { doc: string; page: string | number };
}

export interface SelectedView {
  notListed: boolean;
  pathwayId: string | null;
  version: number | null;
  title: string | null;
  text: string | null;
  selectedAt: string;
}

export interface CandidateList {
  outcome: Outcome;
  notActive: boolean;
  candidates: CandidateView[];
  selected: SelectedView | null;
}

export interface PathwayRecord {
  selected: SelectedView | null;
  acknowledgedRedFlags: {
    eventId: string;
    pathwayId: string;
    pathwayTitle: string | null;
    actedAt: string;
  }[];
  notActive: boolean;
}
