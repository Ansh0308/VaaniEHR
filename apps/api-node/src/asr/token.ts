// The short-lived token that lets the browser open the audio stream on asr-py (Phase 4A, ADR-D26).
// Format: base64url(JSON payload) + "." + base64url(HMAC-SHA256(payload part, INTERNAL_SERVICE_SECRET)).
// The payload names the session and the consent scopes api-node has just confirmed; asr-py verifies it with the
// same secret and refuses audio without it. It carries no names and no patient data, only ids.
import { createHmac, randomUUID } from 'node:crypto';

export const ASR_AUDIENCE = 'asr-py';
export const ASR_TOKEN_TTL_SECONDS = 120;

export interface AsrTokenClaims {
  v: 1;
  aud: typeof ASR_AUDIENCE;
  /** consultation session id */
  sid: string;
  /** consent scopes confirmed at issue time */
  scopes: string[];
  /** user and clinic that asked for it (ids only) */
  uid: string;
  cid: string;
  iat: number;
  exp: number;
  jti: string;
}

const b64 = (buffer: Buffer): string => buffer.toString('base64url');

export function signAsrToken(
  secret: string,
  input: { sessionId: string; scopes: string[]; userId: string; clinicId: string },
  now: Date = new Date(),
): { token: string; expiresAt: string; claims: AsrTokenClaims } {
  const iat = Math.floor(now.getTime() / 1000);
  const claims: AsrTokenClaims = {
    v: 1,
    aud: ASR_AUDIENCE,
    sid: input.sessionId,
    scopes: [...input.scopes].sort(),
    uid: input.userId,
    cid: input.clinicId,
    iat,
    exp: iat + ASR_TOKEN_TTL_SECONDS,
    jti: randomUUID(),
  };
  const payload = b64(Buffer.from(JSON.stringify(claims), 'utf8'));
  const signature = b64(createHmac('sha256', secret).update(payload).digest());
  return {
    token: `${payload}.${signature}`,
    expiresAt: new Date(claims.exp * 1000).toISOString(),
    claims,
  };
}
