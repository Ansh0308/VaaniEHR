// Erasure requests (PG-20; Phase 12B Run 2, ADR-D45). A request is recorded by staff or an admin for a patient, reviewed by an
// admin, and then COMPLETED or REFUSED. Completing removes everything about the patient that is not part of a SIGNED visit record
// and keeps the signed record, the visit versions and the audit log. Whether a signed clinical record must be kept after an erasure
// request is NOT decided here: it is open question OCI-016 ("to be checked by my guide / institution / a clinician"); the safer
// default (keep the signed record, remove the rest) is what this code does.
//
// What is removed, per session of the patient in this clinic:
//   every session  : all consent still granted is withdrawn (the speech service then deletes the audio at its next purge run),
//                    draft transcript text and unconfirmed facts, suggested questions and the derived shortlist (the same rules as
//                    a consent withdrawal), the FHIR bundles, WhatsApp summaries and messages (derived from the signed record)
//   unsigned session: also the doctor-confirmed transcript and facts, the doctor's own pathway decisions and the prescription rows
//   the patient    : ABHA link and transactions, the clinical profile (allergies and conditions typed by staff)
// What is kept: signed visit records and their versions, the facts, transcript and medicines a signed record rests on, consent
// events, the audit log, session rows (ids and times), audio metadata rows (no audio), and the patient's name and phone, which
// belong to ClinicOS and are not changed from here.
// The result stores COUNTS only, never content. The setting `vaani.erasure` is switched on only in this file (static test).
import type { AuthContext } from '../auth/types.js';
import { withdrawEverythingForPatient } from '../consent/routes.js';
import type { Queryable } from '../db/tx.js';
import { errors } from '../http/errors.js';
import { deleteDerivedPathwayRows } from '../pathways/service.js';
import type { Services } from '../services.js';
import { deleteDraftSegments } from '../transcripts/routes.js';

export const CHANNELS = ['in_person', 'phone', 'written'] as const;
export type Channel = (typeof CHANNELS)[number];
export type Status = 'received' | 'in_review' | 'completed' | 'refused';

export interface RequestRow {
  id: string;
  clinic_id: string;
  patient_id: string;
  status: Status;
  channel: Channel;
  note: string;
  requested_by: string;
  requested_by_role: string;
  received_at: Date;
  reviewed_at: Date | null;
  decided_at: Date | null;
  refusal_reason: string | null;
  result: Record<string, number> | null;
}

export interface RequestView {
  id: string;
  patientId: string;
  patientName: string | null;
  status: Status;
  channel: Channel;
  note: string;
  requestedByRole: string;
  receivedAt: string;
  reviewedAt: string | null;
  decidedAt: string | null;
  refusalReason: string | null;
  result: Record<string, number> | null;
}

const COLUMNS = `id, clinic_id, patient_id, status, channel, note, requested_by, requested_by_role, received_at,
  reviewed_at, decided_at, refusal_reason, result`;

async function toView(services: Services, row: RequestRow): Promise<RequestView> {
  const patient = await services.directory.getPatient(row.clinic_id, row.patient_id);
  return {
    id: row.id,
    patientId: row.patient_id,
    patientName: patient?.name ?? null,
    status: row.status,
    channel: row.channel,
    note: row.note,
    requestedByRole: row.requested_by_role,
    receivedAt: row.received_at.toISOString(),
    reviewedAt: row.reviewed_at ? row.reviewed_at.toISOString() : null,
    decidedAt: row.decided_at ? row.decided_at.toISOString() : null,
    refusalReason: row.refusal_reason,
    result: row.result,
  };
}

async function load(db: Queryable, auth: AuthContext, id: string): Promise<RequestRow> {
  const r = await db.query<RequestRow>(
    `SELECT ${COLUMNS} FROM erasure_request WHERE id = $1 AND clinic_id = $2`,
    [id, auth.clinicId],
  );
  if (!r.rows[0]) throw errors.notFound('Request not found');
  return r.rows[0];
}

export async function createRequest(
  db: Queryable,
  services: Services,
  auth: AuthContext,
  input: { patientId: string; channel: Channel; note: string },
): Promise<RequestView> {
  const patient = await services.directory.getPatient(auth.clinicId, input.patientId);
  if (!patient) throw errors.notFound('Patient not found');
  const open = await db.query(
    "SELECT 1 FROM erasure_request WHERE clinic_id = $1 AND patient_id = $2 AND status IN ('received', 'in_review')",
    [auth.clinicId, input.patientId],
  );
  if (open.rowCount)
    throw errors.conflict('There is already an open erasure request for this patient');
  const r = await db.query<RequestRow>(
    `INSERT INTO erasure_request (clinic_id, patient_id, channel, note, requested_by, requested_by_role)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${COLUMNS}`,
    [auth.clinicId, input.patientId, input.channel, input.note, auth.sub, auth.role],
  );
  return toView(services, r.rows[0] as RequestRow);
}

export async function listRequests(
  db: Queryable,
  services: Services,
  auth: AuthContext,
  status: Status | undefined,
): Promise<RequestView[]> {
  const params: unknown[] = [auth.clinicId];
  let where = 'clinic_id = $1';
  if (auth.role !== 'admin') {
    params.push(auth.sub);
    where += ` AND requested_by = $${params.length}`; // staff see the requests they recorded themselves
  }
  if (status) {
    params.push(status);
    where += ` AND status = $${params.length}`;
  }
  const r = await db.query<RequestRow>(
    `SELECT ${COLUMNS} FROM erasure_request WHERE ${where} ORDER BY received_at DESC LIMIT 100`,
    params,
  );
  return Promise.all(r.rows.map((row) => toView(services, row)));
}

export async function startReview(
  db: Queryable,
  services: Services,
  auth: AuthContext,
  id: string,
): Promise<RequestView> {
  const row = await load(db, auth, id);
  if (row.status !== 'received')
    throw errors.conflict('Only a request that was just received can be put in review');
  const r = await db.query<RequestRow>(
    `UPDATE erasure_request SET status = 'in_review', reviewed_by = $2, reviewed_at = now(), updated_at = now()
      WHERE id = $1 RETURNING ${COLUMNS}`,
    [id, auth.sub],
  );
  return toView(services, r.rows[0] as RequestRow);
}

export async function refuse(
  db: Queryable,
  services: Services,
  auth: AuthContext,
  id: string,
  reason: string,
): Promise<RequestView> {
  const row = await load(db, auth, id);
  if (row.status !== 'received' && row.status !== 'in_review') {
    throw errors.conflict('This request is already decided');
  }
  const r = await db.query<RequestRow>(
    `UPDATE erasure_request SET status = 'refused', refusal_reason = $2, decided_by = $3, decided_at = now(), updated_at = now()
      WHERE id = $1 RETURNING ${COLUMNS}`,
    [id, reason, auth.sub],
  );
  return toView(services, r.rows[0] as RequestRow);
}

/** What completing would remove and keep, as counts. Read only. */
export async function impact(
  db: Queryable,
  patientId: string,
  clinicId: string,
): Promise<Record<string, number>> {
  const count = async (sql: string): Promise<number> =>
    Number((await db.query<{ n: number }>(sql, [patientId, clinicId])).rows[0]?.n ?? 0);
  const mine = `(SELECT id FROM consultation_session WHERE clinicos_patient_id = $1 AND clinicos_clinic_id = $2)`;
  const unsigned = `(SELECT s.id FROM consultation_session s WHERE s.clinicos_patient_id = $1 AND s.clinicos_clinic_id = $2
                      AND NOT EXISTS (SELECT 1 FROM visit_record v WHERE v.session_id = s.id AND v.status = 'signed'))`;
  return {
    sessions: await count(`SELECT count(*)::int AS n FROM ${mine} x`),
    signedVisitsKept: await count(
      `SELECT count(*)::int AS n FROM visit_record v WHERE v.status = 'signed' AND v.session_id IN ${mine}`,
    ),
    audioRecordingsToDelete: await count(
      `SELECT count(*)::int AS n FROM audio_asset WHERE deleted_at IS NULL AND session_id IN ${mine}`,
    ),
    transcriptSegmentsToRemove: await count(
      `SELECT count(*)::int AS n FROM transcript_segment WHERE session_id IN ${unsigned}
        OR (status = 'draft' AND session_id IN ${mine})`,
    ),
    factsToRemove: await count(
      `SELECT count(*)::int AS n FROM extracted_fact WHERE session_id IN ${unsigned}
        OR (status <> 'confirmed' AND session_id IN ${mine})`,
    ),
    prescriptionRowsToRemove: await count(
      `SELECT count(*)::int AS n FROM prescription_item WHERE session_id IN ${unsigned}`,
    ),
    derivedExportsToRemove: await count(
      `SELECT ((SELECT count(*) FROM fhir_bundle WHERE session_id IN ${mine})
             + (SELECT count(*) FROM whatsapp_summary WHERE session_id IN ${mine})
             + (SELECT count(*) FROM whatsapp_message WHERE session_id IN ${mine}))::int AS n`,
    ),
    abhaRowsToRemove: await count(
      `SELECT ((SELECT count(*) FROM abha_link WHERE patient_id = $1 AND clinic_id = $2)
             + (SELECT count(*) FROM abha_txn WHERE patient_id = $1 AND clinic_id = $2))::int AS n`,
    ),
    clinicalProfileRowsToRemove: await count(
      `SELECT count(*)::int AS n FROM patient_clinical_profile WHERE clinicos_patient_id = $1 AND $2::uuid IS NOT NULL`,
    ),
  };
}

type Counts = Record<
  | 'sessions'
  | 'signedVisitsKept'
  | 'consentWithdrawals'
  | 'transcriptSegmentsRemoved'
  | 'factsRemoved'
  | 'questionsRemoved'
  | 'candidatesRemoved'
  | 'prescriptionRowsRemoved'
  | 'derivedExportsRemoved'
  | 'abhaRowsRemoved'
  | 'clinicalProfileRowsRemoved'
  | 'audioRecordingsPendingDeletion',
  number
>;

export interface Done {
  view: RequestView;
  counts: Record<string, number>;
  /** one entry per session whose consent was withdrawn (for the audit log) */
  withdrawn: { sessionId: string; scopes: string[] }[];
  /** per session: deleted draft rows (for the audit log) */
  drafts: {
    sessionId: string;
    segments: number;
    facts: number;
    questions: number;
    candidates: number;
  }[];
}

export async function complete(
  db: Queryable,
  services: Services,
  auth: AuthContext,
  id: string,
): Promise<Done> {
  const row = await load(db, auth, id);
  if (row.status !== 'in_review')
    throw errors.conflict('A request must be in review before it can be completed');
  const patientId = row.patient_id;
  const clinicId = auth.clinicId;
  const counts: Counts = {
    sessions: 0,
    signedVisitsKept: 0,
    consentWithdrawals: 0,
    transcriptSegmentsRemoved: 0,
    factsRemoved: 0,
    questionsRemoved: 0,
    candidatesRemoved: 0,
    prescriptionRowsRemoved: 0,
    derivedExportsRemoved: 0,
    abhaRowsRemoved: 0,
    clinicalProfileRowsRemoved: 0,
    audioRecordingsPendingDeletion: 0,
  };
  const withdrawn = await withdrawEverythingForPatient(db, patientId, clinicId, auth);
  counts.consentWithdrawals = withdrawn.reduce((n, w) => n + w.scopes.length, 0);

  const sessions = await db.query<{ id: string; signed: boolean }>(
    `SELECT s.id, EXISTS (SELECT 1 FROM visit_record v WHERE v.session_id = s.id AND v.status = 'signed') AS signed
       FROM consultation_session s WHERE s.clinicos_patient_id = $1 AND s.clinicos_clinic_id = $2`,
    [patientId, clinicId],
  );
  const drafts: Done['drafts'] = [];
  const gone = async (sql: string, sid: string): Promise<number> =>
    (await db.query(sql, [sid])).rowCount ?? 0;
  try {
    // from here until the end of the loop the guards that protect derived data allow a DELETE (migration 0019)
    await db.query("SELECT set_config('vaani.erasure', 'on', true)");
    for (const session of sessions.rows) {
      counts.sessions += 1;
      const d = await deleteDraftSegments(db, session.id);
      const p = await deleteDerivedPathwayRows(db, session.id);
      counts.transcriptSegmentsRemoved += d.segments;
      counts.factsRemoved += d.facts;
      counts.questionsRemoved += p.questions;
      counts.candidatesRemoved += p.candidates;
      // derived exports of a signed record (not the record itself): messages first, they point at the summaries
      counts.derivedExportsRemoved += await gone(
        'DELETE FROM whatsapp_message WHERE session_id = $1',
        session.id,
      );
      counts.derivedExportsRemoved += await gone(
        'DELETE FROM whatsapp_summary WHERE session_id = $1',
        session.id,
      );
      counts.derivedExportsRemoved += await gone(
        'DELETE FROM fhir_bundle WHERE session_id = $1',
        session.id,
      );
      if (session.signed) {
        counts.signedVisitsKept += 1;
      } else {
        // an unsigned visit is not a record yet: all of its working data goes
        counts.factsRemoved += await gone(
          'DELETE FROM extracted_fact WHERE session_id = $1',
          session.id,
        );
        counts.transcriptSegmentsRemoved += await gone(
          'DELETE FROM transcript_segment WHERE session_id = $1',
          session.id,
        );
        counts.questionsRemoved += await gone(
          'DELETE FROM question_event WHERE session_id = $1',
          session.id,
        );
        counts.candidatesRemoved += await gone(
          'DELETE FROM candidate WHERE session_id = $1',
          session.id,
        );
        counts.prescriptionRowsRemoved += await gone(
          'DELETE FROM prescription_item WHERE session_id = $1',
          session.id,
        );
      }
      drafts.push({
        sessionId: session.id,
        ...{
          segments: d.segments,
          facts: d.facts,
          questions: p.questions,
          candidates: p.candidates,
        },
      });
    }
  } finally {
    await db.query("SELECT set_config('vaani.erasure', 'off', true)");
  }
  counts.abhaRowsRemoved +=
    (
      await db.query('DELETE FROM abha_txn WHERE patient_id = $1 AND clinic_id = $2', [
        patientId,
        clinicId,
      ])
    ).rowCount ?? 0;
  counts.abhaRowsRemoved +=
    (
      await db.query('DELETE FROM abha_link WHERE patient_id = $1 AND clinic_id = $2', [
        patientId,
        clinicId,
      ])
    ).rowCount ?? 0;
  counts.clinicalProfileRowsRemoved =
    (
      await db.query('DELETE FROM patient_clinical_profile WHERE clinicos_patient_id = $1', [
        patientId,
      ])
    ).rowCount ?? 0;
  counts.audioRecordingsPendingDeletion = Number(
    (
      await db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM audio_asset WHERE deleted_at IS NULL
          AND session_id IN (SELECT id FROM consultation_session WHERE clinicos_patient_id = $1 AND clinicos_clinic_id = $2)`,
        [patientId, clinicId],
      )
    ).rows[0]?.n ?? 0,
  );
  const r = await db.query<RequestRow>(
    `UPDATE erasure_request SET status = 'completed', result = $2::jsonb, decided_by = $3, decided_at = now(), updated_at = now()
      WHERE id = $1 RETURNING ${COLUMNS}`,
    [id, JSON.stringify(counts), auth.sub],
  );
  return {
    view: await toView(services, r.rows[0] as RequestRow),
    counts,
    withdrawn: withdrawn.map((w) => ({ sessionId: w.sessionId, scopes: [...w.scopes] })),
    drafts,
  };
}
