// Pathway loader with versioning (Phase 6A). The only file in this package that touches the disk.
// Files are *.pathway.json under a folder. An ACTIVE version is immutable: its content hash is recorded in
// pathways.lock.json (npm run pathways:lock) and a changed file fails the load; an edit is a NEW version number.
// Production loads status "active" only; status "test" loads only with allowTest (an explicit dev/test flag);
// status "draft" never loads. Per pathway id the highest eligible version wins.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Pathway } from './types.js';
import { validateSet } from './validate.js';

export const LOCK_FILE = 'pathways.lock.json';
export type Lock = Record<string, string>;

export interface LoadOptions {
  /** load status "test" pathways too (dev and tests only) */
  allowTest: boolean;
  /** every active pathway must have a matching entry in the lock file */
  requireLock?: boolean;
}

export interface Loaded {
  pathways: Pathway[];
  /** non-empty = do not use these pathways */
  problems: string[];
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export const pathwayHash = (p: unknown): string =>
  createHash('sha256').update(canonical(p)).digest('hex');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name.endsWith('.pathway.json')) out.push(full);
  }
  return out;
}

export function readLock(dir: string): Lock {
  const file = join(dir, LOCK_FILE);
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Lock) : {};
}

export function loadPathwayDir(dir: string, options: LoadOptions): Loaded {
  if (!existsSync(dir)) return { pathways: [], problems: [] };
  const problems: string[] = [];
  const items: { file: string; data: unknown }[] = [];
  for (const file of walk(dir)) {
    try {
      items.push({ file, data: JSON.parse(readFileSync(file, 'utf8')) });
    } catch {
      problems.push(`${file}: not valid JSON`);
    }
  }
  problems.push(...validateSet(items).errors);
  const lock = readLock(dir);
  const eligible: Pathway[] = [];
  for (const { data } of items) {
    const p = data as Pathway;
    if (p.status === 'active' || (p.status === 'test' && options.allowTest)) eligible.push(p);
  }
  for (const p of eligible.filter((x) => x.status === 'active')) {
    const key = `${p.id}@${p.version}`;
    const recorded = lock[key];
    if (recorded === undefined) {
      if (options.requireLock)
        problems.push(`${key}: active pathway is not in ${LOCK_FILE} (run the lock command)`);
    } else if (recorded !== pathwayHash(p)) {
      problems.push(
        `${key}: an active version is immutable but its content changed; make a new version`,
      );
    }
  }
  const latest = new Map<string, Pathway>();
  for (const p of eligible) {
    const prior = latest.get(p.id);
    if (!prior || p.version > prior.version) latest.set(p.id, p);
  }
  const pathways = [...latest.values()].sort((a, b) => a.id.localeCompare(b.id));
  return { pathways, problems };
}

/** Adds the hashes of active pathways that are not locked yet. Never changes an existing entry. */
export function lockActive(dir: string): { added: string[]; problems: string[] } {
  const { problems, pathways } = loadPathwayDir(dir, { allowTest: false });
  const lock = readLock(dir);
  const added: string[] = [];
  for (const p of pathways) {
    const key = `${p.id}@${p.version}`;
    if (lock[key] === undefined) {
      lock[key] = pathwayHash(p);
      added.push(key);
    }
  }
  if (problems.length === 0 && added.length > 0) {
    writeFileSync(join(dir, LOCK_FILE), `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
  }
  return { added, problems };
}
