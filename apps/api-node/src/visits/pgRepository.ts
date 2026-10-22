// Standalone Postgres implementation of VisitRepository (Phase 8 Run 1). Phase 12 adds a ClinicOS-backed one.
import type { Queryable } from '../db/tx.js';
import type {
  NewVersion,
  SignedContent,
  VersionSummary,
  VisitRecord,
  VisitRepository,
  VisitVersion,
} from './repository.js';

interface VersionRow {
  version: number;
  kind: 'signed' | 'amendment';
  content: SignedContent;
  content_hash: string;
  safety_configured: boolean;
  safety_not_run_acknowledged: boolean;
  reason: string | null;
  signed_by: string;
  signed_at: Date;
}

const summary = (r: VersionRow): VersionSummary => ({
  version: r.version,
  kind: r.kind,
  contentHash: r.content_hash,
  safetyConfigured: r.safety_configured,
  safetyNotRunAcknowledged: r.safety_not_run_acknowledged,
  reason: r.reason,
  signedBy: r.signed_by,
  signedAt: r.signed_at.toISOString(),
});
const full = (r: VersionRow): VisitVersion => ({ ...summary(r), content: r.content });

const COLUMNS = `version, kind, content, content_hash, safety_configured, safety_not_run_acknowledged, reason,
  signed_by, signed_at`;

export class PgVisitRepository implements VisitRepository {
  async findBySession(
    db: Queryable,
    clinicId: string,
    sessionId: string,
  ): Promise<VisitRecord | null> {
    const r = await db.query<{
      id: string;
      session_id: string;
      status: 'draft' | 'signed';
      current_version: number;
      patient_ref: string;
      doctor_id: string;
      signed_at: Date | null;
    }>(
      `SELECT id, session_id, status, current_version, patient_ref, doctor_id, signed_at
         FROM visit_record WHERE session_id = $1 AND clinic_id = $2`,
      [sessionId, clinicId],
    );
    const v = r.rows[0];
    return v
      ? {
          id: v.id,
          sessionId: v.session_id,
          status: v.status,
          currentVersion: v.current_version,
          patientRef: v.patient_ref,
          doctorId: v.doctor_id,
          signedAt: v.signed_at ? v.signed_at.toISOString() : null,
        }
      : null;
  }

  async createSigned(
    db: Queryable,
    input: NewVersion & { patientRef: string; doctorId: string },
  ): Promise<VisitVersion> {
    const record = await db.query<{ id: string }>(
      `INSERT INTO visit_record (session_id, clinic_id, patient_ref, doctor_id, status, current_version, signed_at)
       VALUES ($1, $2, $3, $4, 'signed', 1, now()) RETURNING id`,
      [input.sessionId, input.clinicId, input.patientRef, input.doctorId],
    );
    const inserted = await db.query<VersionRow>(
      `INSERT INTO visit_record_version (visit_id, session_id, clinic_id, version, kind, content, content_hash,
         safety_configured, safety_not_run_acknowledged, signed_by)
       VALUES ($1, $2, $3, 1, 'signed', $4::jsonb, $5, $6, $7, $8) RETURNING ${COLUMNS}`,
      [
        record.rows[0]?.id,
        input.sessionId,
        input.clinicId,
        JSON.stringify(input.content),
        input.contentHash,
        input.safetyConfigured,
        input.safetyNotRunAcknowledged,
        input.signedBy,
      ],
    );
    return full(inserted.rows[0] as VersionRow);
  }

  async addAmendment(db: Queryable, input: NewVersion & { reason: string }): Promise<VisitVersion> {
    const locked = await db.query<{ id: string; current_version: number }>(
      `SELECT id, current_version FROM visit_record
        WHERE session_id = $1 AND clinic_id = $2 AND status = 'signed' FOR UPDATE`,
      [input.sessionId, input.clinicId],
    );
    const record = locked.rows[0];
    if (!record) throw new Error('no signed visit to amend');
    const next = record.current_version + 1;
    const inserted = await db.query<VersionRow>(
      `INSERT INTO visit_record_version (visit_id, session_id, clinic_id, version, kind, content, content_hash,
         safety_configured, safety_not_run_acknowledged, reason, signed_by)
       VALUES ($1, $2, $3, $4, 'amendment', $5::jsonb, $6, $7, $8, $9, $10) RETURNING ${COLUMNS}`,
      [
        record.id,
        input.sessionId,
        input.clinicId,
        next,
        JSON.stringify(input.content),
        input.contentHash,
        input.safetyConfigured,
        input.safetyNotRunAcknowledged,
        input.reason,
        input.signedBy,
      ],
    );
    await db.query(
      'UPDATE visit_record SET current_version = $2, updated_at = now() WHERE id = $1',
      [record.id, next],
    );
    return full(inserted.rows[0] as VersionRow);
  }

  async getVersion(
    db: Queryable,
    clinicId: string,
    sessionId: string,
    version?: number,
  ): Promise<VisitVersion | null> {
    const r = await db.query<VersionRow>(
      `SELECT ${COLUMNS} FROM visit_record_version
        WHERE session_id = $1 AND clinic_id = $2 AND ($3::int IS NULL OR version = $3)
        ORDER BY version DESC LIMIT 1`,
      [sessionId, clinicId, version ?? null],
    );
    return r.rows[0] ? full(r.rows[0]) : null;
  }

  async listVersions(
    db: Queryable,
    clinicId: string,
    sessionId: string,
  ): Promise<VersionSummary[]> {
    const r = await db.query<VersionRow>(
      `SELECT ${COLUMNS} FROM visit_record_version WHERE session_id = $1 AND clinic_id = $2 ORDER BY version`,
      [sessionId, clinicId],
    );
    return r.rows.map(summary);
  }
}
