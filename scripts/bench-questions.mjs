// Benchmark question engines runner (Phase 11B, ADR-D43).
// Evaluates Rules-Only, Plain-LLM, and Hybrid question engines against synthetic benchmark cases.
// Usage: node --import tsx scripts/bench-questions.mjs <engine> <pathwayDir>
import { readFileSync } from 'node:fs';
import {
  DEFAULT_ENGINE_CONFIG,
  HybridDeterministicMockProvider,
  loadPathwayDir,
  PlainLlmDeterministicMockProvider,
  runEngine,
  runHybridBaseline,
  runPlainLlmBaseline,
} from '../packages/rules/src/index.ts';

const engine = process.argv[2] ?? 'rules-only';
const dir = process.argv[3];
if (!dir) {
  process.stderr.write('usage: bench-questions.mjs <rules-only|llm-only|hybrid> <pathwayDir>\n');
  process.exit(1);
}

const loaded = loadPathwayDir(dir, { allowTest: true, requireLock: false });
if (loaded.problems.length) throw new Error(`pathway problems: ${loaded.problems.length}`);
const cases = JSON.parse(readFileSync(0, 'utf8'));
const config = DEFAULT_ENGINE_CONFIG;

async function simulateRulesOnly(c) {
  const slots = {};
  const asked = [];
  const dismissed = [];
  let questions = 0;
  let toTop3 = null;
  let stoppedOnRedFlag = false;
  let last = null;

  for (let i = 0; i < config.question_cap + 4; i += 1) {
    last = runEngine(loaded.pathways, { slots, asked, dismissed, snoozed: [] }, config);
    const top3 = last.candidates.slice(0, 3).map((x) => x.pathway_id);
    if (toTop3 === null && c.condition_label && top3.includes(c.condition_label)) {
      toTop3 = questions;
    }
    if (last.outcome === 'RED_FLAG') {
      stoppedOnRedFlag = true;
      break;
    }
    if (last.outcome !== 'QUESTION' || !last.node_id) break;
    const slot = last.slot;
    questions += 1;
    if (slot && Object.prototype.hasOwnProperty.call(c.oracle_slots ?? {}, slot)) {
      slots[slot] = c.oracle_slots[slot];
      asked.push(last.node_id);
    } else {
      dismissed.push(last.node_id);
    }
  }

  const ids = (last?.candidates ?? []).map((x) => x.pathway_id);
  return {
    id: c.id,
    outcome: last?.outcome ?? 'NONE',
    top1: ids[0] ?? null,
    top3: ids.slice(0, 3),
    questions,
    questions_to_top3: toTop3,
    red_flag_stopped: stoppedOnRedFlag,
    valid: true,
    errors: [],
  };
}

async function simulatePlainLlm(c, provider) {
  const slots = {};
  const asked = [];
  const dismissed = [];
  let questions = 0;
  let toTop3 = null;
  let stoppedOnRedFlag = false;
  let last = null;

  for (let i = 0; i < config.question_cap + 4; i += 1) {
    const context = {
      case_id: c.id,
      confirmed_slots: slots,
      asked_node_keys: asked,
      dismissed_node_keys: dismissed,
      dialogue: c.dialogue ?? [],
      lang: 'en',
    };

    last = await runPlainLlmBaseline(context, loaded.pathways, provider);
    const top3 = (last.candidates ?? []).slice(0, 3).map((x) => x.pathway_id);
    if (toTop3 === null && c.condition_label && top3.includes(c.condition_label)) {
      toTop3 = questions;
    }
    if (last.outcome === 'RED_FLAG') {
      stoppedOnRedFlag = true;
      break;
    }
    if (last.outcome !== 'QUESTION' || !last.suggested_question) break;

    // In plain LLM, match suggested question to an unknown slot if possible
    questions += 1;
    const availableSlots = Object.keys(c.oracle_slots ?? {});
    const nextSlot = availableSlots.find((s) => !Object.prototype.hasOwnProperty.call(slots, s));
    if (nextSlot) {
      slots[nextSlot] = c.oracle_slots[nextSlot];
      asked.push(`llm_${nextSlot}`);
    } else {
      dismissed.push(`llm_unmatched_${questions}`);
      break;
    }
  }

  const ids = (last?.candidates ?? []).map((x) => x.pathway_id);
  return {
    id: c.id,
    outcome: last?.outcome ?? 'NONE',
    top1: ids[0] ?? null,
    top3: ids.slice(0, 3),
    questions,
    questions_to_top3: toTop3,
    red_flag_stopped: stoppedOnRedFlag,
    valid: last?.validity.is_valid ?? false,
    errors: last?.validity.errors ?? [],
  };
}

async function simulateHybrid(c, provider) {
  const slots = {};
  const asked = [];
  const dismissed = [];
  let questions = 0;
  let toTop3 = null;
  let stoppedOnRedFlag = false;
  let last = null;

  for (let i = 0; i < config.question_cap + 4; i += 1) {
    const context = {
      case_id: c.id,
      confirmed_slots: slots,
      asked_node_keys: asked,
      dismissed_node_keys: dismissed,
      dialogue: c.dialogue ?? [],
      lang: 'en',
    };

    last = await runHybridBaseline(context, loaded.pathways, provider);
    const top3 = (last.candidates ?? []).slice(0, 3).map((x) => x.pathway_id);
    if (toTop3 === null && c.condition_label && top3.includes(c.condition_label)) {
      toTop3 = questions;
    }
    if (last.final_outcome === 'RED_FLAG') {
      stoppedOnRedFlag = true;
      break;
    }
    if (last.final_outcome !== 'QUESTION' || !last.node_id) break;

    const slot = last.slot;
    questions += 1;
    if (slot && Object.prototype.hasOwnProperty.call(c.oracle_slots ?? {}, slot)) {
      slots[slot] = c.oracle_slots[slot];
      asked.push(last.node_id);
    } else {
      dismissed.push(last.node_id);
    }
  }

  const ids = (last?.candidates ?? []).map((x) => x.pathway_id);
  return {
    id: c.id,
    outcome: last?.final_outcome ?? 'NONE',
    top1: ids[0] ?? null,
    top3: ids.slice(0, 3),
    questions,
    questions_to_top3: toTop3,
    red_flag_stopped: stoppedOnRedFlag,
    valid: last?.validity.is_valid ?? false,
    errors: last?.validity.errors ?? [],
  };
}

async function main() {
  const pathways = loaded.pathways.map((p) => ({ id: p.id, version: p.version }));
  let results;
  let providerInfo = { name: 'rules-engine', model: 'deterministic', synthetic_mock: false };

  if (engine === 'rules-only') {
    results = await Promise.all(cases.map(simulateRulesOnly));
  } else if (engine === 'llm-only') {
    const provider = new PlainLlmDeterministicMockProvider();
    providerInfo = { name: provider.name, model: provider.model, synthetic_mock: provider.is_mock };
    results = [];
    for (const c of cases) {
      results.push(await simulatePlainLlm(c, provider));
    }
  } else if (engine === 'hybrid') {
    const provider = new HybridDeterministicMockProvider();
    providerInfo = { name: provider.name, model: provider.model, synthetic_mock: provider.is_mock };
    results = [];
    for (const c of cases) {
      results.push(await simulateHybrid(c, provider));
    }
  } else {
    throw new Error(`unknown question engine "${engine}"`);
  }

  const report = {
    engine,
    pathways: 'toy',
    pathway_versions: pathways,
    config,
    provider: providerInfo.name,
    model: providerInfo.model,
    synthetic_mock: providerInfo.synthetic_mock,
    results,
  };

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch((err) => {
  process.stderr.write(`Error: ${err.message}\n`);
  process.exit(1);
});
