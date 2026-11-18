// Hybrid Question Suggestion Baseline (Phase 11B, ADR-D43).
// Combines the deterministic rules question engine with controlled LLM phrasing and candidate re-ranking.
// The deterministic engine strictly enforces reachable nodes, question cap, red-flag stops, and candidate conditions.
import { createHash } from 'node:crypto';
import { runEngine, type Candidate, type EngineInput } from '../engine.js';
import type { Pathway } from '../types.js';
import { DEFAULT_ENGINE_CONFIG } from '../config.js';
import type {
  BaselineProvider,
  BaselineValidity,
  ConsultationContext,
  HybridQuestionOutput,
} from './types.js';

export const HYBRID_PROMPT_VERSION = '2026-11-18.hybrid-v1';

export const HYBRID_SYSTEM_PROMPT = `You are a research assistant participating in a Hybrid Question Engine experiment for VaaniEHR.
The deterministic clinical rules engine has already evaluated the consultation and computed:
1. Valid reachable candidate conditions.
2. The specific diagnostic question node to be asked.

YOUR RESEARCH ROLE:
- You may refine or adapt the phrasing of the suggested question to make it natural and clear for the patient.
- You may explain why this question is relevant in the context of the consultation.
- You CANNOT change the question's target slot or node ID.
- You CANNOT introduce candidate conditions that are not in the deterministic candidate list.
- You CANNOT suppress red flags.

JSON OUTPUT SCHEMA:
{
  "phrased_question": "string",
  "contextual_reason": "string",
  "reranked_candidate_ids": ["string"]
}`;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

export function buildHybridUserPrompt(
  context: ConsultationContext,
  deterministicAsk: string,
  deterministicSlot: string,
  deterministicCandidates: Candidate[],
): string {
  return JSON.stringify(
    {
      deterministic_suggested_question: deterministicAsk,
      target_slot: deterministicSlot,
      deterministic_candidates: deterministicCandidates.map((c) => ({
        pathway_id: c.pathway_id,
        title: c.title,
        score: c.score,
      })),
      dialogue: (context.dialogue ?? []).map((d) => `${d.speaker}: ${d.text}`).join('\n') || 'None',
      confirmed_slots: context.confirmed_slots,
      target_lang: context.lang ?? 'en',
    },
    null,
    2,
  );
}

export class HybridDeterministicMockProvider implements BaselineProvider {
  name = 'deterministic-mock-hybrid';
  model = 'mock-toy-v1';
  is_mock = true;

  constructor(private readonly customReply?: (system: string, user: string) => string) {}

  async complete(
    system: string,
    user: string,
  ): Promise<{
    text: string;
    tokens?: { prompt: number; completion: number; total: number };
  }> {
    if (this.customReply) {
      const text = this.customReply(system, user);
      return {
        text,
        tokens: {
          prompt: system.length / 4,
          completion: text.length / 4,
          total: (system.length + text.length) / 4,
        },
      };
    }

    const payload = JSON.parse(user) as {
      deterministic_suggested_question: string;
      deterministic_candidates: Array<{ pathway_id: string; title: string }>;
    };

    const phrased = payload.deterministic_suggested_question
      ? `Could you please tell me: ${payload.deterministic_suggested_question}`
      : 'No question needed.';

    const response = {
      phrased_question: phrased,
      contextual_reason:
        'Politely phrased for clear patient communication based on current symptoms.',
      reranked_candidate_ids: payload.deterministic_candidates.map((c) => c.pathway_id),
    };

    const text = JSON.stringify(response);
    return {
      text,
      tokens: { prompt: 180, completion: 90, total: 270 },
    };
  }
}

export async function runHybridBaseline(
  context: ConsultationContext,
  pathways: Pathway[],
  provider: BaselineProvider,
): Promise<HybridQuestionOutput> {
  const start = Date.now();

  // 1. Run deterministic question engine
  const engineInput: EngineInput = {
    slots: context.confirmed_slots,
    asked: context.asked_node_keys ?? [],
    dismissed: context.dismissed_node_keys ?? [],
    snoozed: context.snoozed_node_keys ?? [],
    lang: context.lang ?? 'en',
  };

  const deterministic = runEngine(pathways, engineInput, DEFAULT_ENGINE_CONFIG);
  const promptHash = createHash('sha256').update(HYBRID_SYSTEM_PROMPT).digest('hex');
  const inputHash = createHash('sha256')
    .update(JSON.stringify(context.confirmed_slots))
    .digest('hex');

  const baseProvenance = {
    engine: 'hybrid' as const,
    provider: provider.name,
    model: provider.model,
    prompt_version: HYBRID_PROMPT_VERSION,
    prompt_hash: promptHash,
    input_hash: inputHash,
    synthetic_mock: provider.is_mock,
  };

  // If deterministic outcome is RED_FLAG, ABSTAIN, or COMPLETE:
  // Deterministic constraints are immutable. The LLM is never called to override or suppress them.
  if (deterministic.outcome !== 'QUESTION') {
    return {
      engine: 'hybrid',
      deterministic_outcome: deterministic.outcome,
      final_outcome: deterministic.outcome,
      candidates: deterministic.candidates,
      node_id: deterministic.node_id,
      pathway_id: deterministic.pathway_id,
      pathway_version: deterministic.pathway_version,
      slot: deterministic.slot,
      ask: deterministic.ask,
      reason_text: deterministic.reason_text,
      red_flags: deterministic.red_flags,
      overrides_attempted: false,
      fallback_applied: false,
      validity: { is_valid: true, errors: [] },
      provenance: {
        ...baseProvenance,
        latency_ms: Date.now() - start,
      },
      abstention_reason:
        deterministic.outcome === 'ABSTAIN'
          ? 'Deterministic engine abstained (score threshold or cap)'
          : null,
    };
  }

  // Outcome is QUESTION: call LLM for phrasing and ranking assistance within deterministic constraints
  const userPrompt = buildHybridUserPrompt(
    context,
    deterministic.ask ?? '',
    deterministic.slot ?? '',
    deterministic.candidates,
  );

  let rawText: string;
  let tokens: { prompt: number; completion: number; total: number } | undefined;
  let validity: BaselineValidity = { is_valid: true, errors: [] };
  let overridesAttempted = false;
  let fallbackApplied = false;

  try {
    const res = await provider.complete(HYBRID_SYSTEM_PROMPT, userPrompt);
    rawText = res.text;
    tokens = res.tokens;
  } catch (err) {
    // Provider failure: fail-safe to deterministic output
    return {
      engine: 'hybrid',
      deterministic_outcome: deterministic.outcome,
      final_outcome: deterministic.outcome,
      candidates: deterministic.candidates,
      node_id: deterministic.node_id,
      pathway_id: deterministic.pathway_id,
      pathway_version: deterministic.pathway_version,
      slot: deterministic.slot,
      ask: deterministic.ask,
      reason_text: deterministic.reason_text,
      red_flags: deterministic.red_flags,
      overrides_attempted: false,
      fallback_applied: true,
      validity: {
        is_valid: false,
        errors: [`Provider completion failed: ${err instanceof Error ? err.message : String(err)}`],
      },
      provenance: {
        ...baseProvenance,
        latency_ms: Date.now() - start,
      },
      abstention_reason: null,
    };
  }

  let phrasedQuestion = deterministic.ask;
  let contextualReason = deterministic.reason_text;
  const finalCandidates = [...deterministic.candidates];

  try {
    const parsed = JSON.parse(rawText) as Obj;
    if (!isObj(parsed)) {
      validity = { is_valid: false, errors: ['Hybrid LLM response is not a JSON object'] };
      fallbackApplied = true;
    } else {
      // Validate phrased question
      if (nonEmpty(parsed.phrased_question)) {
        phrasedQuestion = parsed.phrased_question;
      }

      if (nonEmpty(parsed.contextual_reason)) {
        contextualReason = `${deterministic.reason_text} [LLM Phrasing: ${parsed.contextual_reason}]`;
      }

      // Check candidate re-ranking: only allowed to reorder existing deterministic candidates
      if (Array.isArray(parsed.reranked_candidate_ids)) {
        const allowedIds = new Set(deterministic.candidates.map((c) => c.pathway_id));
        const invalidIds = parsed.reranked_candidate_ids.filter(
          (id) => !allowedIds.has(String(id)),
        );

        if (invalidIds.length > 0) {
          // LLM attempted to inject an unreviewed candidate! REJECT and fallback!
          overridesAttempted = true;
          fallbackApplied = true;
          validity.errors.push(
            `LLM attempted to inject unapproved candidate conditions: [${invalidIds.join(', ')}]. Discarded.`,
          );
        } else {
          // Valid re-ordering of deterministic candidates
          const rankMap = new Map(
            parsed.reranked_candidate_ids.map((id, idx) => [String(id), idx]),
          );
          finalCandidates.sort((a, b) => {
            const rankA = rankMap.has(a.pathway_id) ? (rankMap.get(a.pathway_id) as number) : 999;
            const rankB = rankMap.has(b.pathway_id) ? (rankMap.get(b.pathway_id) as number) : 999;
            return rankA - rankB;
          });
        }
      }
    }
  } catch {
    validity = { is_valid: false, errors: ['Hybrid LLM output could not be parsed as JSON'] };
    fallbackApplied = true;
  }

  return {
    engine: 'hybrid',
    deterministic_outcome: deterministic.outcome,
    final_outcome: deterministic.outcome,
    candidates: finalCandidates,
    node_id: deterministic.node_id,
    pathway_id: deterministic.pathway_id,
    pathway_version: deterministic.pathway_version,
    slot: deterministic.slot,
    ask: phrasedQuestion,
    reason_text: contextualReason,
    red_flags: deterministic.red_flags,
    overrides_attempted: overridesAttempted,
    fallback_applied: fallbackApplied,
    validity,
    provenance: {
      ...baseProvenance,
      latency_ms: Date.now() - start,
      tokens,
    },
    abstention_reason: null,
  };
}
