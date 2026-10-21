// Shared by the tests: the fake toy pathways and a seeded random generator. Not exported from the package.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPathwayDir } from './loader.js';
import type { Pathway } from './types.js';

export const FIXTURES = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'fixtures');
export const TOY_DIR = join(FIXTURES, 'pathways');
export const CASES_DIR = join(FIXTURES, 'cases');

export function toyPathways(): Pathway[] {
  const loaded = loadPathwayDir(TOY_DIR, { allowTest: true });
  if (loaded.problems.length > 0) throw new Error(loaded.problems.join('; '));
  return loaded.pathways;
}
export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
export const readJson = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8'));

/** mulberry32: small seeded generator so a failing random case can be reproduced */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fills the per-node source trail with FAKE values so a toy pathway can stand in for an active one in tests. */
export function withTrail<T extends object>(p: T): T {
  for (const n of (p as { nodes: Record<string, unknown>[] }).nodes) {
    n.source_quote = `TOY quote for ${String(n.id)}`;
    n.page = 1;
    if (n.type === 'terminal') n.refer = false;
  }
  return p;
}
