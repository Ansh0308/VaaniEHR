// SandboxAbha (Phase 9B, ADR-D42): the ABDM V3 sandbox OTP flow for an ABHA number or address. Sensitive values are RSA-encrypted
// before they leave (encryption.ts). Disabled unless ABDM_PROVIDER=sandbox, ABDM_ENABLE_SANDBOX=true and credentials are set
// (provider.ts). The request bodies follow the ABDM V3 guidance as known to the project and are UNVERIFIED against the
// official pages (unreachable in this run, docs/ABDM.md): scripts/abdm-smoke.mjs is the way to check them with real sandbox
// credentials. Nothing sensitive is logged or put in an error.
import type { AbdmClient } from './client.js';
import { encryptForAbdm } from './encryption.js';
import { AbhaError } from './errors.js';
import type {
  AbhaProvider,
  StartInput,
  StartResult,
  VerifyInput,
  VerifyResult,
} from './provider.js';

const SCOPE = {
  abha_number: ['abha-login', 'mobile-verify'],
  abha_address: ['abha-address-login', 'mobile-verify'],
} as const;
const HINT = { abha_number: 'abha-number', abha_address: 'abha-address' } as const;

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

export class SandboxAbha implements AbhaProvider {
  readonly mode = 'sandbox' as const;
  /** remembers which scope a transaction used (an in-memory map: a transaction lives minutes) */
  private readonly scopes = new Map<string, readonly string[]>();
  constructor(private readonly client: AbdmClient) {}

  async startOtp(input: StartInput): Promise<StartResult> {
    const key = await this.client.publicKey();
    const scope = SCOPE[input.kind];
    const json = await this.client.post('/profile/login/request/otp', {
      scope,
      loginHint: HINT[input.kind],
      loginId: encryptForAbdm(key, input.value),
      otpSystem: 'abdm',
    });
    const txn = str(json['txnId']);
    if (!txn) throw new AbhaError('rejected', 'ABDM answered without a transaction reference.');
    this.scopes.set(txn, scope);
    return { txn };
  }

  async verifyOtp(input: VerifyInput): Promise<VerifyResult> {
    const key = await this.client.publicKey();
    const scope = this.scopes.get(input.txn) ?? SCOPE.abha_number;
    const json = await this.client.post('/profile/login/verify', {
      scope,
      authData: {
        authMethods: ['otp'],
        otp: { txnId: input.txn, otpValue: encryptForAbdm(key, input.otp) },
      },
    });
    this.scopes.delete(input.txn);
    const accounts = Array.isArray(json['accounts'])
      ? (json['accounts'][0] as Record<string, unknown> | undefined)
      : undefined;
    const profile = (json['ABHAProfile'] ?? json['profile'] ?? accounts) as
      Record<string, unknown> | undefined;
    if (!profile) throw new AbhaError('rejected', 'ABDM answered without a profile.');
    return {
      abhaAddress: str(profile['preferredAbhaAddress']) ?? str(profile['abhaAddress']),
      abhaNumber: str(profile['ABHANumber']) ?? str(profile['abhaNumber']),
    };
  }
}
