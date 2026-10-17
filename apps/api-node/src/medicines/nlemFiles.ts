// CSV files of the NLEM import (data/medicines/*, git-ignored: ADR-D18), their reader, and the diff between two runs.
import { neutraliseFormula, toCsv } from '../audit/csv.js';
import { HOLD_REASONS, type FormulationRow, type Rejected, type ReviewItem } from './nlemParser.js';
import { formulationKey } from './normalise.js';

/** Where every NLEM-derived row says it came from. The page number is a separate column. */
export const NLEM_SOURCE = 'NLEM 2022 (Government of India)';

export const MEDICINE_COLUMNS = [
  'generic_name',
  'strength',
  'dose_form',
  'route',
  'therapeutic_category',
  'nlem_year',
  'snomed_code',
  'atc_code',
  'source',
  'source_page',
  'nlem_ref',
  'healthcare_levels',
  'source_notes',
  'also_listed_in',
  'reviewed_on',
  'reviewed_by',
] as const;

/** The main CSV. snomed_code, atc_code, reviewed_on and reviewed_by are always empty here (Phase 3A rules). */
export function medicinesToCsv(rows: readonly FormulationRow[]): string {
  const table = rows.map((r) => [
    r.genericName,
    r.strength,
    r.doseForm,
    r.route,
    r.therapeuticCategory,
    r.nlemYear,
    null,
    null,
    NLEM_SOURCE,
    r.sourcePage,
    r.nlemRef,
    r.healthcareLevels,
    r.sourceNotes,
    r.alsoListedIn.join('; '),
    null,
    null,
  ]);
  // The spreadsheet-safety prefix would silently change a value, so a value that would need it stops the run instead.
  for (const row of table)
    for (const cell of row)
      if (typeof cell === 'string' && neutraliseFormula(cell) !== cell)
        throw new Error(
          `a value starts with a formula character and cannot be written safely: "${cell}"`,
        );
  return toCsv(MEDICINE_COLUMNS, table);
}

export function reviewToCsv(review: readonly ReviewItem[]): string {
  return toCsv(
    ['page', 'item_number', 'generic_name', 'status', 'reasons', 'text_as_extracted'],
    review.map((r) => [
      r.page,
      r.ref,
      r.name,
      r.held
        ? 'HELD (not loaded)'
        : r.resolvedBy === 'override'
          ? 'resolved: manually transcribed'
          : 'loaded with a note',
      r.reasons.join('; '),
      r.rawText,
    ]),
  );
}

export function rejectedToCsv(rejected: readonly Rejected[]): string {
  return toCsv(
    ['page', 'item_number', 'reason', 'text'],
    rejected.map((r) => [r.page, r.ref, r.reason, r.rawText]),
  );
}

export function genericsToCsv(entries: ReadonlyArray<{ name: string; refs: string[] }>): string {
  return toCsv(
    ['generic_name', 'listings', 'item_numbers'],
    entries.map((e) => [e.name, e.refs.length, e.refs.join('; ')]),
  );
}

export function isHeld(item: ReviewItem): boolean {
  return item.reasons.some((r) => HOLD_REASONS.has(r));
}

/** RFC 4180 reader: quoted cells, doubled quotes, CRLF or LF. Returns rows of cells (the header is the first row). */
export function readCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const body = text.startsWith('﻿') ? text.slice(1) : text;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i] as string;
    if (quoted) {
      if (ch === '"' && body[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && body[i + 1] === '\n') i += 1;
      row.push(cell);
      cell = '';
      rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

/** CSV text -> objects keyed by the header names. */
export function readCsvObjects(text: string): Array<Record<string, string>> {
  const [header, ...rows] = readCsv(text);
  if (!header) return [];
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

export interface RunDiff {
  added: string[];
  removed: string[];
  changed: string[];
}

const keyOfRecord = (r: Record<string, string>) =>
  formulationKey({
    genericName: r.generic_name ?? '',
    doseForm: r.dose_form || null,
    strength: r.strength || null,
    route: r.route || null,
  });

const label = (r: Record<string, string>) =>
  [r.generic_name, r.dose_form, r.strength].filter(Boolean).join(' | ');

/** Compares the previous run's CSV with this run's CSV by formulation key. Empty arrays mean "no difference". */
export function diffRuns(previousCsv: string, currentCsv: string): RunDiff {
  const previous = new Map(readCsvObjects(previousCsv).map((r) => [keyOfRecord(r), r]));
  const current = new Map(readCsvObjects(currentCsv).map((r) => [keyOfRecord(r), r]));
  const diff: RunDiff = { added: [], removed: [], changed: [] };
  for (const [key, row] of current) {
    const old = previous.get(key);
    if (!old) diff.added.push(label(row));
    else if (MEDICINE_COLUMNS.some((c) => (old[c] ?? '') !== (row[c] ?? '')))
      diff.changed.push(label(row));
  }
  for (const [key, row] of previous) if (!current.has(key)) diff.removed.push(label(row));
  return diff;
}
