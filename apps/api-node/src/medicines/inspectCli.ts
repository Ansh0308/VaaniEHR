// `npm run medicines:inspect -- held`            the rows the importer held, with the PDF's own text next to my reading
// `npm run medicines:inspect -- sample [--n 20] [--seed 3] [--docs docs/NLEM_SPOTCHECK.md]`
//                                                a seeded random sample of LOADED rows for a spot-check
// Prints PDF text to the terminal only. The --docs file holds page numbers and item numbers (no PDF text).
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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

if (!existsSync(pdf) || (mode !== 'held' && mode !== 'sample')) {
  process.stderr.write(
    'Usage: medicines:inspect -- held | sample [--n 20] [--seed 3] [--docs <file>]\n',
  );
  process.exit(1);
}

const result = parseNlem(await readPdfItems(pdf), { nlemYear: 2022 });
const entryOf = (page: number, ref: string): ParsedEntry | undefined =>
  result.entries.find((e) => e.page === page && e.ref === ref);

const cells = (lines: RawLine[]) => {
  for (const l of lines)
    out(`    ${l.column.padEnd(5)} | y=${String(Math.round(l.y)).padStart(3)} | ${l.text}`);
};

if (mode === 'held') {
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
  const pool = [...result.rows];
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
    `SAMPLE: ${picked.length} of ${result.rows.length} loaded rows, seed ${seed} (same seed, same sample)\n`,
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
      `A random sample of ${picked.length} of the ${result.rows.length} loaded medicine rows, drawn with seed ${seed} by \`npm run medicines:inspect -- sample --n ${n} --seed ${seed}\` (the same seed draws the same sample). Only page numbers and item numbers are recorded here, no text from the PDF. The owner compares each row with the PDF and records pass or fail.`,
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
