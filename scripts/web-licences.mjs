// Generates apps/web/src/licensing/licences.generated.json: the licence list shown on the Settings / About page (PG-18).
// Source: the web app's runtime dependencies (apps/web/package.json) and their licences in package-lock.json.
//   node scripts/web-licences.mjs           writes the file
//   node scripts/web-licences.mjs --check   fails if the committed file is out of date (part of `npm run check`)
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib.mjs';

const OUT = join(ROOT, 'apps', 'web', 'src', 'licensing', 'licences.generated.json');
const web = JSON.parse(readFileSync(join(ROOT, 'apps', 'web', 'package.json'), 'utf8'));
const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'));

const entries = Object.keys(web.dependencies)
  .sort()
  .map((name) => {
    const pkg =
      lock.packages[`node_modules/${name}`] ?? lock.packages[`apps/web/node_modules/${name}`];
    if (!pkg?.license) throw new Error(`No licence recorded in package-lock.json for ${name}`);
    return { name, version: pkg.version, licence: pkg.license };
  });

const text = `${JSON.stringify(entries, null, 2)}\n`;

if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(OUT, 'utf8');
  } catch {
    /* missing file counts as out of date */
  }
  if (current !== text) {
    console.error(
      'apps/web/src/licensing/licences.generated.json is out of date. Run: npm run licences:web',
    );
    process.exit(1);
  }
  console.log(`OK: licence list for the Settings page is up to date (${entries.length} packages)`);
} else {
  writeFileSync(OUT, text, { encoding: 'utf8' });
  console.log(`wrote ${OUT} (${entries.length} packages)`);
}
