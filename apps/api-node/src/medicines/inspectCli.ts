// `npm run medicines:inspect -- held`            the rows the importer held, with the PDF's own text next to my reading
// `npm run medicines:inspect -- sample [--n 20] [--seed 3] [--docs docs/NLEM_SPOTCHECK.md]`
//                                                a seeded random sample of LOADED rows for a spot-check
// Prints PDF text to the terminal only. The --docs file holds page numbers and item numbers (no PDF text).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCsvObjects } from './nlemFiles.js';
import { applyOverrides, parseOverridesCsv } from './overrides.js';
import { joinWrapped, parseNlem, type ParsedEntry, type RawLine } from './nlemParser.js';
import { parseFormLine } from './normalise.js';
import { readPdfItems } from './pdfItems.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const pdf = join(REPO_ROOT, 'data', 'medicines', 'raw', 'nlem2022.pdf');
const out = (line = '') => process.stdout.write(`${line}\n`);
const args = process.argv.slice(2);
const mode = args[0];
const flag = (name: string, fallback: string) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? (args[i + 1] as string) : fallback;
};

if (
  !existsSync(pdf) ||
  (mode !== 'held' && mode !== 'sample' && mode !== 'coverage' && mode !== 'expected')
) {
  process.stderr.write(
    'Usage: medicines:inspect -- held | coverage | expected | sample [--n 20] [--seed 3] [--docs <file>]\n',
  );
  process.exit(1);
}

const result = parseNlem(await readPdfItems(pdf), { nlemYear: 2022 });
// the rows as they are loaded: the parser's rows with the owner's manual transcriptions applied (if the private file exists)
const overridesFile = join(REPO_ROOT, 'data', 'medicines', 'nlem2022.overrides.csv');
const finalRows = existsSync(overridesFile)
  ? applyOverrides(
      result.rows,
      parseOverridesCsv(readFileSync(overridesFile, 'utf8')).rows,
      (page, ref) => result.entries.find((e) => e.page === page && e.ref === ref)?.category ?? null,
      2022,
    ).rows
  : result.rows;
const entryOf = (page: number, ref: string): ParsedEntry | undefined =>
  result.entries.find((e) => e.page === page && e.ref === ref);

const cells = (lines: RawLine[]) => {
  for (const l of lines)
    out(`    ${l.column.padEnd(5)} | y=${String(Math.round(l.y)).padStart(3)} | ${l.text}`);
};

if (mode === 'coverage') {
  const heldKeys = new Set(result.review.filter((r) => r.held).map((r) => `${r.page}|${r.ref}`));
  const cells = result.cells;
  type Cell = (typeof cells)[number];
  const inHeld = (c: Cell) => heldKeys.has(`${c.page}|${c.ref}`);
  const count = (f: (c: Cell) => boolean) => cells.filter(f).length;
  // a cell of a loaded item that reached no row is unmapped
  const unmapped = cells.filter((c) => !inHeld(c) && c.disposition === 'HELD');
  // a prefix cell that was attached to the dose-form lines after it is accounted for; only the rest is a defect
  const prefixBad = cells.filter(
    (c) => c.defects.includes('PREFIX_LINE') && c.disposition !== 'PREFIX_ATTACHED',
  );
  const headerBad = cells.filter((c) => c.defects.includes('HEADER_FRAGMENT'));
  const collapsed = cells.filter((c) => c.disposition === 'COLLAPSED_IN_ENTRY');
  out('SYSTEMATIC CELL CHECK (every raw dose-form cell of every numbered item)');
  out(`  total raw dose-form cells ........................... ${cells.length}`);
  out(
    `  (a) became a loaded row ............................ ${count((c) => c.disposition === 'LOADED')}`,
  );
  out(
    `      wrapped continuation joined to the cell before . ${count((c) => c.disposition === 'WRAP_JOINED')}`,
  );
  out(
    `      prefix cell attached to the lines after it ..... ${count((c) => c.disposition === 'PREFIX_ATTACHED')}`,
  );
  out(
    `      note inside the cell (# or *) -> source_notes .. ${count((c) => c.disposition === 'NOTE')}`,
  );
  out(
    `      in a HELD item (listed for a person) ........... ${count((c) => c.disposition === 'HELD' && inHeld(c))}`,
  );
  out(`      merged into another row of the SAME item ....... ${collapsed.length}  (defect)`);
  out(`      UNMAPPED (loaded item, cell reached no row) .... ${unmapped.length}  (defect)`);
  out(
    `  (b) prefix cells NOT attached (end in "-" or "/", no digit) ${prefixBad.length}  (defect)`,
  );
  out(
    `  (c) page-header fragments left in cells ............. ${headerBad.length}  (defect; the filter took out ${result.stats.headerFragmentsDropped})`,
  );
  // (d) every "#" / "*" marker on a name must have its note in the source_notes of a loaded row of that item
  const rowsOf = (page: number, ref: string) =>
    result.rows.filter((r) => r.nlemRef === ref && r.sourcePage === page);
  const rowsListing = (ref: string) =>
    result.rows.filter((r) => r.nlemRef === ref || r.alsoListedIn.includes(ref));
  const marks: Array<{
    page: number;
    ref: string;
    marker: string;
    found: boolean;
    reached: boolean;
  }> = [];
  for (const e of result.entries) {
    if (heldKeys.has(`${e.page}|${e.ref}`)) continue;
    const notes = [...rowsOf(e.page, e.ref), ...rowsListing(e.ref)]
      .map((r) => r.sourceNotes ?? '')
      .join(' ');
    for (const line of e.rawLines.filter((l) => l.column === 'name')) {
      for (const m of line.text.match(/[*#†]+/g) ?? []) {
        const fn = result.footnotes.find((f) => f.page === e.page && f.marker === m);
        marks.push({
          page: e.page,
          ref: e.ref,
          marker: m,
          found: fn !== undefined,
          reached:
            (fn !== undefined && notes.includes(fn.text.slice(0, 30))) ||
            notes.includes(`table note: ${m}`) ||
            notes.includes(`footnote marker ${m} beside the name; its text was not found`),
        });
      }
    }
  }
  const tableNotes = cells.filter((c) => !inHeld(c) && c.disposition === 'NOTE');
  out(`  (d) name markers (* ** # ...) on loaded items ....... ${marks.length}`);
  out(
    `      footnote text found on the page ................ ${marks.filter((m) => m.found).length}`,
  );
  out(
    `      note reached source_notes (or its absence is recorded there) ${marks.filter((m) => m.reached).length}  (defect if below ${marks.length})`,
  );
  out(
    `      notes inside a cell (start with # or *): ${tableNotes.length}, reached source_notes: ${tableNotes.filter((c) => rowsListing(c.ref).some((r) => (r.sourceNotes ?? '').includes('table note:'))).length}`,
  );
  const show = (title: string, list: Cell[]) => {
    if (list.length === 0) return;
    out(`\n${title}`);
    for (const c of list)
      out(`  p${c.page} item ${c.ref}${inHeld(c) ? ' [held]' : ''}: "${c.text}"`);
  };
  show('UNMAPPED cells:', unmapped);
  show('Cells merged into another row of the same item:', collapsed);
  show('Prefix cells not attached:', prefixBad);
  show('Page-header fragments left in cells:', headerBad);
  const missing = marks.filter((m) => !m.reached);
  if (missing.length > 0) {
    out('\nMarkers whose note did not reach source_notes:');
    for (const m of missing.slice(0, 20))
      out(
        `  p${m.page} item ${m.ref} marker ${m.marker} (footnote ${m.found ? 'found' : 'NOT FOUND'})`,
      );
  }
} else if (mode === 'expected') {
  // the owner's confirmed rows, compared mechanically with what the parser read for the same items
  const file = join(REPO_ROOT, 'data', 'medicines', 'nlem2022.expected.csv');
  if (!existsSync(file)) {
    process.stderr.write(`No expected-rows file at ${file}\n`);
    process.exit(1);
  }
  const expected = readCsvObjects(readFileSync(file, 'utf8'));
  const items = [...new Set(expected.map((e) => `${e.page}|${e.nlem_ref}`))];
  let allMatch = true;
  for (const key of items) {
    const [page, ref] = key.split('|') as [string, string];
    const want = expected
      .filter((e) => e.page === page && e.nlem_ref === ref)
      .map((e) => `${e.generic_name} | ${e.level} | ${e.dose_form} | ${e.strength}`)
      .sort();
    const entry = entryOf(Number(page), ref);
    const got = (entry?.parsedLines ?? [])
      .map((l) => `${entry?.name} | ${l.level ?? ''} | ${l.doseForm ?? ''} | ${l.strength ?? ''}`)
      .sort();
    const heldItem = result.review.find((r) => r.page === Number(page) && r.ref === ref && r.held);
    const same = want.length === got.length && want.every((w, i) => w === got[i]) && !heldItem;
    allMatch &&= same;
    out(
      `${same ? 'MATCH ' : 'DIFFER'} PDF p.${page} item ${ref} (${entry?.name ?? '?'}): ${want.length} expected, ${got.length} read${heldItem ? ' [HELD]' : ''}`,
    );
    if (!same) {
      for (const w of want) if (!got.includes(w)) out(`    expected but not read: ${w}`);
      for (const g of got) if (!want.includes(g)) out(`    read but not expected: ${g}`);
    }
  }
  out(
    allMatch
      ? '\nALL items match the confirmed list exactly.'
      : '\nSOME items differ: keep those held.',
  );
} else if (mode === 'held') {
  const held = result.review.filter((r) => r.held);
  out(`HELD ROWS: ${held.length} (none of these is loaded; nothing below is guessed)\n`);
  held.forEach((h, i) => {
    const entry = entryOf(h.page, h.ref);
    out(
      `=== ${i + 1} of ${held.length}: PDF page ${h.page}, item ${h.ref}   reasons: ${h.reasons.join(', ')}`,
    );
    out(
      '  PDF cells in the order the file holds them (column | height on page | text as extracted):',
    );
    cells(h.rawLines);
    out('  My reading:');
    out(`    medicine: ${h.name}`);
    out(`    category: ${entry?.category ?? '(none)'}`);
    const levels = h.rawLines.filter((l) => l.column === 'level').map((l) => l.text);
    out(`    level(s): ${levels.length > 0 ? levels.join(' / ') : '(none read)'}`);
    const joined = joinWrapped(
      h.rawLines.filter((l) => l.column === 'form').map((l) => ({ y: l.y, text: l.text })),
    );
    joined.lines.forEach((line, k) => {
      const p = parseFormLine(line.text);
      const verdict = p.problem
        ? `CANNOT SPLIT (${p.problem}): needs your decision`
        : p.doseForm === null && p.strength === null
          ? 'no form or strength; the source text would be kept as a note'
          : `form "${p.doseForm ?? ''}" | strength "${p.strength ?? ''}"${p.paediatric ? ' | paediatric (p)' : ''}`;
      out(`    form line ${k + 1}: "${line.text}"  ->  ${verdict}`);
    });
    if (h.geometryReading)
      out(
        `  The second (geometric) method read this row differently: medicine "${h.geometryReading.name}", forms [${h.geometryReading.forms.map((f) => `"${f}"`).join(', ')}]`,
      );
    out();
  });
} else {
  const n = Number.parseInt(flag('--n', '20'), 10);
  const seed = Number.parseInt(flag('--seed', '3'), 10);
  // mulberry32: a small seeded generator, so the same seed gives the same sample
  let a = seed >>> 0;
  const random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pool = [...finalRows];
  const picked: typeof pool = [];
  while (picked.length < Math.min(n, pool.length)) {
    const [row] = pool.splice(Math.floor(random() * pool.length), 1);
    if (row) picked.push(row);
  }
  picked.sort(
    (x, y) =>
      x.sourcePage - y.sourcePage || x.nlemRef.localeCompare(y.nlemRef, 'en', { numeric: true }),
  );
  out(
    `SAMPLE: ${picked.length} of ${finalRows.length} loaded rows, seed ${seed} (same seed, same sample)\n`,
  );
  picked.forEach((r, i) => {
    const entry = entryOf(r.sourcePage, r.nlemRef);
    out(`=== ${i + 1}: PDF page ${r.sourcePage}, item ${r.nlemRef}`);
    out('  PDF cells for this item (the line this row came from is marked <==):');
    for (const l of entry?.rawLines ?? []) {
      const p = l.column === 'form' ? parseFormLine(l.text) : null;
      const mine =
        p !== null &&
        !p.problem &&
        (p.doseForm ?? null) === r.doseForm &&
        (p.strength ?? null) === r.strength;
      out(
        `    ${l.column.padEnd(5)} | y=${String(Math.round(l.y)).padStart(3)} | ${l.text}${mine ? '   <==' : ''}`,
      );
    }
    out('  Loaded as:');
    out(`    generic: ${r.genericName}`);
    out(
      `    dose form: ${r.doseForm ?? '(none)'}   strength: ${r.strength ?? '(none)'}   level: ${r.healthcareLevels ?? '(none)'}`,
    );
    out(`    category: ${r.therapeuticCategory ?? '(none)'}`);
    if (r.sourceNotes) out(`    note: ${r.sourceNotes}`);
    if (r.alsoListedIn.length > 0) out(`    also listed in: ${r.alsoListedIn.join(', ')}`);
    out();
  });
  const docs = flag('--docs', '');
  if (docs) {
    const md = [
      '# NLEM_SPOTCHECK.md - extraction spot-check (for the viva)',
      '',
      `A random sample of ${picked.length} of the ${finalRows.length} loaded medicine rows, drawn with seed ${seed} by \`npm run medicines:inspect -- sample --n ${n} --seed ${seed}\` (the same seed draws the same sample). Only page numbers and item numbers are recorded here, no text from the PDF. The owner compares each row with the PDF and records pass or fail.`,
      '',
      '| # | PDF page | Item number | Owner result (pass / fail) | Note |',
      '|---|---|---|---|---|',
      ...picked.map((r, i) => `| ${i + 1} | ${r.sourcePage} | ${r.nlemRef} |  |  |`),
      '',
      'Result: _not yet checked_.',
      '',
    ].join('\n');
    writeFileSync(resolve(REPO_ROOT, docs), md, 'utf8');
    out(`(wrote ${docs}: page numbers and item numbers only)`);
  }
}
