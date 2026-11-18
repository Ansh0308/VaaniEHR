// Research Question Engine Baselines Index (Phase 11B, ADR-D43).
export * from './types.js';
export * from './plainLlm.js';
export * from './hybrid.js';

import { runEngine, type EngineInput } from '../engine.js';
import { DEFAULT_ENGINE_CONFIG } from '../config.js';
import type { Pathway } from '../types.js';
import { runPlainLlmBaseline, PlainLlmDeterministicMockProvider } from './plainLlm.js';
import { runHybridBaseline, HybridDeterministicMockProvider } from './hybrid.js';
import type {
  BaselineProvider,
  BaselineProviderMode,
  ConsultationContext,
  QuestionBaselineComparison,
} from './types.js';

export async function compareQuestionBaselines(
  context: ConsultationContext,
  pathways: Pathway[],
  options?: {
    plainLlmProvider?: BaselineProvider;
    hybridProvider?: BaselineProvider;
    mode?: BaselineProviderMode;
  },
): Promise<QuestionBaselineComparison> {
  const mode = options?.mode ?? (options?.plainLlmProvider?.is_mock === false ? 'live' : 'mock');

  const plainProvider = options?.plainLlmProvider ?? new PlainLlmDeterministicMockProvider();
  const hybridProvider = options?.hybridProvider ?? new HybridDeterministicMockProvider();

  // 1. Rules-Only
  const engineInput: EngineInput = {
    slots: context.confirmed_slots,
    asked: context.asked_node_keys ?? [],
    dismissed: context.dismissed_node_keys ?? [],
    snoozed: context.snoozed_node_keys ?? [],
    lang: context.lang ?? 'en',
  };
  const rulesOnly = runEngine(pathways, engineInput, DEFAULT_ENGINE_CONFIG);

  // 2. Plain-LLM
  const plainLlm = await runPlainLlmBaseline(context, pathways, plainProvider);

  // 3. Hybrid
  const hybrid = await runHybridBaseline(context, pathways, hybridProvider);

  return {
    case_id: context.case_id,
    context,
    rules_only: rulesOnly,
    plain_llm: plainLlm,
    hybrid,
    provider_mode: mode,
    notes:
      'Comparison evaluated on toy research pathways only. Plain-LLM and Hybrid baselines are research comparison models and are not clinically approved.',
  };
}
