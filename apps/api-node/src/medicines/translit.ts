// Gujarati search mapping (FR-F5-03): "gu_text" (how a person types the name in Gujarati) -> "latin_text" (the generic or
// brand name in English). The live table medicine_translit_gu stays EMPTY until a Gujarati reviewer has approved a list.
// This loader REFUSES every row that does not name its reviewer and review date, so an unreviewed machine draft can never
// reach the live search table by accident. Dry run unless apply=true.
import type pg from 'pg';
import { appendAudit } from '../audit/audit.js';
import { withTransaction } from '../db/tx.js';
import { readCsvObjects } from './nlemFiles.js';

export interface TranslitRow {
  line: number;
  guText: string;
  latinText: string;
  source: string;
  reviewedBy: string;
  reviewedOn: string;
}

const GUJARATI = /[઀-૿]/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseTranslitCsv(text: string): { rows: TranslitRow[]; errors: string[] } {
  const errors: string[] = [];
  const rows: TranslitRow[] = [];
  const records = readCsvObjects(text);
  if (records.length === 0) return { rows, errors: ['the file has no data rows'] };
  const first = records[0] ?? {};
  for (const needed of ['gu_text', 'latin_text', 'source', 'reviewed_by', 'reviewed_on'])
    if (!(needed in first)) errors.push(`missing column: ${needed}`);
  if (errors.length > 0) return { rows, errors };
  records.forEach((r, i) => {
    const line = i + 2;
    const row = {
      line,
      guText: (r.gu_text ?? '').trim(),
      latinText: (r.latin_text ?? '').trim(),
      source: (r.source ?? '').trim(),
      reviewedBy: (r.reviewed_by ?? '').trim(),
      reviewedOn: (r.reviewed_on ?? '').trim(),
    };
    if (!GUJARATI.test(row.guText))
      return void errors.push(`line ${line}: gu_text has no Gujarati letters`);
    if (row.latinText === '') return void errors.push(`line ${line}: latin_text is empty`);
    if (row.source === '') return void errors.push(`line ${line}: source is empty`);
    if (row.reviewedBy === '' || !ISO_DATE.test(row.reviewedOn))
      return void errors.push(
        `line ${line}: not approved (reviewed_by and a YYYY-MM-DD reviewed_on are required)`,
      );
    rows.push(row);
  });
  return { rows, errors };
}

export interface TranslitResult {
  inserted: number;
  alreadyThere: number;
}

class DryRun extends Error {
  constructor(public readonly result: TranslitResult) {
    super('dry run');
  }
}

export async function applyTranslit(
  ownerPool: pg.Pool,
  rows: readonly TranslitRow[],
  apply: boolean,
): Promise<TranslitResult> {
  return withTransaction(ownerPool, async (tx) => {
    const result: TranslitResult = { inserted: 0, alreadyThere: 0 };
    for (const r of rows) {
      const res = await tx.query(
        `INSERT INTO medicine_translit_gu (gu_text, latin_text, source, reviewed_by, reviewed_on)
         VALUES ($1, lower($2), $3, $4, $5) ON CONFLICT (gu_text, latin_text) DO NOTHING`,
        [r.guText, r.latinText, r.source, r.reviewedBy, r.reviewedOn],
      );
      if ((res.rowCount ?? 0) > 0) result.inserted += 1;
      else result.alreadyThere += 1;
    }
    if (!apply) throw new DryRun(result);
    await appendAudit(tx, {
      action: 'MEDICINE_TRANSLIT_LOADED',
      resourceType: 'medicine_translit_gu',
      resourceId: 'approved-list',
      meta: { fileRows: rows.length, inserted: result.inserted, alreadyThere: result.alreadyThere },
    });
    return result;
  }).catch((err: unknown) => {
    if (err instanceof DryRun) return err.result; // rolled back: a dry run changes nothing
    throw err;
  });
}
