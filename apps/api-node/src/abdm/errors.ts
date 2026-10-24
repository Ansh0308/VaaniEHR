// Structured ABHA / ABDM errors (Phase 9B, ADR-D42). A message here NEVER contains an identifier, an OTP, a token or a
// response body: it is plain words, safe to show a person and safe to log. `cause` is a short code for tests and the UI.
export type AbhaFailure =
  | 'otp_wrong'
  | 'otp_expired'
  | 'rate_limited'
  | 'unavailable'
  | 'identity_unknown'
  | 'rejected'
  | 'not_configured';

export class AbhaError extends Error {
  constructor(
    public readonly failure: AbhaFailure,
    message: string,
    /** seconds the caller should wait (rate limit), when the service said so */
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'AbhaError';
  }
}
