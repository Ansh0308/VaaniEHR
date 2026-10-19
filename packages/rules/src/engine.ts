// The question engine (Phase 6A, FR-F4-02, -03, -04, -06, -07, -09). PURE: no I/O, no clock, no randomness, no LLM.
// Input: the slots the doctor has CONFIRMED plus what was already suggested. Output: a ranked shortlist of candidate
// conditions (never a "diagnosis") and exactly one of: the next question, a red flag, or an abstention.
// The engine suggests; the doctor decides. It never names a medicine or a treatment.
import { DEFAULT_ENGINE_CONFIG, type EngineConfig } from './config.js';
import {
  nodeKey,
  type Condition,
  type Lang,
  type Pathway,
  type QuestionNode,
  type SlotValue,
} from './types.js';

export interface EngineInput {
  /** confirmed slot values only (slot name -> value) */
  slots: Record<string, SlotValue>;
  /** node keys (pathwayId/nodeId) already suggested and acted on */
  asked: string[];
  dismissed: string[];
  /** hidden for now; they do not count towards the cap */
  snoozed: string[];
  lang?: Lang;
}

export interface Evidence {
  rule_id: string;
  slot: string;
  /** the question node this rule is tied to (the STW node, FR-F4-09) */
  node_id: string | null;
}

export interface Candidate {
  pathway_id: string;
  version: number;
  title: string;
  score: number;
  evidence_for: Evidence[];
  evidence_against: Evidence[];
  source: { doc: string; page: string | number };
}

export type Outcome = 'QUESTION' | 'RED_FLAG' | 'ABSTAIN' | 'COMPLETE';

export interface EngineOutput {
  candidates: Candidate[];
  outcome: Outcome;
  /** node key (pathwayId/nodeId) for QUESTION and RED_FLAG, else null */
  node_id: string | null;
  pathway_id: string | null;
  pathway_version: number | null;
  slot: string | null;
  /** the question to put to the patient, in the requested language (QUESTION only) */
  ask: string | null;
  reason_text: string;
  /** every red flag that is currently raised, in the order they are reported */
  red_flags: string[];
}

export function matches(value: SlotValue | undefined, c: Condition): boolean {
  if (value === undefined) return false;
  const v = c.value;
  switch (c.op) {
    case 'eq':
      return value === v;
    case 'ne':
      return value !== v;
    case 'in':
      return Array.isArray(v) && v.includes(value);
    default: {
      if (typeof value !== 'number' || typeof v !== 'number') return false;
      return c.op === 'gt'
        ? value > v
        : c.op === 'gte'
          ? value >= v
          : c.op === 'lt'
            ? value < v
            : value <= v;
    }
  }
}

const questions = (p: Pathway): QuestionNode[] =>
  p.nodes.filter((n): n is QuestionNode => n.type === 'question');

const sortedPathways = (pathways: Pathway[]): Pathway[] =>
  [...pathways].sort((a, b) => a.id.localeCompare(b.id) || b.version - a.version);

const round4 = (n: number): number => Math.round(n * 10000) / 10000;

function score(
  p: Pathway,
  slots: Record<string, SlotValue>,
  cfg: EngineConfig,
  lang: Lang,
): Candidate {
  const slotNodes = new Map(questions(p).map((n) => [n.slot, n.id]));
  const evidenceFor: Evidence[] = [];
  const evidenceAgainst: Evidence[] = [];
  let total = 0;
  let forWeight = 0;
  let againstWeight = 0;
  for (const rule of p.rules) {
    total += rule.weight;
    const value = slots[rule.slot];
    if (value === undefined) continue;
    const e: Evidence = {
      rule_id: rule.id,
      slot: rule.slot,
      node_id: slotNodes.get(rule.slot) ?? null,
    };
    if (matches(value, rule.if)) {
      forWeight += rule.weight;
      evidenceFor.push(e);
    } else {
      againstWeight += rule.weight;
      evidenceAgainst.push(e);
    }
  }
  const raw = total > 0 ? (forWeight - cfg.against_penalty * againstWeight) / total : 0;
  return {
    pathway_id: p.id,
    version: p.version,
    title: p.title[lang],
    score: round4(Math.min(1, Math.max(0, raw))),
    evidence_for: evidenceFor,
    evidence_against: evidenceAgainst,
    source: { doc: p.source.doc, page: p.source.page },
  };
}

/** Nodes reachable from start through edges whose source node has been answered and whose condition holds. */
function askable(p: Pathway, slots: Record<string, SlotValue>): Set<string> {
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const open = new Set<string>([p.start]);
  const stack = [p.start];
  while (stack.length > 0) {
    const node = byId.get(stack.pop() as string);
    if (node?.type !== 'question') continue;
    const value = slots[node.slot];
    if (value === undefined) continue; // not answered yet: nothing beyond it opens
    for (const edge of node.edges ?? []) {
      if (matches(value, edge.if) && !open.has(edge.to)) {
        open.add(edge.to);
        stack.push(edge.to);
      }
    }
  }
  return open;
}

export function runEngine(
  pathways: Pathway[],
  input: EngineInput,
  config: EngineConfig = DEFAULT_ENGINE_CONFIG,
): EngineOutput {
  const lang: Lang = input.lang ?? 'en';
  const ordered = sortedPathways(pathways);
  const { slots } = input;

  const candidates = ordered
    .map((p) => score(p, slots, config, lang))
    .filter((c) => c.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score || a.pathway_id.localeCompare(b.pathway_id) || b.version - a.version,
    )
    .slice(0, config.candidate_limit);

  const base = {
    candidates,
    node_id: null,
    pathway_id: null,
    pathway_version: null,
    slot: null,
    ask: null,
  };

  // 1. red flags come before everything else, whatever the cap says
  const redFlags: { key: string; p: Pathway; n: QuestionNode }[] = [];
  for (const p of ordered) {
    for (const n of [...questions(p)].sort((a, b) => a.id.localeCompare(b.id))) {
      if (n.red_flag_if && matches(slots[n.slot], n.red_flag_if)) {
        redFlags.push({ key: nodeKey(p.id, n.id), p, n });
      }
    }
  }
  const flagKeys = redFlags.map((r) => r.key);
  const first = redFlags[0];
  if (first) {
    return {
      ...base,
      outcome: 'RED_FLAG',
      node_id: first.key,
      pathway_id: first.p.id,
      pathway_version: first.p.version,
      slot: first.n.slot,
      reason_text: first.n.reason[lang],
      red_flags: flagKeys,
    };
  }

  // 2. the next question
  const done = new Set([...input.asked, ...input.dismissed]);
  const hidden = new Set([...done, ...input.snoozed]);
  const capReached = done.size >= config.question_cap;
  type Option = { key: string; p: Pathway; n: QuestionNode; tier: number };
  const options: Option[] = [];
  if (!capReached) {
    for (const p of ordered) {
      const open = askable(p, slots);
      const compatible = p.red_flag_compatible_slots;
      const flagPresent =
        compatible === undefined ||
        compatible.some((s) => slots[s] !== undefined && slots[s] !== false && slots[s] !== 0);
      for (const n of questions(p)) {
        const key = nodeKey(p.id, n.id);
        if (!open.has(n.id) || hidden.has(key) || slots[n.slot] !== undefined) continue;
        const tier = config.red_flag_first && n.red_flag_if && flagPresent ? 0 : 1;
        options.push({ key, p, n, tier });
      }
    }
  }
  // total value of asking a slot = sum of the weights of the nodes that ask it, times "not yet known" (1 here)
  const totalBySlot = new Map<string, number>();
  for (const o of options)
    totalBySlot.set(o.n.slot, (totalBySlot.get(o.n.slot) ?? 0) + o.n.info_weight);
  options.sort(
    (a, b) =>
      a.tier - b.tier ||
      (totalBySlot.get(b.n.slot) ?? 0) - (totalBySlot.get(a.n.slot) ?? 0) ||
      b.n.info_weight - a.n.info_weight ||
      a.p.id.localeCompare(b.p.id) ||
      a.n.id.localeCompare(b.n.id),
  );
  const pick = options[0];
  if (pick) {
    return {
      ...base,
      outcome: 'QUESTION',
      node_id: pick.key,
      pathway_id: pick.p.id,
      pathway_version: pick.p.version,
      slot: pick.n.slot,
      ask: pick.n.ask[lang],
      reason_text: pick.n.reason[lang],
      red_flags: [],
    };
  }

  // 3. nothing left to ask: abstain when no candidate is strong enough, else the shortlist stands
  const top = candidates[0]?.score ?? 0;
  if (top < config.abstain_threshold) {
    return {
      ...base,
      outcome: 'ABSTAIN',
      reason_text: capReached
        ? 'question limit reached; more information needed'
        : 'more information needed',
      red_flags: [],
    };
  }
  return {
    ...base,
    outcome: 'COMPLETE',
    reason_text: capReached ? 'question limit reached' : 'no further questions',
    red_flags: [],
  };
}
