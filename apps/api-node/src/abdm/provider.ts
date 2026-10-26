// AbhaProvider (Phase 9B, ADR-D42, FR-F9-01): how an ABHA number or address is checked by one-time password. MockAbha is the
// DEFAULT and needs no network and no credential; SandboxAbha talks to the ABDM V3 sandbox and is disabled unless a flag and
// credentials are set. A provider never returns an OTP or a token, and its errors carry plain words only (errors.ts).
import { AbdmClient } from './client.js';
import { AbhaError } from './errors.js';
import type { IdentityKind } from './identityGuard.js';
import { MockAbha } from './mockProvider.js';
import { SandboxAbha } from './sandboxProvider.js';

export interface StartInput {
  kind: IdentityKind;
  value: string;
}
export interface StartResult {
  /** the provider's own transaction reference; the API never sends it to the browser */
  txn: string;
}
export interface VerifyInput {
  txn: string;
  otp: string;
}
export interface VerifyResult {
  abhaAddress: string | null;
  /** only ever used to make the salted hash; never stored, never logged, never returned */
  abhaNumber: string | null;
}
export interface AbhaProvider {
  readonly mode: 'mock' | 'sandbox';
  startOtp(input: StartInput): Promise<StartResult>;
  verifyOtp(input: VerifyInput): Promise<VerifyResult>;
}

/** A sandbox that was asked for but is not fully set up: every call fails with the reason; it never falls back to the mock. */
export class NotConfiguredAbha implements AbhaProvider {
  readonly mode = 'sandbox' as const;
  constructor(private readonly reason: string) {}
  async startOtp(): Promise<StartResult> {
    throw new AbhaError('not_configured', this.reason);
  }
  async verifyOtp(): Promise<VerifyResult> {
    throw new AbhaError('not_configured', this.reason);
  }
}

export interface AbdmEnv {
  ABDM_PROVIDER?: string | undefined;
  ABDM_ENABLE_SANDBOX?: string | undefined;
  ABDM_CLIENT_ID?: string | undefined;
  ABDM_CLIENT_SECRET?: string | undefined;
  ABDM_SESSION_URL?: string | undefined;
  ABDM_CERT_URL?: string | undefined;
  ABDM_ABHA_URL?: string | undefined;
}

export function createAbha(env: AbdmEnv, fetchImpl: typeof fetch = fetch): AbhaProvider {
  if ((env.ABDM_PROVIDER ?? 'mock') !== 'sandbox') return new MockAbha();
  if (env.ABDM_ENABLE_SANDBOX !== 'true') {
    return new NotConfiguredAbha(
      'The ABDM sandbox is switched off (ABDM_ENABLE_SANDBOX is not true).',
    );
  }
  if (!env.ABDM_CLIENT_ID || !env.ABDM_CLIENT_SECRET) {
    return new NotConfiguredAbha('The ABDM sandbox needs a client id and a client secret.');
  }
  try {
    return new SandboxAbha(
      new AbdmClient({
        clientId: env.ABDM_CLIENT_ID,
        clientSecret: env.ABDM_CLIENT_SECRET,
        ...(env.ABDM_SESSION_URL ? { sessionUrl: env.ABDM_SESSION_URL } : {}),
        ...(env.ABDM_CERT_URL ? { certUrl: env.ABDM_CERT_URL } : {}),
        ...(env.ABDM_ABHA_URL ? { abhaUrl: env.ABDM_ABHA_URL } : {}),
        fetchImpl,
      }),
    );
  } catch (err) {
    if (err instanceof AbhaError) return new NotConfiguredAbha(err.message);
    throw err;
  }
}
