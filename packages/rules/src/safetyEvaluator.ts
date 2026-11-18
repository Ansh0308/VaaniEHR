// Generic Safety Rule Evaluation Infrastructure (Offline Only, Phase 7A).
// Deterministic, fail-closed evaluator for clinician-approved safety rule sets.
// Disconnected from live consultation signing and prescribing.
import {
  isSafetyRuleSetEligible,
  isSafetyRuleSetEligibleForProduction,
  isSyntheticSafetyRuleSet,
  safetyRuleSetHash,
  validateSafetyRuleCriteria,
  validateSafetyRuleSet,
  type SafetyLockEntry,
  type SafetyLockFile,
  type SafetyRuleKind,
  type SafetyRuleSetStatus,
} from './safety.js';

export {
  isSafetyRuleSetEligibleForProduction,
  isSyntheticSafetyRuleSet,
  validateSafetyRuleCriteria,
};
export type { SafetyLockEntry, SafetyLockFile, SafetyRuleKind, SafetyRuleSetStatus };

export class SafetyIntegrityError extends Error {
  constructor(
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'SafetyIntegrityError';
  }
}

export type SafetyRuleOutcome = 'pass' | 'alert' | 'not_evaluated' | 'configuration_error';
export type SafetyAlertSeverity = 'red' | 'amber';
export type SafetyClinicalScope = 'clinical' | 'synthetic_test';

export interface SafetyRuleProvenance {
  sourceId: string;
  documentTitle?: string;
  editionOrVersion?: string;
  citation: string;
  locator: string;
  licenseReuse?: string;
  reviewedOn?: string;
  reviewer?: string;
  reviewerRole?: string;
  approvalReference?: string;
}

export interface AllergyRuleCriteria {
  allergen: string;
  prohibited_substances: string[];
  description?: string;
}

export interface MaxDoseRuleCriteria {
  substance: string;
  max_daily_amount: number;
  unit: string;
  description?: string;
}

export interface DuplicateClassRuleCriteria {
  drug_class: string;
  substances: string[];
  max_allowed?: number;
  description?: string;
}

export interface InteractionRuleCriteria {
  substance_a: string;
  substance_b: string;
  description?: string;
}

export interface OutOfScopeRuleCriteria {
  condition?: string;
  min_age_years?: number;
  max_age_years?: number;
  prohibited_symptoms?: string[];
  description?: string;
}

export interface EvaluatableSafetyRule {
  id: string;
  kind: SafetyRuleKind;
  enabled: boolean;
  severity?: SafetyAlertSeverity;
  description?: string;
  source: {
    source_id?: string;
    document_title?: string;
    edition_or_version?: string;
    locator?: string;
    license_reuse?: string;
    citation: string;
  };
  clinical_review: {
    state: 'unreviewed' | 'pending' | 'approved';
    reviewer?: string;
    reviewer_role?: string;
    reviewed_on?: string;
    approval_reference?: string;
  };
  criteria?: unknown;
}

export interface EvaluatableSafetyRuleSet {
  id: string;
  schema_version: 1;
  version: number;
  status: SafetyRuleSetStatus;
  synthetic?: boolean;
  tier?: 'clinical' | 'synthetic_test';
  source: {
    source_id?: string;
    document_title?: string;
    edition_or_version?: string;
    locator?: string;
    license_reuse?: string;
    citation: string;
  };
  clinical_review: {
    state: 'unreviewed' | 'pending' | 'approved';
    reviewer?: string;
    reviewer_role?: string;
    reviewed_on?: string;
    approval_reference?: string;
  };
  rules: EvaluatableSafetyRule[];
}

export interface SimulatedPatientRecord {
  patientId?: string;
  ageYears?: number;
  allergies?: Array<{
    allergen: string;
    substance?: string;
  }>;
  symptoms?: string[];
  diagnoses?: string[];
}

export interface SimulatedPrescriptionItem {
  id?: string;
  substance: string;
  doseAmount?: number;
  doseUnit?: string;
  frequencyPerDay?: number;
  dailyAmount?: number;
  unit?: string;
}

export interface SafetyEvaluationInput {
  patient?: SimulatedPatientRecord;
  prescriptions?: SimulatedPrescriptionItem[];
  encounterCondition?: string;
}

export interface RuleEvaluationEvidence {
  matchedSubstances?: string[];
  matchedAllergens?: string[];
  matchedSymptoms?: string[];
  observedDailyAmount?: number;
  thresholdDailyAmount?: number;
  observedCount?: number;
  thresholdCount?: number;
  details?: string;
}

export interface RuleEvaluationResult {
  ruleId: string;
  ruleKind: SafetyRuleKind;
  outcome: SafetyRuleOutcome;
  severity?: SafetyAlertSeverity;
  message: string;
  evidence?: RuleEvaluationEvidence;
  provenance: SafetyRuleProvenance;
}

export interface RuleSetEvaluationSummary {
  ruleSetId: string;
  ruleSetVersion: number;
  ruleSetHash: string;
  status: SafetyRuleSetStatus;
  clinicalScope: SafetyClinicalScope;
  eligible: boolean;
  totalRules: number;
  evaluatedRules: number;
  counts: {
    pass: number;
    alert: number;
    not_evaluated: number;
    configuration_error: number;
  };
  alerts: {
    red: number;
    amber: number;
  };
  results: RuleEvaluationResult[];
}

export interface SafetyEvaluationOptions {
  lockEntry?: SafetyLockEntry;
  lockFile?: SafetyLockFile;
  enforceEligibility?: boolean;
  allowSynthetic?: boolean;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const normalize = (v: unknown): string => (typeof v === 'string' ? v.trim().toLowerCase() : '');

function extractProvenance(
  rule: EvaluatableSafetyRule,
  ruleSet: EvaluatableSafetyRuleSet,
): SafetyRuleProvenance {
  return {
    sourceId: rule.source.source_id ?? ruleSet.source.source_id ?? 'unknown-source',
    documentTitle: rule.source.document_title ?? ruleSet.source.document_title,
    editionOrVersion: rule.source.edition_or_version ?? ruleSet.source.edition_or_version,
    citation: rule.source.citation,
    locator: rule.source.locator ?? ruleSet.source.locator ?? '',
    licenseReuse: rule.source.license_reuse ?? ruleSet.source.license_reuse,
    reviewedOn: rule.clinical_review.reviewed_on ?? ruleSet.clinical_review.reviewed_on,
    reviewer: rule.clinical_review.reviewer ?? ruleSet.clinical_review.reviewer,
    reviewerRole: rule.clinical_review.reviewer_role ?? ruleSet.clinical_review.reviewer_role,
    approvalReference:
      rule.clinical_review.approval_reference ?? ruleSet.clinical_review.approval_reference,
  };
}

function evaluateAllergyRule(
  rule: EvaluatableSafetyRule,
  input: SafetyEvaluationInput,
  provenance: SafetyRuleProvenance,
): RuleEvaluationResult {
  const severity: SafetyAlertSeverity = rule.severity ?? 'red';
  const criteria = rule.criteria as AllergyRuleCriteria;

  if (input.patient === undefined) {
    return {
      ruleId: rule.id,
      ruleKind: rule.kind,
      outcome: 'configuration_error',
      severity,
      message: `Patient profile is required for allergy evaluation on rule "${rule.id}".`,
      provenance,
    };
  }

  if (input.patient.allergies === undefined || !Array.isArray(input.patient.allergies)) {
    return {
      ruleId: rule.id,
      ruleKind: rule.kind,
      outcome: 'configuration_error',
      severity,
      message: `Patient allergy history is required and must be an array for rule "${rule.id}".`,
      provenance,
    };
  }

  for (const [idx, allergy] of input.patient.allergies.entries()) {
    if (!isObj(allergy) || !nonEmpty(allergy.allergen)) {
      return {
        ruleId: rule.id,
        ruleKind: rule.kind,
        outcome: 'configuration_error',
        severity,
        message: `Patient allergy at index ${idx} is malformed or lacks non-empty allergen name.`,
        provenance,
      };
    }
  }

  if (input.prescriptions === undefined || !Array.isArray(input.prescriptions)) {
    return {
      ruleId: rule.id,
      ruleKind: rule.kind,
      outcome: 'configuration_error',
      severity,
      message: `Prescriptions list is required and must be an array for rule "${rule.id}".`,
      provenance,
    };
  }

  for (const [idx, rx] of input.prescriptions.entries()) {
    if (!isObj(rx) || !nonEmpty(rx.substance)) {
      return {
        ruleId: rule.id,
        ruleKind: rule.kind,
        outcome: 'configuration_error',
        severity,
        message: `Prescription at index ${idx} is invalid or missing non-empty substance string.`,
        provenance,
      };
    }
  }

  const patientAllergies = input.patient.allergies;
  const targetAllergenNorm = normalize(criteria.allergen);
  const patientHasAllergy = patientAllergies.some(
    (a) => normalize(a.allergen) === targetAllergenNorm,
  );

  if (!patientHasAllergy) {
    return {
      ruleId: rule.id,
      ruleKind: rule.kind,
      outcome: 'not_evaluated',
      message: `Patient has no documented allergy to "${criteria.allergen}".`,
      provenance,
    };
  }

  const prohibitedNorms = new Set(criteria.prohibited_substances.map(normalize));
  const matchedSubstances: string[] = [];

  for (const rx of input.prescriptions) {
    if (prohibitedNorms.has(normalize(rx.substance))) {
      matchedSubstances.push(rx.substance);
    }
  }

  if (matchedSubstances.length > 0) {
    return {
      ruleId: rule.id,
      ruleKind: rule.kind,
      outcome: 'alert',
      severity,
      message: `Prescribed substance(s) [${matchedSubstances.join(', ')}] cross-react with documented allergy "${criteria.allergen}".`,
      evidence: {
        matchedAllergens: [criteria.allergen],
        matchedSubstances,
      },
      provenance,
    };
  }

  return {
    ruleId: rule.id,
    ruleKind: rule.kind,
    outcome: 'pass',
    message: `Prescriptions evaluated against allergy "${criteria.allergen}"; no cross-reactive substances prescribed.`,
    evidence: {
      matchedAllergens: [criteria.allergen],
    },
    provenance,
  };
}

function evaluateMaxDoseRule(
  rule: EvaluatableSafetyRule,
  input: SafetyEvaluationInput,
  provenance: SafetyRuleProvenance,
): RuleEvaluationResult {
  const severity: SafetyAlertSeverity = rule.severity ?? 'red';
  const criteria = rule.criteria as MaxDoseRuleCriteria;

  if (input.prescriptions === undefined || !Array.isArray(input.prescriptions)) {
    return {
      ruleId: rule.id,
      ruleKind: rule.kind,
      outcome: 'configuration_error',
      severity,
      message: `Prescriptions must be an array for rule "${rule.id}".`,
      provenance,
    };
  }

  for (const [idx, rx] of input.prescriptions.entries()) {
    if (!isObj(rx) || !nonEmpty(rx.substance)) {
      return {
        ruleId: rule.id,
        ruleKind: rule.kind,
        outcome: 'configuration_error',
        severity,
        message: `Prescription at index ${idx} is invalid or missing non-empty substance string.`,
        provenance,
      };
    }
  }

  const targetSubstanceNorm = normalize(criteria.substance);
  const targetUnitNorm = normalize(criteria.unit);
  const matchingRx = input.prescriptions.filter(
    (rx) => normalize(rx.substance) === targetSubstanceNorm,
  );

  if (matchingRx.length === 0) {
    return {
      ruleId: rule.id,
      ruleKind: rule.kind,
      outcome: 'not_evaluated',
      message: `Substance "${criteria.substance}" is not prescribed.`,
      provenance,
    };
  }

  let totalDailyAmount = 0;

  for (const rx of matchingRx) {
    if (typeof rx.dailyAmount === 'number') {
      if (!Number.isFinite(rx.dailyAmount) || rx.dailyAmount <= 0) {
        return {
          ruleId: rule.id,
          ruleKind: rule.kind,
          outcome: 'configuration_error',
          severity,
          message: `Prescription dailyAmount for "${criteria.substance}" must be a positive finite number.`,
          provenance,
        };
      }
      if (rx.unit !== undefined && normalize(rx.unit) !== targetUnitNorm) {
        return {
          ruleId: rule.id,
          ruleKind: rule.kind,
          outcome: 'configuration_error',
          severity,
          message: `Unit mismatch for "${criteria.substance}": expected "${criteria.unit}", got "${rx.unit}".`,
          provenance,
        };
      }
      totalDailyAmount += rx.dailyAmount;
    } else if (typeof rx.doseAmount === 'number' && typeof rx.frequencyPerDay === 'number') {
      if (
        !Number.isFinite(rx.doseAmount) ||
        rx.doseAmount <= 0 ||
        !Number.isFinite(rx.frequencyPerDay) ||
        rx.frequencyPerDay <= 0
      ) {
        return {
          ruleId: rule.id,
          ruleKind: rule.kind,
          outcome: 'configuration_error',
          severity,
          message: `Prescription doseAmount and frequencyPerDay for "${criteria.substance}" must be positive numbers.`,
          provenance,
        };
      }
      if (rx.doseUnit !== undefined && normalize(rx.doseUnit) !== targetUnitNorm) {
        return {
          ruleId: rule.id,
          ruleKind: rule.kind,
          outcome: 'configuration_error',
          severity,
          message: `Unit mismatch for "${criteria.substance}": expected "${criteria.unit}", got "${rx.doseUnit}".`,
          provenance,
        };
      }
      totalDailyAmount += rx.doseAmount * rx.frequencyPerDay;
    } else {
      return {
        ruleId: rule.id,
        ruleKind: rule.kind,
        outcome: 'configuration_error',
        severity,
        message: `Prescription for "${criteria.substance}" lacks valid dailyAmount or doseAmount+frequencyPerDay.`,
        provenance,
      };
    }
  }

  if (totalDailyAmount > criteria.max_daily_amount) {
    return {
      ruleId: rule.id,
      ruleKind: rule.kind,
      outcome: 'alert',
      severity,
      message: `Daily dose for "${criteria.substance}" (${totalDailyAmount} ${criteria.unit}) exceeds maximum allowed (${criteria.max_daily_amount} ${criteria.unit}).`,
      evidence: {
        matchedSubstances: [criteria.substance],
        observedDailyAmount: totalDailyAmount,
        thresholdDailyAmount: criteria.max_daily_amount,
      },
      provenance,
    };
  }

  return {
    ruleId: rule.id,
    ruleKind: rule.kind,
    outcome: 'pass',
    message: `Daily dose for "${criteria.substance}" (${totalDailyAmount} ${criteria.unit}) is within allowed limit (${criteria.max_daily_amount} ${criteria.unit}).`,
    evidence: {
      matchedSubstances: [criteria.substance],
      observedDailyAmount: totalDailyAmount,
      thresholdDailyAmount: criteria.max_daily_amount,
    },
    provenance,
  };
}

function evaluateDuplicateClassRule(
  rule: EvaluatableSafetyRule,
  input: SafetyEvaluationInput,
  provenance: SafetyRuleProvenance,
): RuleEvaluationResult {
  const severity: SafetyAlertSeverity = rule.severity ?? 'amber';
  const criteria = rule.criteria as DuplicateClassRuleCriteria;
  const maxAllowed = criteria.max_allowed ?? 1;

  if (input.prescriptions === undefined || !Array.isArray(input.prescriptions)) {
    return {
      ruleId: rule.id,
      ruleKind: rule.kind,
      outcome: 'configuration_error',
      severity,
      message: `Prescriptions must be an array for rule "${rule.id}".`,
      provenance,
    };
  }

  for (const [idx, rx] of input.prescriptions.entries()) {
    if (!isObj(rx) || !nonEmpty(rx.substance)) {
      return {
        ruleId: rule.id,
        ruleKind: rule.kind,
        outcome: 'configuration_error',
        severity,
        message: `Prescription at index ${idx} is invalid or missing non-empty substance string.`,
        provenance,
      };
    }
  }

  const classSubstancesNorm = new Set(criteria.substances.map(normalize));
  const matchedSubstances: string[] = [];

  for (const rx of input.prescriptions) {
    if (classSubstancesNorm.has(normalize(rx.substance))) {
      matchedSubstances.push(rx.substance);
    }
  }

  if (matchedSubstances.length === 0) {
    return {
      ruleId: rule.id,
      ruleKind: rule.kind,
      outcome: 'not_evaluated',
      message: `No medications from class "${criteria.drug_class}" prescribed.`,
      provenance,
    };
  }

  if (matchedSubstances.length > maxAllowed) {
    return {
      ruleId: rule.id,
      ruleKind: rule.kind,
      outcome: 'alert',
      severity,
      message: `Duplicate medications prescribed from class "${criteria.drug_class}" (${matchedSubstances.join(', ')}): found ${matchedSubstances.length}, maximum allowed is ${maxAllowed}.`,
      evidence: {
        matchedSubstances,
        observedCount: matchedSubstances.length,
        thresholdCount: maxAllowed,
      },
      provenance,
    };
  }

  return {
    ruleId: rule.id,
    ruleKind: rule.kind,
    outcome: 'pass',
    message: `Medications from class "${criteria.drug_class}" count (${matchedSubstances.length}) is within allowed limit (${maxAllowed}).`,
    evidence: {
      matchedSubstances,
      observedCount: matchedSubstances.length,
      thresholdCount: maxAllowed,
    },
    provenance,
  };
}

function evaluateMajorInteractionRule(
  rule: EvaluatableSafetyRule,
  input: SafetyEvaluationInput,
  provenance: SafetyRuleProvenance,
): RuleEvaluationResult {
  const severity: SafetyAlertSeverity = rule.severity ?? 'red';
  const criteria = rule.criteria as InteractionRuleCriteria;

  if (input.prescriptions === undefined || !Array.isArray(input.prescriptions)) {
    return {
      ruleId: rule.id,
      ruleKind: rule.kind,
      outcome: 'configuration_error',
      severity,
      message: `Prescriptions must be an array for rule "${rule.id}".`,
      provenance,
    };
  }

  for (const [idx, rx] of input.prescriptions.entries()) {
    if (!isObj(rx) || !nonEmpty(rx.substance)) {
      return {
        ruleId: rule.id,
        ruleKind: rule.kind,
        outcome: 'configuration_error',
        severity,
        message: `Prescription at index ${idx} is invalid or missing non-empty substance string.`,
        provenance,
      };
    }
  }

  const prescribedNorms = new Set<string>();
  for (const rx of input.prescriptions) {
    prescribedNorms.add(normalize(rx.substance));
  }

  const normA = normalize(criteria.substance_a);
  const normB = normalize(criteria.substance_b);
  const hasA = prescribedNorms.has(normA);
  const hasB = prescribedNorms.has(normB);

  if (!hasA && !hasB) {
    return {
      ruleId: rule.id,
      ruleKind: rule.kind,
      outcome: 'not_evaluated',
      message: `Neither "${criteria.substance_a}" nor "${criteria.substance_b}" is prescribed.`,
      provenance,
    };
  }

  if (hasA && hasB) {
    return {
      ruleId: rule.id,
      ruleKind: rule.kind,
      outcome: 'alert',
      severity,
      message: `Major interaction detected: both "${criteria.substance_a}" and "${criteria.substance_b}" are prescribed concurrently.`,
      evidence: {
        matchedSubstances: [criteria.substance_a, criteria.substance_b],
      },
      provenance,
    };
  }

  const presentSubstance = hasA ? criteria.substance_a : criteria.substance_b;
  const missingPartner = hasA ? criteria.substance_b : criteria.substance_a;

  return {
    ruleId: rule.id,
    ruleKind: rule.kind,
    outcome: 'pass',
    message: `"${presentSubstance}" prescribed; interacting partner "${missingPartner}" is not prescribed.`,
    evidence: {
      matchedSubstances: [presentSubstance],
    },
    provenance,
  };
}

function evaluateOutOfScopeRule(
  rule: EvaluatableSafetyRule,
  input: SafetyEvaluationInput,
  provenance: SafetyRuleProvenance,
): RuleEvaluationResult {
  const severity: SafetyAlertSeverity = rule.severity ?? 'red';
  const criteria = rule.criteria as OutOfScopeRuleCriteria;

  if (criteria.condition !== undefined) {
    const ruleConditionNorm = normalize(criteria.condition);
    const encounterConditionNorm = normalize(input.encounterCondition);
    if (!encounterConditionNorm || ruleConditionNorm !== encounterConditionNorm) {
      return {
        ruleId: rule.id,
        ruleKind: rule.kind,
        outcome: 'not_evaluated',
        message: `Encounter condition "${input.encounterCondition ?? 'none'}" does not match rule condition scope "${criteria.condition}".`,
        provenance,
      };
    }
  }

  const hasMinAge = typeof criteria.min_age_years === 'number';
  const hasMaxAge = typeof criteria.max_age_years === 'number';

  if (hasMinAge || hasMaxAge) {
    if (
      !input.patient ||
      typeof input.patient.ageYears !== 'number' ||
      !Number.isFinite(input.patient.ageYears) ||
      input.patient.ageYears < 0
    ) {
      return {
        ruleId: rule.id,
        ruleKind: rule.kind,
        outcome: 'configuration_error',
        severity,
        message: `Valid non-negative patient age is required for age-bound evaluation on rule "${rule.id}".`,
        provenance,
      };
    }

    if (hasMinAge && input.patient.ageYears < (criteria.min_age_years as number)) {
      return {
        ruleId: rule.id,
        ruleKind: rule.kind,
        outcome: 'alert',
        severity,
        message: `Patient age (${input.patient.ageYears} yrs) is below minimum age (${criteria.min_age_years} yrs) for this clinical protocol.`,
        evidence: {
          details: `Age ${input.patient.ageYears} < min ${criteria.min_age_years}`,
        },
        provenance,
      };
    }

    if (hasMaxAge && input.patient.ageYears > (criteria.max_age_years as number)) {
      return {
        ruleId: rule.id,
        ruleKind: rule.kind,
        outcome: 'alert',
        severity,
        message: `Patient age (${input.patient.ageYears} yrs) exceeds maximum age (${criteria.max_age_years} yrs) for this clinical protocol.`,
        evidence: {
          details: `Age ${input.patient.ageYears} > max ${criteria.max_age_years}`,
        },
        provenance,
      };
    }
  }

  if (Array.isArray(criteria.prohibited_symptoms) && criteria.prohibited_symptoms.length > 0) {
    if (!input.patient || !Array.isArray(input.patient.symptoms)) {
      return {
        ruleId: rule.id,
        ruleKind: rule.kind,
        outcome: 'configuration_error',
        severity,
        message: `Patient symptoms list is required for red-flag symptom checking on rule "${rule.id}".`,
        provenance,
      };
    }

    for (const [idx, sym] of input.patient.symptoms.entries()) {
      if (!nonEmpty(sym)) {
        return {
          ruleId: rule.id,
          ruleKind: rule.kind,
          outcome: 'configuration_error',
          severity,
          message: `Patient symptom at index ${idx} is malformed or lacks non-empty string.`,
          provenance,
        };
      }
    }

    const patientSymptomsNorm = new Set(input.patient.symptoms.map(normalize));
    const matchedSymptoms: string[] = [];

    for (const symptom of criteria.prohibited_symptoms) {
      if (patientSymptomsNorm.has(normalize(symptom))) {
        matchedSymptoms.push(symptom);
      }
    }

    if (matchedSymptoms.length > 0) {
      return {
        ruleId: rule.id,
        ruleKind: rule.kind,
        outcome: 'alert',
        severity,
        message: `Out-of-scope red-flag symptom(s) detected: [${matchedSymptoms.join(', ')}]. Escalation required.`,
        evidence: {
          matchedSymptoms,
        },
        provenance,
      };
    }
  }

  return {
    ruleId: rule.id,
    ruleKind: rule.kind,
    outcome: 'pass',
    message:
      'Encounter condition and patient parameters are within scope; no red-flag symptoms present.',
    provenance,
  };
}

export function evaluateSafetyRule(
  rule: EvaluatableSafetyRule,
  ruleSet: EvaluatableSafetyRuleSet,
  input: SafetyEvaluationInput,
): RuleEvaluationResult {
  const provenance = extractProvenance(rule, ruleSet);

  if (rule.enabled !== true) {
    return {
      ruleId: rule.id,
      ruleKind: rule.kind,
      outcome: 'not_evaluated',
      message: `Rule "${rule.id}" is disabled.`,
      provenance,
    };
  }

  const criteriaErrors: string[] = [];
  validateSafetyRuleCriteria(
    rule.kind,
    rule.criteria,
    `Rule "${rule.id}".criteria`,
    criteriaErrors,
  );
  if (criteriaErrors.length > 0) {
    return {
      ruleId: rule.id,
      ruleKind: rule.kind,
      outcome: 'configuration_error',
      severity: rule.severity ?? 'red',
      message: `Rule "${rule.id}" criteria validation failed: ${criteriaErrors.join('; ')}`,
      provenance,
    };
  }

  switch (rule.kind) {
    case 'allergy_cross_reactivity':
      return evaluateAllergyRule(rule, input, provenance);
    case 'maximum_daily_dose':
      return evaluateMaxDoseRule(rule, input, provenance);
    case 'duplicate_drug_class':
      return evaluateDuplicateClassRule(rule, input, provenance);
    case 'major_interaction':
      return evaluateMajorInteractionRule(rule, input, provenance);
    case 'out_of_scope_stop':
      return evaluateOutOfScopeRule(rule, input, provenance);
    default:
      return {
        ruleId: rule.id,
        ruleKind: rule.kind,
        outcome: 'configuration_error',
        severity: rule.severity ?? 'red',
        message: `Unsupported safety rule kind "${rule.kind}".`,
        provenance,
      };
  }
}

export function evaluateSafetyRuleSet(
  ruleSet: EvaluatableSafetyRuleSet,
  input: SafetyEvaluationInput,
  options: SafetyEvaluationOptions = {},
): RuleSetEvaluationSummary {
  if (!isObj(ruleSet)) {
    throw new SafetyIntegrityError('Rule set must be a valid JSON object');
  }

  const enforceEligibility = options.enforceEligibility ?? true;
  const allowSynthetic = options.allowSynthetic ?? false;
  const hash = safetyRuleSetHash(ruleSet);
  const isSynthetic = isSyntheticSafetyRuleSet(ruleSet);

  if (isSynthetic && !allowSynthetic) {
    throw new SafetyIntegrityError(
      `Synthetic test rule set "${ruleSet.id}" is isolated from clinical evaluation. Fictional or synthetic approval metadata cannot be treated as real clinical approval. Offline synthetic test harnesses must pass { allowSynthetic: true }.`,
    );
  }

  let lockEntry = options.lockEntry;
  if (!lockEntry && options.lockFile?.locks) {
    const key = `${ruleSet.id}@${ruleSet.version}`;
    lockEntry = options.lockFile.locks[key];
  }

  if (enforceEligibility) {
    const validation = validateSafetyRuleSet(ruleSet);
    if (validation.errors.length > 0) {
      throw new SafetyIntegrityError(
        `Rule set "${ruleSet.id}" failed structural validation: ${validation.errors.join('; ')}`,
      );
    }

    if (ruleSet.status !== 'clinically_approved') {
      throw new SafetyIntegrityError(
        `Rule set "${ruleSet.id}" has status "${ruleSet.status}"; only "clinically_approved" rule sets are eligible for evaluation`,
      );
    }

    if (!lockEntry) {
      throw new SafetyIntegrityError(
        `Rule set "${ruleSet.id}@${ruleSet.version}" is missing an immutable lock entry in safety-rules.lock.json`,
      );
    }

    if (lockEntry.sha256 !== hash) {
      throw new SafetyIntegrityError(
        `Rule set "${ruleSet.id}@${ruleSet.version}" content has been tampered with or modified (expected lock hash ${lockEntry.sha256}, got ${hash})`,
      );
    }
  }

  const eligible = isSafetyRuleSetEligible(ruleSet, lockEntry);
  const results: RuleEvaluationResult[] = [];
  const counts = {
    pass: 0,
    alert: 0,
    not_evaluated: 0,
    configuration_error: 0,
  };
  const alerts = {
    red: 0,
    amber: 0,
  };

  const safeInput = isObj(input) ? input : {};

  for (const rule of ruleSet.rules ?? []) {
    const result = evaluateSafetyRule(rule, ruleSet, safeInput);
    results.push(result);
    counts[result.outcome] += 1;
    if (result.outcome === 'alert') {
      if (result.severity === 'amber') alerts.amber += 1;
      else alerts.red += 1;
    }
  }

  return {
    ruleSetId: ruleSet.id,
    ruleSetVersion: ruleSet.version,
    ruleSetHash: hash,
    status: ruleSet.status,
    clinicalScope: isSynthetic ? 'synthetic_test' : 'clinical',
    eligible,
    totalRules: (ruleSet.rules ?? []).length,
    evaluatedRules: counts.pass + counts.alert,
    counts,
    alerts,
    results,
  };
}

export function evaluateSafetyRuleSets(
  ruleSets: EvaluatableSafetyRuleSet[],
  input: SafetyEvaluationInput,
  options: SafetyEvaluationOptions = {},
): RuleSetEvaluationSummary[] {
  if (!Array.isArray(ruleSets)) {
    throw new TypeError('ruleSets must be an array');
  }
  return ruleSets.map((rs) => evaluateSafetyRuleSet(rs, input, options));
}
