// ABHA verification logic (Phase 9B, ADR-D42, FR-F9-01..03). The flow: the staff member attests the patient agreed, gives a TEST
// identity (the guard refuses anything else), an OTP is requested, the OTP is checked. Stored: the ABHA address, the time, the
// mode and a salted hash of the number. Never stored or logged: the number, the OTP, any token. Every failure is a structured
// error in plain words; failures are audited (cause words only) in their own transaction so they survive the refusal.
import { createHmac } from 'node:crypto';
import { z } from 'zod';
import type { AuthContext } from '../auth/types.js';
import { withTransaction, type Queryable } from '../db/tx.js';
import { AppError, errors } from '../http/errors.js';
import type { Services } from '../services.js';
import { AbhaError, type AbhaFailure } from './errors.js';
import {
  checkIdentity,
  MOCK_IDENTITIES,
  parseSandboxAllowlist,
  type IdentityVerdict,
} from './identityGuard.js';

export const MAX_OTP_ATTEMPTS = 3;
export const MAX_STARTS_PER_QUARTER_HOUR = 5;
const TXN_LIFETIME_MS = 10 * 60_000;

export const NOTICE = {
  mock: 'MOCK - a simulated check with fake identities. This is not a real ABHA verification.',
  sandbox: 'SANDBOX - the ABDM test environment, test identities only. This is not a real person.',
} as const;

export const statusView = z.object({
  patientId: z.uuid(),
  verified: z.boolean(),
  abhaAddress: z.string().nullable(),
  verifiedAt: z.string().nullable(),
  /** the mode that produced the stored verification (null when none) */
  verifiedMode: z.enum(['mock', 'sandbox']).nullable(),
  /** the mode the server runs in now */
  mode: z.enum(['mock', 'sandbox']),
  notice: z.string(),
  /** only in mock mode: the fake identities that can be used, so the demo is possible (never real people) */
  mockIdentities: z
    .array(z.object({ number: z.string(), address: z.string(), outcome: z.string() }))
    .nullable(),
});
export type StatusView = z.infer<typeof statusView>;

export const startedView = z.object({
  /** our own opaque reference; the provider's reference and the identity never reach the browser */
  txnId: z.uuid(),
  mode: z.enum(['mock', 'sandbox']),
  notice: z.string(),
  expiresInSeconds: z.number(),
});
export const verifiedView = statusView.extend({ verified: z.literal(true) });

const groupNumber = (n: string): string =>
  `${n.slice(0, 2)}-${n.slice(2, 6)}-${n.slice(6, 10)}-${n.slice(10)}`;

export async function readStatus(
  db: Queryable,
  services: Services,
  auth: AuthContext,
  patientId: string,
): Promise<StatusView> {
  const patient = await services.directory.getPatient(auth.clinicId, patientId);
  if (!patient) throw errors.notFound('Patient not found');
  const r = await db.query<{
    abha_address: string | null;
    verified_at: Date;
    mode: 'mock' | 'sandbox';
  }>(
    'SELECT abha_address, verified_at, mode FROM abha_link WHERE clinic_id = $1 AND patient_id = $2',
    [auth.clinicId, patientId],
  );
  const row = r.rows[0];
  const mode = services.abha.mode;
  return {
    patientId,
    verified: !!row,
    abhaAddress: row?.abha_address ?? null,
    verifiedAt: row ? row.verified_at.toISOString() : null,
    verifiedMode: row?.mode ?? null,
    mode,
    notice: NOTICE[mode],
    mockIdentities:
      mode === 'mock'
        ? Object.values(MOCK_IDENTITIES).map((m) => ({
            number: groupNumber(m.number),
            address: m.address,
            outcome: m.outcome,
          }))
        : null,
  };
}

/** Maps a provider failure to the API error. Only our own words go out. */
export function toApiError(e: AbhaError): AppError {
  const map: Record<AbhaFailure, [AppError['code'], number]> = {
    otp_wrong: ['ABHA_OTP_WRONG', 400],
    otp_expired: ['ABHA_OTP_EXPIRED', 410],
    rate_limited: ['ABHA_RATE_LIMITED', 429],
    unavailable: ['ABHA_UNAVAILABLE', 503],
    not_configured: ['ABHA_UNAVAILABLE', 503],
    identity_unknown: ['ABHA_NOT_FOUND', 422],
    rejected: ['ABHA_FAILED', 502],
  };
  const [code, status] = map[e.failure];
  return new AppError(
    code,
    e.message,
    status,
    e.retryAfterSeconds ? { retryAfterSeconds: e.retryAfterSeconds } : undefined,
  );
}

const REJECT_WORDS: Record<Exclude<IdentityVerdict['reason'], 'ok'>, string> = {
  aadhaar_like: 'This looks like an Aadhaar number. Aadhaar numbers are never accepted here.',
  not_allowlisted:
    "This is not one of the allowed test identities. Only the mock test identities (or the owner's sandbox test list) can be used; real ABHA numbers are never accepted.",
  production_address: 'This looks like a real ABHA address. Only test identities can be used.',
  malformed: 'This does not look like an ABHA number (14 digits) or an ABHA address.',
};

export function saltedHash(key: string, patientId: string, number: string): string {
  return createHmac('sha256', `abha-number-v1:${key}`)
    .update(`${patientId}:${number}`)
    .digest('hex');
}

/** A provider crash is replaced by a fixed message: the original text could hold a value, so it never reaches the log. */
const unexpected = (): AppError =>
  new AppError('ABHA_FAILED', 'The ABHA check failed unexpectedly. Nothing was saved.', 502);

type Audit = (failure: string) => Promise<void>;

export async function startVerification(
  db: Queryable,
  services: Services,
  auth: AuthContext,
  input: { patientId: string; identity: string },
  failed: Audit,
): Promise<z.infer<typeof startedView>> {
  const patient = await services.directory.getPatient(auth.clinicId, input.patientId);
  if (!patient) throw errors.notFound('Patient not found');
  const mode = services.abha.mode;
  const verdict = checkIdentity(
    input.identity,
    mode,
    parseSandboxAllowlist(services.config.abdm.sandboxTestIdentities),
  );
  if (!verdict.ok || verdict.kind === null) {
    await failed(`identity_${verdict.reason}`);
    throw new AppError(
      'ABHA_IDENTITY_REJECTED',
      REJECT_WORDS[verdict.reason as Exclude<typeof verdict.reason, 'ok'>],
      400,
    );
  }
  const recent = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM abha_txn WHERE clinic_id = $1 AND patient_id = $2 AND created_at > now() - interval '15 minutes'`,
    [auth.clinicId, input.patientId],
  );
  if ((recent.rows[0]?.n ?? 0) >= MAX_STARTS_PER_QUARTER_HOUR) {
    await failed('start_rate_limited');
    throw new AppError(
      'ABHA_RATE_LIMITED',
      'Too many OTP requests for this patient. Wait a few minutes.',
      429,
    );
  }
  let txn: string;
  try {
    txn = (await services.abha.startOtp({ kind: verdict.kind, value: verdict.value })).txn;
  } catch (err) {
    if (err instanceof AbhaError) {
      await failed(err.failure);
      throw toApiError(err);
    }
    await failed('unexpected');
    throw unexpected();
  }
  const row = await db.query<{ id: string }>(
    `INSERT INTO abha_txn (patient_id, clinic_id, provider_txn, mode, kind, attested_by, created_by, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$6, now() + ($7::int * interval '1 millisecond')) RETURNING id`,
    [input.patientId, auth.clinicId, txn, mode, verdict.kind, auth.sub, TXN_LIFETIME_MS],
  );
  return {
    txnId: row.rows[0]?.id as string,
    mode,
    notice: NOTICE[mode],
    expiresInSeconds: TXN_LIFETIME_MS / 1000,
  };
}

export async function verifyOtp(
  db: Queryable,
  services: Services,
  auth: AuthContext,
  input: { txnId: string; otp: string },
  failed: (patientId: string, failure: string) => Promise<void>,
): Promise<StatusView> {
  const t = await db.query<{
    id: string;
    patient_id: string;
    provider_txn: string;
    mode: 'mock' | 'sandbox';
    status: string;
    attempts: number;
    expired: boolean;
    attested_by: string;
  }>(
    `SELECT id, patient_id, provider_txn, mode, status, attempts, expires_at < now() AS expired, attested_by
       FROM abha_txn WHERE id = $1 AND clinic_id = $2`,
    [input.txnId, auth.clinicId],
  );
  const txn = t.rows[0];
  if (!txn) throw errors.notFound('This verification was not found');
  if (txn.status !== 'open') {
    await failed(txn.patient_id, `txn_${txn.status}`);
    throw errors.conflict('This verification is already finished. Start again.');
  }
  if (txn.expired) {
    await closeTxn(services, txn.id, 'failed');
    await failed(txn.patient_id, 'otp_expired');
    throw new AppError('ABHA_OTP_EXPIRED', 'The OTP has expired. Start again.', 410);
  }
  if (txn.attempts >= MAX_OTP_ATTEMPTS) {
    await closeTxn(services, txn.id, 'locked');
    await failed(txn.patient_id, 'locked');
    throw new AppError('ABHA_RATE_LIMITED', 'Too many wrong OTPs. Start again later.', 429);
  }
  // the attempt is counted in its OWN committed transaction, so a refusal below cannot roll the count back
  await withTransaction(services.pool, (own) =>
    own.query('UPDATE abha_txn SET attempts = attempts + 1 WHERE id = $1', [txn.id]),
  );
  let result;
  try {
    result = await services.abha.verifyOtp({ txn: txn.provider_txn, otp: input.otp });
  } catch (err) {
    if (err instanceof AbhaError) {
      if (err.failure === 'otp_expired') await closeTxn(services, txn.id, 'failed');
      else if (txn.attempts + 1 >= MAX_OTP_ATTEMPTS && err.failure === 'otp_wrong')
        await closeTxn(services, txn.id, 'locked');
      await failed(txn.patient_id, err.failure);
      const api = toApiError(err);
      if (err.failure === 'otp_wrong') {
        const left = Math.max(0, MAX_OTP_ATTEMPTS - (txn.attempts + 1));
        throw new AppError(
          api.code,
          `The OTP is not correct. ${left} ${left === 1 ? 'try' : 'tries'} left.`,
          400,
          { attemptsLeft: left },
        );
      }
      throw api;
    }
    await failed(txn.patient_id, 'unexpected');
    throw unexpected();
  }
  const hash = result.abhaNumber
    ? saltedHash(services.lockoutKey, txn.patient_id, result.abhaNumber)
    : null;
  await db.query(
    `INSERT INTO abha_link (patient_id, clinic_id, abha_address, abha_number_hash, mode, verified_at, verified_by, attested_by, attested_at)
     VALUES ($1,$2,$3,$4,$5, now(), $6, $7, now())
     ON CONFLICT (clinic_id, patient_id) DO UPDATE SET abha_address = EXCLUDED.abha_address,
       abha_number_hash = EXCLUDED.abha_number_hash, mode = EXCLUDED.mode, verified_at = EXCLUDED.verified_at,
       verified_by = EXCLUDED.verified_by, attested_by = EXCLUDED.attested_by, attested_at = EXCLUDED.attested_at, updated_at = now()`,
    [txn.patient_id, auth.clinicId, result.abhaAddress, hash, txn.mode, auth.sub, txn.attested_by],
  );
  await db.query("UPDATE abha_txn SET status = 'verified' WHERE id = $1", [txn.id]);
  return readStatus(db, services, auth, txn.patient_id);
}

async function closeTxn(
  services: Services,
  id: string,
  status: 'failed' | 'locked',
): Promise<void> {
  await withTransaction(services.pool, (own) =>
    own.query('UPDATE abha_txn SET status = $2 WHERE id = $1', [id, status]),
  );
}
