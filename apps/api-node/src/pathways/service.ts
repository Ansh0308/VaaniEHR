// Pathway service (Phase 6A): turns the session's CONFIRMED facts into slots, asks the engine, and keeps the records.
// Nothing here calls a language model. Facts feed the engine only when status = confirmed (and carry a concept id that
// the slot map knows). The engine suggests; every row written here is a suggestion or a doctor's choice, never a result.
import { z } from 'zod';
import type { Queryable } from '../db/tx.js';
import type { PathwayCatalog } from './catalog.js';
import {
  factsToSlots,
  nodeKey,
  runEngine,
  type EngineOutput,
  type FactForSlots,
  type Lang,
} from './rules.js';

export const langQuery = z.object({ lang: z.enum(['en', 'gu', 'hi']).default('en') });
export type LangQuery = z.infer<typeof langQuery>;

export interface PathwayState {
  out: EngineOutput;
  /** slots left unknown because two confirmed facts disagreed (ids of slots, not text) */
  conflicts: string[];
  /** question events that count towards the cap */
  questionsUsed: number;
}

export async function computeState(
  db: Queryable,
  catalog: PathwayCatalog,
  sessionId: string,
  lang: Lang,
): Promise<PathwayState> {
  const facts = await db.query<FactForSlots>(
    `SELECT id::text AS id, status, concept_id, negated, uncertain FROM extracted_fact
      WHERE session_id = $1 AND status = 'confirmed' AND concept_id IS NOT NULL`,
    [sessionId],
  );
  const mapped = factsToSlots(facts.rows, catalog.slotMap);
  const last = await db.query<{ at: Date | null }>(
    "SELECT max(confirmed_at) AS at FROM extracted_fact WHERE session_id = $1 AND status = 'confirmed'",
    [sessionId],
  );
  const lastFact = last.rows[0]?.at ?? null;
  const events = await db.query<{
    pathway_id: string;
    node_id: string;
    status: 'asked' | 'dismissed' | 'snoozed';
    acted_at: Date;
  }>(
    `SELECT pathway_id, node_id, status, acted_at FROM question_event
      WHERE session_id = $1 AND kind = 'question' AND status IN ('asked', 'dismissed', 'snoozed')`,
    [sessionId],
  );
  const asked: string[] = [];
  const dismissed: string[] = [];
  const snoozed: string[] = [];
  for (const e of events.rows) {
    const key = nodeKey(e.pathway_id, e.node_id);
    if (e.status === 'asked') asked.push(key);
    else if (e.status === 'dismissed') dismissed.push(key);
    // a snoozed question stays hidden only until a newer confirmed fact arrives
    else if (!lastFact || e.acted_at >= lastFact) snoozed.push(key);
  }
  const out = runEngine(
    catalog.pathways,
    { slots: mapped.slots, asked, dismissed, snoozed, lang },
    catalog.engine,
  );
  return {
    out,
    conflicts: mapped.conflicts,
    questionsUsed: new Set([...asked, ...dismissed]).size,
  };
}

export interface EventRef {
  id: string;
  status: string;
  created: boolean;
}

/** The open suggestion for this node (or the red flag's record); a new row only when there is none. */
export async function ensureEvent(
  db: Queryable,
  session: { id: string; clinicId: string },
  out: EngineOutput,
): Promise<EventRef | null> {
  if (!out.pathway_id || !out.node_id || out.pathway_version === null || !out.slot) return null;
  const kind = out.outcome === 'RED_FLAG' ? 'red_flag' : 'question';
  const nodeId = out.node_id.slice(out.pathway_id.length + 1);
  const found = await db.query<{ id: string; status: string }>(
    `SELECT id, status FROM question_event
      WHERE session_id = $1 AND pathway_id = $2 AND node_id = $3 AND kind = $4
        AND (status = 'suggested' OR kind = 'red_flag')
      ORDER BY created_at DESC LIMIT 1`,
    [session.id, out.pathway_id, nodeId, kind],
  );
  const existing = found.rows[0];
  if (existing) return { id: existing.id, status: existing.status, created: false };
  const inserted = await db.query<{ id: string }>(
    `INSERT INTO question_event (session_id, clinic_id, pathway_id, pathway_version, node_id, slot, kind)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [session.id, session.clinicId, out.pathway_id, out.pathway_version, nodeId, out.slot, kind],
  );
  return { id: inserted.rows[0]?.id as string, status: 'suggested', created: true };
}

/**
 * Consent withdrawal (same idea as unconfirmed facts, ADR-D29/D34): derived pathway rows go; the doctor's own decisions
 * stay (a selected working condition, an acknowledged red flag).
 */
export async function deleteDerivedPathwayRows(
  db: Queryable,
  sessionId: string,
): Promise<{ questions: number; candidates: number }> {
  const q = await db.query(
    "DELETE FROM question_event WHERE session_id = $1 AND status <> 'acknowledged'",
    [sessionId],
  );
  const c = await db.query("DELETE FROM candidate WHERE session_id = $1 AND kind = 'derived'", [
    sessionId,
  ]);
  return { questions: q.rowCount ?? 0, candidates: c.rowCount ?? 0 };
}
