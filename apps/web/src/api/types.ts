// Shapes of the api-node responses the pages use (see apps/api-node/openapi.json). Fake data only.

export type Role = 'doctor' | 'staff' | 'admin' | 'researcher';
export const ROLES: readonly Role[] = ['doctor', 'staff', 'admin', 'researcher'];

export interface User {
  id: string;
  name: string;
  role: Role;
  clinicId: string;
  status: string;
  isSimulated: boolean;
}

export interface LoginResult {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  user: User;
}

export interface Patient {
  id: string;
  name: string | null;
  phone: string;
  dob: string | null;
  gender: string | null;
  email: string | null;
  optInMsg: boolean;
  isSimulated: boolean;
  createdAt: string;
  allergies: string[];
}

export type ConsentScope = 'audio' | 'ai_processing' | 'whatsapp';
export const CONSENT_SCOPES: readonly ConsentScope[] = ['audio', 'ai_processing', 'whatsapp'];
export type NoticeLanguage = 'en' | 'gu';

export interface ScopeState {
  granted: boolean;
  since: string | null;
  noticeVersion: string | null;
  noticeLanguage: NoticeLanguage | null;
  source: 'patient' | 'staff' | null;
}

export interface ConsentState {
  sessionId: string;
  scopes: Record<ConsentScope, ScopeState>;
  recordingAllowed: boolean;
  whatsappAllowed: boolean;
}

export interface ConsentEvent {
  seq: number;
  scope: ConsentScope;
  granted: boolean;
  noticeVersion: string;
  noticeLanguage: NoticeLanguage;
  source: 'patient' | 'staff';
  recordedByRole: string;
  ts: string;
}

export interface Session {
  id: string;
  tokenId: string | null;
  patientId: string;
  doctorId: string;
  clinicId: string;
  startedAt: string;
  endedAt: string | null;
  languageMix: string | null;
  status: 'created' | 'in_progress' | 'ended';
}

export interface SessionListItem extends Session {
  patientName: string | null;
  consent: {
    audio: boolean;
    aiProcessing: boolean;
    whatsapp: boolean;
    recordingAllowed: boolean;
  };
}

export interface ConsentNotice {
  version: string;
  language: NoticeLanguage;
  status: 'PLACEHOLDER' | 'APPROVED';
  needsReview: boolean;
  title: string;
  body: string;
  scopes: Record<ConsentScope, { label: string; description: string }>;
}

export interface NoticeBundle {
  version: string;
  notices: Record<NoticeLanguage, ConsentNotice>;
}

/** Admin rows are full; researcher rows are anonymised (only seq, ts, action, resourceType, actorRole). */
export interface AuditRow {
  seq: number;
  ts: string;
  action: string;
  resourceType: string | null;
  actorRole: string | null;
  actorUserId?: string | null;
  resourceId?: string | null;
  sessionId?: string | null;
  requestId?: string | null;
  rowHash?: string;
}

export interface AuditPage {
  items: AuditRow[];
  nextBeforeSeq: number | null;
}

export interface VerifyResult {
  ok: boolean;
  firstBrokenSeq?: number;
  reason?: string;
}

export interface EvalRunSummary {
  id: string;
  runAt: string | null;
  split: string | null;
  datasetHash: string | null;
  codeCommit: string | null;
  casesCount: number;
  hasErrorsCsv: boolean;
}

export interface EvalRunDetail {
  id: string;
  manifest: Record<string, unknown>;
  summaryMd: string;
  tableTex: string;
  cellsCsv: string;
  casesCsv: string;
  questionsCsv: string;
  errorsCsv: string;
}

export interface QuestionBaselineCase {
  id: string;
  title: string;
  condition_label: string;
  description: string;
  dialogue: Array<{ speaker: string; text: string; lang?: string }>;
  confirmed_slots: Record<string, unknown>;
  oracle_slots: Record<string, unknown>;
}

export interface QuestionBaselineSlot {
  slot: string;
  type: string;
  choices?: string[];
  label: string;
}

export interface QuestionBaselinesCatalog {
  engines: string[];
  provider_mode: string;
  synthetic_mock: boolean;
  provider: string;
  cases: QuestionBaselineCase[];
  available_slots: QuestionBaselineSlot[];
}

export interface QuestionCandidateResult {
  pathway_id: string;
  score: number;
  confidence?: number;
  title?: string;
  matched_slots?: string[];
  missing_slots?: string[];
  red_flags_present?: string[];
}

export interface QuestionEngineOutput {
  outcome: string;
  suggested_question?: string | null;
  slot?: string | null;
  node_id?: string | null;
  confidence?: number | null;
  candidates?: QuestionCandidateResult[];
  rephrasing?: string | null;
  rephrased_question?: string | null;
  final_outcome?: string;
  abstention_reason?: string | null;
  validity?: {
    is_valid: boolean;
    errors: string[];
    schema_valid: boolean;
    confidence_bounded: boolean;
    candidate_pool_bounded: boolean;
    no_ungrounded_injections: boolean;
    immutability_preserved: boolean;
  };
  provenance?: {
    model: string;
    provider: string;
    prompt_version: string;
    synthetic_mock: boolean;
    execution_time_ms: number;
  };
  immutability_check?: {
    red_flag_preserved: boolean;
    candidate_pool_bounded: boolean;
    overrides_attempted: boolean;
    fallback_applied: boolean;
  };
}

export interface QuestionBaselineComparison {
  case_id: string;
  context: Record<string, unknown>;
  rules_only: QuestionEngineOutput;
  plain_llm: QuestionEngineOutput;
  hybrid: QuestionEngineOutput;
  provider_mode: string;
  notes: string;
}
