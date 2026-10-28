// Reads the requirement IDs straight from the PRD (DOCUMENTS/VaaniEHR_PRD.md) so the SRS and the traceability matrix cannot drift
// from it (Phase 13A). Used by scripts/srs.mjs and scripts/trace.mjs.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const PRD_PATH = 'DOCUMENTS/VaaniEHR_PRD.md';

const cells = (line) =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replaceAll('\\|', '|'));

/** @returns {{features: Record<string,{title:string,priority:string}>, fr:object[], nfr:object[], pg:object[], metrics:object[]}} */
export function parsePrd(text = readFileSync(join(ROOT, PRD_PATH), 'utf8')) {
  const features = {};
  const fr = [];
  const nfr = [];
  const pg = [];
  const metrics = [];
  const seen = new Set();
  for (const line of text.split(/\r?\n/)) {
    const h = /^### (F\d+) [—-] (.+?)(?: [—-] \*\*(P\d)\*\*.*)?$/.exec(line);
    if (h) {
      features[h[1]] = {
        title: h[2]
          .replace(/\*+/g, '')
          .replace(/\s*\(.*$/, '')
          .trim(),
        priority: h[3] ?? '',
      };
      continue;
    }
    const m = /^\| (FR-F\d+-\d+|NFR-[A-Z]+-\d+|PG-\d+|M-\d+) \|/.exec(line);
    if (!m) continue;
    const id = m[1];
    const c = cells(line);
    if (seen.has(id)) throw new Error(`PRD lists ${id} twice`);
    seen.add(id);
    if (id.startsWith('FR-')) {
      if (c.length !== 2) throw new Error(`${id}: expected 2 columns, got ${c.length}`);
      fr.push({ id, feature: id.split('-')[1], text: c[1] });
    } else if (id.startsWith('NFR-')) {
      if (c.length !== 4) throw new Error(`${id}: expected 4 columns, got ${c.length}`);
      nfr.push({ id, category: c[1], text: c[2], target: c[3] });
    } else if (id.startsWith('PG-')) {
      if (c.length !== 7) throw new Error(`${id}: expected 7 columns, got ${c.length}`);
      pg.push({
        id,
        name: c[1].replace(/\*+/g, ''),
        route: c[2],
        roles: c[3],
        purpose: c[4],
        contents: c[5],
        priority: c[6],
      });
    } else {
      if (c.length !== 5) throw new Error(`${id}: expected 5 columns, got ${c.length}`);
      metrics.push({ id, name: c[1], definition: c[2], target: c[3], source: c[4] });
    }
  }
  return { features, fr, nfr, pg, metrics };
}

const NFR_SECTION = {
  PERF: '6.1',
  SEC: '6.2',
  PRIV: '6.3',
  REL: '6.4',
  UX: '6.5',
  MAINT: '6.6',
  COMP: '6.7',
};
/** Section of docs/SRS.md that holds a requirement (the layout is fixed by scripts/srs.mjs). */
export function sectionOf(id) {
  if (id.startsWith('FR-')) return `4.${id.split('-')[1].slice(1)}`;
  if (id.startsWith('PG-')) return '5';
  if (id.startsWith('NFR-')) return NFR_SECTION[id.split('-')[1]] ?? '6';
  return '7';
}

export const allIds = (prd) => [...prd.fr, ...prd.nfr, ...prd.pg].map((r) => r.id);

export function readStatus() {
  return JSON.parse(readFileSync(join(ROOT, 'docs', 'srs-status.json'), 'utf8'));
}
