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
