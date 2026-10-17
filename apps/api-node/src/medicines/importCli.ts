// `npm run import:nlem [-- --dry-run] [-- --pdf <path>]`
// Reads the private NLEM 2022 PDF, writes the CSV files under data/medicines/ (git-ignored), loads medicine_master as the
// database owner and prints the report. Repeatable: a second run changes nothing and the diff is empty.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import '../db/types.js';
import {
  diffRuns,
  genericsToCsv,
  medicinesToCsv,
  rejectedToCsv,
  reviewToCsv,
} from './nlemFiles.js';
import { loadNlemRows, type LoadResult } from './nlemLoad.js';
import { parseNlem } from './nlemParser.js';
import { applyOverrides, parseOverridesCsv } from './overrides.js';
import { readPdfItems } from './pdfItems.js';
import { formatReport } from './nlemReport.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const DIR = join(REPO_ROOT, 'data', 'medicines');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const retireStale = args.includes('--retire-stale');
const pdfFlag = args.indexOf('--pdf');
const pdfPath =
  pdfFlag >= 0 && args[pdfFlag + 1]
    ? resolve(args[pdfFlag + 1] as string)
    : join(DIR, 'raw', 'nlem2022.pdf');

if (!existsSync(pdfPath)) {
  console.error(
    `The NLEM PDF is not at ${pdfPath}. Put it in data/medicines/raw/ (it is git-ignored).`,
  );
  process.exit(1);
}
mkdirSync(DIR, { recursive: true });

const pages = await readPdfItems(pdfPath);
const result = parseNlem(pages, { nlemYear: 2022 });

// Manual transcriptions confirmed by the owner (private file; read only if it exists).
const overridesPath = join(DIR, 'nlem2022.overrides.csv');
let overrideLine = 'Manual overrides: none (no data/medicines/nlem2022.overrides.csv).';
if (existsSync(overridesPath)) {
  const { rows: overrideRows, errors } = parseOverridesCsv(readFileSync(overridesPath, 'utf8'));
  if (errors.length > 0) {
    process.stderr.write('nlem2022.overrides.csv was refused; nothing was imported:\n');
    for (const e of errors) process.stderr.write(`  ${e}\n`);
    process.exit(1);
  }
  const applied = applyOverrides(
    result.rows,
    overrideRows,
    (page, ref) => result.entries.find((e) => e.page === page && e.ref === ref)?.category ?? null,
    2022,
  );
  result.rows = applied.rows;
  result.stats.formulationRows = applied.rows.length;
  // an item the owner transcribed by hand is resolved: it is no longer held
  const transcribed = new Set(overrideRows.map((o) => `${o.sourcePage}|${o.nlemRef}`));
  for (const item of result.review)
    if (item.held && transcribed.has(`${item.page}|${item.ref}`)) {
      item.held = false;
      item.resolvedBy = 'override';
    }
  result.stats.flaggedHeld = result.review.filter((r) => r.held).length;
  overrideLine = `Manual overrides: ${applied.addedRows} rows for ${applied.items.length} item numbers (${applied.items.join(', ')}); they replaced ${applied.replacedRows} parsed rows.`;
}

const csvPath = join(DIR, 'nlem2022.csv');
const prevPath = join(DIR, 'nlem2022.prev.csv');
const previousText = existsSync(csvPath) ? readFileSync(csvPath, 'utf8') : null;
const csv = medicinesToCsv(result.rows);
const diff = previousText === null ? null : diffRuns(previousText, csv);
if (previousText !== null) copyFileSync(csvPath, prevPath);
writeFileSync(csvPath, csv, 'utf8');
writeFileSync(join(DIR, 'nlem2022.review.csv'), reviewToCsv(result.review), 'utf8');
writeFileSync(join(DIR, 'nlem2022.rejected.csv'), rejectedToCsv(result.rejected), 'utf8');

const byName = new Map<string, { name: string; refs: string[] }>();
for (const e of result.entries) {
  const key = e.name.toLowerCase();
  byName.set(key, { name: e.name, refs: [...(byName.get(key)?.refs ?? []), e.ref] });
}
writeFileSync(join(DIR, 'nlem2022.generics.csv'), genericsToCsv([...byName.values()]), 'utf8');

let load: LoadResult | null = null;
if (!dryRun) {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) {
    console.error(
      'MIGRATION_DATABASE_URL is not set (run `npm run setup:env`, then `npm run db:up`).',
    );
    process.exit(1);
  }
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  try {
    load = await loadNlemRows(
      pool,
      result.rows,
      {
        numberedEntries: result.stats.numberedEntries,
        formulationRows: result.stats.formulationRows,
        distinctGenerics: result.stats.distinctGenerics,
        rejectedItems: result.stats.rejected,
        heldForReview: result.stats.flaggedHeld,
      },
      { retireStale },
    );
  } finally {
    await pool.end();
  }
}

const report = formatReport({
  pdfFile: pdfPath.replace(REPO_ROOT, '.').replaceAll('\\', '/'),
  pdfPages: pages.length,
  result,
  diff,
  load,
  finalNames: [
    ...new Map(result.rows.map((r) => [r.genericName.toLowerCase(), r.genericName])).values(),
  ],
  files: [
    'data/medicines/nlem2022.csv',
    'data/medicines/nlem2022.review.csv',
    'data/medicines/nlem2022.rejected.csv',
    'data/medicines/nlem2022.generics.csv',
    'data/medicines/nlem2022.report.txt',
  ],
});
const reportWithOverrides = report.replace(
  'Files written (git-ignored):',
  `${overrideLine}

Files written (git-ignored):`,
);
writeFileSync(join(DIR, 'nlem2022.report.txt'), reportWithOverrides, 'utf8');
process.stdout.write(reportWithOverrides);
