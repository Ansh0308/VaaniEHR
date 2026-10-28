// Guard (Phase 13A): every file in docs/ is listed in docs/README.md, and every link there points at a file that exists.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ROOT } from './lib.mjs';

const docs = join(ROOT, 'docs');
const index = readFileSync(join(docs, 'README.md'), 'utf8');
const files = [];
(function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else files.push(relative(docs, p).replaceAll('\\', '/'));
  }
})(docs);

const problems = [];
for (const f of files)
  if (!index.includes(`(${f})`)) problems.push(`docs/${f} is not listed in docs/README.md`);
for (const m of index.matchAll(/\]\(([^)#]+?)(?:#[^)]*)?\)/g)) {
  const target = m[1];
  if (/^https?:/.test(target)) continue;
  if (!existsSync(join(docs, target)))
    problems.push(`docs/README.md links to a missing file: ${target}`);
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`docs index ok (${files.length} files listed)`);
