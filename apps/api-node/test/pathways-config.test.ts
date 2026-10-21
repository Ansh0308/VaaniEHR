// Pathway configuration and catalog loading: test pathways only with the explicit flag, never in production, and any
// problem in a pathway file stops start-up. No database.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config/env.js';
import { loadCatalog } from '../src/pathways/catalog.js';
import { TOY_PATHWAYS_ENV } from './db/helpers.js';
import { baseEnv, testConfig } from './helpers.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('pathway configuration', () => {
  it('test pathways are off by default and cannot be switched on in production', () => {
    expect(testConfig().pathways.allowTest).toBe(false);
    const problems = (() => {
      try {
        loadConfig({ ...baseEnv, NODE_ENV: 'production', PATHWAYS_ALLOW_TEST: 'true' });
      } catch (e) {
        return e instanceof ConfigError ? e.problems : [];
      }
      return [];
    })();
    expect(problems.join()).toMatch(/PATHWAYS_ALLOW_TEST/);
  });
  it('engine parameters come from the environment and are range-checked', () => {
    const c = testConfig({ PATHWAY_QUESTION_CAP: '5', PATHWAY_ABSTAIN_THRESHOLD: '0.7' });
    expect(c.pathways.engine).toEqual({ question_cap: 5, abstain_threshold: 0.7 });
    expect(() => testConfig({ PATHWAY_ABSTAIN_THRESHOLD: '2' })).toThrow(ConfigError);
  });
});

describe('the catalog', () => {
  it('loads the toy pathways only when test pathways are allowed', () => {
    const on = loadCatalog(testConfig({ ...TOY_PATHWAYS_ENV }));
    expect(on.pathways.map((p) => p.id)).toEqual([
      'toy_condition_a',
      'toy_condition_b',
      'toy_condition_c',
    ]);
    expect(on.slotMap.mappings.length).toBeGreaterThan(0);
    const off = loadCatalog(testConfig({ ...TOY_PATHWAYS_ENV, PATHWAYS_ALLOW_TEST: 'false' }));
    expect(off.pathways).toEqual([]);
  });
  it('a missing folder is an empty catalog; a broken pathway file stops the load', () => {
    const none = loadCatalog(
      testConfig({ PATHWAYS_DIR: join(tmpdir(), 'no-such-pathways-folder') }),
    );
    expect(none.pathways).toEqual([]);
    const dir = mkdtempSync(join(tmpdir(), 'pw-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'bad.pathway.json'), JSON.stringify({ id: 'x', status: 'test' }), 'utf8');
    expect(() =>
      loadCatalog(testConfig({ PATHWAYS_DIR: dir, PATHWAYS_ALLOW_TEST: 'true' })),
    ).toThrow(/not valid/);
  });
});
