// Research Question Engine Baselines (Phase 11B, ADR-D43).
// Pure interfaces and contracts for comparing Rules-Only, Plain-LLM, and Hybrid engines.
// Toy pathways only; never describes real clinical guidelines or approvals.
import type { Candidate, EngineOutput, Outcome } from '../engine.js';
import type { Lang, SlotValue } from '../types.js';

export type QuestionEngineKind = 'rules-only' | 'llm-only' | 'hybrid';
export type BaselineProviderMode = 'live' | 'mock' | 'unavailable';

export interface DialogueTurn {
  speaker: 'doctor' | 'patient' | 'other';
  text: string;
}

export interface ConsultationContext {
  case_id?: string;
  dialogue?: DialogueTurn[];
  confirmed_slots: Record<string, SlotValue>;
  asked_node_keys?: string[];
  dismissed_node_keys?: string[];
  snoozed_node_keys?: string[];
  lang?: Lang;
}

export interface LlmQuestionCandidate {
  pathway_id: string;
  title: string;
  confidence: number;
  reasoning: string;
  evidence_quotes?: string[];
}

export interface BaselineProvenance {
  engine: QuestionEngineKind;
  provider: string;
  model: string;
  prompt_version: string;
  prompt_hash: string;
  input_hash: string;
  latency_ms?: number;
  tokens?: {
    prompt: number;
    completion: number;
    total: number;
  };
  synthetic_mock: boolean;
}

export interface BaselineValidity {
  is_valid: boolean;
  errors: string[];
}

export interface PlainLlmQuestionOutput {
  engine: 'llm-only';
  candidates: LlmQuestionCandidate[];
  outcome: Outcome;
  suggested_question: string | null;
  reason_text: string;
  red_flags: string[];
  evidence_references: string[];
  validity: BaselineValidity;
  provenance: BaselineProvenance;
  abstention_reason: string | null;
}

export interface HybridQuestionOutput {
  engine: 'hybrid';
  deterministic_outcome: Outcome;
  final_outcome: Outcome;
  candidates: Candidate[];
  node_id: string | null;
  pathway_id: string | null;
  pathway_version: number | null;
  slot: string | null;
  ask: string | null;
  reason_text: string;
  red_flags: string[];
  overrides_attempted: boolean;
  fallback_applied: boolean;
  validity: BaselineValidity;
  provenance: BaselineProvenance;
  abstention_reason: string | null;
}

export interface BaselineProvider {
  name: string;
  model: string;
  is_mock: boolean;
  complete(
    systemPrompt: string,
    userPrompt: string,
  ): Promise<{
    text: string;
    tokens?: { prompt: number; completion: number; total: number };
  }>;
}

export interface QuestionBaselineComparison {
  case_id?: string;
  context: ConsultationContext;
  rules_only: EngineOutput;
  plain_llm: PlainLlmQuestionOutput;
  hybrid: HybridQuestionOutput;
  provider_mode: BaselineProviderMode;
  notes: string;
}

export interface BaselineSimulatedCase {
  id: string;
  condition_label?: string;
  oracle_slots?: Record<string, SlotValue>;
  dialogue?: DialogueTurn[];
  red_flag?: boolean;
}

export interface BaselineSimulationResult {
  id: string;
  engine: QuestionEngineKind;
  outcome: Outcome;
  top1: string | null;
  top3: string[];
  questions_asked: number;
  questions_to_top3: number | null;
  red_flag_stopped: boolean;
  validity: BaselineValidity;
  latency_ms: number;
  provider: string;
  synthetic_mock: boolean;
}
