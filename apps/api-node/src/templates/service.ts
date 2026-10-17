// Prescription templates: queries, the visibility and edit rules, and the views (FR-F5-04).
// Rules (ADR-D24):
//  - every query is limited to the caller's clinic;
//  - a PERSONAL template is visible only to its owner (anyone else gets "not found", so its existence is not revealed);
//  - a CLINIC-WIDE template is visible to the whole clinic's doctors and admins;
//  - it may be edited or retired by its owner, or by an admin when it is clinic-wide; only the owner can change who can see it;
//  - a template cannot gain a retired medicine; an item whose medicine was retired LATER stays, and is flagged when
//    the template is loaded (it is never dropped or replaced silently).
import type { QueryResultRow } from 'pg';
import type { AuthContext } from '../auth/types.js';
import type { ClinicOSAdapter } from '../clinicos/ClinicOSAdapter.js';
import type { Queryable } from '../db/tx.js';
import { errors } from '../http/errors.js';
import type { FrequencyCode } from './frequency.js';

export type Visibility = 'personal' | 'clinic';

export interface TemplateRow extends QueryResultRow {
  id: string;
  name: string;
  owner_user_id: string;
  clinic_id: string;
  visibility: Visibility;
  retired_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface ItemRow extends QueryResultRow {
  id: string;
  position: number;
  medicine_id: string;
  dose: string | null;
  frequency: FrequencyCode | null;
  duration: string | null;
  instructions: string | null;
  generic_name: string;
  strength: string | null;
  dose_form: string | null;
  route: string | null;
  source: string;
  source_page: number | null;
  reviewed_on: Date | string | null;
  medicine_retired_at: Date | null;
}

export interface MedicineBrief {
  id: string;
  genericName: string;
  strength: string | null;
  doseForm: string | null;
  route: string | null;
  source: string;
  sourcePage: number | null;
  sourcePagePrinted: number | null;
  reviewStatus: 'reviewed' | 'not_reviewed';
  retired: boolean;
}

export interface TemplateItemView {
  id: string;
  position: number;
  medicine: MedicineBrief;
  dose: string | null;
  frequency: FrequencyCode | null;
  duration: string | null;
  instructions: string | null;
  /** The medicine was retired after it was added: the item is kept, and flagged. */
  medicineRetired: boolean;
}

export const clinicOf = (auth: AuthContext): string => {
  if (!auth.clinicId) throw errors.forbidden('This account has no clinic');
  return auth.clinicId;
};

const iso = (d: Date | string): string => (d instanceof Date ? d.toISOString() : String(d));

/** The visibility rule as SQL: $1 = clinic id, $2 = user id (the caller). */
export const VISIBLE_SQL = `t.clinic_id = $1 AND (t.visibility = 'clinic' OR t.owner_user_id = $2)`;

export function canEdit(row: TemplateRow, auth: AuthContext): boolean {
  if (row.owner_user_id === auth.sub) return true;
  return auth.role === 'admin' && row.visibility === 'clinic';
}

/** A template the caller may see, or null (not found, in another clinic, or somebody else's personal one). */
export async function visibleTemplate(
  db: Queryable,
  auth: AuthContext,
  id: string,
): Promise<TemplateRow | null> {
  const r = await db.query<TemplateRow>(
    `SELECT t.* FROM med_template t WHERE t.id = $3 AND ${VISIBLE_SQL}`,
    [clinicOf(auth), auth.sub, id],
  );
  return r.rows[0] ?? null;
}

export function mustEdit(row: TemplateRow, auth: AuthContext): void {
  if (!canEdit(row, auth)) throw errors.forbidden('You cannot change this template');
}

async function ownerNames(
  directory: ClinicOSAdapter,
  clinicId: string,
  ids: string[],
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  for (const id of new Set(ids)) {
    const user = await directory.getUser(id);
    out.set(id, user && user.clinicId === clinicId ? user.name : null);
  }
  return out;
}

export async function toSummaries(
  db: Queryable,
  directory: ClinicOSAdapter,
  auth: AuthContext,
  rows: Array<TemplateRow & { item_count: number }>,
) {
  const names = await ownerNames(
    directory,
    clinicOf(auth),
    rows.map((r) => r.owner_user_id),
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    visibility: r.visibility,
    ownerId: r.owner_user_id,
    ownerName: names.get(r.owner_user_id) ?? null,
    ownedByMe: r.owner_user_id === auth.sub,
    itemCount: Number(r.item_count),
    retired: r.retired_at !== null,
    updatedAt: iso(r.updated_at),
    canEdit: canEdit(r, auth),
  }));
}

export async function itemsOf(db: Queryable, templateId: string): Promise<TemplateItemView[]> {
  const r = await db.query<ItemRow>(
    `SELECT i.id, i.position, i.medicine_id, i.dose, i.frequency, i.duration, i.instructions,
            m.generic_name, m.strength, m.dose_form, m.route, m.source, m.source_page, m.reviewed_on,
            m.retired_at AS medicine_retired_at
       FROM med_template_item i JOIN medicine_master m ON m.id = i.medicine_id
      WHERE i.template_id = $1 ORDER BY i.position`,
    [templateId],
  );
  return r.rows.map((i) => ({
    id: i.id,
    position: i.position,
    medicine: {
      id: i.medicine_id,
      genericName: i.generic_name,
      strength: i.strength,
      doseForm: i.dose_form,
      route: i.route,
      source: i.source,
      sourcePage: i.source_page,
      sourcePagePrinted: i.source_page === null ? null : i.source_page - 1,
      reviewStatus: i.reviewed_on === null ? 'not_reviewed' : 'reviewed',
      retired: i.medicine_retired_at !== null,
    },
    dose: i.dose,
    frequency: i.frequency,
    duration: i.duration,
    instructions: i.instructions,
    medicineRetired: i.medicine_retired_at !== null,
  }));
}

export async function templateDetail(
  db: Queryable,
  directory: ClinicOSAdapter,
  auth: AuthContext,
  row: TemplateRow,
) {
  const [summary] = await toSummaries(db, directory, auth, [{ ...row, item_count: 0 }]);
  const items = await itemsOf(db, row.id);
  if (!summary) throw new Error('template summary missing');
  return { ...summary, itemCount: items.length, items };
}

/** Checks the medicine ids of a template body: they exist, and none is retired unless it was already in the template. */
export async function checkMedicines(
  db: Queryable,
  medicineIds: string[],
  alreadyInTemplate: ReadonlySet<string>,
): Promise<void> {
  const ids = [...new Set(medicineIds)];
  const r = await db.query<{ id: string; retired_at: Date | null }>(
    'SELECT id, retired_at FROM medicine_master WHERE id = ANY($1::uuid[])',
    [ids],
  );
  const found = new Map(r.rows.map((m) => [m.id, m.retired_at !== null]));
  for (const id of ids) {
    if (!found.has(id)) throw errors.validation('A medicine in the list does not exist');
    if (found.get(id) && !alreadyInTemplate.has(id))
      throw errors.validation('A retired medicine cannot be added to a template');
  }
}

export interface ItemInput {
  medicineId: string;
  dose?: string | null | undefined;
  frequency?: FrequencyCode | null | undefined;
  duration?: string | null | undefined;
  instructions?: string | null | undefined;
}

/** Replaces the items of a template (inside the caller's transaction). */
export async function replaceItems(
  db: Queryable,
  templateId: string,
  items: ItemInput[],
): Promise<void> {
  await db.query('DELETE FROM med_template_item WHERE template_id = $1', [templateId]);
  await db.query(
    `INSERT INTO med_template_item (template_id, medicine_id, position, dose, frequency, duration, instructions)
     SELECT $1, * FROM unnest($2::uuid[], $3::int[], $4::text[], $5::text[], $6::text[], $7::text[])`,
    [
      templateId,
      items.map((i) => i.medicineId),
      items.map((_, index) => index),
      items.map((i) => i.dose ?? null),
      items.map((i) => i.frequency ?? null),
      items.map((i) => i.duration ?? null),
      items.map((i) => i.instructions ?? null),
    ],
  );
}

/** The items as the thing that is compared to see what changed (positions are the order). */
export const itemsSignature = (items: Array<Omit<ItemInput, never>>): string =>
  JSON.stringify(
    items.map((i) => [
      i.medicineId,
      i.dose ?? null,
      i.frequency ?? null,
      i.duration ?? null,
      i.instructions ?? null,
    ]),
  );
