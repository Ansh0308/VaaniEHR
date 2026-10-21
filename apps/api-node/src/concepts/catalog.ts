// The concept list (remaining Phase 5 items, ADR-D37): the owner's UNREVIEWED draft word list, read once at start-up from
// a git-ignored file (default data/concepts/concepts.json, made by `python -m app.extraction.linking convert`). When the
// file is missing the catalog is "not loaded": the screen says so and nothing is suggested. Every concept is
// unreviewed, internal ids only; a SNOMED id on an unreviewed concept is refused.
import { existsSync, readFileSync } from 'node:fs';
import type { Config } from '../config/env.js';
import { ConceptLinker } from '../pathways/rules.js';

export interface ConceptRecord {
  id: string;
  labels: Record<string, string[]>;
  reviewStatus: 'unreviewed' | 'reviewed';
}
export interface ConceptCatalog {
  loaded: boolean;
  concepts: ConceptRecord[];
  linker: ConceptLinker | null;
}

export const NOT_LOADED: ConceptCatalog = { loaded: false, concepts: [], linker: null };

export function loadConceptCatalog(config: Config): ConceptCatalog {
  const file = config.concepts.file;
  if (!existsSync(file)) return NOT_LOADED;
  const data = JSON.parse(readFileSync(file, 'utf8')) as { concepts?: unknown };
  if (!Array.isArray(data.concepts)) throw new Error('concept list: "concepts" must be a list');
  const concepts: ConceptRecord[] = [];
  for (const raw of data.concepts as Record<string, unknown>[]) {
    const status = raw.review_status ?? 'unreviewed';
    if (status !== 'unreviewed' && status !== 'reviewed') {
      throw new Error(`concept ${String(raw.id)}: review_status must be unreviewed or reviewed`);
    }
    if (raw.snomed_id !== null && raw.snomed_id !== undefined && status !== 'reviewed') {
      throw new Error(
        `concept ${String(raw.id)}: a snomed_id is only allowed on a reviewed concept`,
      );
    }
    if (typeof raw.id !== 'string' || !/^[A-Za-z0-9_]{1,64}$/.test(raw.id)) {
      throw new Error('concept list: every concept needs an id of letters, digits and underscores');
    }
    concepts.push({
      id: raw.id,
      labels: (raw.labels ?? {}) as Record<string, string[]>,
      reviewStatus: status,
    });
  }
  return {
    loaded: true,
    concepts,
    linker: new ConceptLinker(concepts.map((c) => ({ id: c.id, labels: c.labels }))),
  };
}
