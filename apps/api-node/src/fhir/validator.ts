// The FHIR validator seam (Phase 9A, ADR-D40, FR-F8-03). The HL7 validator (validator_cli.jar 7.0.3, Java 11+) runs OUTSIDE this
// process in its own server mode (`node scripts/fhir-validator-server.mjs`) with the ABDM IG loaded once (loading takes
// minutes). This file only talks to it over HTTP. When no server is configured, or it does not answer, the result is
// `not_validated` with a plain reason: a bundle is never called valid without the validator's word, and nothing retries.
import type { Json } from './builder.js';

export type ValidationStatus = 'valid' | 'invalid' | 'not_validated';

export interface ValidationIssue {
  severity: 'fatal' | 'error' | 'warning' | 'information';
  /** FHIRPath-style location of the problem */
  path: string;
  message: string;
}

export interface ValidationResult {
  status: ValidationStatus;
  errors: number;
  warnings: number;
  information: number;
  issues: ValidationIssue[];
  /** the raw OperationOutcome from the validator, kept untouched; null when the validator did not run */
  outcome: Json | null;
  validatorVersion: string | null;
  /** why it was not validated (never set when the validator answered) */
  message: string | null;
}

export interface FhirValidator {
  validate(bundle: Json): Promise<ValidationResult>;
}

const NOT_RUN = (message: string): ValidationResult => ({
  status: 'not_validated',
  errors: 0,
  warnings: 0,
  information: 0,
  issues: [],
  outcome: null,
  validatorVersion: null,
  message,
});

interface OutcomeIssue {
  severity?: string;
  expression?: string[];
  location?: string[];
  details?: { text?: string };
  diagnostics?: string;
}

/** Turns the validator's OperationOutcome into counts and a flat issue list. Nothing is filtered out. */
export function summariseOutcome(outcome: Json, validatorVersion: string | null): ValidationResult {
  const raw = (outcome['issue'] as OutcomeIssue[] | undefined) ?? [];
  const issues: ValidationIssue[] = raw.map((i) => ({
    severity: (['fatal', 'error', 'warning', 'information'].includes(i.severity ?? '')
      ? i.severity
      : 'error') as ValidationIssue['severity'],
    path: i.expression?.[0] ?? i.location?.[0] ?? '',
    message: i.details?.text ?? i.diagnostics ?? '',
  }));
  const n = (s: string) => issues.filter((i) => i.severity === s).length;
  const errors = n('error') + n('fatal');
  return {
    status: errors > 0 ? 'invalid' : 'valid',
    errors,
    warnings: n('warning'),
    information: n('information'),
    issues,
    outcome,
    validatorVersion,
    message: null,
  };
}

export class NotConfiguredFhirValidator implements FhirValidator {
  async validate(): Promise<ValidationResult> {
    return NOT_RUN(
      'The FHIR validator is not configured on this server (FHIR_VALIDATOR_URL is not set).',
    );
  }
}

export class HttpFhirValidator implements FhirValidator {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs = 180_000,
  ) {}

  async validate(bundle: Json): Promise<ValidationResult> {
    try {
      const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/validateResource`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/fhir+json', Accept: 'application/fhir+json' },
        body: JSON.stringify(bundle),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok)
        return NOT_RUN(`The FHIR validator answered with an error (HTTP ${res.status}).`);
      const outcome = (await res.json()) as Json;
      if (outcome['resourceType'] !== 'OperationOutcome') {
        return NOT_RUN(
          'The FHIR validator answered with something that is not an OperationOutcome.',
        );
      }
      return summariseOutcome(outcome, res.headers.get('x-validator-version'));
    } catch {
      return NOT_RUN('The FHIR validator could not be reached or timed out.');
    }
  }
}

export function createFhirValidator(url: string | undefined): FhirValidator {
  return url ? new HttpFhirValidator(url) : new NotConfiguredFhirValidator();
}
