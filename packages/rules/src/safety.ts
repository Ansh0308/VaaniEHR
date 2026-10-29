// Phase 7 preparation only. This validates rule-authoring metadata; it never evaluates a clinical rule.
// No caller in this repository loads these files into the runtime SafetyChecks seam.
import { createHash } from 'node:crypto';

export const SAFETY_LOCK_FILE = 'safety-rules.lock.json';
export const SAFETY_RULE_KINDS = [
  'allergy_cross_reactivity',
  'maximum_daily_dose',
  'duplicate_drug_class',
  'major_interaction',
  'out_of_scope_stop',
] as const;
export const SAFETY_RULE_SET_STATUSES = [
  'draft',
  'review_pending',
  'clinically_approved',
  'disabled',
] as const;
export type SafetyRuleKind = (typeof SAFETY_RULE_KINDS)[number];
export type SafetyRuleSetStatus = (typeof SAFETY_RULE_SET_STATUSES)[number];
export interface SafetyFinding {
  errors: string[];
  warnings: string[];
}
export interface SafetyLockEntry {
  sha256: string;
  file: string;
}
export interface SafetyLockFile {
  schema_version: 1;
  source: string;
  locks: Record<string, SafetyLockEntry>;
}
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const TODO = /TODO\s*\(source\)/i;
const ID = /^[a-z][a-z0-9_]{0,63}$/;
const SHA256 = /^[a-f0-9]{64}$/;

function isCalendarDate(value: unknown): value is string {
  if (!nonEmpty(value) || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 && date.getUTCDate() === day
  );
}

/** Canonical JSON: recursively sorted object keys, with array order deliberately preserved. */
export function canonicalSafetyJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalSafetyJson).join(',')}]`;
  if (isObj(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalSafetyJson(value[key])}`)
      .join(',')}}`;
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new TypeError('safety data must be JSON-serializable');
  return encoded;
}

export function safetyRuleSetHash(raw: unknown): string {
  return createHash('sha256').update(canonicalSafetyJson(raw)).digest('hex');
}

function requiredSource(source: unknown, at: string, errors: string[]): void {
  if (!isObj(source)) {
    errors.push(`${at}: source metadata must be an object`);
    return;
  }
  for (const key of [
    'source_id',
    'document_title',
    'edition_or_version',
    'locator',
    'license_reuse',
    'citation',
  ]) {
    if (!nonEmpty(source[key]) || TODO.test(String(source[key])))
      errors.push(`${at}: source.${key} is required and cannot be TODO(source)`);
  }
}

function requiredReview(review: unknown, at: string, errors: string[]): void {
  if (!isObj(review) || review.state !== 'approved') {
    errors.push(`${at}: clinical_review.state must be approved`);
    return;
  }
  for (const key of ['reviewer', 'reviewer_role', 'approval_reference'])
    if (!nonEmpty(review[key])) errors.push(`${at}: clinical_review.${key} is required`);
  if (!isCalendarDate(review.reviewed_on))
    errors.push(`${at}: clinical_review.reviewed_on must be a valid calendar date`);
}

/** Structural validation accepts unfinished drafts, but never declares any document eligible. */
export function validateSafetyRuleSet(raw: unknown, label = 'safety rule set'): SafetyFinding {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isObj(raw)) return { errors: [`${label}: must be a JSON object`], warnings };
  for (const key of [
    'id',
    'schema_version',
    'version',
    'status',
    'source',
    'clinical_review',
    'rules',
  ])
    if (!(key in raw)) errors.push(`${label}: missing "${key}"`);
  if (!nonEmpty(raw.id) || !ID.test(raw.id)) errors.push(`${label}: id must match ${ID}`);
  if (raw.schema_version !== 1) errors.push(`${label}: schema_version must be 1`);
  if (!Number.isInteger(raw.version) || Number(raw.version) < 1)
    errors.push(`${label}: version must be a whole number from 1`);
  if (!(SAFETY_RULE_SET_STATUSES as readonly string[]).includes(String(raw.status)))
    errors.push(`${label}: invalid status`);
  if (!isObj(raw.source) || !nonEmpty(raw.source.citation))
    errors.push(`${label}: source.citation is required`);
  const review = isObj(raw.clinical_review) ? raw.clinical_review : null;
  if (!review || !['unreviewed', 'pending', 'approved'].includes(String(review.state)))
    errors.push(`${label}: clinical_review.state must be unreviewed, pending or approved`);
  if (review?.reviewed_on !== undefined && !isCalendarDate(review.reviewed_on))
    errors.push(
      `${label}: clinical_review.reviewed_on must be a valid calendar date when supplied`,
    );
  const rules = Array.isArray(raw.rules) ? raw.rules : null;
  if (!rules) errors.push(`${label}: rules must be an array`);
  const ids = new Set<string>();
  for (const [i, rule] of (rules ?? []).entries()) {
    const at = `${label}: rules[${i}]`;
    if (!isObj(rule)) {
      errors.push(`${at} must be an object`);
      continue;
    }
    if (!nonEmpty(rule.id) || !ID.test(rule.id)) errors.push(`${at}.id is invalid`);
    else if (ids.has(rule.id)) errors.push(`${at}.id duplicates ${rule.id}`);
    else ids.add(rule.id);
    if (!(SAFETY_RULE_KINDS as readonly string[]).includes(String(rule.kind)))
      errors.push(`${at}.kind is invalid`);
    if (typeof rule.enabled !== 'boolean') errors.push(`${at}.enabled must be boolean`);
    if (!isObj(rule.source) || !nonEmpty(rule.source.citation))
      errors.push(`${at}.source.citation is required`);
  }
  const approved = raw.status === 'clinically_approved';
  if (approved) {
    requiredSource(raw.source, label, errors);
    requiredReview(raw.clinical_review, label, errors);
    if ((rules?.length ?? 0) === 0)
      errors.push(`${label}: clinically_approved requires at least one rule`);
    for (const [i, rule] of (rules ?? []).entries())
      if (isObj(rule)) {
        const at = `${label}: rules[${i}]`;
        if (rule.enabled !== true)
          errors.push(`${at}: clinically_approved rule sets cannot contain disabled rules`);
        requiredSource(rule.source, at, errors);
        requiredReview(rule.clinical_review, at, errors);
      }
  } else if (rules?.some((rule) => isObj(rule) && rule.enabled === true))
    warnings.push(
      `${label}: enabled draft/pending rules remain ineligible and are not runtime-loaded`,
    );
  return { errors, warnings };
}

/** Validation success alone is insufficient: approval, complete metadata, enabled rules and a matching immutable lock are all required. */
export function isSafetyRuleSetEligible(raw: unknown, lock?: SafetyLockEntry): boolean {
  if (
    !isObj(raw) ||
    raw.status !== 'clinically_approved' ||
    validateSafetyRuleSet(raw).errors.length > 0 ||
    !lock
  )
    return false;
  return lock.sha256 === safetyRuleSetHash(raw);
}

export function validateSafetyLockFile(raw: unknown, label = SAFETY_LOCK_FILE): SafetyFinding {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isObj(raw)) return { errors: [`${label}: must be a JSON object`], warnings };
  if (raw.schema_version !== 1) errors.push(`${label}: schema_version must be 1`);
  if (!nonEmpty(raw.source)) errors.push(`${label}: source is required`);
  if (!isObj(raw.locks)) errors.push(`${label}: locks must be an object`);
  else
    for (const [key, entry] of Object.entries(raw.locks)) {
      if (!/^[a-z][a-z0-9_]{0,63}@[1-9]\d*$/.test(key))
        errors.push(`${label}: invalid lock key ${key}`);
      if (!isObj(entry) || !nonEmpty(entry.file) || !SHA256.test(String(entry.sha256)))
        errors.push(`${label}: ${key} must have file and SHA-256`);
    }
  return { errors, warnings };
}

/** Detect duplicate versions and require every approved version to match its root-level lock entry. */
export function validateSafetyRuleSetCollection(
  items: { file: string; data: unknown }[],
  lock?: SafetyLockFile,
  requireApprovedLock = false,
): SafetyFinding {
  const errors: string[] = [];
  const warnings: string[] = [];
  const seen = new Map<string, string>();
  for (const item of items) {
    const one = validateSafetyRuleSet(item.data, item.file);
    errors.push(...one.errors);
    warnings.push(...one.warnings);
    if (!isObj(item.data) || !nonEmpty(item.data.id) || !Number.isInteger(item.data.version))
      continue;
    const key = `${item.data.id}@${item.data.version}`;
    if (seen.has(key)) errors.push(`${item.file}: ${key} already appears in ${seen.get(key)}`);
    else seen.set(key, item.file);
    if (item.data.status === 'clinically_approved' && requireApprovedLock) {
      const entry = lock?.locks[key];
      if (!entry) errors.push(`${item.file}: approved ${key} is missing from ${SAFETY_LOCK_FILE}`);
      else if (entry.file !== item.file)
        errors.push(`${item.file}: approved ${key} lock file path differs`);
      else if (entry.sha256 !== safetyRuleSetHash(item.data))
        errors.push(`${item.file}: approved ${key} content differs from its immutable lock`);
    }
  }
  return { errors, warnings };
}
