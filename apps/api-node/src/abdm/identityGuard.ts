// The identity guard (Phase 9B, ADR-D42, FR-F9-03). The project must never handle a real person's ABHA or Aadhaar number, so
// the API refuses anything that is not a known TEST identity BEFORE it reaches any provider:
//  - the MOCK set: obviously fake fixtures (zeros, mock.invalid addresses), always allowed in mock mode;
//  - the SANDBOX allowlist: identities the owner copied from the ABDM sandbox test data into ABDM_SANDBOX_TEST_IDENTITIES
//    (comma separated), allowed only in sandbox mode;
//  - anything else is refused. A 12-digit number is refused as "looks like an Aadhaar number" whatever it is; a 14-digit number
//    that is not in the allowed set is refused as "looks like an ABHA number"; an address that ends in the production suffix
//    is refused.
// Heuristic and its limit: it cannot know whether an allowlisted number belongs to a real person (the owner must only put
// published test identities there), and it will refuse a made-up 14-digit test number that nobody allowlisted (a false
// positive on purpose: asking the owner to add it is safer than letting an unknown number through).
export type IdentityKind = 'abha_number' | 'abha_address';

export interface IdentityVerdict {
  ok: boolean;
  kind: IdentityKind | null;
  /** normalised value (digits only for a number, lower case for an address) */
  value: string;
  reason: 'ok' | 'aadhaar_like' | 'not_allowlisted' | 'production_address' | 'malformed';
}

/** The MOCK fixtures: obviously fake, never real. Each one drives a different outcome in the mock provider. */
export const MOCK_IDENTITIES = {
  ok: { number: '91000000000001', address: 'mock.success@mock.invalid', outcome: 'success' },
  expired: {
    number: '91000000000002',
    address: 'mock.expired@mock.invalid',
    outcome: 'the OTP has expired',
  },
  rateLimited: {
    number: '91000000000003',
    address: 'mock.limited@mock.invalid',
    outcome: 'too many requests',
  },
  down: {
    number: '91000000000004',
    address: 'mock.down@mock.invalid',
    outcome: 'the service is down',
  },
  unknown: {
    number: '91000000000005',
    address: 'mock.unknown@mock.invalid',
    outcome: 'no such account',
  },
} as const;
export const MOCK_OTP = '123456';

const digitsOnly = (s: string): string => s.replace(/[\s-]/g, '');

export function normaliseIdentity(raw: string): { kind: IdentityKind | null; value: string } {
  const t = raw.trim().toLowerCase();
  if (t.includes('@'))
    return /^[a-z0-9._-]{3,64}@[a-z0-9.-]{2,40}$/.test(t)
      ? { kind: 'abha_address', value: t }
      : { kind: null, value: t };
  const d = digitsOnly(t);
  return /^\d+$/.test(d) ? { kind: 'abha_number', value: d } : { kind: null, value: t };
}

export function checkIdentity(
  raw: string,
  mode: 'mock' | 'sandbox',
  sandboxAllow: readonly string[],
): IdentityVerdict {
  const { kind, value } = normaliseIdentity(raw);
  if (kind === null) return { ok: false, kind, value, reason: 'malformed' };
  const mock = Object.values(MOCK_IDENTITIES).flatMap((m) => [m.number, m.address]);
  const sandbox = sandboxAllow.map((x) => normaliseIdentity(x).value);
  if (kind === 'abha_number') {
    if (value.length === 12) return { ok: false, kind, value, reason: 'aadhaar_like' };
    if (value.length !== 14) return { ok: false, kind, value, reason: 'malformed' };
  } else if (/@(abdm|ndhm)$/.test(value)) {
    return { ok: false, kind, value, reason: 'production_address' };
  }
  const allowed = mode === 'mock' ? mock : sandbox;
  return allowed.includes(value)
    ? { ok: true, kind, value, reason: 'ok' }
    : { ok: false, kind, value, reason: 'not_allowlisted' };
}

export const parseSandboxAllowlist = (raw: string | undefined): string[] =>
  (raw ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
