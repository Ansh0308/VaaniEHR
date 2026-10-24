// Rules-only question engine, simulated against a case's oracle answers (Phase 11A, ADR-D43). TOY PATHWAYS ONLY: the only pathways
// in the repository are fake, so every number this produces is labelled "toy" by the runner and never describes a real condition.
//   node --import tsx scripts/bench-rules.mjs <pathwayDir>      (reads a JSON array of cases on stdin, writes JSON on stdout)
// Case: {id, condition_label, oracle_slots, red_flag}. The simulated patient answers each question from oracle_slots (a slot the
// oracle does not know is dismissed). Reported per case: the top-1 and top-3 pathway ids at the end, the number of questions asked
// before the labelled condition first entered the top 3 (null if never), and whether a red flag stopped the run.
import { readFileSync } from 'node:fs';
import { DEFAULT_ENGINE_CONFIG, loadPathwayDir, runEngine } from '../packages/rules/src/index.ts';

const dir = process.argv[2];
if (!dir) throw new Error('usage: bench-rules.mjs <pathwayDir>');
const loaded = loadPathwayDir(dir, { allowTest: true, requireLock: false });
if (loaded.problems.length) throw new Error(`pathway problems: ${loaded.problems.length}`);
const cases = JSON.parse(readFileSync(0, 'utf8'));
const config = DEFAULT_ENGINE_CONFIG;

function simulate(c) {
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
    if (toTop3 === null && c.condition_label && top3.includes(c.condition_label))
      toTop3 = questions;
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
  };
}

const pathways = loaded.pathways.map((p) => ({ id: p.id, version: p.version }));
const report = {
  engine: 'rules-only',
  pathways: 'toy',
  pathway_versions: pathways,
  config,
  results: cases.map(simulate),
};
process.stdout.write(`${JSON.stringify(report)}
`);
