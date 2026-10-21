// Coverage of the regression cases (Phase 6B): which nodes and edges the hand-written cases exercise. Informational: a
// node is exercised when a case makes the engine suggest it, or answers its slot; an edge when a case answers its
// source node with a value that satisfies the edge condition; a terminal when one of its incoming edges is exercised.
import type { EngineConfig } from './config.js';
import type { CaseFile } from './cases.js';
import { matches, runEngine } from './engine.js';
import { nodeKey, type Pathway, type QuestionNode } from './types.js';

export interface Coverage {
  pathway_id: string;
  nodes_total: number;
  nodes_hit: number;
  edges_total: number;
  edges_hit: number;
  missing_nodes: string[];
  missing_edges: string[];
}

export function coverageReport(
  pathways: Pathway[],
  files: CaseFile[],
  config: EngineConfig,
): Coverage[] {
  const suggested = new Set<string>();
  const cases = files.flatMap((f) => f.cases);
  for (const c of cases) {
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
    if (out.node_id) suggested.add(out.node_id);
  }
  return pathways.map((p) => {
    const questions = p.nodes.filter((n): n is QuestionNode => n.type === 'question');
    const edgeHit = new Set<string>();
    const nodeHit = new Set<string>();
    const edgeName = (from: string, i: number, to: string) => `${from}#${i + 1}->${to}`;
    for (const q of questions) {
      if (suggested.has(nodeKey(p.id, q.id))) nodeHit.add(q.id);
      for (const c of cases) {
        const value = c.slots[q.slot];
        if (value === undefined) continue;
        nodeHit.add(q.id);
        (q.edges ?? []).forEach((e, i) => {
          if (matches(value, e.if)) {
            edgeHit.add(edgeName(q.id, i, e.to));
            nodeHit.add(e.to);
          }
        });
      }
    }
    const edges = questions.flatMap((q) => (q.edges ?? []).map((e, i) => edgeName(q.id, i, e.to)));
    return {
      pathway_id: p.id,
      nodes_total: p.nodes.length,
      nodes_hit: p.nodes.filter((n) => nodeHit.has(n.id)).length,
      edges_total: edges.length,
      edges_hit: edges.filter((e) => edgeHit.has(e)).length,
      missing_nodes: p.nodes.filter((n) => !nodeHit.has(n.id)).map((n) => n.id),
      missing_edges: edges.filter((e) => !edgeHit.has(e)),
    };
  });
}
