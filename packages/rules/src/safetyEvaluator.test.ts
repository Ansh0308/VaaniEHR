import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  evaluateSafetyRule,
  evaluateSafetyRuleSet,
  evaluateSafetyRuleSets,
  isSafetyRuleSetEligibleForProduction,
  isSyntheticSafetyRuleSet,
  SafetyIntegrityError,
  validateSafetyRuleCriteria,
  type EvaluatableSafetyRule,
  type EvaluatableSafetyRuleSet,
  type SafetyEvaluationInput,
  type SafetyLockFile,
} from './safetyEvaluator.js';

const fixturePath = resolve(__dirname, '../fixtures/safety/synthetic-mechanics.safety.json');
const lockPath = resolve(__dirname, '../fixtures/safety/safety-rules.lock.json');
const fixtureJson: EvaluatableSafetyRuleSet = JSON.parse(readFileSync(fixturePath, 'utf8'));
const lockJson: SafetyLockFile = JSON.parse(readFileSync(lockPath, 'utf8'));

describe('SafetyEvaluator - Synthetic Approval Isolation', () => {
  it('identifies synthetic fixtures and isolates them from production eligibility', () => {
    expect(isSyntheticSafetyRuleSet(fixtureJson)).toBe(true);
    // Low-level integrity check might pass for tests, but production eligibility strictly rejects synthetic content
    const lockEntry = lockJson.locks['synthetic_mechanics@1'];
    expect(isSafetyRuleSetEligibleForProduction(fixtureJson, lockEntry)).toBe(false);
  });

  it('rejects evaluation of synthetic rule sets by default in production clinical mode', () => {
    const input: SafetyEvaluationInput = {
      encounterCondition: 'SYNTH_CONDITION_ZETA',
      patient: { ageYears: 30, allergies: [], symptoms: [] },
      prescriptions: [{ substance: 'SYNTH_SUBSTANCE_BETA', dailyAmount: 500, unit: 'mg' }],
    };

    // By default allowSynthetic is false -> fail closed!
    expect(() =>
      evaluateSafetyRuleSet(fixtureJson, input, {
        lockFile: lockJson,
        enforceEligibility: true,
      }),
    ).toThrow(/isolated from clinical evaluation/i);
  });

  it('evaluates approved locked synthetic fixture only when allowSynthetic: true is explicitly provided', () => {
    const input: SafetyEvaluationInput = {
      encounterCondition: 'SYNTH_CONDITION_ZETA',
      patient: {
        ageYears: 30,
        allergies: [],
        symptoms: ['SYNTH_MILD_COUGH'],
      },
      prescriptions: [
        {
          substance: 'SYNTH_SUBSTANCE_BETA',
          dailyAmount: 500,
          unit: 'mg',
        },
      ],
    };

    const summary = evaluateSafetyRuleSet(fixtureJson, input, {
      lockFile: lockJson,
      enforceEligibility: true,
      allowSynthetic: true,
    });

    expect(summary.eligible).toBe(true);
    expect(summary.clinicalScope).toBe('synthetic_test');
    expect(summary.ruleSetId).toBe('synthetic_mechanics');
    expect(summary.totalRules).toBe(5);
    expect(summary.counts.pass).toBeGreaterThan(0);
  });
});

describe('SafetyEvaluator - Integrity & Eligibility Gates', () => {
  it('rejects unapproved (draft) rule sets when eligibility is enforced', () => {
    const draftRuleSet: EvaluatableSafetyRuleSet = {
      ...JSON.parse(JSON.stringify(fixtureJson)),
      status: 'draft',
      clinical_review: { state: 'unreviewed' },
    };

    expect(() =>
      evaluateSafetyRuleSet(draftRuleSet, {}, { enforceEligibility: true, allowSynthetic: true }),
    ).toThrow(SafetyIntegrityError);
  });

  it('rejects rule set when immutable lock entry is missing', () => {
    const emptyLock: SafetyLockFile = {
      schema_version: 1,
      source: 'Empty lock',
      locks: {},
    };

    expect(() =>
      evaluateSafetyRuleSet(
        fixtureJson,
        {},
        {
          lockFile: emptyLock,
          enforceEligibility: true,
          allowSynthetic: true,
        },
      ),
    ).toThrow(SafetyIntegrityError);
  });

  it('rejects tampered rule set where content does not match lock SHA-256 hash', () => {
    const tamperedRuleSet: EvaluatableSafetyRuleSet = JSON.parse(JSON.stringify(fixtureJson));
    tamperedRuleSet.rules[0]!.severity = 'amber';

    expect(() =>
      evaluateSafetyRuleSet(
        tamperedRuleSet,
        {},
        {
          lockFile: lockJson,
          enforceEligibility: true,
          allowSynthetic: true,
        },
      ),
    ).toThrow(/tampered with or modified/);
  });

  it('allows draft/synthetic rule sets in test mode when enforceEligibility: false', () => {
    const draftRuleSet: EvaluatableSafetyRuleSet = {
      ...JSON.parse(JSON.stringify(fixtureJson)),
      status: 'draft',
    };

    const summary = evaluateSafetyRuleSet(
      draftRuleSet,
      {},
      {
        enforceEligibility: false,
        allowSynthetic: true,
      },
    );

    expect(summary.eligible).toBe(false);
    expect(summary.clinicalScope).toBe('synthetic_test');
    expect(summary.totalRules).toBe(5);
  });
});

describe('SafetyEvaluator - Runtime Criteria Validation', () => {
  it('rejects criteria with unexpected properties', () => {
    const errors: string[] = [];
    validateSafetyRuleCriteria(
      'maximum_daily_dose',
      {
        substance: 'SYNTH_SUBSTANCE_BETA',
        max_daily_amount: 1000,
        unit: 'mg',
        unexpected_extra_property: true,
      },
      'test.criteria',
      errors,
    );
    expect(errors.join('\n')).toMatch(/unexpected property "unexpected_extra_property"/);
  });

  it('rejects non-positive max_daily_amount and missing units', () => {
    const errors: string[] = [];
    validateSafetyRuleCriteria(
      'maximum_daily_dose',
      {
        substance: 'SYNTH_SUBSTANCE_BETA',
        max_daily_amount: -50,
        unit: '',
      },
      'test.criteria',
      errors,
    );
    expect(errors.join('\n')).toMatch(/must be a positive number/);
    expect(errors.join('\n')).toMatch(/unit must be a non-empty string/);
  });

  it('rejects duplicate class criteria with fewer than 2 substances', () => {
    const errors: string[] = [];
    validateSafetyRuleCriteria(
      'duplicate_drug_class',
      {
        drug_class: 'SYNTH_CLASS',
        substances: ['ONLY_ONE_SUBSTANCE'],
      },
      'test.criteria',
      errors,
    );
    expect(errors.join('\n')).toMatch(/at least two substance strings/);
  });

  it('rejects major interaction criteria when substance_a equals substance_b', () => {
    const errors: string[] = [];
    validateSafetyRuleCriteria(
      'major_interaction',
      {
        substance_a: 'SYNTH_DRUG_X',
        substance_b: 'synth_drug_x',
      },
      'test.criteria',
      errors,
    );
    expect(errors.join('\n')).toMatch(/must be distinct substances/);
  });

  it('rejects out_of_scope_stop when min_age exceeds max_age', () => {
    const errors: string[] = [];
    validateSafetyRuleCriteria(
      'out_of_scope_stop',
      {
        condition: 'SYNTH_CONDITION',
        min_age_years: 70,
        max_age_years: 20,
      },
      'test.criteria',
      errors,
    );
    expect(errors.join('\n')).toMatch(/min_age_years cannot exceed max_age_years/);
  });

  it('produces configuration_error when rule being evaluated has invalid criteria', () => {
    const badRule: EvaluatableSafetyRule = {
      id: 'bad_criteria_rule',
      kind: 'maximum_daily_dose',
      enabled: true,
      source: fixtureJson.rules[0]!.source,
      clinical_review: fixtureJson.rules[0]!.clinical_review,
      criteria: {
        substance: 'SYNTH_DRUG',
        max_daily_amount: -10, // Invalid: negative
        unit: 'mg',
      },
    };

    const res = evaluateSafetyRule(badRule, fixtureJson, {
      prescriptions: [{ substance: 'SYNTH_DRUG', dailyAmount: 50, unit: 'mg' }],
    });
    expect(res.outcome).toBe('configuration_error');
    expect(res.message).toMatch(/criteria validation failed/i);
  });
});

describe('SafetyEvaluator - Allergy Cross-Reactivity Mechanics', () => {
  const allergyRule = fixtureJson.rules.find((r) => r.id === 'synth_allergy_cross')!;

  it('returns not_evaluated when patient has no allergy matching the criteria allergen', () => {
    const input: SafetyEvaluationInput = {
      patient: {
        allergies: [{ allergen: 'SYNTH_OTHER_ALLERGEN' }],
      },
      prescriptions: [{ substance: 'SYNTH_SUBSTANCE_ALPHA_DERIVATIVE' }],
    };

    const res = evaluateSafetyRule(allergyRule, fixtureJson, input);
    expect(res.outcome).toBe('not_evaluated');
    expect(res.message).toMatch(/no documented allergy/i);
  });

  it('returns pass when patient has documented allergy but no prohibited cross-reactive substances are prescribed', () => {
    const input: SafetyEvaluationInput = {
      patient: {
        allergies: [{ allergen: 'SYNTH_ALLERGEN_ALPHA' }],
      },
      prescriptions: [{ substance: 'SYNTH_SAFE_SUBSTANCE' }],
    };

    const res = evaluateSafetyRule(allergyRule, fixtureJson, input);
    expect(res.outcome).toBe('pass');
    expect(res.evidence?.matchedAllergens).toEqual(['SYNTH_ALLERGEN_ALPHA']);
  });

  it('returns red alert when prescribed substance cross-reacts with documented allergy', () => {
    const input: SafetyEvaluationInput = {
      patient: {
        allergies: [{ allergen: 'SYNTH_ALLERGEN_ALPHA' }],
      },
      prescriptions: [
        { substance: 'SYNTH_SAFE_SUBSTANCE' },
        { substance: 'SYNTH_SUBSTANCE_ALPHA_DERIVATIVE' },
      ],
    };

    const res = evaluateSafetyRule(allergyRule, fixtureJson, input);
    expect(res.outcome).toBe('alert');
    expect(res.severity).toBe('red');
    expect(res.evidence?.matchedSubstances).toEqual(['SYNTH_SUBSTANCE_ALPHA_DERIVATIVE']);
    expect(res.provenance.sourceId).toBe('SYNTH-SRC-001');
    expect(res.provenance.approvalReference).toBe('SYNTH-APPROV-2026-11-18');
  });

  it('returns configuration_error when patient record is missing or allergies field is malformed', () => {
    const resNoPatient = evaluateSafetyRule(allergyRule, fixtureJson, {
      prescriptions: [{ substance: 'SYNTH_SAFE' }],
    });
    expect(resNoPatient.outcome).toBe('configuration_error');

    const resBadAllergies = evaluateSafetyRule(allergyRule, fixtureJson, {
      patient: { allergies: 'not-an-array' as unknown as [] },
      prescriptions: [{ substance: 'SYNTH_SAFE' }],
    });
    expect(resBadAllergies.outcome).toBe('configuration_error');
  });

  it('returns configuration_error when prescription list is missing', () => {
    const res = evaluateSafetyRule(allergyRule, fixtureJson, {
      patient: { allergies: [{ allergen: 'SYNTH_ALLERGEN_ALPHA' }] },
    });
    expect(res.outcome).toBe('configuration_error');
    expect(res.message).toMatch(/prescriptions list is required/i);
  });
});

describe('SafetyEvaluator - Maximum Daily Dose Mechanics', () => {
  const maxDoseRule = fixtureJson.rules.find((r) => r.id === 'synth_max_daily_dose')!;

  it('returns not_evaluated when substance is not prescribed', () => {
    const input: SafetyEvaluationInput = {
      prescriptions: [{ substance: 'SYNTH_OTHER_MEDICINE' }],
    };

    const res = evaluateSafetyRule(maxDoseRule, fixtureJson, input);
    expect(res.outcome).toBe('not_evaluated');
  });

  it('returns pass when daily dose is strictly within allowed ceiling', () => {
    const input: SafetyEvaluationInput = {
      prescriptions: [
        {
          substance: 'SYNTH_SUBSTANCE_BETA',
          dailyAmount: 800,
          unit: 'mg',
        },
      ],
    };

    const res = evaluateSafetyRule(maxDoseRule, fixtureJson, input);
    expect(res.outcome).toBe('pass');
    expect(res.evidence?.observedDailyAmount).toBe(800);
    expect(res.evidence?.thresholdDailyAmount).toBe(1000);
  });

  it('handles exact boundary value (daily amount == max allowed) as pass', () => {
    const input: SafetyEvaluationInput = {
      prescriptions: [
        {
          substance: 'SYNTH_SUBSTANCE_BETA',
          dailyAmount: 1000,
          unit: 'mg',
        },
      ],
    };

    const res = evaluateSafetyRule(maxDoseRule, fixtureJson, input);
    expect(res.outcome).toBe('pass');
    expect(res.evidence?.observedDailyAmount).toBe(1000);
  });

  it('returns red alert when daily dose exceeds maximum allowed ceiling (e.g. boundary + 1)', () => {
    const input: SafetyEvaluationInput = {
      prescriptions: [
        {
          substance: 'SYNTH_SUBSTANCE_BETA',
          dailyAmount: 1001,
          unit: 'mg',
        },
      ],
    };

    const res = evaluateSafetyRule(maxDoseRule, fixtureJson, input);
    expect(res.outcome).toBe('alert');
    expect(res.severity).toBe('red');
    expect(res.evidence?.observedDailyAmount).toBe(1001);
  });

  it('correctly calculates total daily dose from doseAmount and frequencyPerDay', () => {
    const input: SafetyEvaluationInput = {
      prescriptions: [
        {
          substance: 'SYNTH_SUBSTANCE_BETA',
          doseAmount: 600,
          doseUnit: 'mg',
          frequencyPerDay: 2, // 600 * 2 = 1200 > 1000
        },
      ],
    };

    const res = evaluateSafetyRule(maxDoseRule, fixtureJson, input);
    expect(res.outcome).toBe('alert');
    expect(res.evidence?.observedDailyAmount).toBe(1200);
  });

  it('returns configuration_error when dose unit mismatches or dose amount is non-positive', () => {
    const inputUnitMismatch: SafetyEvaluationInput = {
      prescriptions: [
        {
          substance: 'SYNTH_SUBSTANCE_BETA',
          dailyAmount: 100,
          unit: 'g', // expected mg
        },
      ],
    };

    const resUnit = evaluateSafetyRule(maxDoseRule, fixtureJson, inputUnitMismatch);
    expect(resUnit.outcome).toBe('configuration_error');
    expect(resUnit.message).toMatch(/unit mismatch/i);

    const inputBadAmount: SafetyEvaluationInput = {
      prescriptions: [
        {
          substance: 'SYNTH_SUBSTANCE_BETA',
          dailyAmount: -500, // Invalid: negative
          unit: 'mg',
        },
      ],
    };

    const resBad = evaluateSafetyRule(maxDoseRule, fixtureJson, inputBadAmount);
    expect(resBad.outcome).toBe('configuration_error');
    expect(resBad.message).toMatch(/positive finite number/i);
  });
});

describe('SafetyEvaluator - Duplicate Drug Class Mechanics', () => {
  const dupRule = fixtureJson.rules.find((r) => r.id === 'synth_duplicate_class')!;

  it('returns not_evaluated when no drugs from class are prescribed', () => {
    const input: SafetyEvaluationInput = {
      prescriptions: [{ substance: 'SYNTH_OTHER' }],
    };

    const res = evaluateSafetyRule(dupRule, fixtureJson, input);
    expect(res.outcome).toBe('not_evaluated');
  });

  it('returns pass when 1 medication from class is prescribed (within max_allowed = 1)', () => {
    const input: SafetyEvaluationInput = {
      prescriptions: [{ substance: 'SYNTH_GAMMA_SUB_1' }],
    };

    const res = evaluateSafetyRule(dupRule, fixtureJson, input);
    expect(res.outcome).toBe('pass');
    expect(res.evidence?.observedCount).toBe(1);
    expect(res.evidence?.thresholdCount).toBe(1);
  });

  it('returns amber alert when 2 medications from class are prescribed', () => {
    const input: SafetyEvaluationInput = {
      prescriptions: [{ substance: 'SYNTH_GAMMA_SUB_1' }, { substance: 'SYNTH_GAMMA_SUB_2' }],
    };

    const res = evaluateSafetyRule(dupRule, fixtureJson, input);
    expect(res.outcome).toBe('alert');
    expect(res.severity).toBe('amber');
    expect(res.evidence?.observedCount).toBe(2);
    expect(res.evidence?.matchedSubstances).toEqual(['SYNTH_GAMMA_SUB_1', 'SYNTH_GAMMA_SUB_2']);
  });

  it('returns configuration_error when prescription item is malformed or missing substance', () => {
    const input: SafetyEvaluationInput = {
      prescriptions: [null as unknown as { substance: string }],
    };

    const res = evaluateSafetyRule(dupRule, fixtureJson, input);
    expect(res.outcome).toBe('configuration_error');
  });
});

describe('SafetyEvaluator - Major Interaction Mechanics', () => {
  const interactionRule = fixtureJson.rules.find((r) => r.id === 'synth_major_interaction')!;

  it('returns not_evaluated when neither interacting partner is prescribed', () => {
    const input: SafetyEvaluationInput = {
      prescriptions: [{ substance: 'SYNTH_UNRELATED_DRUG' }],
    };

    const res = evaluateSafetyRule(interactionRule, fixtureJson, input);
    expect(res.outcome).toBe('not_evaluated');
  });

  it('returns pass when only one of the substances is prescribed without its interacting partner', () => {
    const input: SafetyEvaluationInput = {
      prescriptions: [{ substance: 'SYNTH_SUBSTANCE_DELTA' }],
    };

    const res = evaluateSafetyRule(interactionRule, fixtureJson, input);
    expect(res.outcome).toBe('pass');
    expect(res.evidence?.matchedSubstances).toEqual(['SYNTH_SUBSTANCE_DELTA']);
  });

  it('returns red alert when both interacting substances are prescribed concurrently', () => {
    const input: SafetyEvaluationInput = {
      prescriptions: [
        { substance: 'SYNTH_SUBSTANCE_DELTA' },
        { substance: 'SYNTH_SUBSTANCE_EPSILON' },
      ],
    };

    const res = evaluateSafetyRule(interactionRule, fixtureJson, input);
    expect(res.outcome).toBe('alert');
    expect(res.severity).toBe('red');
    expect(res.evidence?.matchedSubstances).toEqual([
      'SYNTH_SUBSTANCE_DELTA',
      'SYNTH_SUBSTANCE_EPSILON',
    ]);
  });
});

describe('SafetyEvaluator - Out-of-Scope Stop Mechanics', () => {
  const outOfScopeRule = fixtureJson.rules.find((r) => r.id === 'synth_out_of_scope_stop')!;

  it('returns not_evaluated when encounter condition does not match rule condition scope', () => {
    const input: SafetyEvaluationInput = {
      encounterCondition: 'SYNTH_DIFFERENT_CONDITION',
      patient: { ageYears: 25, symptoms: [] },
    };

    const res = evaluateSafetyRule(outOfScopeRule, fixtureJson, input);
    expect(res.outcome).toBe('not_evaluated');
  });

  it('returns pass when condition matches, patient age is within bounds, and no red-flag symptoms are present', () => {
    const input: SafetyEvaluationInput = {
      encounterCondition: 'SYNTH_CONDITION_ZETA',
      patient: {
        ageYears: 25,
        symptoms: ['SYNTH_NORMAL_FATIGUE'],
      },
    };

    const res = evaluateSafetyRule(outOfScopeRule, fixtureJson, input);
    expect(res.outcome).toBe('pass');
  });

  it('returns red alert when patient age is below minimum age bound (pediatric out-of-scope)', () => {
    const input: SafetyEvaluationInput = {
      encounterCondition: 'SYNTH_CONDITION_ZETA',
      patient: {
        ageYears: 10,
        symptoms: [],
      },
    };

    const res = evaluateSafetyRule(outOfScopeRule, fixtureJson, input);
    expect(res.outcome).toBe('alert');
    expect(res.severity).toBe('red');
    expect(res.message).toMatch(/below minimum age/i);
  });

  it('returns red alert when patient age exceeds maximum age bound (geriatric out-of-scope)', () => {
    const input: SafetyEvaluationInput = {
      encounterCondition: 'SYNTH_CONDITION_ZETA',
      patient: {
        ageYears: 70,
        symptoms: [],
      },
    };

    const res = evaluateSafetyRule(outOfScopeRule, fixtureJson, input);
    expect(res.outcome).toBe('alert');
    expect(res.severity).toBe('red');
    expect(res.message).toMatch(/exceeds maximum age/i);
  });

  it('returns red alert when emergency red-flag symptom is detected', () => {
    const input: SafetyEvaluationInput = {
      encounterCondition: 'SYNTH_CONDITION_ZETA',
      patient: {
        ageYears: 35,
        symptoms: ['SYNTH_MILD_FEVER', 'SYNTH_RED_FLAG_COLLAPSE'],
      },
    };

    const res = evaluateSafetyRule(outOfScopeRule, fixtureJson, input);
    expect(res.outcome).toBe('alert');
    expect(res.severity).toBe('red');
    expect(res.evidence?.matchedSymptoms).toEqual(['SYNTH_RED_FLAG_COLLAPSE']);
  });

  it('returns configuration_error when patient age is missing or negative', () => {
    const inputMissingAge: SafetyEvaluationInput = {
      encounterCondition: 'SYNTH_CONDITION_ZETA',
      patient: { symptoms: [] },
    };

    const resMissing = evaluateSafetyRule(outOfScopeRule, fixtureJson, inputMissingAge);
    expect(resMissing.outcome).toBe('configuration_error');

    const inputNegativeAge: SafetyEvaluationInput = {
      encounterCondition: 'SYNTH_CONDITION_ZETA',
      patient: { ageYears: -5, symptoms: [] },
    };

    const resNeg = evaluateSafetyRule(outOfScopeRule, fixtureJson, inputNegativeAge);
    expect(resNeg.outcome).toBe('configuration_error');
    expect(resNeg.message).toMatch(/valid non-negative patient age is required/i);
  });

  it('returns configuration_error when patient symptoms list contains empty string', () => {
    const inputBadSymptoms: SafetyEvaluationInput = {
      encounterCondition: 'SYNTH_CONDITION_ZETA',
      patient: {
        ageYears: 30,
        symptoms: [''],
      },
    };

    const res = evaluateSafetyRule(outOfScopeRule, fixtureJson, inputBadSymptoms);
    expect(res.outcome).toBe('configuration_error');
    expect(res.message).toMatch(/non-empty string/i);
  });
});

describe('SafetyEvaluator - Multi-Rule Set Batch Evaluation', () => {
  it('evaluates multiple rule sets returning summary for each with clinicalScope', () => {
    const input: SafetyEvaluationInput = {
      encounterCondition: 'SYNTH_CONDITION_ZETA',
      patient: {
        ageYears: 20,
        allergies: [],
        symptoms: [],
      },
      prescriptions: [
        {
          substance: 'SYNTH_SUBSTANCE_BETA',
          dailyAmount: 100,
          unit: 'mg',
        },
      ],
    };

    const summaries = evaluateSafetyRuleSets([fixtureJson], input, {
      lockFile: lockJson,
      enforceEligibility: true,
      allowSynthetic: true,
    });

    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.totalRules).toBe(5);
    expect(summaries[0]!.clinicalScope).toBe('synthetic_test');
    expect(summaries[0]!.eligible).toBe(true);
  });
});
