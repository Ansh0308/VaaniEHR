// Plain-LLM Question Suggestion Baseline (Phase 11B, ADR-D43).
// Research-only pipeline. Evaluates candidate conditions and suggests questions directly using LLM/prompting.
// Strictly unapproved toy research baseline: never presents questions as clinical advice or guidelines.
import { createHash } from 'node:crypto';
import type { Outcome } from '../engine.js';
import type { Pathway } from '../types.js';
import type {
  BaselineProvider,
  BaselineValidity,
  ConsultationContext,
  LlmQuestionCandidate,
  PlainLlmQuestionOutput,
} from './types.js';

export const PLAIN_LLM_PROMPT_VERSION = '2026-11-18.plain-llm-v1';

export const PLAIN_LLM_SYSTEM_PROMPT = `You are a research evaluation assistant analyzing simulated consultation data for the VaaniEHR project.
You must analyze the patient's reported symptoms and confirmed clinical slots, identify candidate conditions from the available toy research pathways, and suggest the next relevant question.

STRICT RESEARCH BOUNDARIES:
1. This is a synthetic research evaluation on TOY PATHWAYS. Never invent medical guidelines, treatment recommendations, or claim clinical approval.
2. Output MUST be valid JSON adhering strictly to the schema below. No conversational prose or markdown formatting outside the JSON object.
3. Every suggested condition must carry a confidence score between 0.0 and 1.0 and a brief reasoning grounded in the provided facts.
4. When evidence is cited, quotes must match the dialogue text or confirmed slots.

JSON OUTPUT SCHEMA:
{
  "candidates": [
    {
      "pathway_id": "string",
      "title": "string",
      "confidence": number,
      "reasoning": "string",
      "evidence_quotes": ["string"]
    }
  ],
  "outcome": "QUESTION" | "RED_FLAG" | "ABSTAIN" | "COMPLETE",
  "suggested_question": "string or null",
  "reason_text": "string",
  "red_flags": ["string"],
  "evidence_references": ["string"],
  "abstention_reason": "string or null"
}`;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

export function buildPlainLlmUserPrompt(context: ConsultationContext, pathways: Pathway[]): string {
  const pathwaySummaries = pathways.map((p) => ({
    id: p.id,
    title: p.title[context.lang ?? 'en'] ?? p.title.en,
    slots: p.nodes.filter((n) => n.type === 'question').map((n) => n.slot),
  }));

  const slots = context.confirmed_slots;
  const dialogueText = (context.dialogue ?? [])
    .map((d) => `${d.speaker.toUpperCase()}: ${d.text}`)
    .join('\n');

  return JSON.stringify(
    {
      instructions: 'Evaluate candidates and suggest next question based strictly on context.',
      available_pathways: pathwaySummaries,
      confirmed_slots: slots,
      dialogue: dialogueText || 'No raw dialogue available; evaluate confirmed slots.',
      asked_node_keys: context.asked_node_keys ?? [],
      dismissed_node_keys: context.dismissed_node_keys ?? [],
      requested_lang: context.lang ?? 'en',
    },
    null,
    2,
  );
}

export function validatePlainLlmOutput(raw: unknown): {
  valid: boolean;
  errors: string[];
  parsed?: {
    candidates: LlmQuestionCandidate[];
    outcome: Outcome;
    suggested_question: string | null;
    reason_text: string;
    red_flags: string[];
    evidence_references: string[];
    abstention_reason: string | null;
  };
} {
  const errors: string[] = [];
  if (!isObj(raw)) {
    return { valid: false, errors: ['Output must be a JSON object'] };
  }

  // Check unexpected keys
  const allowedKeys = [
    'candidates',
    'outcome',
    'suggested_question',
    'reason_text',
    'red_flags',
    'evidence_references',
    'abstention_reason',
  ];
  for (const k of Object.keys(raw)) {
    if (!allowedKeys.includes(k)) {
      errors.push(`Unexpected top-level property "${k}"`);
    }
  }

  const validOutcomes: Outcome[] = ['QUESTION', 'RED_FLAG', 'ABSTAIN', 'COMPLETE'];
  if (!validOutcomes.includes(raw.outcome as Outcome)) {
    errors.push(
      `Invalid outcome "${String(raw.outcome)}"; must be one of ${validOutcomes.join(', ')}`,
    );
  }

  if (typeof raw.reason_text !== 'string') {
    errors.push('reason_text must be a string');
  }

  if (raw.suggested_question !== null && typeof raw.suggested_question !== 'string') {
    errors.push('suggested_question must be a string or null');
  }

  if (!Array.isArray(raw.red_flags)) {
    errors.push('red_flags must be an array');
  }

  if (!Array.isArray(raw.evidence_references)) {
    errors.push('evidence_references must be an array');
  }

  if (raw.abstention_reason !== null && typeof raw.abstention_reason !== 'string') {
    errors.push('abstention_reason must be a string or null');
  }

  const parsedCandidates: LlmQuestionCandidate[] = [];
  if (!Array.isArray(raw.candidates)) {
    errors.push('candidates must be an array');
  } else {
    for (const [idx, c] of raw.candidates.entries()) {
      if (!isObj(c)) {
        errors.push(`candidates[${idx}] must be an object`);
        continue;
      }
      if (!nonEmpty(c.pathway_id)) errors.push(`candidates[${idx}].pathway_id is required`);
      if (!nonEmpty(c.title)) errors.push(`candidates[${idx}].title is required`);
      if (
        typeof c.confidence !== 'number' ||
        Number.isNaN(c.confidence) ||
        c.confidence < 0 ||
        c.confidence > 1
      ) {
        errors.push(`candidates[${idx}].confidence must be a number between 0.0 and 1.0`);
      }
      if (typeof c.reasoning !== 'string') {
        errors.push(`candidates[${idx}].reasoning must be a string`);
      }
      parsedCandidates.push({
        pathway_id: String(c.pathway_id ?? ''),
        title: String(c.title ?? ''),
        confidence: Number(c.confidence ?? 0),
        reasoning: String(c.reasoning ?? ''),
        evidence_quotes: Array.isArray(c.evidence_quotes)
          ? c.evidence_quotes.map(String)
          : undefined,
      });
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    errors: [],
    parsed: {
      candidates: parsedCandidates,
      outcome: raw.outcome as Outcome,
      suggested_question: raw.suggested_question as string | null,
      reason_text: String(raw.reason_text ?? ''),
      red_flags: (raw.red_flags as string[]) ?? [],
      evidence_references: (raw.evidence_references as string[]) ?? [],
      abstention_reason: (raw.abstention_reason as string | null) ?? null,
    },
  };
}

/** Deterministic mock provider that simulates Plain-LLM predictions for testing without external calls. */
export class PlainLlmDeterministicMockProvider implements BaselineProvider {
  name = 'deterministic-mock-plain-llm';
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
      confirmed_slots: Record<string, unknown>;
      available_pathways: Array<{ id: string; title: string; slots: string[] }>;
    };

    const slots = payload.confirmed_slots ?? {};
    // Check for red flag indicators in mock
    const hasRedFlag = Object.keys(slots).some(
      (k) => k.includes('red_flag') || k.includes('emergency'),
    );
    if (hasRedFlag) {
      const response = {
        candidates: [
          {
            pathway_id: 'toy_condition_emergency',
            title: 'Toy Emergency Condition',
            confidence: 0.99,
            reasoning: 'Red-flag symptom identified in confirmed slots.',
            evidence_quotes: ['emergency slot positive'],
          },
        ],
        outcome: 'RED_FLAG',
        suggested_question: null,
        reason_text: 'Emergency red-flag symptom detected.',
        red_flags: ['toy_red_flag_alert'],
        evidence_references: ['emergency slot positive'],
        abstention_reason: null,
      };
      return {
        text: JSON.stringify(response),
        tokens: { prompt: 150, completion: 80, total: 230 },
      };
    }

    // Rank pathways based on slot matches
    const scored = (payload.available_pathways ?? [])
      .map((p) => {
        const matchCount = p.slots.filter(
          (s) => slots[s] !== undefined && slots[s] !== false,
        ).length;
        const confidence =
          p.slots.length > 0 ? Math.min(0.95, (matchCount + 1) / (p.slots.length + 1)) : 0.1;
        return {
          pathway_id: p.id,
          title: p.title,
          confidence: Math.round(confidence * 100) / 100,
          reasoning: `Matched ${matchCount} confirmed slots in toy pathway ${p.id}.`,
          evidence_quotes: Object.keys(slots).map((k) => `${k}=${String(slots[k])}`),
        };
      })
      .sort((a, b) => b.confidence - a.confidence);

    // Pick first unasked slot from top pathway
    const topPathway = payload.available_pathways?.find((p) => p.id === scored[0]?.pathway_id);
    const unaskedSlot = topPathway?.slots.find((s) => slots[s] === undefined);

    let outcome: Outcome = 'QUESTION';
    let suggestedQuestion: string | null = unaskedSlot ? `Is ${unaskedSlot} present?` : null;
    let reasonText = `Next diagnostic question for ${topPathway?.title ?? 'differential'}.`;

    if (!unaskedSlot) {
      outcome = 'COMPLETE';
      suggestedQuestion = null;
      reasonText = 'All pathway slots have been answered.';
    }

    const response = {
      candidates: scored.slice(0, 3),
      outcome,
      suggested_question: suggestedQuestion,
      reason_text: reasonText,
      red_flags: [],
      evidence_references: Object.keys(slots),
      abstention_reason: null,
    };

    const text = JSON.stringify(response);
    return {
      text,
      tokens: { prompt: 200, completion: 120, total: 320 },
    };
  }
}

export async function runPlainLlmBaseline(
  context: ConsultationContext,
  pathways: Pathway[],
  provider: BaselineProvider,
): Promise<PlainLlmQuestionOutput> {
  const start = Date.now();
  const systemPrompt = PLAIN_LLM_SYSTEM_PROMPT;
  const userPrompt = buildPlainLlmUserPrompt(context, pathways);

  const promptHash = createHash('sha256')
    .update(systemPrompt + '\n' + userPrompt)
    .digest('hex');
  const inputHash = createHash('sha256')
    .update(JSON.stringify(context.confirmed_slots))
    .digest('hex');

  let rawText: string;
  let tokens: { prompt: number; completion: number; total: number } | undefined;
  let validity: BaselineValidity = { is_valid: false, errors: [] };

  try {
    const res = await provider.complete(systemPrompt, userPrompt);
    rawText = res.text;
    tokens = res.tokens;
  } catch (err) {
    validity = {
      is_valid: false,
      errors: [`Provider completion failed: ${err instanceof Error ? err.message : String(err)}`],
    };
    return {
      engine: 'llm-only',
      candidates: [],
      outcome: 'ABSTAIN',
      suggested_question: null,
      reason_text: 'Provider execution failure',
      red_flags: [],
      evidence_references: [],
      validity,
      provenance: {
        engine: 'llm-only',
        provider: provider.name,
        model: provider.model,
        prompt_version: PLAIN_LLM_PROMPT_VERSION,
        prompt_hash: promptHash,
        input_hash: inputHash,
        latency_ms: Date.now() - start,
        tokens,
        synthetic_mock: provider.is_mock,
      },
      abstention_reason: 'Provider execution failure',
    };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawText);
  } catch {
    validity = { is_valid: false, errors: ['LLM output is not valid JSON'] };
  }

  if (parsedJson) {
    const validation = validatePlainLlmOutput(parsedJson);
    validity = { is_valid: validation.valid, errors: validation.errors };
    if (validation.valid && validation.parsed) {
      return {
        engine: 'llm-only',
        candidates: validation.parsed.candidates,
        outcome: validation.parsed.outcome,
        suggested_question: validation.parsed.suggested_question,
        reason_text: validation.parsed.reason_text,
        red_flags: validation.parsed.red_flags,
        evidence_references: validation.parsed.evidence_references,
        validity,
        provenance: {
          engine: 'llm-only',
          provider: provider.name,
          model: provider.model,
          prompt_version: PLAIN_LLM_PROMPT_VERSION,
          prompt_hash: promptHash,
          input_hash: inputHash,
          latency_ms: Date.now() - start,
          tokens,
          synthetic_mock: provider.is_mock,
        },
        abstention_reason: validation.parsed.abstention_reason,
      };
    }
  }

  // Fallback for invalid output
  return {
    engine: 'llm-only',
    candidates: [],
    outcome: 'ABSTAIN',
    suggested_question: null,
    reason_text: 'Malformed output rejected by schema validator',
    red_flags: [],
    evidence_references: [],
    validity,
    provenance: {
      engine: 'llm-only',
      provider: provider.name,
      model: provider.model,
      prompt_version: PLAIN_LLM_PROMPT_VERSION,
      prompt_hash: promptHash,
      input_hash: inputHash,
      latency_ms: Date.now() - start,
      tokens,
      synthetic_mock: provider.is_mock,
    },
    abstention_reason: 'Schema validation rejected malformed LLM response',
  };
}
