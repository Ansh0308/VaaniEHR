import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadPathwayDir } from '../loader.js';
import {
  compareQuestionBaselines,
  HybridDeterministicMockProvider,
  PLAIN_LLM_PROMPT_VERSION,
  PlainLlmDeterministicMockProvider,
  runHybridBaseline,
  runPlainLlmBaseline,
  validatePlainLlmOutput,
  type BaselineProvider,
  type ConsultationContext,
} from './index.js';

const toyDir = resolve(__dirname, '../../fixtures/pathways/_toy');
const loaded = loadPathwayDir(toyDir, { allowTest: true, requireLock: false });

describe('Plain-LLM Question Baseline', () => {
  it('validates schema-compliant output correctly', () => {
    const valid = {
      candidates: [
        {
          pathway_id: 'toy_condition_a',
          title: 'Toy condition A',
          confidence: 0.85,
          reasoning: 'Symptoms match pathway A.',
          evidence_quotes: ['toy_symptom_1=true'],
        },
      ],
      outcome: 'QUESTION',
      suggested_question: 'Is toy symptom 2 present?',
      reason_text: 'Differentiates condition A.',
      red_flags: [],
      evidence_references: ['toy_symptom_1'],
      abstention_reason: null,
    };

    const res = validatePlainLlmOutput(valid);
    expect(res.valid).toBe(true);
    expect(res.errors).toHaveLength(0);
    expect(res.parsed?.candidates[0]?.confidence).toBe(0.85);
  });

  it('rejects malformed output, invalid outcomes, out-of-range confidence, and unexpected properties', () => {
    const badOutcome = {
      candidates: [],
      outcome: 'INVALID_OUTCOME',
      reason_text: 'test',
      red_flags: [],
      evidence_references: [],
      abstention_reason: null,
    };
    expect(validatePlainLlmOutput(badOutcome).valid).toBe(false);

    const badConfidence = {
      candidates: [
        {
          pathway_id: 'p1',
          title: 'Title',
          confidence: 1.5, // > 1.0
          reasoning: 'test',
        },
      ],
      outcome: 'QUESTION',
      reason_text: 'test',
      red_flags: [],
      evidence_references: [],
      abstention_reason: null,
    };
    expect(validatePlainLlmOutput(badConfidence).valid).toBe(false);

    const unexpectedProperty = {
      candidates: [],
      outcome: 'QUESTION',
      reason_text: 'test',
      red_flags: [],
      evidence_references: [],
      abstention_reason: null,
      hallucinated_guideline_citation: 'Invented Guideline 2026',
    };
    expect(validatePlainLlmOutput(unexpectedProperty).valid).toBe(false);
  });

  it('runs deterministic mock baseline and attaches provenance with prompt/input hashes', async () => {
    const context: ConsultationContext = {
      confirmed_slots: {
        toy_symptom_1: true,
      },
      dialogue: [{ speaker: 'patient', text: 'I have toy symptom 1.' }],
    };

    const provider = new PlainLlmDeterministicMockProvider();
    const res = await runPlainLlmBaseline(context, loaded.pathways, provider);

    expect(res.engine).toBe('llm-only');
    expect(res.validity.is_valid).toBe(true);
    expect(res.candidates.length).toBeGreaterThan(0);
    expect(res.provenance.prompt_version).toBe(PLAIN_LLM_PROMPT_VERSION);
    expect(res.provenance.prompt_hash).toHaveLength(64);
    expect(res.provenance.input_hash).toHaveLength(64);
    expect(res.provenance.synthetic_mock).toBe(true);
  });

  it('detects emergency symptoms and outputs RED_FLAG in Plain-LLM mock', async () => {
    const context: ConsultationContext = {
      confirmed_slots: {
        toy_symptom_red_flag: true,
      },
    };

    const provider = new PlainLlmDeterministicMockProvider();
    const res = await runPlainLlmBaseline(context, loaded.pathways, provider);

    expect(res.outcome).toBe('RED_FLAG');
    expect(res.red_flags.length).toBeGreaterThan(0);
  });

  it('fails safe with ABSTAIN when provider execution throws', async () => {
    const failingProvider: BaselineProvider = {
      name: 'failing-provider',
      model: 'fail-model',
      is_mock: false,
      async complete() {
        throw new Error('Network timeout simulation');
      },
    };

    const context: ConsultationContext = { confirmed_slots: {} };
    const res = await runPlainLlmBaseline(context, loaded.pathways, failingProvider);

    expect(res.outcome).toBe('ABSTAIN');
    expect(res.validity.is_valid).toBe(false);
    expect(res.abstention_reason).toMatch(/Provider execution failure/);
  });
});

describe('Hybrid Question Baseline', () => {
  it('enforces immutable deterministic red flags regardless of LLM', async () => {
    // Condition with red flag positive
    const context: ConsultationContext = {
      confirmed_slots: {
        toy_redflag_1: true, // red flag node in toy condition B
      },
    };

    const provider = new HybridDeterministicMockProvider();
    const res = await runHybridBaseline(context, loaded.pathways, provider);

    expect(res.deterministic_outcome).toBe('RED_FLAG');
    expect(res.final_outcome).toBe('RED_FLAG');
    expect(res.red_flags.length).toBeGreaterThan(0);
    expect(res.overrides_attempted).toBe(false);
  });

  it('allows natural phrasing refinement within deterministic question node', async () => {
    const context: ConsultationContext = {
      confirmed_slots: {
        toy_symptom_1: true,
      },
    };

    const provider = new HybridDeterministicMockProvider();
    const res = await runHybridBaseline(context, loaded.pathways, provider);

    expect(res.deterministic_outcome).toBe('QUESTION');
    expect(res.final_outcome).toBe('QUESTION');
    expect(res.node_id).toBeTruthy();
    expect(res.ask).toMatch(/Could you please tell me/i);
    expect(res.fallback_applied).toBe(false);
  });

  it('detects and rejects attempt by LLM to inject unreviewed candidate conditions', async () => {
    const maliciousProvider: BaselineProvider = {
      name: 'injection-mock',
      model: 'mock-malicious',
      is_mock: true,
      async complete() {
        return {
          text: JSON.stringify({
            phrased_question: 'Unverified question?',
            contextual_reason: 'Testing boundary enforcement',
            reranked_candidate_ids: [
              'toy_condition_a',
              'unreviewed_fake_condition_xyz', // Not in deterministic candidates!
            ],
          }),
        };
      },
    };

    const context: ConsultationContext = {
      confirmed_slots: {
        toy_symptom_1: true,
      },
    };

    const res = await runHybridBaseline(context, loaded.pathways, maliciousProvider);

    expect(res.overrides_attempted).toBe(true);
    expect(res.fallback_applied).toBe(true);
    // Unapproved condition must not be present in output candidates
    expect(res.candidates.some((c) => c.pathway_id === 'unreviewed_fake_condition_xyz')).toBe(
      false,
    );
    expect(res.validity.errors.join(' ')).toMatch(/unapproved candidate conditions/i);
  });

  it('fails safe to deterministic output if LLM returns malformed JSON or throws', async () => {
    const brokenProvider: BaselineProvider = {
      name: 'broken-provider',
      model: 'mock-broken',
      is_mock: true,
      async complete() {
        return { text: 'Not valid JSON at all!' };
      },
    };

    const context: ConsultationContext = {
      confirmed_slots: {
        toy_symptom_1: true,
      },
    };

    const res = await runHybridBaseline(context, loaded.pathways, brokenProvider);

    expect(res.final_outcome).toBe('QUESTION');
    expect(res.fallback_applied).toBe(true);
    expect(res.validity.is_valid).toBe(false);
    expect(res.ask).toBeTruthy(); // Still has deterministic question!
  });
});

describe('Question Baseline Comparison', () => {
  it('compares Rules-Only, Plain-LLM, and Hybrid side-by-side on consultation context', async () => {
    const context: ConsultationContext = {
      case_id: 'case_toy_eval_01',
      confirmed_slots: {
        toy_symptom_1: true,
      },
      dialogue: [{ speaker: 'patient', text: 'I am experiencing toy symptom 1.' }],
    };

    const comparison = await compareQuestionBaselines(context, loaded.pathways);

    expect(comparison.case_id).toBe('case_toy_eval_01');
    expect(comparison.rules_only.outcome).toBe('QUESTION');
    expect(comparison.plain_llm.engine).toBe('llm-only');
    expect(comparison.hybrid.engine).toBe('hybrid');
    expect(comparison.provider_mode).toBe('mock');
    expect(comparison.notes).toMatch(/toy research pathways only/i);
  });
});
