// Fills the generated regions of docs/SRS.md (Phase 13A) from the PRD and docs/srs-status.json, so requirement IDs and texts
// cannot drift. Prose outside the regions is hand-written. Run: `npm run srs` (it formats the file with prettier afterwards).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, parsePrd, readStatus } from './srs-lib.mjs';
import { npm } from './lib.mjs';

const prd = parsePrd();
const status = readStatus();
const cell = (s) => String(s).replaceAll('|', '\\|').replace(/\r?\n/g, ' ');
const refs = (s) => [...(s.adr ?? []).map((a) => `ADR-${a}`), ...(s.oci ?? [])].join(', ') || '-';
const table = (head, rows) =>
  `| ${head.join(' | ')} |\n|${head.map(() => '---').join('|')}|\n${rows.map((r) => `| ${r.map(cell).join(' | ')} |`).join('\n')}`;
const tally = (list) =>
  ['Implemented', 'Partial', 'Planned'].map((k) => list.filter((r) => status[r.id]?.status === k).length);

const regions = {};

regions.counts = (() => {
  const rows = [
    ['Functional (FR)', prd.fr],
    ['Non-functional (NFR)', prd.nfr],
    ['Pages (PG)', prd.pg],
  ].map(([n, l]) => [n, l.length, ...tally(l)]);
  return table(['Kind', 'In the PRD', 'Implemented', 'Partial', 'Planned'], rows);
})();

regions.fr = Object.entries(prd.features)
  .map(([f, info], i) => {
    const n = Number(f.slice(1));
    const head = `### 4.${n} ${f} - ${info.title} (${info.priority || 'priority not stated'})`;
    const own = prd.fr.filter((r) => r.feature === f);
    if (!own.length) {
      const s = status._features?.[f];
      return `${head}\n\nThe PRD gives ${f} no requirement rows (${s ? s.why : 'no entry in docs/srs-status.json'}). Status: **${s?.status ?? 'unknown'}**.`;
    }
    return `${head}\n\n${table(
      ['ID', 'Requirement (PRD text, unchanged)', 'Status', 'What exists, or what is missing', 'ADR / OCI'],
      own.map((r) => [r.id, r.text, status[r.id].status, status[r.id].why, refs(status[r.id])]),
    )}`;
  })
  .join('\n\n');

regions.pg = table(
  ['ID', 'Page', 'Route in the PRD', 'Who', 'Priority', 'Status', 'What exists, or what is missing', 'ADR / OCI'],
  prd.pg.map((r) => [r.id, r.name, r.route, r.roles, r.priority, status[r.id].status, status[r.id].why, refs(status[r.id])]),
);

const NFR_TITLES = {
  PERF: 'Performance',
  SEC: 'Security',
  PRIV: 'Privacy',
  REL: 'Reliability',
  UX: 'Usability',
  MAINT: 'Maintainability',
  COMP: 'Compliance',
};
regions.nfr = Object.keys(NFR_TITLES)
  .map((k, i) => {
    const own = prd.nfr.filter((r) => r.id.split('-')[1] === k);
    return `### 6.${i + 1} ${NFR_TITLES[k]}\n\n${table(
      ['ID', 'Requirement (PRD text, unchanged)', 'Target (PRD)', 'Status', 'Evidence', 'What exists, or what is missing', 'ADR / OCI'],
      own.map((r) => {
        const s = status[r.id];
        return [r.id, `${r.category}: ${r.text}`, r.target, s.status, s.measured ? 'Automated test or check' : 'Not measured', s.why, refs(s)];
      }),
    )}`;
  })
  .join('\n\n');

regions.metrics = table(
  ['ID', 'Metric', 'Target (PRD)', 'Measured?', 'Note'],
  prd.metrics.map((m) => {
    const s = status._metrics?.[m.id];
    return [m.id, m.name, m.target, s?.measured ?? 'unknown', s?.note ?? 'no entry in docs/srs-status.json'];
  }),
);

regions.oci = (() => {
  const text = readFileSync(join(ROOT, 'docs', 'OPEN_CLINICAL_ITEMS.md'), 'utf8');
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\| (OCI-\d+) \| (.*?) \|/.exec(line);
    if (!m) continue;
    const first = m[2].split(/(?<=[.:])\s/)[0];
    rows.push([m[1], first.length > 200 ? first.slice(0, 197) + '...' : first]);
  }
  return table(['ID', 'Open item (first sentence; the full text and the owner action are in docs/OPEN_CLINICAL_ITEMS.md)'], rows);
})();

const file = join(ROOT, 'docs', 'SRS.md');
let md = readFileSync(file, 'utf8');
for (const [name, body] of Object.entries(regions)) {
  const re = new RegExp(`(<!-- BEGIN GENERATED:${name} -->)[\\s\\S]*?(<!-- END GENERATED:${name} -->)`);
  if (!re.test(md)) throw new Error(`docs/SRS.md has no GENERATED:${name} region`);
  md = md.replace(re, (_, a, b) => `${a}\n\n${body}\n\n${b}`);
}
writeFileSync(file, md);
npm(['exec', '--', 'prettier', '--write', 'docs/SRS.md'], { quiet: true });
console.log(`updated ${Object.keys(regions).length} generated regions in docs/SRS.md`);
