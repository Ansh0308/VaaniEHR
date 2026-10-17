// The importer's printed report. Pure text building, so a test can check what it says.
import type { RunDiff } from './nlemFiles.js';
import type { LoadResult } from './nlemLoad.js';
import type { ParseResult } from './nlemParser.js';
import { distinctKey, looseKey } from './normalise.js';

export interface ReportInput {
  pdfFile: string;
  pdfPages: number;
  result: ParseResult;
  /** null on the first run (no previous CSV to compare with). */
  diff: RunDiff | null;
  /** null for a dry run (nothing was written to the database). */
  load: LoadResult | null;
  files: string[];
  /** Distinct generic names of the rows actually loaded (after manual transcriptions). */
  finalNames?: string[];
}

const dots = (label: string, value: number | string, width = 60) =>
  `  ${label} ${'.'.repeat(Math.max(2, width - label.length))} ${value}`;

export interface Reconciliation {
  /** Names in the publication's alphabetical list that no table entry matches. */
  onlyInAlphabetical: string[];
  /** Distinct names found in the tables that the alphabetical list does not have. */
  onlyInTables: string[];
  matched: number;
}

/** Compares the distinct names from the tables with the numbered alphabetical list (letters and digits only, any case). */
export function reconcile(
  tableNames: readonly string[],
  alphabetical: ReadonlyArray<{ no: number; name: string }>,
): Reconciliation {
  const table = new Map<string, string>();
  for (const name of tableNames) table.set(looseKey(name), name);
  const alpha = new Map<string, string>();
  for (const a of alphabetical) alpha.set(looseKey(a.name), `${a.no}. ${a.name}`);
  return {
    onlyInAlphabetical: [...alpha].filter(([k]) => !table.has(k)).map(([, v]) => v),
    onlyInTables: [...table].filter(([k]) => !alpha.has(k)).map(([, v]) => v),
    matched: [...table.keys()].filter((k) => alpha.has(k)).length,
  };
}

function sample(list: readonly string[], n = 8): string {
  return list.length === 0
    ? 'none'
    : `${list.slice(0, n).join('; ')}${list.length > n ? `; ... (${list.length - n} more)` : ''}`;
}

export function formatReport(input: ReportInput): string {
  const { result: r, diff, load } = input;
  const s = r.stats;
  const out: string[] = [];
  const heldByReason = new Map<string, number>();
  for (const item of r.review)
    if (item.held)
      for (const reason of item.reasons)
        heldByReason.set(reason, (heldByReason.get(reason) ?? 0) + 1);
  const rejectedByReason = new Map<string, number>();
  for (const x of r.rejected)
    rejectedByReason.set(x.reason, (rejectedByReason.get(x.reason) ?? 0) + 1);

  out.push('NLEM 2022 import report');
  out.push(
    `Source file: ${input.pdfFile} (${input.pdfPages} pages: ${s.pagesRead} table pages read, ${s.pagesSkipped} other pages skipped)`,
  );
  out.push('');
  out.push('Counts (each number counts a different thing):');
  out.push(dots('numbered lines found in the tables', s.numberedLines));
  out.push(dots('  of which numbered category headings (not medicines)', s.headings));
  out.push(dots('numbered medicine entries', s.numberedEntries));
  out.push(dots('formulation lines (one per dose form + strength)', s.formulationLines));
  out.push(dots('wrapped form lines joined back together', s.wrappedLinesJoined));
  out.push(
    dots('formulation ROWS after removing repeats (= medicine_master rows)', s.formulationRows),
  );
  out.push(dots('distinct generic names read from the tables', s.distinctGenerics));
  if (input.finalNames)
    out.push(dots('distinct generic names in the loaded rows', input.finalNames.length));
  out.push(dots('rejected (text that could not be placed; no row made)', s.rejected));
  out.push(
    dots(
      'flagged for review',
      `${s.flagged} (${s.flaggedHeld} HELD and not loaded; ${r.review.filter((x) => x.resolvedBy === 'override').length} resolved by manual transcription; ${s.flagged - s.flaggedHeld - r.review.filter((x) => x.resolvedBy === 'override').length} loaded with a note)`,
    ),
  );
  out.push('');

  out.push(
    `Why ${s.numberedEntries} numbered entries reduce to ${s.distinctGenerics} distinct names:`,
  );
  out.push(
    `  ${r.repeats.extraEntries} entries repeat a generic that is already listed. NLEM lists a medicine again under every`,
  );
  out.push(
    '  therapeutic category it belongs to (for example morphine under anaesthesia, analgesics and palliative care).',
  );
  out.push(
    `  Listings per generic: ${r.repeats.byListings.map((b) => `${b.generics} generics listed ${b.listings}x`).join(', ')}.`,
  );
  out.push(
    `  Listed 3 or more times: ${sample(
      r.repeats.mostRepeated.map((m) => `${m.name} (${m.refs.join(', ')})`),
      20,
    )}`,
  );
  out.push(
    `  Formulation lines vs rows: ${s.formulationLines} lines became ${s.formulationRows} rows; the same generic + dose form + strength under two sections is ONE row (the other item numbers go in also_listed_in).`,
  );
  out.push('');

  const distinctNames = input.finalNames ?? [
    ...new Map(r.entries.map((e) => [distinctKey(e.name), e.name])).values(),
  ];
  const rec = reconcile(distinctNames, r.alphabetical.names);
  const a = r.alphabetical;
  out.push('Compare with the official count (reconciled by name; not decided by this script):');
  out.push(
    `  The publication numbers its own "Alphabetical List of Medicines in NLEM 2022" (starts at PDF page ${a.firstPage ?? '?'}) from 1 to ${a.highest}${
      a.missing.length > 0
        ? `; numbers I could not read: ${a.missing.join(', ')}`
        : '; every number from 1 to the highest was read'
    }.`,
  );
  out.push(
    `  The PRD uses 384 medicines. The loaded rows hold ${distinctNames.length} distinct names; ${rec.matched} of them match a name in the alphabetical list.`,
  );
  out.push(
    `  Only in the alphabetical list (${rec.onlyInAlphabetical.length}): ${sample(rec.onlyInAlphabetical, 40)}`,
  );
  out.push(`  Only in the tables (${rec.onlyInTables.length}): ${sample(rec.onlyInTables, 40)}`);
  out.push(
    '  The committee report (reportnlem2022.pdf) disagrees with itself (the PRD notes 384 and 386):',
  );
  out.push(
    '   - PDF page 9: "contains 386 medicines", then "a total of 384 medicines"; it splits them 342 / 41 / 11 / 4 across',
  );
  out.push(
    '     one / two / three / four categories (that sums to 398, not 384) and says the full list is 440 items long.',
  );
  out.push(
    '   - PDF page 14, table: total 384 (each medicine counted once) and 460 (counted once per category, 56 repeats).',
  );
  out.push('   - PDF page 65: "Out of 386 medicines ... 342 / 41 / 11 / 4".');
  out.push('');

  out.push(
    `Generics that could not be placed (all of their entries were held or rejected): ${sample(r.unplaced, 40)}`,
  );
  if (heldByReason.size > 0)
    out.push(`Held rows by reason: ${[...heldByReason].map(([k, v]) => `${k} ${v}`).join(', ')}`);
  if (rejectedByReason.size > 0) {
    out.push('Rejected text by reason:');
    for (const [reason, n] of rejectedByReason) out.push(`  ${n} x ${reason}`);
  }
  out.push('');

  if (diff === null)
    out.push('Diff against the previous run: this is the first run (no previous file).');
  else if (diff.added.length + diff.removed.length + diff.changed.length === 0)
    out.push('Diff against the previous run: none (identical).');
  else {
    out.push(
      `Diff against the previous run: ${diff.added.length} added, ${diff.removed.length} removed, ${diff.changed.length} changed.`,
    );
    if (diff.added.length) out.push(`  added: ${sample(diff.added)}`);
    if (diff.removed.length) out.push(`  removed: ${sample(diff.removed)}`);
    if (diff.changed.length) out.push(`  changed: ${sample(diff.changed)}`);
  }
  out.push(
    load === null
      ? 'Database: not touched (dry run).'
      : `Database: ${load.inserted} inserted, ${load.updated} updated, ${load.unchanged} unchanged${load.restored > 0 ? `, ${load.restored} restored (retired by an earlier run, produced again now)` : ''}.`,
  );
  if (load !== null)
    out.push(
      load.stale.length === 0
        ? 'In the database but not in this import: none.'
        : `In the database but not in this import: ${load.stale.length} (${sample(load.stale)}). ${
            load.retiredStale > 0
              ? `${load.retiredStale} retired (retired, never deleted).`
              : 'Run again with --retire-stale to retire them (never deleted).'
          }`,
    );
  out.push('');
  out.push('Files written (git-ignored):');
  for (const f of input.files) out.push(`  ${f}`);
  out.push(
    'Route, SNOMED code, ATC code, reviewed_on and reviewed_by are NULL on every row (see docs/OPEN_CLINICAL_ITEMS.md).',
  );
  return `${out.join('\n')}\n`;
}
