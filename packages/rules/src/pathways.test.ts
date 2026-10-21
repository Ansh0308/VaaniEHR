// Validator, loader, versioning, slot mapping and the hand-written regression cases (Phase 6A).
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runCases, type CaseFile } from './cases.js';
import { DEFAULT_ENGINE_CONFIG } from './config.js';
import { loadPathwayDir, lockActive, pathwayHash } from './loader.js';
import { factsToSlots, parseSlotMap } from './slots.js';
import { CASES_DIR, TOY_DIR, clone, readJson, toyPathways, withTrail } from './testutil.js';
import {
  REQUIRED_PATHWAY_KEYS,
  REQUIRED_SOURCE_KEYS,
  validatePathway,
  validateSet,
} from './validate.js';

type Loose = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const toy = (): Loose => clone(toyPathways()[0]) as unknown as Loose;
const errorsOf = (p: unknown) => validatePathway(p).errors.join(' | ');

describe('validator', () => {
  it('accepts the toy pathways', () => {
    for (const p of toyPathways()) expect(validatePathway(p).errors).toEqual([]);
  });
  it('reports missing localized text, naming the language', () => {
    const p = toy();
    delete p.nodes[0].ask.gu;
    p.title.hi = '';
    const e = errorsOf(p);
    expect(e).toMatch(/ask: text for "gu" is missing/);
    expect(e).toMatch(/title: text for "hi" is missing/);
  });
  it('reports unknown node references and unknown rule slots', () => {
    const p = toy();
    p.nodes[0].edges[0].to = 'nope';
    p.rules[0].slot = 'ghost_slot';
    p.start = 'zzz';
    const e = errorsOf(p);
    expect(e).toMatch(/unknown node "nope"/);
    expect(e).toMatch(/unknown slot "ghost_slot"/);
    expect(e).toMatch(/start must name a question node/);
  });
  it('an ACTIVE pathway needs a named reviewer and a review date; a test one does not', () => {
    const p = toy();
    p.status = 'active';
    expect(errorsOf(p)).toMatch(/reviewed_by/);
    expect(errorsOf(p)).toMatch(/reviewed_on/);
    p.source.reviewed_by = 'Dr Fake Reviewer';
    p.source.reviewed_on = '2026-10-01';
    withTrail(p);
    expect(validatePathway(p).errors).toEqual([]);
    p.source.reviewed_by = '   ';
    expect(errorsOf(p)).toMatch(/reviewed_by/);
  });
  it('an ACTIVE pathway needs source_quote, page and a reviewer on every node; a test one is exempt', () => {
    const p = withTrail(toy());
    p.status = 'active';
    p.source.reviewed_by = 'Dr Fake Reviewer';
    p.source.reviewed_on = '2026-10-01';
    expect(validatePathway(p).errors).toEqual([]);
    delete p.nodes[1].source_quote;
    delete p.nodes[2].page;
    delete p.nodes[p.nodes.length - 1].refer;
    const e = errorsOf(p);
    expect(e).toMatch(/node q2: an active pathway needs source_quote/);
    expect(e).toMatch(/node q3: an active pathway needs page/);
    expect(e).toMatch(/terminal needs the refer flag/);
    const t = toy(); // status test: no trail needed
    expect(t.status).toBe('test');
    expect(validatePathway(t).errors).toEqual([]);
  });
  it('a node may carry its own reviewer; without one the pathway reviewer counts', () => {
    const p = withTrail(toy());
    p.status = 'active';
    p.source.reviewed_on = '2026-10-01';
    p.source.reviewed_by = '';
    p.nodes.forEach((n: Record<string, unknown>) => (n.reviewed_by = 'Dr Fake Reviewer'));
    expect(errorsOf(p)).not.toMatch(/needs a reviewer/);
    delete p.nodes[0].reviewed_by;
    expect(errorsOf(p)).toMatch(/node q1: an active pathway needs a reviewer/);
  });
  it('wrong types in the optional trail fields are refused even on a test pathway', () => {
    const p = toy();
    p.nodes[0].source_quote = '  ';
    p.nodes[0].page = -2;
    p.nodes[p.nodes.length - 1].refer = 'yes';
    const e = errorsOf(p);
    expect(e).toMatch(/source_quote must be a non-empty text/);
    expect(e).toMatch(/page must be a page number or text/);
    expect(e).toMatch(/refer must be true or false/);
  });
  it('refuses diagnosis, medicine and treatment wording', () => {
    const p = toy();
    p.nodes[0].reason.en = 'This confirms the diagnosis; start the medicine';
    expect(errorsOf(p)).toMatch(/forbidden wording/);
  });
  it('refuses unreachable nodes, duplicate ids, bad values and bad ids', () => {
    const p = toy();
    p.nodes.push({ ...clone(p.nodes[0]), id: 'island' });
    p.nodes.push({ id: 'q1', type: 'terminal', label: p.title });
    p.rules[0].if = { op: 'eq', value: 'yes' };
    p.id = 'Bad Id';
    const e = errorsOf(p);
    expect(e).toMatch(/node "island" cannot be reached/);
    expect(e).toMatch(/duplicate node id "q1"/);
    expect(e).toMatch(/value does not fit the boolean slot/);
    expect(e).toMatch(/id must match/);
  });
  it('refuses a duplicate id@version across files', () => {
    const a = toy();
    expect(
      validateSet([
        { file: 'a', data: a },
        { file: 'b', data: clone(a) },
      ]).errors.join(),
    ).toMatch(/already defined in a/);
  });
  it('the JSON Schema and the validator agree on the required keys', () => {
    const schema = readJson(join(TOY_DIR, '..', '..', 'schema', 'pathway.schema.json')) as Loose;
    expect(schema.required).toEqual([...REQUIRED_PATHWAY_KEYS]);
    expect(schema.properties.source.required).toEqual([...REQUIRED_SOURCE_KEYS]);
  });
});

describe('loader and versions', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const folder = (files: Record<string, unknown>) => {
    const dir = mkdtempSync(join(tmpdir(), 'pathways-'));
    dirs.push(dir);
    mkdirSync(dir, { recursive: true });
    for (const [name, data] of Object.entries(files)) {
      writeFileSync(join(dir, name), JSON.stringify(data), 'utf8');
    }
    return dir;
  };
  const active = (version: number, over: Record<string, unknown> = {}) => {
    const p = toy();
    p.status = 'active';
    p.version = version;
    p.source.reviewed_by = 'Dr Fake Reviewer';
    p.source.reviewed_on = '2026-10-01';
    withTrail(p);
    return { ...p, ...over };
  };

  it('status test loads only with the explicit flag; draft never loads', () => {
    const t = toy();
    const d = { ...toy(), id: 'toy_draft', status: 'draft' };
    const dir = folder({ 'a.pathway.json': t, 'b.pathway.json': d });
    expect(loadPathwayDir(dir, { allowTest: false }).pathways).toEqual([]);
    const withTest = loadPathwayDir(dir, { allowTest: true });
    expect(withTest.pathways.map((p) => p.id)).toEqual([t.id]);
    expect(withTest.problems).toEqual([]);
  });
  it('the highest active version wins', () => {
    const dir = folder({
      'v1.pathway.json': active(1),
      'v2.pathway.json': active(2),
    });
    const loaded = loadPathwayDir(dir, { allowTest: false });
    expect(loaded.pathways.map((p) => p.version)).toEqual([2]);
  });
  it('an active version is immutable: changing it after locking fails; a new version is fine', () => {
    const dir = folder({ 'a.pathway.json': active(1) });
    expect(lockActive(dir).added).toEqual(['toy_condition_a@1']);
    expect(loadPathwayDir(dir, { allowTest: false, requireLock: true }).problems).toEqual([]);
    const edited = active(1);
    edited.title.en = 'Toy condition A (edited)';
    writeFileSync(join(dir, 'a.pathway.json'), JSON.stringify(edited), 'utf8');
    expect(loadPathwayDir(dir, { allowTest: false }).problems.join()).toMatch(/immutable/);
    writeFileSync(join(dir, 'a.pathway.json'), JSON.stringify(active(1)), 'utf8');
    writeFileSync(join(dir, 'a2.pathway.json'), JSON.stringify({ ...edited, version: 2 }), 'utf8');
    expect(lockActive(dir).added).toEqual(['toy_condition_a@2']);
    expect(loadPathwayDir(dir, { allowTest: false, requireLock: true }).problems).toEqual([]);
  });
  it('an active pathway missing from the lock file fails when the lock is required', () => {
    const dir = folder({ 'a.pathway.json': active(1) });
    expect(loadPathwayDir(dir, { allowTest: false, requireLock: true }).problems.join()).toMatch(
      /not in/,
    );
    expect(loadPathwayDir(dir, { allowTest: false }).problems).toEqual([]);
  });
  it('the hash ignores key order', () => {
    expect(pathwayHash({ a: 1, b: { c: 2, d: 3 } })).toBe(pathwayHash({ b: { d: 3, c: 2 }, a: 1 }));
  });
  it('a pathway file with a problem is reported, never silently dropped', () => {
    const bad = toy();
    delete bad.nodes[0].reason;
    const dir = folder({ 'a.pathway.json': bad });
    expect(loadPathwayDir(dir, { allowTest: true }).problems.join()).toMatch(/reason/);
  });
});

describe('facts to slots', () => {
  const map = parseSlotMap(readJson(join(TOY_DIR, '_toy', 'slot-map.json')));
  const f = (id: string, concept: string | null, over: Record<string, unknown> = {}) => ({
    id,
    status: 'confirmed',
    concept_id: concept,
    negated: false,
    uncertain: false,
    ...over,
  });
  it('only confirmed, certain, mapped facts set a slot; a negated fact gives false', () => {
    const r = factsToSlots(
      [
        f('1', 'toy_c_toy_symptom_1'),
        f('2', 'toy_c_toy_symptom_2', { negated: true }),
        f('3', 'toy_c_toy_symptom_5', { status: 'heard' }),
        f('4', 'toy_c_toy_symptom_6', { status: 'stale' }),
        f('5', 'toy_c_toy_redflag_1', { uncertain: true }),
        f('6', 'unmapped_concept'),
        f('7', null),
      ],
      map,
    );
    expect(r.slots).toEqual({ toy_symptom_1: true, toy_symptom_2: false });
    expect(r.used).toBe(2);
  });
  it('two confirmed facts that disagree leave the slot unknown and are reported', () => {
    const r = factsToSlots(
      [f('1', 'toy_c_toy_symptom_1'), f('2', 'toy_c_toy_symptom_1', { negated: true })],
      map,
    );
    expect(r.slots).toEqual({});
    expect(r.conflicts).toEqual(['toy_symptom_1']);
  });
  it('rejects a malformed map', () => {
    expect(() => parseSlotMap({ version: 2 })).toThrow();
    expect(() => parseSlotMap({ version: 1, mappings: [{ concept_id: 'x' }] })).toThrow();
  });
});

describe('regression case files', () => {
  const files = readdirSync(CASES_DIR).filter((n) => n.endsWith('.cases.json'));
  it('there is a case file for every toy pathway', () => {
    expect(files).toEqual(toyPathways().map((p) => `${p.id}.cases.json`));
  });
  for (const name of files) {
    it(`${name}: every case gives the expected outcome`, () => {
      const file = readJson(join(CASES_DIR, name)) as CaseFile;
      expect(file.cases.length).toBeGreaterThanOrEqual(5);
      expect(runCases(toyPathways(), file, DEFAULT_ENGINE_CONFIG)).toEqual([]);
    });
  }
  it('the runner reports a wrong expectation', () => {
    const file: CaseFile = {
      cases: [{ name: 'wrong', slots: {}, expect: { outcome: 'ABSTAIN' } }],
    };
    expect(runCases(toyPathways(), file, DEFAULT_ENGINE_CONFIG)).toEqual([
      'wrong: expected ABSTAIN, got QUESTION',
    ]);
  });
});
