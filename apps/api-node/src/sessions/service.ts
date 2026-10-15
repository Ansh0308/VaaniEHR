// Consultation sessions (PRD 8.2 consultation_session). ClinicOS-owned ids are plain uuid references (no foreign keys).
import type { QueryResultRow } from 'pg';
import type { AuthContext } from '../auth/types.js';
import type { Queryable } from '../db/tx.js';

interface SessionRow extends QueryResultRow {
  id: string;
  clinicos_token_id: string | null;
  clinicos_patient_id: string;
  clinicos_doctor_id: string;
  clinicos_clinic_id: string;
  started_at: Date;
  ended_at: Date | null;
  language_mix: string | null;
  status: 'created' | 'in_progress' | 'ended';
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

export const toSession = (r: SessionRow): Session => ({
  id: r.id,
  tokenId: r.clinicos_token_id,
  patientId: r.clinicos_patient_id,
  doctorId: r.clinicos_doctor_id,
  clinicId: r.clinicos_clinic_id,
  startedAt: r.started_at.toISOString(),
  endedAt: r.ended_at ? r.ended_at.toISOString() : null,
  languageMix: r.language_mix,
  status: r.status,
});

/**
 * Loads a session the caller may see: same clinic, and a doctor only sees their OWN sessions (ClinicOS binds visits to
 * the owning doctor). Staff and admin see the whole clinic. Anything else is "not found", never "forbidden", so ids
 * of other clinics' sessions cannot be probed.
 */
export async function loadSession(
  db: Queryable,
  auth: AuthContext,
  sessionId: string,
): Promise<Session | null> {
  const r = await db.query<SessionRow>(
    'SELECT * FROM consultation_session WHERE id = $1 AND clinicos_clinic_id = $2',
    [sessionId, auth.clinicId],
  );
  const row = r.rows[0];
  if (!row) return null;
  if (auth.role === 'doctor' && row.clinicos_doctor_id !== auth.sub) return null;
  return toSession(row);
}
