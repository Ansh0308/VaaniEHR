// Loads the parsed NLEM rows into medicine_master as the database OWNER (never as the API role) and writes one audit
// entry, through the same audit-chain code the API uses (appendAudit). Idempotent: running it again with the same rows
// inserts nothing and changes nothing. Review fields are never touched here (they stay NULL; a clinician sets them later).
import type pg from 'pg';
import { appendAudit } from '../audit/audit.js';
import { withTransaction } from '../db/tx.js';
import { NLEM_SOURCE } from './nlemFiles.js';
import type { FormulationRow } from './nlemParser.js';
import { formulationKey } from './normalise.js';

export interface LoadResult {
  inserted: number;
  updated: number;
  unchanged: number;
  /** NLEM rows that are in the database but not in this import (an earlier run read them differently). */
  stale: string[];
  /** How many of those were retired (only when asked; rows are never deleted). */
  retiredStale: number;
  /** Rows an earlier run had retired as stale that this run produces again: they are active again. */
  restored: number;
}

/** Why the importer retires a row. A row an admin retired has no reason and is never restored by an import. */
export const STALE_REASON = 'not in the NLEM import';

const UPSERT = `
INSERT INTO medicine_master
  (generic_name, strength, dose_form, route, therapeutic_category, nlem_year, source, source_page,
   nlem_ref, healthcare_levels, source_notes, also_listed_in)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
ON CONFLICT (lower(generic_name), coalesce(dose_form, ''), coalesce(strength, ''), coalesce(route, ''))
DO UPDATE SET
  therapeutic_category = EXCLUDED.therapeutic_category, nlem_year = EXCLUDED.nlem_year,
  source = EXCLUDED.source, source_page = EXCLUDED.source_page, nlem_ref = EXCLUDED.nlem_ref,
  healthcare_levels = EXCLUDED.healthcare_levels, source_notes = EXCLUDED.source_notes,
  also_listed_in = EXCLUDED.also_listed_in,
  retired_at = CASE WHEN medicine_master.retired_reason = 'not in the NLEM import' THEN NULL ELSE medicine_master.retired_at END,
  retired_reason = CASE WHEN medicine_master.retired_reason = 'not in the NLEM import' THEN NULL ELSE medicine_master.retired_reason END
WHERE medicine_master.retired_reason = 'not in the NLEM import' OR (medicine_master.therapeutic_category, medicine_master.nlem_year, medicine_master.source,
       medicine_master.source_page, medicine_master.nlem_ref, medicine_master.healthcare_levels,
       medicine_master.source_notes, medicine_master.also_listed_in)
  IS DISTINCT FROM
      (EXCLUDED.therapeutic_category, EXCLUDED.nlem_year, EXCLUDED.source, EXCLUDED.source_page,
       EXCLUDED.nlem_ref, EXCLUDED.healthcare_levels, EXCLUDED.source_notes, EXCLUDED.also_listed_in)
RETURNING (xmax = 0) AS inserted`;

export async function loadNlemRows(
  ownerPool: pg.Pool,
  rows: readonly FormulationRow[],
  counts: Record<string, number>,
  options: { retireStale?: boolean } = {},
): Promise<LoadResult> {
  return withTransaction(ownerPool, async (tx) => {
    const result: LoadResult = {
      inserted: 0,
      updated: 0,
      unchanged: 0,
      stale: [],
      retiredStale: 0,
      restored: 0,
    };
    // rows this importer retired earlier: the ones this run produces again come back
    const earlier = await tx.query<{
      generic_name: string;
      dose_form: string | null;
      strength: string | null;
    }>(`SELECT generic_name, dose_form, strength FROM medicine_master WHERE retired_reason = $1`, [
      STALE_REASON,
    ]);
    const comeBack = new Set(
      earlier.rows.map((e) =>
        formulationKey({
          genericName: e.generic_name,
          doseForm: e.dose_form,
          strength: e.strength,
          route: null,
        }),
      ),
    );
    result.restored = rows.filter((r) => comeBack.has(formulationKey(r))).length;
    for (const r of rows) {
      const res = await tx.query<{ inserted: boolean }>(UPSERT, [
        r.genericName,
        r.strength,
        r.doseForm,
        r.route,
        r.therapeuticCategory,
        r.nlemYear,
        NLEM_SOURCE,
        r.sourcePage,
        r.nlemRef,
        r.healthcareLevels,
        r.sourceNotes,
        r.alsoListedIn,
      ]);
      const returned = res.rows[0];
      if (!returned) result.unchanged += 1;
      else if (returned.inserted) result.inserted += 1;
      else result.updated += 1;
    }
    // Rows an earlier run created that this run no longer produces. Admin-added rows (another source) are never touched.
    const current = new Set(rows.map((r) => formulationKey(r)));
    const existing = await tx.query<{
      id: string;
      generic_name: string;
      dose_form: string | null;
      strength: string | null;
    }>(
      `SELECT id, generic_name, dose_form, strength FROM medicine_master
        WHERE source = $1 AND route IS NULL AND retired_at IS NULL`,
      [NLEM_SOURCE],
    );
    const stale = existing.rows.filter(
      (e) =>
        !current.has(
          formulationKey({
            genericName: e.generic_name,
            doseForm: e.dose_form,
            strength: e.strength,
            route: null,
          }),
        ),
    );
    result.stale = stale.map((e) =>
      [e.generic_name, e.dose_form, e.strength].filter(Boolean).join(' | '),
    );
    if (options.retireStale && stale.length > 0) {
      await tx.query(
        'UPDATE medicine_master SET retired_at = now(), retired_reason = $2 WHERE id = ANY($1::uuid[])',
        [stale.map((e) => e.id), STALE_REASON],
      );
      result.retiredStale = stale.length;
    }
    // Counts only: no PDF text, no names (the audit meta guard also refuses personal-looking keys).
    await appendAudit(tx, {
      action: 'MEDICINE_IMPORTED',
      resourceType: 'medicine_master',
      resourceId: 'nlem2022',
      meta: {
        ...counts,
        inserted: result.inserted,
        updated: result.updated,
        unchanged: result.unchanged,
        staleRows: result.stale.length,
        retiredStale: result.retiredStale,
        restoredRows: result.restored,
      },
    });
    return result;
  });
}
