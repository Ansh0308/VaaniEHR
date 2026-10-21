// Concept suggestions and links (remaining Phase 5 items, ADR-D37). Suggestions are computed from the fact's value and
// the unreviewed list and are NEVER stored. A link is stored only when the doctor confirms it. No score leaves this module.
import type { Queryable } from '../db/tx.js';
import type { ConceptCatalog, ConceptRecord } from './catalog.js';

export type Lang = 'en' | 'gu' | 'hi';
export const SUGGESTIONS_PER_FACT = 3;

export interface SuggestionView {
  conceptId: string;
  label: string;
  reviewStatus: 'unreviewed' | 'reviewed';
}

export const conceptLabel = (c: ConceptRecord, lang: Lang): string =>
  c.labels[lang]?.[0] ?? c.labels.en?.[0] ?? c.id;

export const conceptExists = (catalog: ConceptCatalog, id: string): boolean =>
  catalog.concepts.some((c) => c.id === id);

interface OpenFact {
  id: string;
  type: string;
  value: string;
  concept_id: string | null;
  concept_status: string;
}

/** Suggestions for every fact of the session that is not rejected and has no confirmed link; plus labels for linked ones. */
export async function suggestForSession(
  db: Queryable,
  catalog: ConceptCatalog,
  sessionId: string,
  lang: Lang,
): Promise<{
  listLoaded: boolean;
  byFact: Record<string, SuggestionView[]>;
  conceptLabels: Record<string, string>;
}> {
  if (!catalog.loaded || !catalog.linker)
    return { listLoaded: false, byFact: {}, conceptLabels: {} };
  const facts = await db.query<OpenFact>(
    `SELECT id::text AS id, type, value, concept_id, concept_status FROM extracted_fact
      WHERE session_id = $1 AND status IN ('heard', 'confirmed', 'stale') ORDER BY created_at`,
    [sessionId],
  );
  const byFact: Record<string, SuggestionView[]> = {};
  const conceptLabels: Record<string, string> = {};
  const byId = new Map(catalog.concepts.map((c) => [c.id, c]));
  for (const f of facts.rows) {
    if (f.concept_id) {
      const known = byId.get(f.concept_id);
      conceptLabels[f.concept_id] = known ? conceptLabel(known, lang) : f.concept_id;
    }
    if (f.concept_status === 'confirmed') continue;
    const list = catalog.linker.suggest(f.type, f.value, SUGGESTIONS_PER_FACT).flatMap((s) => {
      const c = byId.get(s.concept_id);
      return c
        ? [{ conceptId: c.id, label: conceptLabel(c, lang), reviewStatus: c.reviewStatus }]
        : [];
    });
    if (list.length > 0) byFact[f.id] = list;
  }
  return { listLoaded: true, byFact, conceptLabels };
}

/** The doctor confirmed a link. Returns false when the fact is not of this session or is rejected. */
export async function confirmLink(
  db: Queryable,
  args: { sessionId: string; factId: string; conceptId: string; doctorId: string },
): Promise<'ok' | 'missing' | 'rejected' | 'not_linkable'> {
  const found = await db.query<{ type: string; status: string }>(
    'SELECT type, status FROM extracted_fact WHERE id = $1 AND session_id = $2 FOR UPDATE',
    [args.factId, args.sessionId],
  );
  const f = found.rows[0];
  if (!f) return 'missing';
  if (f.status === 'rejected') return 'rejected';
  if (f.type !== 'symptom') return 'not_linkable';
  await db.query(
    `UPDATE extracted_fact SET concept_id = $2, concept_status = 'confirmed', concept_confirmed_by = $3,
            concept_confirmed_at = now(), updated_at = now() WHERE id = $1`,
    [args.factId, args.conceptId, args.doctorId],
  );
  return 'ok';
}

/** The doctor cleared a link. Returns the cleared concept id, or null when there was none. */
export async function clearLink(
  db: Queryable,
  args: { sessionId: string; factId: string },
): Promise<string | null> {
  const found = await db.query<{ concept_id: string | null }>(
    'SELECT concept_id FROM extracted_fact WHERE id = $1 AND session_id = $2 FOR UPDATE',
    [args.factId, args.sessionId],
  );
  const id = found.rows[0]?.concept_id ?? null;
  if (id === null) return null;
  await db.query(
    `UPDATE extracted_fact SET concept_id = NULL, concept_status = 'none', concept_confirmed_by = NULL,
            concept_confirmed_at = NULL, updated_at = now() WHERE id = $1`,
    [args.factId],
  );
  return id;
}

/** Editing the words of a fact makes its link stale: it must be confirmed again. */
export async function markLinkStaleOnEdit(
  db: Queryable,
  factId: string,
  newValue: string,
): Promise<void> {
  await db.query(
    `UPDATE extracted_fact SET concept_status = 'stale'
      WHERE id = $1 AND concept_id IS NOT NULL AND concept_status = 'confirmed' AND value <> $2`,
    [factId, newValue],
  );
}
