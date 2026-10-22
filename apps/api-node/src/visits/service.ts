// Sign-off logic (F7, Phase 8 Run 1). The SERVER decides whether a visit can be signed; the screen only shows what this
// returns. Blockers are named, never a generic "invalid". Content is clinical: it goes into the signed snapshot and back
// to the doctor, never into logs or the audit log (ids and counts only).
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { verifyPassword } from '../auth/password.js';
import type { AuthContext } from '../auth/types.js';
import { getEffectiveConsent } from '../consent/service.js';
import type { Queryable } from '../db/tx.js';
import { readFacts } from '../facts/service.js';
import { errors } from '../http/errors.js';
import { listRows, resolveRow, toSignedMedicines, type RowInput } from '../prescription/service.js';
import type { Session } from '../sessions/service.js';
import type { Services } from '../services.js';
import type {
  SignedContent,
  SignedFact,
  SignedMedicine,
  SignedWorkingCondition,
} from './repository.js';
import type { SafetyResult } from './safety.js';

export const BLOCKER_CODES = [
  'session_not_draft',
  'unconfirmed_facts',
  'red_flag_unacknowledged',
  'consent_missing',
  'no_working_condition',
  'incomplete_medicine',
] as const;
export type BlockerCode = (typeof BLOCKER_CODES)[number];
export const blockerView = z.object({ code: z.enum(BLOCKER_CODES), count: z.number() });
export type Blocker = z.infer<typeof blockerView>;

export const safetyView = z.object({
  configured: z.boolean(),
  blocked: z.number(),
  message: z.string(),
});

/** sorted-key JSON, so the same content always hashes the same */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
export const hashContent = (content: SignedContent): string =>
  createHash('sha256').update(canonicalJson(content), 'utf8').digest('hex');

interface Snapshot {
  content: SignedContent;
  blockers: Blocker[];
  medicineCount: number;
}

async function count(db: Queryable, sql: string, args: unknown[]): Promise<number> {
  const r = await db.query<{ n: number }>(sql, args);
  return r.rows[0]?.n ?? 0;
}

/** Reads the whole draft and decides. `alreadySigned` is a blocker of its own: a signed session is amended, not signed. */
export async function evaluateDraft(
  db: Queryable,
  session: Session,
  alreadySigned: boolean,
): Promise<Snapshot> {
  const blockers: Blocker[] = [];
  if (alreadySigned) blockers.push({ code: 'session_not_draft', count: 1 });

  const { facts } = await readFacts(db, session.id);
  // heard AND stale facts are both unconfirmed: the doctor has not (re-)confirmed them
  const unconfirmed = facts.filter((f) => f.status === 'heard' || f.status === 'stale').length;
  if (unconfirmed > 0) blockers.push({ code: 'unconfirmed_facts', count: unconfirmed });

  const redFlags = await count(
    db,
    `SELECT count(*)::int AS n FROM question_event
      WHERE session_id = $1 AND kind = 'red_flag' AND status = 'suggested'`,
    [session.id],
  );
  if (redFlags > 0) blockers.push({ code: 'red_flag_unacknowledged', count: redFlags });

  const ran = await count(
    db,
    `SELECT ((SELECT count(*) FROM question_event WHERE session_id = $1)
           + (SELECT count(*) FROM candidate WHERE session_id = $1 AND kind = 'derived'))::int AS n`,
    [session.id],
  );
  const sel = await db.query<{
    not_listed: boolean;
    pathway_id: string | null;
    pathway_version: number | null;
    not_listed_text: string | null;
  }>(
    `SELECT not_listed, pathway_id, pathway_version, not_listed_text FROM candidate
      WHERE session_id = $1 AND kind = 'selected' AND superseded_at IS NULL`,
    [session.id],
  );
  const s = sel.rows[0];
  let workingCondition: SignedWorkingCondition | null = null;
  if (s) {
    workingCondition = s.not_listed
      ? { kind: 'not_listed', text: s.not_listed_text ?? '' }
      : {
          kind: 'pathway',
          pathwayId: s.pathway_id as string,
          version: s.pathway_version as number,
        };
  }
  // a working condition is needed only when a pathway ran; "not listed" counts as the doctor's choice
  if (ran > 0 && !workingCondition) blockers.push({ code: 'no_working_condition', count: 1 });

  const rows = await listRows(db, session.id);
  const incomplete = rows.filter((r) => r.incomplete).length;
  if (incomplete > 0) blockers.push({ code: 'incomplete_medicine', count: incomplete });

  const signedFacts: SignedFact[] = facts
    .filter((f) => f.status === 'confirmed')
    .map((f) => ({
      id: f.id,
      type: f.type,
      value: f.value,
      negated: f.negated,
      uncertain: f.uncertain,
      speaker: f.speaker,
      source: f.source,
      sourceSegmentSeq: f.sourceSegmentSeq,
      evidenceQuote: f.evidenceQuote,
      edited: f.edited,
      originalValue: f.originalValue,
      conceptId: f.conceptStatus === 'confirmed' ? f.conceptId : null,
      conceptStatus: f.conceptStatus,
    }));
  const aiContentIncluded =
    signedFacts.some((f) => f.source === 'extracted' || f.conceptStatus === 'confirmed') ||
    workingCondition?.kind === 'pathway';

  const consent = await getEffectiveConsent(db, session.id);
  if (aiContentIncluded && !consent.recordingAllowed) {
    blockers.push({ code: 'consent_missing', count: 1 });
  }

  return {
    blockers,
    medicineCount: rows.length,
    content: {
      schema: 1,
      sessionId: session.id,
      patientRef: session.patientId,
      doctorId: session.doctorId,
      signedAt: '',
      facts: signedFacts,
      workingCondition,
      medicines: incomplete > 0 ? [] : toSignedMedicines(rows),
      consent: {
        audio: consent.scopes.audio.granted,
        aiProcessing: consent.scopes.ai_processing.granted,
      },
      aiContentIncluded,
      amendedFrom: null,
    },
  };
}

// --- password re-entry -------------------------------------------------------------------------------------------------
// Five wrong passwords in 15 minutes lock signing for that doctor until the window ends (in memory, per process: this is
// a research prototype with one API process; ADR-D38).
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;
const failures = new Map<string, { n: number; resetAt: number }>();
export const resetSignThrottle = (): void => failures.clear();

export async function checkSignPassword(
  services: Services,
  auth: AuthContext,
  password: string,
): Promise<void> {
  const now = Date.now();
  const entry = failures.get(auth.sub);
  if (entry && entry.resetAt > now && entry.n >= MAX_FAILURES) throw errors.rateLimited();
  if (!services.devLogin) {
    // password login does not exist in ClinicOS mode (Phase 12 supplies its own re-authentication)
    throw errors.notReady('Password re-entry is not available in this mode');
  }
  const user = await services.directory.getUser(auth.sub);
  const login = user ? await services.devLogin.findLoginByEmail(user.email) : null;
  const good =
    login !== null && login.id === auth.sub
      ? await verifyPassword(password, login.passwordHash)
      : await verifyPassword(password, services.dummyPasswordHash).then(() => false);
  if (!good) {
    const live = entry && entry.resetAt > now ? entry : { n: 0, resetAt: now + WINDOW_MS };
    live.n += 1;
    failures.set(auth.sub, live);
    throw errors.invalidPassword();
  }
  failures.delete(auth.sub);
}

// --- safety ------------------------------------------------------------------------------------------------------------
/**
 * Always asks the safety interface (so a future engine cannot be skipped). While it is not configured the doctor must
 * have acknowledged "Safety checks were not run"; a configured engine with unresolved blocked alerts refuses the sign-off.
 */
export async function runSafety(
  services: Services,
  sessionId: string,
  medicines: SignedMedicine[],
): Promise<SafetyResult> {
  return services.safety.run({ sessionId, medicines });
}

export function requireSafetyAcknowledgement(
  safety: SafetyResult,
  acknowledged: boolean,
): { safetyConfigured: boolean; safetyNotRunAcknowledged: boolean } {
  if (!safety.configured) {
    if (!acknowledged) throw errors.safetyAckRequired();
    return { safetyConfigured: false, safetyNotRunAcknowledged: true };
  }
  if (safety.blocked > 0) throw errors.conflict('Safety checks have unresolved blocked alerts');
  return { safetyConfigured: true, safetyNotRunAcknowledged: false };
}

// --- amendment ---------------------------------------------------------------------------------------------------------
/** The amended medicine list, validated like prescription rows, with the master's source copied in. */
export async function amendedMedicines(db: Queryable, rows: RowInput[]): Promise<SignedMedicine[]> {
  const out: SignedMedicine[] = [];
  for (const [i, input] of rows.entries()) {
    const r = await resolveRow(db, input);
    let masterSource: string | null = null;
    let masterSourcePage: number | null = null;
    if (r.medicineId) {
      const m = await db.query<{ source: string | null; source_page: number | null }>(
        'SELECT source, source_page FROM medicine_master WHERE id = $1',
        [r.medicineId],
      );
      masterSource = m.rows[0]?.source ?? null;
      masterSourcePage = m.rows[0]?.source_page ?? null;
    }
    out.push({
      position: i,
      medicineId: r.medicineId,
      name: r.name,
      source: r.source,
      strength: r.strength,
      doseForm: r.doseForm,
      dose: r.dose,
      frequency: r.frequency,
      duration: r.duration,
      note: r.note,
      masterSource,
      masterSourcePage,
    });
  }
  return out;
}
