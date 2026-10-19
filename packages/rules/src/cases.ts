// Regression case files (Phase 6A). A case says: with these confirmed slots and this history, the engine must give this
// outcome (and, for a question, this node). Hand-written per pathway; the runner is used by the tests and the CLI.
//   {"description": "...", "cases": [
//     {"name": "nothing known", "slots": {}, "asked": [], "expect": {"outcome": "QUESTION", "node": "toy_a/q1"}}
//   ]}
// "asked", "dismissed", "snoozed" are optional lists of node keys; "expect.top" optionally names the top candidate's
// pathway id; "expect.min_score" / "expect.max_score" optionally bound that candidate's score.
import type { EngineConfig } from './config.js';
import { runEngine } from './engine.js';
import type { Outcome } from './engine.js';
import type { Pathway, SlotValue } from './types.js';

export interface Case {
  name: string;
  slots: Record<string, SlotValue>;
  asked?: string[];
  dismissed?: string[];
  snoozed?: string[];
  expect: { outcome: Outcome; node?: string; top?: string; min_score?: number; max_score?: number };
}
export interface CaseFile {
  description?: string;
  cases: Case[];
}

export function runCases(pathways: Pathway[], file: CaseFile, config: EngineConfig): string[] {
  const failures: string[] = [];
  for (const c of file.cases) {
    const out = runEngine(
      pathways,
      {
        slots: c.slots,
        asked: c.asked ?? [],
        dismissed: c.dismissed ?? [],
        snoozed: c.snoozed ?? [],
      },
      config,
    );
    const bad = (why: string) => failures.push(`${c.name}: ${why}`);
    if (out.outcome !== c.expect.outcome) bad(`expected ${c.expect.outcome}, got ${out.outcome}`);
    if (c.expect.node !== undefined && out.node_id !== c.expect.node) {
      bad(`expected node ${c.expect.node}, got ${String(out.node_id)}`);
    }
    const top = out.candidates[0];
    if (c.expect.top !== undefined && top?.pathway_id !== c.expect.top) {
      bad(`expected top candidate ${c.expect.top}, got ${String(top?.pathway_id)}`);
    }
    if (c.expect.min_score !== undefined && (top?.score ?? 0) < c.expect.min_score)
      bad('top score below min_score');
    if (c.expect.max_score !== undefined && (top?.score ?? 0) > c.expect.max_score)
      bad('top score above max_score');
  }
  return failures;
}
