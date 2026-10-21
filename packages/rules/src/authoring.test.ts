// Authoring tools (Phase 6B): scaffold, lint, next version, coverage, and the CLI exit codes. Fake toy content only.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { CaseFile } from './cases.js';
import { DEFAULT_ENGINE_CONFIG } from './config.js';
import { coverageReport } from './coverage.js';
import { lintPathway, nextVersion, scaffoldPathway } from './lint.js';
import { loadAllVersions, loadPathwayDir, lockActive } from './loader.js';
import {
  CASES_DIR,
  FIXTURES,
  TOY_DIR,
  clone,
  readJson,
  toyPathways,
  withTrail,
} from './testutil.js';

type Loose = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const toy = (): Loose => clone(toyPathways()[0]) as unknown as Loose;
const CLI = join(fileURLToPath(new URL('.', import.meta.url)), 'cli.ts');
const run = (...args: string[]) =>
  spawnSync(process.execPath, ['--import', 'tsx', CLI, ...args], { encoding: 'utf8' });

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'pw-auth-'));
  dirs.push(d);
  return d;
};
const messages = (raw: unknown) => lintPathway(raw).map((f) => `${f.level}: ${f.message}`);

describe('lint', () => {
  it('the toy pathways have no errors; gaps in their source trail are only warnings', () => {
    for (const p of toyPathways()) {
      const found = lintPathway(p);
      expect(found.filter((f) => f.level === 'error')).toEqual([]);
      expect(found.some((f) => /no source_quote/.test(f.message))).toBe(true);
    }
  });
  it('a DRAFT with gaps gets errors for each: source quote, page, refer flag, localized text, references', () => {
    const p = toy();
    p.status = 'draft';
    delete p.nodes[3].refer; // the terminal
    delete p.nodes[0].ask.hi;
    p.nodes[0].edges[0].to = 'ghost';
    p.nodes.push({ ...clone(p.nodes[0]), id: 'island', edges: [] });
    const text = messages(p).join('\n');
    expect(text).toMatch(/error: .*node q1: no source_quote/);
    expect(text).toMatch(/error: .*node q1: no page/);
    expect(text).toMatch(/error: .*node t1: terminal is missing the refer flag/);
    expect(text).toMatch(/error: .*text for "hi" is missing/);
    expect(text).toMatch(/error: .*unknown node "ghost"/);
    expect(text).toMatch(/error: .*node "island" cannot be reached/);
    expect(text).toMatch(/warning: .*node q3: no concept_id/);
  });
  it('a missing concept id is only a warning, and a placeholder source is reported', () => {
    const p = withTrail(toy());
    p.status = 'draft';
    p.nodes.forEach((n: Loose) => delete n.concept_id);
    p.source.doc = 'TODO(source)';
    const found = lintPathway(p);
    expect(
      found.filter((f) => /concept_id/.test(f.message)).every((f) => f.level === 'warning'),
    ).toBe(true);
    expect(found.find((f) => /source.doc is still a placeholder/.test(f.message))?.level).toBe(
      'warning',
    );
    p.status = 'active';
    expect(
      lintPathway(p).find((f) => /source.doc is still a placeholder/.test(f.message))?.level,
    ).toBe('error');
  });
  it('errors sort before warnings', () => {
    const p = toy();
    p.status = 'draft';
    const levels = lintPathway(p).map((f) => f.level);
    expect(levels.indexOf('warning')).toBeGreaterThan(levels.lastIndexOf('error'));
  });
});

describe('scaffold and next version', () => {
  it('a new pathway is an empty draft with every mandatory field and no clinical content', () => {
    const p = scaffoldPathway('new_condition', 'Some document');
    expect(p).toMatchObject({
      id: 'new_condition',
      version: 1,
      status: 'draft',
      nodes: [],
      rules: [],
    });
    expect((p.source as Loose).doc).toBe('Some document');
    expect(Object.keys(p.source as object)).toEqual(['doc', 'page', 'reviewed_by', 'reviewed_on']);
    expect((p.source as Loose).reviewed_by).toBe('');
    const found = messages(p).join('\n');
    expect(found).toMatch(/nodes must be a non-empty list/); // lint tells the author what is missing
  });
  it('the next version keeps the content, bumps the number, is a draft and clears the sign-off', () => {
    const p = withTrail(toy());
    p.status = 'active';
    p.version = 3;
    p.source.reviewed_by = 'Dr Fake Reviewer';
    p.source.reviewed_on = '2026-10-01';
    p.nodes[0].reviewed_by = 'Dr Fake Reviewer';
    const next = nextVersion(p) as Loose;
    expect(next).toMatchObject({ version: 4, status: 'draft' });
    expect(next.source).toMatchObject({ reviewed_by: '', reviewed_on: '' });
    expect(next.nodes[0].reviewed_by).toBeUndefined();
    expect(next.nodes[0].source_quote).toBe(p.nodes[0].source_quote);
    expect(p.version).toBe(3); // the original object is untouched
  });
});

describe('coverage', () => {
  it('counts the nodes and edges the case files exercise and names what is missing', () => {
    const files = [readJson(join(CASES_DIR, 'toy_condition_a.cases.json'))] as CaseFile[];
    const report = coverageReport(toyPathways(), files, DEFAULT_ENGINE_CONFIG);
    const a = report.find((r) => r.pathway_id === 'toy_condition_a');
    const c = report.find((r) => r.pathway_id === 'toy_condition_c');
    expect(a?.missing_nodes).toEqual([]);
    expect(c?.nodes_hit).toBeLessThan(c?.nodes_total ?? 0); // no case file for C was given
    expect(c?.missing_edges.length).toBeGreaterThan(0);
  });
  it('the real toy case files reach every node and edge', () => {
    const files = readdirSync(CASES_DIR)
      .filter((n) => n.endsWith('.cases.json'))
      .map((n) => readJson(join(CASES_DIR, n)) as CaseFile);
    for (const r of coverageReport(toyPathways(), files, DEFAULT_ENGINE_CONFIG)) {
      expect([r.pathway_id, r.missing_nodes, r.missing_edges]).toEqual([r.pathway_id, [], []]);
    }
  });
  it('the template case file is valid JSON in the case format and its placeholders are all marked TODO', () => {
    const t = readJson(
      join(FIXTURES, '..', 'templates', 'pathway-cases.template.json'),
    ) as CaseFile;
    expect(t.cases.length).toBeGreaterThanOrEqual(4);
    for (const c of t.cases) {
      expect(c.name).toMatch(/^TODO/);
      expect(['QUESTION', 'RED_FLAG', 'ABSTAIN', 'COMPLETE']).toContain(c.expect.outcome);
    }
  });
});

describe('version history for the viewer', () => {
  it('lists every usable version, newest first, and skips drafts', () => {
    const dir = tmp();
    const base = withTrail(toy());
    base.status = 'active';
    base.source.reviewed_by = 'Dr Fake Reviewer';
    base.source.reviewed_on = '2026-10-01';
    for (const v of [1, 2])
      writeFileSync(join(dir, `v${v}.pathway.json`), JSON.stringify({ ...base, version: v }));
    writeFileSync(
      join(dir, 'v3.pathway.json'),
      JSON.stringify({ ...base, version: 3, status: 'draft' }),
    );
    expect(loadAllVersions(dir, { allowTest: false }).map((p) => p.version)).toEqual([2, 1]);
    expect(loadAllVersions(TOY_DIR, { allowTest: false })).toEqual([]);
    expect(loadAllVersions(TOY_DIR, { allowTest: true })).toHaveLength(3);
  });
  it('a draft file that is incomplete does not stop the loader', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'half.pathway.json'), JSON.stringify(scaffoldPathway('half_done')));
    expect(loadPathwayDir(dir, { allowTest: true }).problems).toEqual([]);
  });
  it('the lock file carries a source note so it can live in seed/', () => {
    const dir = tmp();
    const base = withTrail(toy());
    base.status = 'active';
    base.source.reviewed_by = 'Dr Fake Reviewer';
    base.source.reviewed_on = '2026-10-01';
    writeFileSync(join(dir, 'a.pathway.json'), JSON.stringify(base));
    lockActive(dir);
    const lock = JSON.parse(readFileSync(join(dir, 'pathways.lock.json'), 'utf8'));
    expect(typeof lock.source).toBe('string');
    expect(Object.keys(lock.hashes)).toEqual(['toy_condition_a@1']);
    expect(loadPathwayDir(dir, { allowTest: false, requireLock: true }).problems).toEqual([]);
  });
});

describe('the command line', () => {
  it('new writes a draft, refuses to overwrite and refuses a bad id; lint then fails on it', () => {
    const dir = tmp();
    const made = run('new', dir, 'fresh_one', '--doc', 'Some document');
    expect(made.status).toBe(0);
    expect(existsSync(join(dir, 'fresh_one.pathway.json'))).toBe(true);
    expect(run('new', dir, 'fresh_one').status).toBe(2);
    expect(run('new', dir, 'Bad Id').status).toBe(2);
    const lint = run('lint', dir);
    expect(lint.status).toBe(1);
    expect(lint.stdout).toMatch(/ERROR/);
  });
  it('version writes the next draft file next to the old one and never edits the old one', () => {
    const dir = tmp();
    const base = withTrail(toy());
    base.status = 'active';
    base.source.reviewed_by = 'Dr Fake Reviewer';
    base.source.reviewed_on = '2026-10-01';
    const file = join(dir, 'a.pathway.json');
    writeFileSync(file, JSON.stringify(base));
    const before = readFileSync(file, 'utf8');
    expect(run('version', file).status).toBe(0);
    expect(readFileSync(file, 'utf8')).toBe(before);
    const next = JSON.parse(readFileSync(join(dir, 'toy_condition_a.v2.pathway.json'), 'utf8'));
    expect(next).toMatchObject({ version: 2, status: 'draft' });
    expect(run('version', file).status).toBe(2); // version 2 already exists
  });
  it('lint exits 0 on the toy pathways (warnings only), validate and cases pass, coverage can gate', () => {
    expect(run('lint', TOY_DIR).status).toBe(0);
    expect(run('validate', TOY_DIR, '--allow-test').status).toBe(0);
    expect(run('cases', TOY_DIR, CASES_DIR).status).toBe(0);
    expect(run('coverage', TOY_DIR, CASES_DIR, '--fail-under', '100').status).toBe(0);
    const half = tmp();
    writeFileSync(join(half, 'toy_condition_a.cases.json'), JSON.stringify({ cases: [] }));
    expect(run('coverage', TOY_DIR, half, '--fail-under', '100').status).toBe(1);
  });
  it('prints usage and exits 2 for an unknown command', () => {
    expect(run('nonsense').status).toBe(2);
    expect(execFileSync(process.execPath, ['--version'], { encoding: 'utf8' })).toMatch(/^v/);
  });
});
