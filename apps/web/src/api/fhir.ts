// Shapes of the FHIR responses (see apps/api-node/openapi.json). Fake data in tests.
export type BundleKind = 'op_consult' | 'prescription';
export type BundleStatus = 'valid' | 'invalid' | 'not_validated';

export interface ValidationIssue {
  severity: 'fatal' | 'error' | 'warning' | 'information';
  path: string;
  message: string;
}

export interface FhirBundleView {
  kind: BundleKind;
  version: number;
  status: BundleStatus;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  issues: ValidationIssue[];
  validatorVersion: string | null;
  igVersion: string;
  notValidatedReason: string | null;
  validatedAt: string | null;
  createdAt: string;
  /** the doctor sees the bundle; the admin sees only the verdict and the errors (null) */
  bundle: Record<string, unknown> | null;
  exportable: boolean;
}

export interface FhirList {
  currentVersion: number | null;
  versions: number[];
  version: number | null;
  bundles: FhirBundleView[];
}
