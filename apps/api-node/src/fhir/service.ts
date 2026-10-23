// Building, validating and storing the FHIR bundles of a signed visit (Phase 9A, ADR-D40). The builder is pure; this file
// gathers its input (the signed snapshot, the patient and doctor from the clinic directory, the encounter times), asks the
// validator, and stores bundle plus verdict. A signed visit never depends on any of this: a bundle that is invalid or was not
// validated only switches export off. Nothing here retries; a new attempt is a new explicit request.
import { z } from 'zod';
import type { Queryable } from '../db/tx.js';
import type { Services } from '../services.js';
import type { Session } from '../sessions/service.js';
import type { VisitVersion } from '../visits/repository.js';
import {
  buildOpConsultBundle,
  buildPrescriptionBundle,
  IG_VERSION,
  type FhirBuildInput,
  type Json,
} from './builder.js';
import type { ValidationResult } from './validator.js';

export const BUNDLE_KINDS = ['op_consult', 'prescription'] as const;
export type BundleKind = (typeof BUNDLE_KINDS)[number];

export const issueView = z.object({
  severity: z.enum(['fatal', 'error', 'warning', 'information']),
  path: z.string(),
  message: z.string(),
});
export const bundleView = z.object({
  kind: z.enum(BUNDLE_KINDS),
  version: z.number(),
  status: z.enum(['valid', 'invalid', 'not_validated']),
  errorCount: z.number(),
  warningCount: z.number(),
  infoCount: z.number(),
  issues: z.array(issueView),
  validatorVersion: z.string().nullable(),
  igVersion: z.string(),
  notValidatedReason: z.string().nullable(),
  validatedAt: z.string().nullable(),
  createdAt: z.string(),
  /** the bundle itself: shown to the doctor; null for other roles (the admin sees the verdict and the errors only) */
  bundle: z.record(z.string(), z.unknown()).nullable(),
  /** valid only: a bundle that is invalid or was not validated cannot be exported */
  exportable: z.boolean(),
});
export type BundleView = z.infer<typeof bundleView>;

interface Row {
  kind: BundleKind;
  version: number;
  bundle: Json;
  status: 'valid' | 'invalid' | 'not_validated';
  error_count: number;
  warning_count: number;
  info_count: number;
  issues: z.infer<typeof issueView>[];
  validator_version: string | null;
  ig_version: string;
  not_validated_reason: string | null;
  validated_at: Date | null;
  created_at: Date;
}

const COLUMNS = `kind, version, bundle, status, error_count, warning_count, info_count, issues, validator_version,
  ig_version, not_validated_reason, validated_at, created_at`;

export const toView = (r: Row, withBundle: boolean): BundleView => ({
  kind: r.kind,
  version: r.version,
  status: r.status,
  errorCount: r.error_count,
  warningCount: r.warning_count,
  infoCount: r.info_count,
  issues: r.issues,
  validatorVersion: r.validator_version,
  igVersion: r.ig_version,
  notValidatedReason: r.not_validated_reason,
  validatedAt: r.validated_at ? r.validated_at.toISOString() : null,
  createdAt: r.created_at.toISOString(),
  bundle: withBundle ? r.bundle : null,
  exportable: r.status === 'valid',
});

export async function readBundles(
  db: Queryable,
  sessionId: string,
  version: number,
): Promise<Row[]> {
  const r = await db.query<Row>(
    `SELECT ${COLUMNS} FROM fhir_bundle WHERE session_id = $1 AND version = $2 ORDER BY kind`,
    [sessionId, version],
  );
  return r.rows;
}

export async function bundleVersions(db: Queryable, sessionId: string): Promise<number[]> {
  const r = await db.query<{ version: number }>(
    'SELECT DISTINCT version FROM fhir_bundle WHERE session_id = $1 ORDER BY version',
    [sessionId],
  );
  return r.rows.map((x) => x.version);
}

/** What the builder needs beyond the snapshot: the people and the encounter times. */
export async function buildInput(
  services: Services,
  session: Session,
  visit: VisitVersion,
): Promise<FhirBuildInput> {
  const patient = await services.directory.getPatient(session.clinicId, session.patientId);
  const doctor = await services.directory.getUser(session.doctorId);
  return {
    sessionId: session.id,
    version: visit.version,
    kind: visit.kind,
    signedAt: visit.signedAt,
    content: visit.content,
    safetyConfigured: visit.safetyConfigured,
    safetyNotRunAcknowledged: visit.safetyNotRunAcknowledged,
    patient: {
      id: session.patientId,
      name: patient?.name ?? null,
      gender: patient?.gender ?? null,
      birthDate: patient?.dob ?? null,
      phone: patient?.phone ?? null,
    },
    practitioner: { id: session.doctorId, name: doctor?.name ?? null },
    encounter: { startedAt: session.startedAt, endedAt: session.endedAt },
  };
}

export function bundlesFor(input: FhirBuildInput): Array<{ kind: BundleKind; bundle: Json }> {
  const out: Array<{ kind: BundleKind; bundle: Json }> = [
    { kind: 'op_consult', bundle: buildOpConsultBundle(input) },
  ];
  const rx = buildPrescriptionBundle(input);
  if (rx) out.push({ kind: 'prescription', bundle: rx });
  return out;
}

const verdictColumns = (v: ValidationResult) => [
  v.status,
  v.errors,
  v.warnings,
  v.information,
  JSON.stringify(v.issues),
  v.outcome ? JSON.stringify(v.outcome) : null,
  v.validatorVersion,
  v.message,
  v.status === 'not_validated' ? null : new Date(),
];

/**
 * Builds and validates the bundles of one version. Existing rows are kept as they are unless `revalidate` is set, which only
 * asks the validator again for rows that were NOT validated (a verdict of valid or invalid is never overwritten).
 */
export async function generateBundles(
  db: Queryable,
  services: Services,
  session: Session,
  visit: VisitVersion,
  doctorId: string,
  revalidate: boolean,
): Promise<Row[]> {
  const existing = await readBundles(db, session.id, visit.version);
  const input = await buildInput(services, session, visit);
  for (const { kind, bundle } of bundlesFor(input)) {
    const have = existing.find((e) => e.kind === kind);
    if (have && !(revalidate && have.status === 'not_validated')) continue;
    const verdict = await services.fhirValidator.validate(bundle);
    if (have) {
      await db.query(
        `UPDATE fhir_bundle SET status = $3, error_count = $4, warning_count = $5, info_count = $6, issues = $7::jsonb,
                validator_output = $8::jsonb, validator_version = $9, not_validated_reason = $10, validated_at = $11
          WHERE session_id = $1 AND version = $2 AND kind = '${kind}'`,
        [session.id, visit.version, ...verdictColumns(verdict)],
      );
    } else {
      await db.query(
        `INSERT INTO fhir_bundle (session_id, clinic_id, version, kind, bundle, ig_version, created_by, status, error_count,
           warning_count, info_count, issues, validator_output, validator_version, not_validated_reason, validated_at)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$15,$16)`,
        [
          session.id,
          session.clinicId,
          visit.version,
          kind,
          JSON.stringify(bundle),
          IG_VERSION,
          doctorId,
          ...verdictColumns(verdict),
        ],
      );
    }
  }
  return readBundles(db, session.id, visit.version);
}
