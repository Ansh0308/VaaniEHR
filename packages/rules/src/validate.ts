// Pathway validator (Phase 6A). Pure: takes parsed JSON, returns problems. The CLI and the loader both use it.
// Rules: structure and types; every node reference known; every localized text present in en, gu and hi; an ACTIVE pathway
// needs a named reviewer and a review date; no wording that claims a diagnosis, a medicine or a treatment.
import {
  ANSWER_TYPES,
  LANGS,
  OPS,
  STATUSES,
  type AnswerType,
  type Condition,
  type Pathway,
} from './types.js';

/** Keys the JSON Schema (schema/pathway.schema.json) marks as required; a test keeps the two in step. */
export const REQUIRED_PATHWAY_KEYS = [
  'id',
  'version',
  'status',
  'title',
  'source',
  'start',
  'nodes',
  'rules',
] as const;
export const REQUIRED_SOURCE_KEYS = ['doc', 'page', 'reviewed_by', 'reviewed_on'] as const;

const ID = /^[a-z][a-z0-9_]{0,63}$/;
// English text only (gu/hi cannot be scanned): the engine may suggest questions and candidates, nothing more.
const FORBIDDEN = /diagnos|confirmed|prescrib|medicine|medication|treatment|\bdose\b|\bmg\b/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface Problems {
  errors: string[];
  warnings: string[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

function checkLocalized(where: string, v: unknown, errors: string[]): void {
  if (!isObj(v)) {
    errors.push(`${where}: localized text (en, gu, hi) is missing`);
    return;
  }
  for (const lang of LANGS) {
    if (!nonEmpty(v[lang])) errors.push(`${where}: text for "${lang}" is missing or empty`);
  }
  for (const key of Object.keys(v)) {
    if (!(LANGS as readonly string[]).includes(key))
      errors.push(`${where}: unknown language "${key}"`);
  }
  if (nonEmpty(v.en) && FORBIDDEN.test(v.en)) {
    errors.push(
      `${where}: forbidden wording (diagnosis, confirmation, medicine or treatment terms)`,
    );
  }
}

function checkCondition(
  where: string,
  c: unknown,
  answer: AnswerType | undefined,
  choices: string[] | undefined,
  errors: string[],
): void {
  if (!isObj(c) || !(OPS as readonly string[]).includes(String(c.op)) || !('value' in c)) {
    errors.push(`${where}: condition must be {op, value} with op one of ${OPS.join(', ')}`);
    return;
  }
  const cond = c as unknown as Condition;
  const values = Array.isArray(cond.value) ? cond.value : [cond.value];
  if (cond.op === 'in' ? !Array.isArray(cond.value) : Array.isArray(cond.value)) {
    errors.push(`${where}: "in" takes a list, every other operator a single value`);
    return;
  }
  if (!answer) return;
  const numericOp = ['gt', 'gte', 'lt', 'lte'].includes(cond.op);
  if (numericOp && answer !== 'number')
    errors.push(`${where}: ${cond.op} only applies to number slots`);
  for (const value of values) {
    const ok =
      answer === 'boolean'
        ? typeof value === 'boolean'
        : answer === 'number'
          ? typeof value === 'number' && Number.isFinite(value)
          : typeof value === 'string' && (choices ?? []).includes(value);
    if (!ok) errors.push(`${where}: value does not fit the ${answer} slot`);
  }
  if (answer === 'boolean' && !['eq', 'ne'].includes(cond.op)) {
    errors.push(`${where}: boolean slots only use eq or ne`);
  }
}

/** Validates ONE pathway object. `raw` is whatever JSON.parse gave. */
export function validatePathway(raw: unknown, label = 'pathway'): Problems {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isObj(raw)) return { errors: [`${label}: must be a JSON object`], warnings };
  for (const key of REQUIRED_PATHWAY_KEYS) {
    if (!(key in raw)) errors.push(`${label}: missing "${key}"`);
  }
  const id = typeof raw.id === 'string' ? raw.id : '?';
  const at = `${label} (${id})`;
  if (typeof raw.id !== 'string' || !ID.test(raw.id)) errors.push(`${at}: id must match ${ID}`);
  if (!Number.isInteger(raw.version) || (raw.version as number) < 1) {
    errors.push(`${at}: version must be a whole number from 1`);
  }
  if (!(STATUSES as readonly string[]).includes(String(raw.status))) {
    errors.push(`${at}: status must be one of ${STATUSES.join(', ')}`);
  }
  checkLocalized(`${at} title`, raw.title, errors);

  // source block
  const source = isObj(raw.source) ? raw.source : null;
  if (!source) errors.push(`${at}: source block is missing`);
  else {
    for (const key of REQUIRED_SOURCE_KEYS) {
      if (!(key in source)) errors.push(`${at}: source.${key} is missing`);
    }
    if (!nonEmpty(source.doc)) errors.push(`${at}: source.doc is empty`);
    if (raw.status === 'active') {
      if (!nonEmpty(source.reviewed_by)) {
        errors.push(
          `${at}: an active pathway needs source.reviewed_by (a named clinician reviewer)`,
        );
      }
      if (!nonEmpty(source.reviewed_on) || !DATE.test(source.reviewed_on)) {
        errors.push(`${at}: an active pathway needs source.reviewed_on as YYYY-MM-DD`);
      }
    } else if (nonEmpty(source.reviewed_on) && !DATE.test(source.reviewed_on)) {
      errors.push(`${at}: source.reviewed_on must be YYYY-MM-DD`);
    }
  }

  // nodes
  const nodes = Array.isArray(raw.nodes) ? raw.nodes : [];
  if (!Array.isArray(raw.nodes) || nodes.length === 0)
    errors.push(`${at}: nodes must be a non-empty list`);
  const byId = new Map<string, Obj>();
  for (const n of nodes) {
    if (!isObj(n) || typeof n.id !== 'string' || !ID.test(n.id)) {
      errors.push(`${at}: every node needs an id like "q1"`);
      continue;
    }
    if (byId.has(n.id)) errors.push(`${at}: duplicate node id "${n.id}"`);
    byId.set(n.id, n);
  }
  const slotNode = new Map<string, Obj>();
  for (const [nid, n] of byId) {
    const where = `${at} node ${nid}`;
    if (n.type === 'terminal') {
      checkLocalized(`${where} label`, n.label, errors);
      continue;
    }
    if (n.type !== 'question') {
      errors.push(`${where}: type must be "question" or "terminal"`);
      continue;
    }
    if (typeof n.slot !== 'string' || !ID.test(n.slot))
      errors.push(`${where}: slot name is missing or invalid`);
    else slotNode.set(n.slot, n);
    const answer = n.answer as AnswerType;
    if (!(ANSWER_TYPES as readonly string[]).includes(String(n.answer))) {
      errors.push(`${where}: answer must be one of ${ANSWER_TYPES.join(', ')}`);
    }
    const choices = Array.isArray(n.choices) ? (n.choices as string[]) : undefined;
    if (answer === 'choice' && (!choices || choices.length < 2)) {
      errors.push(`${where}: a choice slot needs at least two choices`);
    }
    checkLocalized(`${where} ask`, n.ask, errors);
    checkLocalized(`${where} reason`, n.reason, errors);
    if (typeof n.info_weight !== 'number' || !(n.info_weight > 0) || n.info_weight > 100) {
      errors.push(`${where}: info_weight must be a number above 0 and at most 100`);
    }
    if ('red_flag_if' in n)
      checkCondition(`${where} red_flag_if`, n.red_flag_if, answer, choices, errors);
    for (const [i, e] of (Array.isArray(n.edges) ? n.edges : []).entries()) {
      const ew = `${where} edge ${i + 1}`;
      if (!isObj(e) || typeof e.to !== 'string') {
        errors.push(`${ew}: needs {if, to}`);
        continue;
      }
      checkCondition(`${ew} if`, e.if, answer, choices, errors);
      if (!byId.has(e.to)) errors.push(`${ew}: unknown node "${e.to}"`);
    }
  }
  if (typeof raw.start !== 'string' || byId.get(raw.start)?.type !== 'question') {
    errors.push(`${at}: start must name a question node`);
  }

  // per-node source trail (Phase 6B): an ACTIVE pathway must show, for every node, the exact source sentence, its
  // page and a reviewer; test and draft pathways are exempt (lint reports what is still missing)
  const pathwayReviewer = source && nonEmpty(source.reviewed_by) ? source.reviewed_by : '';
  for (const [nid, n] of byId) {
    const where = `${at} node ${nid}`;
    if ('source_quote' in n && !nonEmpty(n.source_quote) && n.source_quote !== undefined) {
      errors.push(`${where}: source_quote must be a non-empty text`);
    }
    if ('page' in n && !(nonEmpty(n.page) || (typeof n.page === 'number' && n.page >= 0))) {
      errors.push(`${where}: page must be a page number or text`);
    }
    if ('refer' in n && typeof n.refer !== 'boolean')
      errors.push(`${where}: refer must be true or false`);
    if ('concept_id' in n && !nonEmpty(n.concept_id))
      errors.push(`${where}: concept_id must be a non-empty text`);
    if (raw.status !== 'active') continue;
    if (!nonEmpty(n.source_quote))
      errors.push(`${where}: an active pathway needs source_quote on every node`);
    if (!(nonEmpty(n.page) || (typeof n.page === 'number' && n.page >= 0))) {
      errors.push(`${where}: an active pathway needs page on every node`);
    }
    if (!nonEmpty(n.reviewed_by) && !pathwayReviewer) {
      errors.push(
        `${where}: an active pathway needs a reviewer (node reviewed_by or source.reviewed_by)`,
      );
    }
    if (n.type === 'terminal' && typeof n.refer !== 'boolean') {
      errors.push(`${where}: an active terminal needs the refer flag (true or false)`);
    }
  }

  // reachability from start along edges (every node must be reachable)
  if (typeof raw.start === 'string' && byId.has(raw.start)) {
    const seen = new Set<string>([raw.start]);
    const stack = [raw.start];
    while (stack.length > 0) {
      const cur = byId.get(stack.pop() as string);
      for (const e of Array.isArray(cur?.edges) ? (cur?.edges as Obj[]) : []) {
        if (typeof e.to === 'string' && !seen.has(e.to) && byId.has(e.to)) {
          seen.add(e.to);
          stack.push(e.to);
        }
      }
    }
    for (const nid of byId.keys()) {
      if (!seen.has(nid)) errors.push(`${at}: node "${nid}" cannot be reached from start`);
    }
  }

  // scoring rules
  const rules = Array.isArray(raw.rules) ? raw.rules : [];
  if (!Array.isArray(raw.rules) || rules.length === 0)
    errors.push(`${at}: rules must be a non-empty list`);
  const ruleIds = new Set<string>();
  for (const r of rules) {
    if (!isObj(r) || typeof r.id !== 'string' || !ID.test(r.id)) {
      errors.push(`${at}: every rule needs an id`);
      continue;
    }
    const where = `${at} rule ${r.id}`;
    if (ruleIds.has(r.id)) errors.push(`${where}: duplicate rule id`);
    ruleIds.add(r.id);
    const node = typeof r.slot === 'string' ? slotNode.get(r.slot) : undefined;
    if (!node) errors.push(`${where}: unknown slot "${String(r.slot)}" (no question node asks it)`);
    if (typeof r.weight !== 'number' || !(r.weight > 0) || r.weight > 100) {
      errors.push(`${where}: weight must be a number above 0 and at most 100`);
    }
    checkCondition(
      `${where} if`,
      r.if,
      node?.answer as AnswerType | undefined,
      Array.isArray(node?.choices) ? (node?.choices as string[]) : undefined,
      errors,
    );
  }
  if ('red_flag_compatible_slots' in raw) {
    const list = raw.red_flag_compatible_slots;
    if (!Array.isArray(list) || list.some((s) => typeof s !== 'string' || !slotNode.has(s))) {
      errors.push(`${at}: red_flag_compatible_slots must list slots that a question node asks`);
    }
  }
  return { errors, warnings };
}

/** Cross-pathway checks over a set of already parsed pathway objects (duplicate id@version). */
export function validateSet(items: { file: string; data: unknown }[]): Problems {
  const errors: string[] = [];
  const warnings: string[] = [];
  const seen = new Map<string, string>();
  for (const { file, data } of items) {
    const p = validatePathway(data, file);
    errors.push(...p.errors);
    warnings.push(...p.warnings);
    if (isObj(data) && typeof data.id === 'string' && Number.isInteger(data.version)) {
      const key = `${data.id}@${String(data.version)}`;
      const prior = seen.get(key);
      if (prior) errors.push(`${file}: ${key} is already defined in ${prior}`);
      seen.set(key, file);
    }
  }
  return { errors, warnings };
}

export type { Pathway };
