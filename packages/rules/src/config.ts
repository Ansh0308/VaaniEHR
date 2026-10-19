// Engine parameters. Nothing here is a clinical value; every tunable number of the engine lives in this object and is
// passed in by the caller (api-node reads it from the environment/config), none is hard-coded in the engine itself.

export interface EngineConfig {
  /** most questions suggested per session (asked + dismissed); FR-F4-07 */
  question_cap: number;
  /** a candidate must reach this score (0..1) for the engine not to abstain; FR-F4-06 */
  abstain_threshold: number;
  /** how many candidates are returned; FR-F4-09 */
  candidate_limit: number;
  /** each known-but-unmet rule takes this share of its weight off the score (0..1) */
  against_penalty: number;
  /** ask red-flag questions before all others when the pathway's red-flag conditions allow it; FR-F4-03 */
  red_flag_first: boolean;
}

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  question_cap: 8,
  abstain_threshold: 0.5,
  candidate_limit: 3,
  against_penalty: 0.5,
  red_flag_first: true,
};

const KEYS = Object.keys(DEFAULT_ENGINE_CONFIG);

/** Strict parse: unknown keys, wrong types and out-of-range numbers are errors (no silent defaults for bad input). */
export function parseEngineConfig(input: unknown): EngineConfig {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('engine config must be an object');
  }
  const raw = input as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (!KEYS.includes(key)) throw new Error(`engine config: unknown key "${key}"`);
  }
  const merged = { ...DEFAULT_ENGINE_CONFIG, ...raw };
  const intIn = (name: string, v: unknown, min: number, max: number): number => {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
      throw new Error(`engine config: ${name} must be an integer from ${min} to ${max}`);
    }
    return v;
  };
  const unit = (name: string, v: unknown): number => {
    if (typeof v !== 'number' || !(v >= 0 && v <= 1)) {
      throw new Error(`engine config: ${name} must be a number from 0 to 1`);
    }
    return v;
  };
  if (typeof merged.red_flag_first !== 'boolean') {
    throw new Error('engine config: red_flag_first must be true or false');
  }
  return {
    question_cap: intIn('question_cap', merged.question_cap, 0, 50),
    abstain_threshold: unit('abstain_threshold', merged.abstain_threshold),
    candidate_limit: intIn('candidate_limit', merged.candidate_limit, 1, 10),
    against_penalty: unit('against_penalty', merged.against_penalty),
    red_flag_first: merged.red_flag_first,
  };
}
