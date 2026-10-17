// SBOM generator and dependency-reason guard (AGENTS.md Hard Rule 6; ADR-D9: Node, cross-platform).
//   node scripts/sbom.mjs                 -> checks reasons, then writes docs/SBOM.md
//   node scripts/sbom.mjs --reasons-only  -> only checks that every DIRECT dependency has a reason
// Sources: package.json files (direct npm deps), package-lock.json (all npm packages + licences),
// apps/asr-py/requirements*.txt (direct Python deps), the Python environment (installed licences),
// skills-lock.json + .agents/skills (installed skills), infra/docker-compose.yml (images).
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { run, ROOT } from './lib.mjs';

const reasonsOnly = process.argv.includes('--reasons-only');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const readJson = (p) => JSON.parse(read(p));

// ---------- reasons (docs/DECISIONS.md) ----------
function loadReasons() {
  const text = read('docs/DECISIONS.md');
  const match = text.match(/<!-- DEP-REASONS:START -->([\s\S]*?)<!-- DEP-REASONS:END -->/);
  if (!match) throw new Error('DEP-REASONS markers not found in docs/DECISIONS.md');
  const map = new Map();
  for (const line of match[1].split(/\r?\n/)) {
    const cells = line.split('|').map((c) => c.trim());
    if (
      cells.length >= 4 &&
      cells[1] &&
      !/^-+$/.test(cells[1]) &&
      cells[1].toLowerCase() !== 'dependency'
    ) {
      map.set(cells[1].toLowerCase(), cells[2]);
    }
  }
  return map;
}

// ---------- direct dependencies ----------
function directNpm() {
  const manifests = [
    'package.json',
    'apps/web/package.json',
    'apps/api-node/package.json',
    'packages/rules/package.json',
  ];
  const rows = [];
  for (const file of manifests) {
    if (!existsSync(join(ROOT, file))) continue;
    const pkg = readJson(file);
    for (const [kind, deps] of [
      ['runtime', pkg.dependencies],
      ['dev', pkg.devDependencies],
    ]) {
      for (const [name, version] of Object.entries(deps ?? {}))
        rows.push({ name, version, kind, where: file });
    }
  }
  return rows;
}

function directPython() {
  const rows = [];
  for (const file of ['apps/asr-py/requirements.txt', 'apps/asr-py/requirements-dev.txt']) {
    if (!existsSync(join(ROOT, file))) continue;
    for (const line of read(file).split(/\r?\n/)) {
      const m = line.trim().match(/^([A-Za-z0-9_.-]+)==([^\s#;]+)/);
      if (m)
        rows.push({
          name: m[1],
          version: m[2],
          kind: file.endsWith('dev.txt') ? 'dev' : 'runtime',
          where: file,
        });
    }
  }
  return rows;
}

const reasons = loadReasons();
const npmDirect = directNpm();
const pyDirect = directPython();
const missing = [...npmDirect, ...pyDirect].filter((d) => !reasons.has(d.name.toLowerCase()));
if (missing.length > 0) {
  console.error('Direct dependencies without a reason in docs/DECISIONS.md (DEP-REASONS table):');
  for (const d of missing) console.error(`  - ${d.name}@${d.version} (${d.where})`);
  process.exit(1);
}
console.log(
  `OK: all ${npmDirect.length + pyDirect.length} direct dependencies have a stated reason.`,
);
if (reasonsOnly) process.exit(0);

// ---------- licence helpers ----------
const PERMISSIVE = new Set([
  'mit',
  'isc',
  'bsd',
  'bsd-2-clause',
  'bsd-3-clause',
  'apache-2.0',
  '0bsd',
  'blueoak-1.0.0',
  'unlicense',
  'cc0-1.0',
  'python-2.0',
  'psf-2.0',
  'zlib',
  'cc-by-4.0',
  'cc-by-3.0',
  'postgresql',
  'mpl-2.0',
]);
function classify(license) {
  const raw = (license ?? '').trim();
  if (!raw) return 'UNVERIFIED (no licence field)';
  const lowered = raw.toLowerCase();
  if (
    /(^|[^l])gpl|agpl|sspl|busl|-nc|non-commercial|proprietary/.test(lowered) &&
    !/ or /.test(lowered)
  ) {
    return 'REVIEW (copyleft / non-commercial / proprietary)';
  }
  const parts = lowered
    .replace(/[()]/g, ' ')
    .split(/\s+(?:or|and)\s+|\s*\/\s*|\s*;\s*/)
    .map((p) => p.trim());
  const known = parts.filter(
    (p) =>
      PERMISSIVE.has(p) ||
      /^(mit|bsd|apache|isc)/.test(p) ||
      /license ::.*(mit|bsd|apache|isc)/i.test(p),
  );
  if (known.length > 0) return 'ok (permissive)';
  return 'REVIEW (other)';
}
const normaliseLicense = (l) => {
  if (!l) return '';
  if (typeof l === 'string') return l;
  if (Array.isArray(l)) return l.map(normaliseLicense).join(' OR ');
  return l.type ?? '';
};
const cell = (s) =>
  String(s ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ');

// Fallback when the lockfile has no licence: legacy package.json fields, then a LICENSE text sniff.
function licenseFromDisk(lockPath) {
  const dir = join(ROOT, lockPath);
  if (!existsSync(dir)) return '';
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    const declared = normaliseLicense(pkg.license ?? pkg.licenses);
    if (declared) return declared;
  } catch {
    /* fall through to the LICENSE file */
  }
  const file = readdirSync(dir).find((f) => /^licen[cs]e/i.test(f));
  if (!file) return '';
  const text = readFileSync(join(dir, file), 'utf8').slice(0, 2000);
  return /permission is hereby granted, free of charge/i.test(text)
    ? 'MIT (from LICENSE text)'
    : '';
}

// ---------- npm packages (all, from lockfile) ----------
function npmPackages() {
  if (!existsSync(join(ROOT, 'package-lock.json'))) return [];
  const lock = readJson('package-lock.json');
  const out = [];
  for (const [path, info] of Object.entries(lock.packages ?? {})) {
    if (!path || !path.includes('node_modules/')) continue; // skip workspace roots
    if (info.link) continue;
    const name = path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
    out.push({
      name,
      version: info.version,
      license: normaliseLicense(info.license) || licenseFromDisk(path),
      dev: !!info.dev,
      optional: !!info.optional,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

// ---------- python packages (installed environment) ----------
function pythonPackages() {
  const code = [
    'import importlib.metadata as m, json',
    'out=[]',
    'for d in m.distributions():',
    '    md=d.metadata',
    "    lic=md.get('License-Expression') or ''",
    '    if not lic:',
    "        lic=md.get('License') or ''",
    "        if len(lic)>80 or chr(10) in lic: lic=''",
    '    if not lic:',
    "        cl=[c.split('::')[-1].strip() for c in (md.get_all('Classifier') or []) if c.startswith('License ::')]",
    "        lic=' / '.join(cl)",
    "    out.append({'name':md['Name'],'version':md['Version'],'license':lic})",
    "print(json.dumps(sorted(out,key=lambda x:x['name'].lower())))",
  ].join('\n');
  const r = run(process.execPath, ['scripts/py.mjs', 'exec', '-c', code], { quiet: true });
  if (r.status !== 0) return null;
  try {
    return JSON.parse(r.stdout.trim().split(/\r?\n/).pop());
  } catch {
    return null;
  }
}

// ---------- skills ----------
function skills() {
  if (!existsSync(join(ROOT, 'skills-lock.json'))) return [];
  const lock = readJson('skills-lock.json');
  const out = [];
  for (const [name, info] of Object.entries(lock.skills ?? {})) {
    const dir = join(ROOT, '.agents', 'skills', name);
    let license = '';
    let how = '';
    if (existsSync(dir)) {
      const skillMd = join(dir, 'SKILL.md');
      if (existsSync(skillMd)) {
        const head = readFileSync(skillMd, 'utf8').split(/\r?\n/).slice(0, 40).join('\n');
        const m = head.match(/^license:\s*(.+)$/im);
        if (m) {
          license = m[1].trim().replace(/^["']|["']$/g, '');
          how = 'SKILL.md frontmatter';
        }
      }
      if (!license) {
        const file = readdirSync(dir).find((f) => /^licen[cs]e/i.test(f));
        if (file) {
          const text = readFileSync(join(dir, file), 'utf8').slice(0, 3000);
          const guess = /apache license/i.test(text)
            ? 'Apache-2.0'
            : /mit license|permission is hereby granted, free of charge/i.test(text)
              ? 'MIT'
              : /bsd/i.test(text)
                ? 'BSD (variant unverified)'
                : /gnu (affero |lesser )?general public/i.test(text)
                  ? 'GPL-family'
                  : '';
          if (guess) {
            license = guess;
            how = `${file} (text match)`;
          }
        }
      }
    } else {
      how = 'skill files not present on this machine';
    }
    out.push({
      name,
      source: info.source,
      license: license || 'UNVERIFIED',
      how: how || 'no licence declared in skill files; check the source repository',
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// ---------- docker images ----------
function dockerImages() {
  const found = new Map(); // image -> where it is used
  const compose = 'infra/docker-compose.yml';
  if (existsSync(join(ROOT, compose))) {
    for (const m of read(compose).matchAll(/^\s*image:\s*(\S+)/gm)) {
      // Locally built images (vaaniehr/*:local) are our own, not third-party components.
      if (!m[1].startsWith('vaaniehr/')) found.set(m[1], compose);
    }
  }
  for (const app of ['api-node', 'web', 'asr-py']) {
    const file = `apps/${app}/Dockerfile`;
    if (!existsSync(join(ROOT, file))) continue;
    for (const m of read(file).matchAll(/^ARG\s+[A-Z_]*IMAGE=(\S+)/gm)) {
      found.set(m[1], found.has(m[1]) ? `${found.get(m[1])}, ${file}` : file);
    }
  }
  return [...found].map(([image, usedIn]) => ({ image, usedIn }));
}

function imageLicenseNote(image) {
  if (image.startsWith('pgvector/')) {
    return 'pgvector: PostgreSQL License (PRD §12.3); PostgreSQL: PostgreSQL License; Debian base layers carry mixed licences - UNVERIFIED in detail';
  }
  if (image.startsWith('node:')) {
    return 'Node.js: MIT (plus bundled third-party licences); Debian base layers carry mixed licences - UNVERIFIED in detail';
  }
  if (image.startsWith('python:')) {
    return 'CPython: PSF License; Debian base layers carry mixed licences - UNVERIFIED in detail';
  }
  if (image.startsWith('nginxinc/nginx-unprivileged')) {
    return 'nginx: BSD-2-Clause; Alpine base layers carry mixed licences (mostly MIT/BSD/GPL-family for system tools) - UNVERIFIED in detail';
  }
  return 'UNVERIFIED';
}

// ---------- render ----------
const npmAll = npmPackages();
const pyAll = pythonPackages();
const lines = [];
const push = (...l) => lines.push(...l);

push(
  '# SBOM.md - software bill of materials',
  '',
  'Generated by `node scripts/sbom.mjs` (run `npm run sbom`). Do not edit by hand. Covers AGENTS.md Hard Rule 6 / PRD NFR-COMP-02.',
  'Direct dependencies must each have a reason in `docs/DECISIONS.md` (DEP-REASONS table); the generator and `npm run check` fail otherwise.',
  'Licence classification is automatic and **not legal advice**: anything not marked "ok (permissive)" needs a human look before any commercial use.',
  '',
  '## 1. Direct dependencies (with reason)',
  '',
  '| Ecosystem | Package | Version | Kind | Declared in | Licence | Reason |',
  '|---|---|---|---|---|---|---|',
);
const npmLicense = new Map(npmAll.map((p) => [p.name, p.license]));
const pyLicense = new Map(
  (pyAll ?? []).map((p) => [p.name.toLowerCase().replace(/_/g, '-'), p.license]),
);
for (const d of npmDirect.sort((a, b) => a.name.localeCompare(b.name))) {
  push(
    `| npm | ${cell(d.name)} | ${cell(d.version)} | ${d.kind} | ${d.where} | ${cell(npmLicense.get(d.name) || 'UNVERIFIED')} | ${cell(reasons.get(d.name.toLowerCase()))} |`,
  );
}
for (const d of pyDirect.sort((a, b) => a.name.localeCompare(b.name))) {
  const lic =
    pyLicense.get(d.name.toLowerCase().replace(/_/g, '-')) ||
    (pyAll ? 'UNVERIFIED' : 'UNVERIFIED (python env not installed)');
  push(
    `| pip | ${cell(d.name)} | ${cell(d.version)} | ${d.kind} | ${d.where} | ${cell(lic)} | ${cell(reasons.get(d.name.toLowerCase()))} |`,
  );
}

const ACCEPTED = ['tailwindcss', '@tailwindcss/vite', 'eslint', 'typescript', 'vitest'];
push(
  '',
  '### Version choices accepted by the owner (2026-10-14)',
  '',
  'Tailwind 4 (instead of 3.4: avoids 7 audit findings), ESLint 10 (v9 is unsupported), TypeScript 5.9.3 (typescript-eslint does not support newer), Vitest 4 (v5 needs Node 22+; PRD targets Node 20).',
  '',
  '| Package | Pinned version | Why |',
  '|---|---|---|',
);
for (const name of ACCEPTED) {
  const found = npmDirect.find((d) => d.name === name);
  if (found) push(`| ${name} | ${found.version} | ${cell(reasons.get(name.toLowerCase()))} |`);
}

push('', '## 2. Licence review summary', '');
const flagged = [
  ...npmAll
    .filter((p) => classify(p.license) !== 'ok (permissive)')
    .map((p) => ({ eco: 'npm', ...p })),
  ...(pyAll ?? [])
    .filter((p) => classify(p.license) !== 'ok (permissive)')
    .map((p) => ({ eco: 'pip', ...p })),
];
push(
  `- npm packages in lockfile: ${npmAll.length}; pip distributions installed: ${pyAll ? pyAll.length : 'not generated (run `npm run py:setup` first)'}`,
);
push(`- Packages needing review or with unverified licence: ${flagged.length}`);
if (flagged.length > 0) {
  push(
    '',
    '| Ecosystem | Package | Version | Declared licence | Status |',
    '|---|---|---|---|---|',
  );
  for (const p of flagged)
    push(
      `| ${p.eco} | ${cell(p.name)} | ${cell(p.version)} | ${cell(p.license || '(none)')} | ${classify(p.license)} |`,
    );
}

push(
  '',
  '## 3. Docker base images (pinned by tag and digest; checked on Docker Hub 2026-10-14)',
  '',
  '| Image | Used in | Licence note |',
  '|---|---|---|',
);
for (const { image, usedIn } of dockerImages()) {
  push(`| \`${cell(image)}\` | ${cell(usedIn)} | ${cell(imageLicenseNote(image))} |`);
}

push(
  '',
  '## 4. Installed agent skills (tooling only; not shipped)',
  '',
  'Source: `skills-lock.json`. Licence read from the installed skill files in `.agents/skills/` (git-ignored). UNVERIFIED means no licence was found locally; check the source repository.',
  '',
  '| Skill | Source repository | Licence | Status | How determined |',
  '|---|---|---|---|---|',
);
for (const s of skills())
  push(
    `| ${cell(s.name)} | ${cell(s.source)} | ${cell(s.license)} | ${s.license === 'UNVERIFIED' ? 'UNVERIFIED' : classify(s.license)} | ${cell(s.how)} |`,
  );

push(
  '',
  '## 5. Models and datasets',
  '',
  'Models: none used yet. Add each model (ASR, LLM, embeddings) here with licence and version when it is adopted (PRD §12, NFR-COMP-02).',
  '',
  '| Dataset | Version | Licence / terms | Use | Where it lives |',
  '|---|---|---|---|---|',
  '| National List of Essential Medicines (NLEM) | 2022 | Government of India publication (CDSCO). Reuse terms NOT yet checked: OWNER_ACTIONS. | Seeds `medicine_master` (FR-F5-01), ADR-D23 | PDF in `data/medicines/raw/` and every derived file in `data/medicines/` (git-ignored, ADR-D18); tests use synthetic fixtures only |',
  '| NLEM 2022 committee report | 2022 | Government of India publication (CDSCO). Reuse terms NOT yet checked. | Read only for the 384 / 386 note; nothing is copied from it | `data/medicines/raw/` (git-ignored) |',
  '',
  'Not adopted yet: DDInter 2.0 (CC BY-NC-SA 4.0, non-commercial: licence check first), SNOMED CT / CDCI / ATC (licensed releases the owner must supply), brand datasets of unclear provenance.',
);

push(
  '',
  '## 6. All npm packages (from package-lock.json)',
  '',
  '| Package | Version | Licence | Scope | Status |',
  '|---|---|---|---|---|',
);
for (const p of npmAll)
  push(
    `| ${cell(p.name)} | ${cell(p.version)} | ${cell(p.license || '(none)')} | ${p.dev ? 'dev' : 'runtime'}${p.optional ? ', optional' : ''} | ${classify(p.license)} |`,
  );

push('', '## 7. All installed Python distributions', '');
if (pyAll) {
  push('| Package | Version | Licence | Status |', '|---|---|---|---|');
  for (const p of pyAll)
    push(
      `| ${cell(p.name)} | ${cell(p.version)} | ${cell(p.license || '(none)')} | ${classify(p.license)} |`,
    );
} else {
  push(
    'Not generated: Python 3.11 environment not found. Run `npm run py:setup`, then `npm run sbom`.',
  );
}

writeFileSync(join(ROOT, 'docs', 'SBOM.md'), lines.join('\n') + '\n', 'utf8');
console.log(
  `Wrote docs/SBOM.md (${npmAll.length} npm, ${pyAll ? pyAll.length : 0} pip, ${flagged.length} flagged).`,
);
