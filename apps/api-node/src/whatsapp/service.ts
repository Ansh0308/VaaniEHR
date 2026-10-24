// The WhatsApp summary of a signed visit: draft, approve, send, and what the delivery webhook reports (Phase 10 Run 1,
// ADR-D41, FR-F10-01..04). Every gate is decided HERE on the server: the visit must be signed, the patient must have given
// WhatsApp consent (checked again at every step), a summary needs a clean mismatch check before it is stored or approved, and
// a message is sent only for an approved summary whose stored hash still matches its text. Nothing is retried.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { getEffectiveConsent } from '../consent/service.js';
import type { Queryable } from '../db/tx.js';
import { errors } from '../http/errors.js';
import type { Services } from '../services.js';
import type { Session } from '../sessions/service.js';
import type { VisitVersion } from '../visits/repository.js';
import { findMismatches, type Mismatch } from './detector.js';
import { TEMPLATE_LANGUAGE, TEMPLATE_NAME } from './phrases.js';
import { toDigits } from './provider.js';
import {
  buildSummary,
  summaryHash,
  SummaryError,
  type FreeText,
  type SummaryParams,
} from './summary.js';

export const summaryView = z.object({
  id: z.uuid(),
  version: z.number(),
  status: z.enum(['needs_review', 'approved']),
  warningSigns: z.string(),
  followUp: z.string(),
  textGu: z.string(),
  textEn: z.string(),
  phraseTableVersion: z.string(),
  templateName: z.string(),
  /** the Gujarati wording of the fixed phrases has not been reviewed by a Gujarati speaker (always true in this run) */
  needsGujaratiReview: z.boolean(),
  textHash: z.string().nullable(),
  approvedAt: z.string().nullable(),
  /** the visit was amended after this summary was made: it can no longer be approved or sent */
  stale: z.boolean(),
});
export type SummaryView = z.infer<typeof summaryView>;

export const messageView = z.object({
  id: z.uuid(),
  summaryVersion: z.number(),
  status: z.enum(['sent', 'failed', 'delivered', 'read']),
  provider: z.enum(['mock', 'meta']),
  template: z.string(),
  recipientLast4: z.string(),
  errorMessage: z.string().nullable(),
  sentAt: z.string(),
  deliveredAt: z.string().nullable(),
});
export type MessageView = z.infer<typeof messageView>;

interface SummaryRow {
  id: string;
  version: number;
  status: 'needs_review' | 'approved';
  warning_signs: string;
  follow_up: string;
  params: SummaryParams;
  text_gu: string;
  text_en: string;
  phrase_table_version: string;
  template_name: string;
  text_hash: string | null;
  approved_at: Date | null;
}
const SUMMARY_COLUMNS = `id, version, status, warning_signs, follow_up, params, text_gu, text_en, phrase_table_version,
  template_name, text_hash, approved_at`;

export const toSummaryView = (r: SummaryRow, currentVersion: number): SummaryView => ({
  id: r.id,
  version: r.version,
  status: r.status,
  warningSigns: r.warning_signs,
  followUp: r.follow_up,
  textGu: r.text_gu,
  textEn: r.text_en,
  phraseTableVersion: r.phrase_table_version,
  templateName: r.template_name,
  needsGujaratiReview: true,
  textHash: r.text_hash,
  approvedAt: r.approved_at ? r.approved_at.toISOString() : null,
  stale: r.version < currentVersion,
});

export async function readSummaries(db: Queryable, sessionId: string): Promise<SummaryRow[]> {
  const r = await db.query<SummaryRow>(
    `SELECT ${SUMMARY_COLUMNS} FROM whatsapp_summary WHERE session_id = $1 ORDER BY version`,
    [sessionId],
  );
  return r.rows;
}

export async function readMessages(db: Queryable, sessionId: string): Promise<MessageView[]> {
  const r = await db.query<{
    id: string;
    version: number;
    status: MessageView['status'];
    provider: 'mock' | 'meta';
    template: string;
    recipient_last4: string;
    error_message: string | null;
    sent_at: Date;
    delivered_at: Date | null;
  }>(
    `SELECT m.id, s.version, m.status, m.provider, m.template, m.recipient_last4, m.error_message, m.sent_at, m.delivered_at
       FROM whatsapp_message m JOIN whatsapp_summary s ON s.id = m.summary_id
      WHERE m.session_id = $1 ORDER BY m.sent_at DESC, m.created_at DESC`,
    [sessionId],
  );
  return r.rows.map((x) => ({
    id: x.id,
    summaryVersion: x.version,
    status: x.status,
    provider: x.provider,
    template: x.template,
    recipientLast4: x.recipient_last4,
    errorMessage: x.error_message,
    sentAt: x.sent_at.toISOString(),
    deliveredAt: x.delivered_at ? x.delivered_at.toISOString() : null,
  }));
}

/** The visit must be SIGNED: the summary is built from the signed snapshot only. */
export async function requireSigned(
  services: Services,
  db: Queryable,
  session: Session,
): Promise<VisitVersion> {
  const visit = await services.visits.getVersion(db, session.clinicId, session.id);
  if (!visit)
    throw errors.conflict('This visit is not signed yet, so no WhatsApp summary can be made');
  return visit;
}

/** WhatsApp consent must be on record NOW (its own scope, FR-F1-03). */
export async function requireWhatsAppConsent(db: Queryable, session: Session): Promise<void> {
  const consent = await getEffectiveConsent(db, session.id);
  if (!consent.whatsappAllowed) throw errors.consentRequired('Consent required for: whatsapp');
}

export class SummaryRefused extends Error {
  constructor(public readonly mismatches: Mismatch[]) {
    super('The summary does not match the signed visit');
    this.name = 'SummaryRefused';
  }
}

/** Builds the summary from the signed snapshot and refuses it if the parsed output differs from the snapshot. */
export function composeChecked(visit: VisitVersion, free: FreeText) {
  let summary;
  try {
    summary = buildSummary(visit.content, free);
  } catch (err) {
    if (err instanceof SummaryError) throw errors.validation(err.message);
    throw err;
  }
  const mismatches = findMismatches(summary.params, summary.textGu, visit.content);
  if (mismatches.length > 0) throw new SummaryRefused(mismatches);
  return summary;
}

export async function saveDraft(
  db: Queryable,
  session: Session,
  visit: VisitVersion,
  free: FreeText,
  userId: string,
): Promise<SummaryRow> {
  const s = composeChecked(visit, free);
  const existing = (await readSummaries(db, session.id)).find((r) => r.version === visit.version);
  if (existing?.status === 'approved')
    throw errors.conflict('This summary is already approved and cannot be changed');
  const values = [
    free.warningSigns,
    free.followUp,
    JSON.stringify(s.params),
    s.textGu,
    s.textEn,
    s.phraseTableVersion,
    TEMPLATE_NAME,
  ];
  if (existing) {
    await db.query(
      `UPDATE whatsapp_summary SET warning_signs = $2, follow_up = $3, params = $4::jsonb, text_gu = $5, text_en = $6,
              phrase_table_version = $7, template_name = $8, updated_at = now() WHERE id = $1`,
      [existing.id, ...values],
    );
  } else {
    await db.query(
      `INSERT INTO whatsapp_summary (session_id, clinic_id, patient_id, version, created_by, warning_signs, follow_up,
         params, text_gu, text_en, phrase_table_version, template_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12)`,
      [session.id, session.clinicId, session.patientId, visit.version, userId, ...values],
    );
  }
  return (await readSummaries(db, session.id)).find(
    (r) => r.version === visit.version,
  ) as SummaryRow;
}

/** Approval: the summary is composed again from the snapshot and the stored free text, checked again, and stored with its hash. */
export async function approve(
  db: Queryable,
  session: Session,
  visit: VisitVersion,
  userId: string,
): Promise<SummaryRow> {
  const row = (await readSummaries(db, session.id)).find((r) => r.version === visit.version);
  if (!row) throw errors.conflict('There is no summary for the current version of this visit yet');
  if (row.status === 'approved') return row;
  const s = composeChecked(visit, { warningSigns: row.warning_signs, followUp: row.follow_up });
  const hash = summaryHash(s.textGu, s.params);
  await db.query(
    `UPDATE whatsapp_summary SET status = 'approved', params = $2::jsonb, text_gu = $3, text_en = $4, text_hash = $5,
            approved_by = $6, approved_at = now(), updated_at = now() WHERE id = $1`,
    [row.id, JSON.stringify(s.params), s.textGu, s.textEn, hash, userId],
  );
  return (await readSummaries(db, session.id)).find(
    (r) => r.version === visit.version,
  ) as SummaryRow;
}

export function recipientHash(key: string, digits: string): string {
  return createHmac('sha256', key).update(digits).digest('hex');
}

export interface SendOutcome {
  message: MessageView;
  ok: boolean;
}

/**
 * Sends the APPROVED summary of the current version. Refused if it is not approved, if the visit was amended since, if the
 * stored text no longer matches its hash or the snapshot, if WhatsApp consent is gone, if the patient has no phone number, or
 * if it was already sent. A provider failure is recorded as a failed message; nothing is retried.
 */
export async function sendApproved(
  db: Queryable,
  services: Services,
  session: Session,
  visit: VisitVersion,
  userId: string,
): Promise<SendOutcome> {
  const row = (await readSummaries(db, session.id)).find((r) => r.version === visit.version);
  if (!row || row.status !== 'approved')
    throw errors.conflict('The summary must be approved before it is sent');
  if (!row.text_hash || summaryHash(row.text_gu, row.params) !== row.text_hash) {
    throw errors.conflict('The stored summary no longer matches its approval; it was not sent');
  }
  // the stored text is checked against the signed snapshot once more at the moment of sending
  if (findMismatches(row.params, row.text_gu, visit.content).length > 0) {
    throw errors.conflict('The stored summary does not match the signed visit; it was not sent');
  }
  const already = await db.query(
    `SELECT 1 FROM whatsapp_message WHERE summary_id = $1 AND status IN ('sent', 'delivered', 'read')`,
    [row.id],
  );
  if ((already.rowCount ?? 0) > 0) throw errors.conflict('This summary was already sent');
  const patient = await services.directory.getPatient(session.clinicId, session.patientId);
  const digits = patient?.phone ? toDigits(patient.phone) : '';
  if (digits.length < 10) throw errors.conflict('The patient has no phone number on record');

  let result;
  try {
    result = await services.whatsapp.send({
      toDigits: digits,
      template: TEMPLATE_NAME,
      language: TEMPLATE_LANGUAGE,
      params: row.params,
      text: row.text_gu,
    });
  } catch {
    result = {
      ok: false,
      providerMessageId: null,
      error: 'The WhatsApp provider failed unexpectedly.',
    };
  }
  const id = (
    await db.query<{ id: string }>(
      `INSERT INTO whatsapp_message (summary_id, session_id, clinic_id, patient_id, template, status, error_message, provider,
         provider_message_id, recipient_last4, recipient_hash, text_hash, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [
        row.id,
        session.id,
        session.clinicId,
        session.patientId,
        TEMPLATE_NAME,
        result.ok ? 'sent' : 'failed',
        result.ok ? null : (result.error ?? 'Not sent').slice(0, 300),
        services.whatsapp.name,
        result.providerMessageId,
        digits.slice(-4),
        recipientHash(services.lockoutKey, digits),
        row.text_hash,
        userId,
      ],
    )
  ).rows[0]?.id as string;
  const message = (await readMessages(db, session.id)).find((m) => m.id === id) as MessageView;
  return { message, ok: result.ok };
}

// --- webhook -----------------------------------------------------------------------------------------------------------

/** Meta signs the raw request body: header X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(body, app secret) in hex. */
export function verifySignature(
  secret: string,
  rawBody: Buffer | string,
  header: string | undefined,
): boolean {
  if (!header || !header.startsWith('sha256=')) return false;
  const given = header.slice('sha256='.length);
  if (!/^[0-9a-f]{64}$/i.test(given)) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  const actual = Buffer.from(given, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export const webhookPayload = z.looseObject({
  entry: z
    .array(
      z.looseObject({
        changes: z
          .array(
            z.looseObject({
              value: z.looseObject({
                statuses: z
                  .array(
                    z.looseObject({
                      id: z.string(),
                      status: z.string(),
                      errors: z
                        .array(
                          z.looseObject({
                            code: z.number().optional(),
                            title: z.string().optional(),
                          }),
                        )
                        .optional(),
                    }),
                  )
                  .optional(),
                messages: z
                  .array(
                    z.looseObject({
                      from: z.string(),
                      type: z.string(),
                      text: z.looseObject({ body: z.string() }).optional(),
                    }),
                  )
                  .optional(),
              }),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
});
export type WebhookPayload = z.infer<typeof webhookPayload>;

const RANK: Record<string, number> = { sent: 1, delivered: 2, read: 3 };

/** Applies one delivery status. Returns true if a stored message changed. A status never moves backwards. */
export async function applyStatus(
  db: Queryable,
  providerMessageId: string,
  status: string,
  error: string | null,
): Promise<boolean> {
  const cur = await db.query<{ id: string; status: MessageView['status'] }>(
    `SELECT id, status FROM whatsapp_message WHERE provider = 'meta' AND provider_message_id = $1`,
    [providerMessageId],
  );
  const row = cur.rows[0];
  if (!row) return false;
  if (status === 'failed') {
    if (row.status === 'failed' || row.status === 'delivered' || row.status === 'read')
      return false;
    await db.query(
      `UPDATE whatsapp_message SET status = 'failed', error_message = $2 WHERE id = $1`,
      [row.id, (error ?? 'WhatsApp reported that the message failed.').slice(0, 300)],
    );
    return true;
  }
  const to = status === 'delivered' || status === 'read' ? status : null;
  if (!to || (RANK[to] ?? 0) <= (RANK[row.status] ?? 99)) return false;
  await db.query(
    `UPDATE whatsapp_message SET status = $2, delivered_at = coalesce(delivered_at, now()) WHERE id = $1`,
    [row.id, to],
  );
  return true;
}

/** The patient and clinic of the most recent message sent to this number, found through the keyed hash (no number is stored). */
export async function patientOfNumber(
  db: Queryable,
  key: string,
  fromDigits: string,
): Promise<{ patientId: string; clinicId: string } | null> {
  const r = await db.query<{ patient_id: string; clinic_id: string }>(
    `SELECT patient_id, clinic_id FROM whatsapp_message WHERE recipient_hash = $1 ORDER BY sent_at DESC LIMIT 1`,
    [recipientHash(key, toDigits(fromDigits))],
  );
  return r.rows[0] ? { patientId: r.rows[0].patient_id, clinicId: r.rows[0].clinic_id } : null;
}
