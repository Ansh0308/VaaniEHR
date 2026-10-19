// Pathway types (Phase 6A, FR-F4-01). A pathway is a versioned graph of question nodes hand-encoded from a cited source
// and reviewed by a clinician. THIS PACKAGE HOLDS NO CLINICAL CONTENT: the only pathways in the repository are obviously
// fake toy ones (status "test"). The engine suggests questions and candidate conditions; it never names a final
// condition, a medicine or a treatment.

export const LANGS = ['en', 'gu', 'hi'] as const;
export type Lang = (typeof LANGS)[number];
export type Localized = Record<Lang, string>;

export const STATUSES = ['test', 'draft', 'active'] as const;
export type PathwayStatus = (typeof STATUSES)[number];

export type SlotValue = boolean | number | string;
export const ANSWER_TYPES = ['boolean', 'number', 'choice'] as const;
export type AnswerType = (typeof ANSWER_TYPES)[number];

export const OPS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in'] as const;
export type Op = (typeof OPS)[number];
export interface Condition {
  op: Op;
  value: SlotValue | SlotValue[];
}

export interface Source {
  doc: string;
  page: string | number;
  reviewed_by: string;
  reviewed_on: string;
}

export interface Edge {
  if: Condition;
  to: string;
}

export interface QuestionNode {
  id: string;
  type: 'question';
  slot: string;
  answer: AnswerType;
  choices?: string[];
  ask: Localized;
  /** one line: why the question is suggested ("asks because ...") */
  reason: Localized;
  info_weight: number;
  /** if the slot has this value, the engine raises a red flag */
  red_flag_if?: Condition;
  edges?: Edge[];
}

export interface TerminalNode {
  id: string;
  type: 'terminal';
  label: Localized;
}

export type PathwayNode = QuestionNode | TerminalNode;

/** One scoring rule: satisfied rules count for the condition, known-but-unsatisfied ones count against it. */
export interface Rule {
  id: string;
  slot: string;
  if: Condition;
  weight: number;
}

export interface Pathway {
  id: string;
  version: number;
  status: PathwayStatus;
  title: Localized;
  source: Source;
  start: string;
  /** red-flag questions go first only once one of these slots is present; absent = they always go first */
  red_flag_compatible_slots?: string[];
  nodes: PathwayNode[];
  rules: Rule[];
}

export const nodeKey = (pathwayId: string, nodeId: string): string => `${pathwayId}/${nodeId}`;
