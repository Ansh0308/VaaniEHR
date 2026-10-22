// Prescription rows (PG-08, Phase 8 Run 1). The doctor adds medicines from the medicine master (generic first, source kept)
// or, as a clearly flagged fallback, free text ("Not in master list"). Nothing here suggests, checks or guides a dose:
// every value on a row is what the doctor typed or what the master/template already holds. Rows are editable until the
// visit is signed (a database trigger refuses changes after that).
import { z } from 'zod';
import type { Queryable } from '../db/tx.js';
import { errors } from '../http/errors.js';
import { FREQUENCY_CODES } from '../templates/frequency.js';
import type { SignedMedicine } from '../visits/repository.js';

export const rowView = z.object({
  id: z.uuid(),
  position: z.number(),
  medicineId: z.uuid().nullable(),
  name: z.string(),
  /** 'free_text' = typed by hand because the medicine is not in the master list: flagged on the row */
  source: z.enum(['master', 'free_text']),
  strength: z.string().nullable(),
  doseForm: z.string().nullable(),
  dose: z.string().nullable(),
  frequency: z.enum(FREQUENCY_CODES).nullable(),
  duration: z.string().nullable(),
  note: z.string().nullable(),
  fromTemplateId: z.uuid().nullable(),
  /** where the master row comes from (NLEM edition and page); null for a free-text row */
  masterSource: z.string().nullable(),
  masterSourcePage: z.number().nullable(),
  masterReviewStatus: z.enum(['reviewed', 'not_reviewed']).nullable(),
  /** a required field is still empty (a template row without frequency or duration): the visit cannot be signed */
  incomplete: z.boolean(),
});
export type RowView = z.infer<typeof rowView>;

const text = (max: number) => z.string().trim().max(max);
export const rowInput = z
  .object({
    /** a master row's id, or null for the "Not in master list" fallback */
    medicineId: z.uuid().nullable(),
    /** needed for free text; for a master row the master's generic name is used */
    name: text(200).optional(),
    strength: text(100).nullable().optional(),
    doseForm: text(100).nullable().optional(),
    dose: text(100).nullable().optional(),
    frequency: z.enum(FREQUENCY_CODES),
    duration: text(50).min(1),
    note: text(500).nullable().optional(),
  })
  .strict();
export type RowInput = z.infer<typeof rowInput>;

export const rowPatch = z
  .object({
    name: text(200).min(1).optional(),
    strength: text(100).nullable().optional(),
    doseForm: text(100).nullable().optional(),
    dose: text(100).nullable().optional(),
    frequency: z.enum(FREQUENCY_CODES).optional(),
    duration: text(50).min(1).optional(),
    note: text(500).nullable().optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'nothing to change');
export type RowPatch = z.infer<typeof rowPatch>;

interface DbRow {
  id: string;
  position: number;
  medicine_id: string | null;
  name: string;
  source: 'master' | 'free_text';
  strength: string | null;
  dose_form: string | null;
  dose: string | null;
  frequency: (typeof FREQUENCY_CODES)[number] | null;
  duration: string | null;
  note: string | null;
  from_template_id: string | null;
  m_source: string | null;
  m_source_page: number | null;
  m_reviewed_on: Date | string | null;
}

const blank = (v: string | null | undefined): string | null => (v && v.trim() ? v.trim() : null);

const toView = (r: DbRow): RowView => ({
  id: r.id,
  position: r.position,
  medicineId: r.medicine_id,
  name: r.name,
  source: r.source,
  strength: r.strength,
  doseForm: r.dose_form,
  dose: r.dose,
  frequency: r.frequency,
  duration: r.duration,
  note: r.note,
  fromTemplateId: r.from_template_id,
  masterSource: r.m_source,
  masterSourcePage: r.m_source_page,
  masterReviewStatus:
    r.source === 'master' ? (r.m_reviewed_on === null ? 'not_reviewed' : 'reviewed') : null,
  incomplete: !r.frequency || !r.duration,
});

const SELECT = `SELECT p.id, p.position, p.medicine_id, p.name, p.source, p.strength, p.dose_form, p.dose, p.frequency,
       p.duration, p.note, p.from_template_id, m.source AS m_source, m.source_page AS m_source_page,
       m.reviewed_on AS m_reviewed_on
  FROM prescription_item p LEFT JOIN medicine_master m ON m.id = p.medicine_id`;

export async function listRows(db: Queryable, sessionId: string): Promise<RowView[]> {
  const r = await db.query<DbRow>(
    `${SELECT} WHERE p.session_id = $1 ORDER BY p.position, p.created_at`,
    [sessionId],
  );
  return r.rows.map(toView);
}

export async function oneRow(
  db: Queryable,
  sessionId: string,
  id: string,
): Promise<RowView | null> {
  const r = await db.query<DbRow>(`${SELECT} WHERE p.session_id = $1 AND p.id = $2`, [
    sessionId,
    id,
  ]);
  return r.rows[0] ? toView(r.rows[0]) : null;
}

interface MasterRow {
  id: string;
  generic_name: string;
  strength: string | null;
  dose_form: string | null;
  retired_at: Date | null;
}
export async function masterRow(db: Queryable, id: string): Promise<MasterRow | null> {
  const r = await db.query<MasterRow>(
    'SELECT id, generic_name, strength, dose_form, retired_at FROM medicine_master WHERE id = $1',
    [id],
  );
  return r.rows[0] ?? null;
}

export interface ResolvedRow {
  medicineId: string | null;
  name: string;
  source: 'master' | 'free_text';
  strength: string | null;
  doseForm: string | null;
  dose: string | null;
  frequency: (typeof FREQUENCY_CODES)[number];
  duration: string;
  note: string | null;
}

/** Validates one row and fills in what the master holds. Used by add, amend and the sign-time check. */
export async function resolveRow(db: Queryable, input: RowInput): Promise<ResolvedRow> {
  if (input.medicineId !== null) {
    const m = await masterRow(db, input.medicineId);
    if (!m) throw errors.validation('That medicine is not in the master list');
    if (m.retired_at) throw errors.validation('That medicine is retired and cannot be added');
    return {
      medicineId: m.id,
      name: m.generic_name,
      source: 'master',
      // a value the doctor did not send comes from the master; a value they sent (even blank) is theirs
      strength: input.strength === undefined ? m.strength : blank(input.strength),
      doseForm: input.doseForm === undefined ? m.dose_form : blank(input.doseForm),
      dose: blank(input.dose),
      frequency: input.frequency,
      duration: input.duration.trim(),
      note: blank(input.note),
    };
  }
  const name = blank(input.name);
  if (!name) throw errors.validation('A medicine that is not in the master list needs a name');
  return {
    medicineId: null,
    name,
    source: 'free_text',
    strength: blank(input.strength),
    doseForm: blank(input.doseForm),
    dose: blank(input.dose),
    frequency: input.frequency,
    duration: input.duration.trim(),
    note: blank(input.note),
  };
}

export async function nextPosition(db: Queryable, sessionId: string): Promise<number> {
  const r = await db.query<{ n: number }>(
    'SELECT coalesce(max(position) + 1, 0)::int AS n FROM prescription_item WHERE session_id = $1',
    [sessionId],
  );
  return r.rows[0]?.n ?? 0;
}

export async function insertRow(
  db: Queryable,
  args: {
    sessionId: string;
    clinicId: string;
    doctorId: string;
    row: ResolvedRow;
    fromTemplateId?: string | null;
    incompleteOk?: boolean;
  },
): Promise<string> {
  const r = args.row;
  const position = await nextPosition(db, args.sessionId);
  const inserted = await db.query<{ id: string }>(
    `INSERT INTO prescription_item (session_id, clinic_id, position, medicine_id, name, source, strength, dose_form,
       dose, frequency, duration, note, from_template_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
    [
      args.sessionId,
      args.clinicId,
      position,
      r.medicineId,
      r.name,
      r.source,
      r.strength,
      r.doseForm,
      r.dose,
      r.frequency,
      r.duration,
      r.note,
      args.fromTemplateId ?? null,
      args.doctorId,
    ],
  );
  return inserted.rows[0]?.id as string;
}

/** The rows as they are signed: the master's source is copied in so the record stands on its own. */
export function toSignedMedicines(rows: RowView[]): SignedMedicine[] {
  return rows.map((r, i) => ({
    position: i,
    medicineId: r.medicineId,
    name: r.name,
    source: r.source,
    strength: r.strength,
    doseForm: r.doseForm,
    dose: r.dose,
    frequency: r.frequency as string,
    duration: r.duration as string,
    note: r.note,
    masterSource: r.masterSource,
    masterSourcePage: r.masterSourcePage,
  }));
}
