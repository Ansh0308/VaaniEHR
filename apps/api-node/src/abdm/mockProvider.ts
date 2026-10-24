// MockAbha (Phase 9B, ADR-D42, FR-F9-03): replays the outcomes the ABDM documentation describes for the OTP flow, driven by a
// handful of OBVIOUSLY FAKE identities (identityGuard.ts MOCK_IDENTITIES) and the fixed fake OTP. No network, no credential.
// success, wrong OTP, expired OTP, rate limit, service down, unknown account.
import { randomUUID } from 'node:crypto';
import { AbhaError } from './errors.js';
import { MOCK_IDENTITIES, MOCK_OTP } from './identityGuard.js';
import type {
  AbhaProvider,
  StartInput,
  StartResult,
  VerifyInput,
  VerifyResult,
} from './provider.js';

export const MOCK_OTP_LIFETIME_MS = 5 * 60_000;

interface Txn {
  value: string;
  startedAt: number;
}

export class MockAbha implements AbhaProvider {
  readonly mode = 'mock' as const;
  private readonly txns = new Map<string, Txn>();
  constructor(private readonly now: () => number = () => Date.now()) {}

  private is(value: string, key: keyof typeof MOCK_IDENTITIES): boolean {
    return value === MOCK_IDENTITIES[key].number || value === MOCK_IDENTITIES[key].address;
  }

  async startOtp(input: StartInput): Promise<StartResult> {
    if (this.is(input.value, 'down'))
      throw new AbhaError('unavailable', 'MOCK: the ABHA service is not answering.');
    if (this.is(input.value, 'rateLimited')) {
      throw new AbhaError('rate_limited', 'MOCK: too many OTP requests for this ABHA.', 60);
    }
    if (this.is(input.value, 'unknown'))
      throw new AbhaError('identity_unknown', 'MOCK: no ABHA account was found.');
    if (!this.is(input.value, 'ok') && !this.is(input.value, 'expired')) {
      throw new AbhaError('rejected', 'MOCK: this is not one of the mock test identities.');
    }
    const txn = `mock-${randomUUID()}`;
    // the "expired" identity gets a transaction that is already past its lifetime
    const startedAt = this.is(input.value, 'expired')
      ? this.now() - MOCK_OTP_LIFETIME_MS - 1
      : this.now();
    this.txns.set(txn, { value: input.value, startedAt });
    return { txn };
  }

  async verifyOtp(input: VerifyInput): Promise<VerifyResult> {
    const t = this.txns.get(input.txn);
    if (!t)
      throw new AbhaError('otp_expired', 'MOCK: the OTP request was not found or has expired.');
    if (this.now() - t.startedAt > MOCK_OTP_LIFETIME_MS) {
      this.txns.delete(input.txn);
      throw new AbhaError('otp_expired', 'MOCK: the OTP has expired.');
    }
    if (input.otp !== MOCK_OTP) throw new AbhaError('otp_wrong', 'MOCK: the OTP is not correct.');
    this.txns.delete(input.txn);
    return { abhaAddress: MOCK_IDENTITIES.ok.address, abhaNumber: MOCK_IDENTITIES.ok.number };
  }
}
