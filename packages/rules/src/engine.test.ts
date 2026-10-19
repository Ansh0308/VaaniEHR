// Property tests for the engine (Phase 6A): seeded random states over the toy pathways, many rounds.
import { describe, expect, it } from 'vitest';
import { DEFAULT_ENGINE_CONFIG, parseEngineConfig, type EngineConfig } from './config.js';
import { matches, runEngine, type EngineInput } from './engine.js';
import { clone, rng, toyPathways } from './testutil.js';
import { nodeKey, type QuestionNode, type SlotValue } from './types.js';

const pathways = toyPathways();
const questions = pathways.flatMap((p) =>
  p.nodes.filter((n): n is QuestionNode => n.type === 'question').map((n) => ({ p, n })),
);
const keys = questions.map(({ p, n }) => nodeKey(p.id, n.id));
const slotTypes = new Map(questions.map(({ n }) => [n.slot, n]));

function randomValue(r: () => number, n: QuestionNode): SlotValue {
  if (n.answer === 'boolean') return r() < 0.5;
  if (n.answer === 'number') return Math.floor(r() * 10);
  const choices = n.choices as string[];
  return choices[Math.floor(r() * choices.length)] as string;
}

function randomInput(r: () => number): EngineInput {
  const slots: Record<string, SlotValue> = {};
  for (const [slot, n] of slotTypes) if (r() < 0.45) slots[slot] = randomValue(r, n);
  const pick = (share: number) => keys.filter(() => r() < share);
  return { slots, asked: pick(0.2), dismissed: pick(0.1), snoozed: pick(0.1) };
}

const ROUNDS = 1500;
const configs: EngineConfig[] = [
  DEFAULT_ENGINE_CONFIG,
  { ...DEFAULT_ENGINE_CONFIG, question_cap: 2, abstain_threshold: 0.8 },
  { ...DEFAULT_ENGINE_CONFIG, question_cap: 0 },
  { ...DEFAULT_ENGINE_CONFIG, red_flag_first: false, against_penalty: 1, candidate_limit: 1 },
];

describe('engine properties', () => {
  it('never asks for an already answered slot, a hidden node, or past the cap', () => {
    const r = rng(1);
    for (let i = 0; i < ROUNDS; i++) {
      const input = randomInput(r);
      for (const config of configs) {
        const out = runEngine(pathways, input, config);
        if (out.outcome !== 'QUESTION') continue;
        expect(input.slots[out.slot as string]).toBeUndefined();
        const hidden = new Set([...input.asked, ...input.dismissed, ...input.snoozed]);
        expect(hidden.has(out.node_id as string)).toBe(false);
        expect(new Set([...input.asked, ...input.dismissed]).size).toBeLessThan(
          config.question_cap,
        );
        expect(out.ask).toBeTruthy();
        expect(out.reason_text).toBeTruthy();
      }
    }
  });

  it('a red-flag-positive slot always gives RED_FLAG, whatever else is true', () => {
    const r = rng(2);
    const flagged = questions.filter(({ n }) => n.red_flag_if);
    expect(flagged.length).toBeGreaterThan(0);
    for (let i = 0; i < ROUNDS; i++) {
      const input = randomInput(r);
      const target = flagged[Math.floor(r() * flagged.length)];
      if (!target) continue;
      input.slots[target.n.slot] = (target.n.red_flag_if as { value: SlotValue })
        .value as SlotValue;
      for (const config of configs) {
        const out = runEngine(pathways, input, config);
        expect(out.outcome).toBe('RED_FLAG');
        expect(out.red_flags).toContain(nodeKey(target.p.id, target.n.id));
        expect(out.ask).toBeNull();
      }
    }
  });

  it('gives the same output for the same input, whatever the order of pathways and slot keys', () => {
    const r = rng(3);
    for (let i = 0; i < ROUNDS; i++) {
      const input = randomInput(r);
      const first = runEngine(pathways, input);
      expect(runEngine(pathways, clone(input))).toEqual(first);
      const reversed = [...pathways].reverse();
      const shuffledSlots = Object.fromEntries(Object.entries(input.slots).reverse());
      expect(runEngine(reversed, { ...input, slots: shuffledSlots })).toEqual(first);
    }
  });

  it('abstains below the threshold and only then; COMPLETE needs a candidate at or above it', () => {
    const r = rng(4);
    let abstained = 0;
    let completed = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const input = randomInput(r);
      for (const config of configs) {
        const out = runEngine(pathways, input, config);
        const top = out.candidates[0]?.score ?? 0;
        if (out.outcome === 'ABSTAIN') {
          abstained += 1;
          expect(top).toBeLessThan(config.abstain_threshold);
        }
        if (out.outcome === 'COMPLETE') {
          completed += 1;
          expect(top).toBeGreaterThanOrEqual(config.abstain_threshold);
        }
      }
    }
    expect(abstained).toBeGreaterThan(0);
    expect(completed).toBeGreaterThan(0);
  });

  it('respects the question cap: a walked session never asks more than the cap', () => {
    for (const cap of [0, 1, 3, 8]) {
      const config = { ...DEFAULT_ENGINE_CONFIG, question_cap: cap };
      const asked: string[] = [];
      const slots: Record<string, SlotValue> = {};
      for (let step = 0; step < 60; step++) {
        const out = runEngine(pathways, { slots, asked, dismissed: [], snoozed: [] }, config);
        if (out.outcome !== 'QUESTION') break;
        asked.push(out.node_id as string);
        const n = slotTypes.get(out.slot as string) as QuestionNode;
        slots[n.slot] =
          n.answer === 'boolean' ? false : n.answer === 'number' ? 1 : (n.choices as string[])[2]!;
      }
      expect(asked.length).toBeLessThanOrEqual(cap);
    }
  });

  it('snoozed questions are not asked and do not count towards the cap', () => {
    const config = { ...DEFAULT_ENGINE_CONFIG, question_cap: 1 };
    const none = runEngine(
      pathways,
      { slots: {}, asked: [], dismissed: [], snoozed: keys },
      config,
    );
    expect(none.outcome).not.toBe('QUESTION');
    const some = runEngine(
      pathways,
      { slots: {}, asked: [], dismissed: [], snoozed: [keys[0]!] },
      config,
    );
    expect(some.outcome).toBe('QUESTION');
  });

  it('candidates carry evidence for and against, are ranked, limited and linked to a node and a source', () => {
    const base = { asked: [], dismissed: [], snoozed: [] };
    const two = runEngine(
      pathways,
      { ...base, slots: { toy_symptom_1: true, toy_symptom_2: true, toy_choice_1: 'z' } },
      { ...DEFAULT_ENGINE_CONFIG, candidate_limit: 2 },
    );
    expect(two.candidates).toHaveLength(2);
    expect(two.candidates[0]!.score).toBeGreaterThanOrEqual(two.candidates[1]!.score);
    const out = runEngine(pathways, { ...base, slots: { toy_symptom_1: true, toy_choice_1: 'z' } });
    const b = out.candidates.find((c) => c.pathway_id === 'toy_condition_b');
    expect(b?.evidence_for.map((e) => e.rule_id)).toEqual(['r1']);
    expect(b?.evidence_against.map((e) => e.rule_id)).toEqual(['r2']);
    expect(b?.evidence_against[0]?.node_id).toBe('q2');
    expect(b?.source.doc).toMatch(/TOY/);
  });

  it('uses the requested language for the question and the reason', () => {
    const out = runEngine(pathways, {
      slots: {},
      asked: [],
      dismissed: [],
      snoozed: [],
      lang: 'gu',
    });
    expect(out.ask).toMatch(/^\[TOY-GU\]/);
    expect(out.reason_text).toMatch(/^\[TOY-GU\]/);
  });

  it('never uses diagnosis or treatment wording in anything it outputs', () => {
    const r = rng(5);
    for (let i = 0; i < 300; i++) {
      const text = JSON.stringify(runEngine(pathways, randomInput(r)));
      expect(text).not.toMatch(/diagnos|confirmed|prescrib|treatment|medicine/i);
    }
  });
});

describe('conditions and config', () => {
  it('evaluates every operator and refuses numeric operators on non-numbers', () => {
    expect(matches(5, { op: 'gte', value: 5 })).toBe(true);
    expect(matches(4, { op: 'gt', value: 5 })).toBe(false);
    expect(matches(4, { op: 'lt', value: 5 })).toBe(true);
    expect(matches(5, { op: 'lte', value: 4 })).toBe(false);
    expect(matches('x', { op: 'in', value: ['x', 'y'] })).toBe(true);
    expect(matches(true, { op: 'ne', value: false })).toBe(true);
    expect(matches('5', { op: 'gte', value: 5 })).toBe(false);
    expect(matches(undefined, { op: 'ne', value: false })).toBe(false);
  });
  it('the config is strict: unknown keys and out-of-range numbers are refused', () => {
    expect(parseEngineConfig({ question_cap: 5 }).question_cap).toBe(5);
    expect(() => parseEngineConfig({ question_capp: 5 })).toThrow(/unknown key/);
    expect(() => parseEngineConfig({ abstain_threshold: 2 })).toThrow(/0 to 1/);
    expect(() => parseEngineConfig({ question_cap: 1.5 })).toThrow(/integer/);
    expect(() => parseEngineConfig({ red_flag_first: 'yes' })).toThrow(/true or false/);
    expect(() => parseEngineConfig(null)).toThrow();
  });
});
