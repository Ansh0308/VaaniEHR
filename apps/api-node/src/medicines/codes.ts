// TODO(source): OCI-002 - the codes themselves come from a licensed release the owner supplies; none is bundled.
// Maps SNOMED CT and ATC codes onto medicine_master from a file the OWNER supplies (a licensed release). Nothing here
// invents a code: a row without a licence note is refused, and a code that does not look like a code is refused.
//
// File columns (header row required): generic_name, licence_note, snomed_code and/or atc_code, and optionally dose_form,
// strength, route. If dose_form AND strength are both blank, the codes go to EVERY formulation of that generic (ATC is
// per substance); if either is given, the row must match exactly one formulation or it is reported and skipped.
import type pg from 'pg';
import { appendAudit } from '../audit/audit.js';
import { withTransaction } from '../db/tx.js';
import { readCsvObjects } from './nlemFiles.js';

export interface CodeRow {
  line: number;
  genericName: string;
  doseForm: string | null;
  strength: string | null;
  route: string | null;
  snomedCode: string | null;
  atcCode: string | null;
}

const SNOMED = /^\d{6,18}$/;
const ATC = /^[A-Z](?:\d{2}(?:[A-Z](?:[A-Z](?:\d{2})?)?)?)?$/;

export function parseCodesCsv(text: string): { rows: CodeRow[]; errors: string[] } {
  const errors: string[] = [];
  const rows: CodeRow[] = [];
  const records = readCsvObjects(text);
  if (records.length === 0) return { rows, errors: ['the file has no data rows'] };
  const first = records[0] ?? {};
  for (const needed of ['generic_name', 'licence_note'])
    if (!(needed in first)) errors.push(`missing column: ${needed}`);
  if (!('snomed_code' in first) && !('atc_code' in first))
    errors.push('needs a snomed_code and/or an atc_code column');
  if (errors.length > 0) return { rows, errors };

  records.forEach((r, i) => {
    const line = i + 2;
    const name = (r.generic_name ?? '').trim();
    const snomed = (r.snomed_code ?? '').trim();
    const atc = (r.atc_code ?? '').trim().toUpperCase();
    if (name === '') return void errors.push(`line ${line}: generic_name is empty`);
    if ((r.licence_note ?? '').trim() === '')
      return void errors.push(
        `line ${line}: licence_note is empty (every row needs the licence it comes from)`,
      );
    if (snomed === '' && atc === '') return void errors.push(`line ${line}: no code on this row`);
    if (snomed !== '' && !SNOMED.test(snomed))
      return void errors.push(`line ${line}: snomed_code is not 6-18 digits`);
    if (atc !== '' && !ATC.test(atc))
      return void errors.push(`line ${line}: atc_code does not look like an ATC code`);
    rows.push({
      line,
      genericName: name,
      doseForm: (r.dose_form ?? '').trim() || null,
      strength: (r.strength ?? '').trim() || null,
      route: (r.route ?? '').trim() || null,
      snomedCode: snomed || null,
      atcCode: atc || null,
    });
  });
  return { rows, errors };
}

export interface CodesResult {
  matchedRows: number;
  unmatchedRows: number;
  ambiguousRows: number;
  updatedMedicines: number;
  unchangedMedicines: number;
  problems: string[];
}

/** With apply=false nothing is written (a dry run reports what would happen). */
export async function applyCodes(
  ownerPool: pg.Pool,
  rows: readonly CodeRow[],
  apply: boolean,
): Promise<CodesResult> {
  return withTransaction(ownerPool, async (tx) => {
    const result: CodesResult = {
      matchedRows: 0,
      unmatchedRows: 0,
      ambiguousRows: 0,
      updatedMedicines: 0,
      unchangedMedicines: 0,
      problems: [],
    };
    for (const r of rows) {
      const found = await tx.query<{ id: string }>(
        `SELECT id FROM medicine_master
          WHERE lower(generic_name) = lower($1)
            AND ($2::text IS NULL OR dose_form = $2)
            AND ($3::text IS NULL OR strength = $3)
            AND ($4::text IS NULL OR route = $4)`,
        [r.genericName, r.doseForm, r.strength, r.route],
      );
      const narrowed = r.doseForm !== null || r.strength !== null;
      if (found.rows.length === 0) {
        result.unmatchedRows += 1;
        result.problems.push(`line ${r.line}: no medicine matches "${r.genericName}"`);
        continue;
      }
      if (narrowed && found.rows.length > 1) {
        result.ambiguousRows += 1;
        result.problems.push(
          `line ${r.line}: "${r.genericName}" matches ${found.rows.length} formulations; add dose_form and strength`,
        );
        continue;
      }
      result.matchedRows += 1;
      for (const m of found.rows) {
        const res = await tx.query(
          `UPDATE medicine_master
              SET snomed_code = coalesce($2, snomed_code), atc_code = coalesce($3, atc_code)
            WHERE id = $1
              AND (snomed_code, atc_code) IS DISTINCT FROM (coalesce($2, snomed_code), coalesce($3, atc_code))`,
          [m.id, r.snomedCode, r.atcCode],
        );
        if ((res.rowCount ?? 0) > 0) result.updatedMedicines += 1;
        else result.unchangedMedicines += 1;
      }
    }
    if (!apply) throw new DryRun(result);
    await appendAudit(tx, {
      action: 'MEDICINE_CODES_LOADED',
      resourceType: 'medicine_master',
      resourceId: 'codes',
      meta: {
        fileRows: rows.length,
        matchedRows: result.matchedRows,
        unmatchedRows: result.unmatchedRows,
        ambiguousRows: result.ambiguousRows,
        updatedMedicines: result.updatedMedicines,
      },
    });
    return result;
  }).catch((err: unknown) => {
    if (err instanceof DryRun) return err.result; // the transaction was rolled back: a dry run changes nothing
    throw err;
  });
}

class DryRun extends Error {
  constructor(public readonly result: CodesResult) {
    super('dry run');
  }
}
