// Consent state (F1). consent_event is append-only; the EFFECTIVE consent for a scope is its newest event.
import type { QueryResultRow } from 'pg';
import type { Queryable } from '../db/tx.js';
import { CONSENT_SCOPES, type ConsentScope, type NoticeLanguage } from './notices.js';

interface EventRow extends QueryResultRow {
  seq: number;
  scope: ConsentScope;
  granted: boolean;
  notice_version: string;
  notice_language: NoticeLanguage;
  source: 'patient' | 'staff';
  recorded_by_role: string;
  ts: Date;
}

export interface ScopeState {
  granted: boolean;
  since: string | null;
  noticeVersion: string | null;
  noticeLanguage: NoticeLanguage | null;
  source: 'patient' | 'staff' | null;
}

export interface EffectiveConsent {
  sessionId: string;
  scopes: Record<ConsentScope, ScopeState>;
  /** FR-F1-01: recording needs BOTH audio and ai_processing. */
  recordingAllowed: boolean;
  /** FR-F1-03: WhatsApp needs its own scope. */
  whatsappAllowed: boolean;
}

const EMPTY: ScopeState = {
  granted: false,
  since: null,
  noticeVersion: null,
  noticeLanguage: null,
  source: null,
};

export async function getEffectiveConsent(
  db: Queryable,
  sessionId: string,
): Promise<EffectiveConsent> {
  const r = await db.query<EventRow>(
    `SELECT DISTINCT ON (scope) seq, scope, granted, notice_version, notice_language, source, recorded_by_role, ts
       FROM consent_event WHERE session_id = $1 ORDER BY scope, seq DESC`,
    [sessionId],
  );
  const scopes = Object.fromEntries(CONSENT_SCOPES.map((s) => [s, { ...EMPTY }])) as Record<
    ConsentScope,
    ScopeState
  >;
  for (const row of r.rows) {
    scopes[row.scope] = {
      granted: row.granted,
      since: row.ts.toISOString(),
      noticeVersion: row.notice_version,
      noticeLanguage: row.notice_language,
      source: row.source,
    };
  }
  return {
    sessionId,
    scopes,
    recordingAllowed: scopes.audio.granted && scopes.ai_processing.granted,
    whatsappAllowed: scopes.whatsapp.granted,
  };
}

export interface ConsentEventView {
  seq: number;
  scope: ConsentScope;
  granted: boolean;
  noticeVersion: string;
  noticeLanguage: NoticeLanguage;
  source: 'patient' | 'staff';
  recordedByRole: string;
  ts: string;
}

export async function listConsentEvents(
  db: Queryable,
  sessionId: string,
): Promise<ConsentEventView[]> {
  const r = await db.query<EventRow>(
    `SELECT seq, scope, granted, notice_version, notice_language, source, recorded_by_role, ts
       FROM consent_event WHERE session_id = $1 ORDER BY seq ASC LIMIT 200`,
    [sessionId],
  );
  return r.rows.map((row) => ({
    seq: row.seq,
    scope: row.scope,
    granted: row.granted,
    noticeVersion: row.notice_version,
    noticeLanguage: row.notice_language,
    source: row.source,
    recordedByRole: row.recorded_by_role,
    ts: row.ts.toISOString(),
  }));
}

export interface ConsentFlags {
  audio: boolean;
  aiProcessing: boolean;
  whatsapp: boolean;
  recordingAllowed: boolean;
}

/** Effective consent for many sessions in ONE query (used by list screens; avoids one query per row). */
export async function getConsentFlagsFor(
  db: Queryable,
  sessionIds: readonly string[],
): Promise<Map<string, ConsentFlags>> {
  const out = new Map<string, ConsentFlags>();
  for (const id of sessionIds) {
    out.set(id, { audio: false, aiProcessing: false, whatsapp: false, recordingAllowed: false });
  }
  if (sessionIds.length === 0) return out;
  const r = await db.query<{ session_id: string; scope: ConsentScope; granted: boolean }>(
    `SELECT DISTINCT ON (session_id, scope) session_id, scope, granted
       FROM consent_event WHERE session_id = ANY($1::uuid[])
      ORDER BY session_id, scope, seq DESC`,
    [sessionIds],
  );
  for (const row of r.rows) {
    const flags = out.get(row.session_id);
    if (!flags) continue;
    if (row.scope === 'audio') flags.audio = row.granted;
    if (row.scope === 'ai_processing') flags.aiProcessing = row.granted;
    if (row.scope === 'whatsapp') flags.whatsapp = row.granted;
    flags.recordingAllowed = flags.audio && flags.aiProcessing;
  }
  return out;
}
