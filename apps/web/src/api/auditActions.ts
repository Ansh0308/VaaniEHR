// The audit actions the API can write. A test in apps/api-node (static-rules.test.ts) fails if this list and
// AUDIT_ACTIONS in apps/api-node/src/audit/audit.ts ever differ.
export const AUDIT_ACTIONS = [
  'LOGIN_SUCCEEDED',
  'LOGIN_FAILED',
  'LOGOUT',
  'PATIENT_LOOKUP',
  'PATIENT_CREATED',
  'PATIENT_PROFILE_UPDATED',
  'SESSION_CREATED',
  'CONSENT_GRANTED',
  'CONSENT_WITHDRAWN',
  'AUDIT_EXPORTED',
  'SEED_APPLIED',
  'MEDICINE_IMPORTED',
  'MEDICINE_CODES_LOADED',
  'MEDICINE_TRANSLIT_LOADED',
  'MEDICINE_CREATED',
  'MEDICINE_UPDATED',
  'MEDICINE_RETIRED',
  'MEDICINE_RESTORED',
  'MEDICINE_BRAND_ADDED',
  'MEDICINE_BRAND_RETIRED',
] as const;
