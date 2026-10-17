// Manual transcriptions of NLEM rows the importer would not trust (held rows, and rows it read wrongly).
// The file is data/medicines/nlem2022.overrides.csv: PRIVATE, because it holds text from the NLEM PDF and its reuse terms
// are not yet checked (ADR-D18). It is read by the importer only if it exists, and it is never created by a script.
//
// Rules:
//  - every row names its item number, its PDF page and a note that contains "manually transcribed, confirmed by owner";
//  - any item number that has override rows has ALL of its parsed rows replaced by them (so a wrongly read row cannot
//    survive next to its correction);
//  - route, SNOMED, ATC and review columns do not exist here and are refused (they are never set by an import).
import { readCsvObjects } from './nlemFiles.js';
import type { FormulationRow } from './nlemParser.js';

export const OVERRIDE_NOTE_PHRASE = 'manually transcribed, confirmed by owner';
export const OVERRIDE_COLUMNS = [
  'generic_name',
  'dose_form',
  'strength',
  'healthcare_levels',
  'therapeutic_category',
  'nlem_ref',
  'source_page',
  'note',
] as const;
const FORBIDDEN_COLUMNS = ['route', 'snomed_code', 'atc_code', 'reviewed_on', 'reviewed_by'];

export interface OverrideRow {
  line: number;
  genericName: string;
  doseForm: string | null;
  strength: string | null;
  healthcareLevels: string | null;
  therapeuticCategory: string | null;
  nlemRef: string;
  sourcePage: number;
  note: string;
}

export function parseOverridesCsv(text: string): { rows: OverrideRow[]; errors: string[] } {
  const errors: string[] = [];
  const rows: OverrideRow[] = [];
  const records = readCsvObjects(text);
  if (records.length === 0) return { rows, errors: [] };
  const first = records[0] ?? {};
  for (const c of FORBIDDEN_COLUMNS)
    if (c in first) errors.push(`column "${c}" is not allowed here (an import never sets it)`);
  for (const c of ['generic_name', 'nlem_ref', 'source_page', 'note'])
    if (!(c in first)) errors.push(`missing column: ${c}`);
  if (errors.length > 0) return { rows, errors };

  records.forEach((r, i) => {
    const line = i + 2;
    const name = (r.generic_name ?? '').trim();
    const ref = (r.nlem_ref ?? '').trim();
    const page = Number.parseInt((r.source_page ?? '').trim(), 10);
    const note = (r.note ?? '').trim();
    if (name === '') return void errors.push(`line ${line}: generic_name is empty`);
    if (!/^\d{1,2}(?:\.\d{1,3}){1,4}$/.test(ref))
      return void errors.push(
        `line ${line}: nlem_ref "${ref}" is not an item number such as 6.5.1`,
      );
    if (!Number.isInteger(page) || page < 1)
      return void errors.push(`line ${line}: source_page is not a page number`);
    if (!note.toLowerCase().includes(OVERRIDE_NOTE_PHRASE))
      return void errors.push(`line ${line}: note must say "${OVERRIDE_NOTE_PHRASE}"`);
    rows.push({
      line,
      genericName: name,
      doseForm: (r.dose_form ?? '').trim() || null,
      strength: (r.strength ?? '').trim() || null,
      healthcareLevels: (r.healthcare_levels ?? '').trim() || null,
      therapeuticCategory: (r.therapeutic_category ?? '').trim() || null,
      nlemRef: ref,
      sourcePage: page,
      note,
    });
  });
  return { rows, errors };
}

export interface OverrideResult {
  rows: FormulationRow[];
  /** Item numbers whose parsed rows were replaced (or added, when the importer had held them). */
  items: string[];
  replacedRows: number;
  addedRows: number;
}

/** Replaces every parsed row of an overridden item with the transcribed rows. */
export function applyOverrides(
  parsed: readonly FormulationRow[],
  overrides: readonly OverrideRow[],
  categoryOf: (page: number, ref: string) => string | null,
  nlemYear: number,
): OverrideResult {
  const items = new Set(overrides.map((o) => `${o.sourcePage}|${o.nlemRef}`));
  const kept = parsed.filter((r) => !items.has(`${r.sourcePage}|${r.nlemRef}`));
  const replacedRows = parsed.length - kept.length;
  const added: FormulationRow[] = overrides.map((o) => ({
    genericName: o.genericName,
    doseForm: o.doseForm,
    strength: o.strength,
    route: null,
    therapeuticCategory: o.therapeuticCategory ?? categoryOf(o.sourcePage, o.nlemRef),
    nlemYear,
    nlemRef: o.nlemRef,
    healthcareLevels: o.healthcareLevels,
    sourcePage: o.sourcePage,
    sourceNotes: o.note,
    alsoListedIn: [],
  }));
  return {
    rows: [...kept, ...added],
    items: [...items].map((k) => k.split('|')[1] ?? k),
    replacedRows,
    addedRows: added.length,
  };
}
