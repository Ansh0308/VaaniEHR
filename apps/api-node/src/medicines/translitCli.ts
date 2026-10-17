// `npm run medicines:translit -- <approved.csv> [--apply]`  (dry run unless --apply). See translit.ts.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import '../db/types.js';
import { applyTranslit, parseTranslitCsv } from './translit.js';

const out = (line: string) =>
  process.stdout.write(`${line}
`);
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const file = args.find((a) => !a.startsWith('--'));
if (!file || !existsSync(resolve(file))) {
  console.error(
    'Usage: npm run medicines:translit -- <approved.csv> [--apply]   (the file must exist)',
  );
  process.exit(1);
}
const { rows, errors } = parseTranslitCsv(readFileSync(resolve(file), 'utf8'));
if (errors.length > 0) {
  console.error(`The file was refused (${errors.length} problem(s)); nothing was changed:`);
  for (const e of errors.slice(0, 30)) console.error(`  ${e}`);
  process.exit(1);
}
const url = process.env.MIGRATION_DATABASE_URL;
if (!url) {
  console.error(
    'MIGRATION_DATABASE_URL is not set (run `npm run setup:env`, then `npm run db:up`).',
  );
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: url, max: 2 });
try {
  const r = await applyTranslit(pool, rows, apply);
  out(
    `${apply ? 'APPLIED' : 'DRY RUN (nothing written; add --apply)'}: ${rows.length} approved rows`,
  );
  out(`  inserted ${r.inserted}, already there ${r.alreadyThere}`);
} finally {
  await pool.end();
}
