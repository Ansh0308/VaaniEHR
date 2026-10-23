// The ONE place audit rows are written (FR-F7-04, FR-F1-05). Every mutating endpoint goes through ctx.audit() in the
// route wrapper, which calls appendAudit() inside the same transaction as the change, so the change and its audit
// row commit or roll back together.
import type { QueryResultRow } from 'pg';
import '../db/types.js';
import type { Queryable, Tx } from '../db/tx.js';
import { computeRowHash, GENESIS_HASH, type AuditRecord, type ChainRow } from './chain.js';

export const AUDIT_ACTIONS = [
  'LOGIN_SUCCEEDED',
  'LOGIN_FAILED',
  'LOGOUT',
  'PATIENT_LOOKUP',
  'PATIENT_CREATED',
  'PATIENT_PROFILE_UPDATED',
  'SESSION_CREATED',
  'CONSENT_GRANTED',
  'CONSENT_WITHDRAWN',
  'AUDIT_EXPORTED',
  'SEED_APPLIED',
  'ASR_TOKEN_ISSUED',
  'AUDIO_STORED',
  'AUDIO_PURGED',
  'TRANSCRIPT_SAVED',
  'TRANSCRIPT_CONFIRMED',
  'TRANSCRIPT_DRAFT_DELETED',
  'FACTS_EXTRACTED',
  'FACT_ADDED',
  'FACT_CONFIRMED',
  'FACT_REJECTED',
  'FACT_EDITED',
  'FACT_CONCEPT_CONFIRMED',
  'FACT_CONCEPT_CLEARED',
  'QUESTION_ACTED',
  'RED_FLAG_ACKNOWLEDGED',
  'CANDIDATE_SELECTED',
  'CANDIDATE_SELECTION_UNDONE',
  'PATHWAY_DATA_DELETED',
  'MEDICINE_IMPORTED',
  'MEDICINE_CODES_LOADED',
  'MEDICINE_TRANSLIT_LOADED',
  'MEDICINE_CREATED',
  'MEDICINE_UPDATED',
  'MEDICINE_RETIRED',
  'MEDICINE_RESTORED',
  'MEDICINE_BRAND_ADDED',
  'MEDICINE_BRAND_RETIRED',
  'TEMPLATE_CREATED',
  'TEMPLATE_UPDATED',
  'TEMPLATE_RETIRED',
  'TEMPLATE_RESTORED',
  'PRESCRIPTION_ITEM_ADDED',
  'PRESCRIPTION_ITEM_EDITED',
  'PRESCRIPTION_ITEM_REMOVED',
  'PRESCRIPTION_TEMPLATE_APPLIED',
  'VISIT_SIGNED',
  'VISIT_SIGN_REFUSED',
  'VISIT_AMENDED',
  'VISIT_AMEND_REFUSED',
  'FHIR_GENERATED',
  'FHIR_EXPORTED',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditEntry {
  action: AuditAction;
  actorUserId?: string | null;
  actorRole?: string | null;
  clinicId?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  sessionId?: string | null;
  ip?: string | null;
  requestId?: string | null;
  /** Identifiers and counts only. Never names, phone numbers, allergies, emails or tokens (checked below). */
  meta?: Record<string, unknown>;
}

// Defensive guard against PHI/PII in audit metadata (healthcare-phi-compliance: audit trails must not leak data).
const FORBIDDEN_META_KEY =
  /phone|email|password|token|secret|name|dob|birth|allerg|address|reason_text/i;

export function assertSafeMeta(meta: Record<string, unknown>): void {
  for (const key of Object.keys(meta)) {
    if (FORBIDDEN_META_KEY.test(key)) {
      throw new Error(
        `audit meta key "${key}" looks like personal data; store identifiers or counts only`,
      );
    }
  }
}

// Arbitrary constant: serialises chain writers (transaction-scoped, released on commit/rollback).
const CHAIN_LOCK_KEY = 8_265_041_007;

interface HeadRow extends QueryResultRow {
  seq: number;
  row_hash: string;
}

export async function appendAudit(
  tx: Tx,
  entry: AuditEntry,
  now: Date = new Date(),
): Promise<{ seq: number; rowHash: string }> {
  const meta = entry.meta ?? {};
  assertSafeMeta(meta);

  await tx.query('SELECT pg_advisory_xact_lock($1)', [CHAIN_LOCK_KEY]);
  const head = await tx.query<HeadRow>(
    'SELECT seq, row_hash FROM audit_log ORDER BY seq DESC LIMIT 1',
  );
  const prev = head.rows[0];
  const seq = Number(prev?.seq ?? 0) + 1; // Number(): never string-concatenate a bigint that arrived as text

  const record: AuditRecord = {
    seq,
    ts: now.toISOString(),
    actorUserId: entry.actorUserId ?? null,
    actorRole: entry.actorRole ?? null,
    clinicId: entry.clinicId ?? null,
    action: entry.action,
    resourceType: entry.resourceType ?? null,
    resourceId: entry.resourceId ?? null,
    sessionId: entry.sessionId ?? null,
    ip: entry.ip ?? null,
    requestId: entry.requestId ?? null,
    meta,
    prevHash: prev?.row_hash ?? GENESIS_HASH,
  };
  const rowHash = computeRowHash(record);

  await tx.query(
    `INSERT INTO audit_log
       (seq, ts, actor_user_id, actor_role, clinic_id, action, resource_type, resource_id, session_id,
        ip, request_id, meta, prev_hash, row_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14)`,
    [
      record.seq,
      record.ts,
      record.actorUserId,
      record.actorRole,
      record.clinicId,
      record.action,
      record.resourceType,
      record.resourceId,
      record.sessionId,
      record.ip,
      record.requestId,
      JSON.stringify(record.meta),
      record.prevHash,
      rowHash,
    ],
  );
  return { seq, rowHash };
}

interface AuditDbRow extends QueryResultRow {
  seq: number;
  ts: Date;
  actor_user_id: string | null;
  actor_role: string | null;
  clinic_id: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  session_id: string | null;
  ip: string | null;
  request_id: string | null;
  meta: Record<string, unknown>;
  prev_hash: string;
  row_hash: string;
}

export function toChainRow(r: AuditDbRow): ChainRow {
  return {
    seq: Number(r.seq),
    ts: r.ts.toISOString(),
    actorUserId: r.actor_user_id,
    actorRole: r.actor_role,
    clinicId: r.clinic_id,
    action: r.action,
    resourceType: r.resource_type,
    resourceId: r.resource_id,
    sessionId: r.session_id,
    ip: r.ip,
    requestId: r.request_id,
    meta: r.meta,
    prevHash: r.prev_hash,
    rowHash: r.row_hash,
  };
}

/** Audit rows in chain order, after a given seq (callers page for large tables). */
export async function readChainRows(
  db: Queryable,
  afterSeq = 0,
  limit = 5000,
): Promise<ChainRow[]> {
  const result = await db.query<AuditDbRow>(
    'SELECT * FROM audit_log WHERE seq > $1 ORDER BY seq ASC LIMIT $2',
    [afterSeq, limit],
  );
  return result.rows.map(toChainRow);
}
