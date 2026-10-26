// The ABDM V3 sandbox client (Phase 9B, ADR-D42): an access token with caching, the RSA public key, and a request helper with
// retry and backoff. It NEVER logs or returns a request or response body, an identifier, an OTP or a token: errors are
// structured (AbhaError) with plain words. The paths and body shapes below follow the ABDM V3 integration guidance as known to
// the project; the official sandbox documentation host answered 503 during this run, so they are UNVERIFIED (docs/ABDM.md) and
// every one can be overridden by environment variable. The sandbox provider is OFF by default, so none of this runs unless the
// owner switches it on and checks it against the official pages.
import { randomUUID } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { parsePublicKey } from './encryption.js';
import { AbhaError } from './errors.js';

export interface AbdmClientConfig {
  clientId: string;
  clientSecret: string;
  /** POST: access token (client credentials) */
  sessionUrl?: string;
  /** GET: the public key used to encrypt sensitive values */
  certUrl?: string;
  /** base of the ABHA V3 profile, login and enrolment APIs */
  abhaUrl?: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  maxAttempts?: number;
  timeoutMs?: number;
}

export const DEFAULTS = {
  // UNVERIFIED defaults (see the header): override with ABDM_SESSION_URL, ABDM_CERT_URL, ABDM_ABHA_URL
  sessionUrl: 'https://dev.abdm.gov.in/api/hiecm/gateway/v3/sessions',
  certUrl: 'https://abhasbx.abdm.gov.in/abha/api/v3/profile/public/certificate',
  abhaUrl: 'https://abhasbx.abdm.gov.in/abha/api/v3',
} as const;

const KEY_TTL_MS = 60 * 60_000;
const TOKEN_MARGIN_MS = 30_000;

/** https, or http to this machine only (local test servers). */
export function isSecureUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.protocol === 'https:' ||
      (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname))
    );
  } catch {
    return false;
  }
}

export class AbdmClient {
  private token: { value: string; expiresAt: number } | null = null;
  private key: { value: KeyObject; fetchedAt: number } | null = null;
  private readonly f: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(private readonly cfg: AbdmClientConfig) {
    // ASVS 12.2.1 (ADR-D44): sandbox credentials and identity values are never sent over plain http (local test servers excepted)
    for (const url of [cfg.sessionUrl, cfg.certUrl, cfg.abhaUrl]) {
      if (url !== undefined && !isSecureUrl(url)) {
        throw new AbhaError('not_configured', 'ABDM addresses must start with https://.');
      }
    }
    this.f = cfg.fetchImpl ?? fetch;
    this.sleep = cfg.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = cfg.now ?? (() => Date.now());
  }

  get abhaUrl(): string {
    return (this.cfg.abhaUrl ?? DEFAULTS.abhaUrl).replace(/\/$/, '');
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'REQUEST-ID': randomUUID(),
      TIMESTAMP: new Date(this.now()).toISOString(),
      'X-CM-ID': 'sbx',
      ...extra,
    };
  }

  /** One HTTP call with retry and exponential backoff on network errors, 429 and 5xx. Other 4xx answers are not retried. */
  private async send(url: string, init: RequestInit): Promise<Response> {
    const attempts = this.cfg.maxAttempts ?? 3;
    let last: AbhaError | null = null;
    for (let i = 0; i < attempts; i += 1) {
      try {
        const res = await this.f(url, {
          ...init,
          signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 15_000),
        });
        if (res.status === 429 || res.status >= 500) {
          const wait = Number(res.headers.get('retry-after'));
          const hasWait = Number.isFinite(wait) && wait > 0;
          last =
            res.status === 429
              ? new AbhaError(
                  'rate_limited',
                  'ABDM says there were too many requests.',
                  hasWait ? wait : undefined,
                )
              : new AbhaError('unavailable', 'The ABDM service is not answering.');
          if (i < attempts - 1) {
            await this.sleep(hasWait ? Math.min(wait * 1000, 10_000) : 500 * 2 ** i);
            continue;
          }
          throw last;
        }
        return res;
      } catch (err) {
        if (err instanceof AbhaError) throw err;
        last = new AbhaError('unavailable', 'The ABDM service could not be reached.');
        if (i < attempts - 1) await this.sleep(500 * 2 ** i);
      }
    }
    throw last ?? new AbhaError('unavailable', 'The ABDM service could not be reached.');
  }

  async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt - TOKEN_MARGIN_MS > this.now()) return this.token.value;
    const res = await this.send(this.cfg.sessionUrl ?? DEFAULTS.sessionUrl, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        clientId: this.cfg.clientId,
        clientSecret: this.cfg.clientSecret,
        grantType: 'client_credentials',
      }),
    });
    if (!res.ok)
      throw new AbhaError(
        'rejected',
        'ABDM did not give an access token (check the client id and secret).',
      );
    const json = (await res.json().catch(() => ({}))) as {
      accessToken?: string;
      expiresIn?: number;
    };
    if (!json.accessToken)
      throw new AbhaError('rejected', 'ABDM answered without an access token.');
    this.token = {
      value: json.accessToken,
      expiresAt: this.now() + (json.expiresIn ?? 600) * 1000,
    };
    return json.accessToken;
  }

  async publicKey(): Promise<KeyObject> {
    if (this.key && this.now() - this.key.fetchedAt < KEY_TTL_MS) return this.key.value;
    const res = await this.send(this.cfg.certUrl ?? DEFAULTS.certUrl, {
      method: 'GET',
      headers: this.headers({ Authorization: `Bearer ${await this.accessToken()}` }),
    });
    if (!res.ok) throw new AbhaError('unavailable', 'The ABDM public key could not be fetched.');
    const json = (await res.json().catch(() => ({}))) as { publicKey?: string };
    if (!json.publicKey) throw new AbhaError('unavailable', 'ABDM answered without a public key.');
    try {
      this.key = { value: parsePublicKey(json.publicKey), fetchedAt: this.now() };
    } catch {
      throw new AbhaError('unavailable', 'The ABDM public key could not be read.');
    }
    return this.key.value;
  }

  /** POST a JSON body to a path under the ABHA base and map ABDM refusals to structured errors (no body text kept). */
  async post(path: string, body: unknown): Promise<Record<string, unknown>> {
    const res = await this.send(`${this.abhaUrl}${path}`, {
      method: 'POST',
      headers: this.headers({ Authorization: `Bearer ${await this.accessToken()}` }),
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok) return json;
    // classify from the text ABDM sent, then drop it: only our own fixed words leave this function
    const nested = (json['error'] as { message?: string } | undefined)?.message ?? '';
    const said = `${String(json['message'] ?? '')} ${nested}`.toLowerCase();
    if (/expire/.test(said))
      throw new AbhaError('otp_expired', 'The OTP has expired. Ask for a new one.');
    if (/invalid otp|incorrect|wrong|mismatch|otp.*not.*(valid|correct)/.test(said)) {
      throw new AbhaError('otp_wrong', 'The OTP is not correct.');
    }
    if (/not found|no account|does not exist|not registered|invalid.*(abha|health)/.test(said)) {
      throw new AbhaError('identity_unknown', 'ABDM found no ABHA account for this.');
    }
    if (res.status === 401 || res.status === 403) {
      this.token = null;
      throw new AbhaError('rejected', 'ABDM refused the request (check the sandbox credentials).');
    }
    throw new AbhaError('rejected', 'ABDM could not accept the request.');
  }
}
