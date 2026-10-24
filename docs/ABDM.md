# ABDM / ABHA (Phase 9B, ADR-D42)

**Status: MOCK-first. Nothing here has been checked against the official ABDM sandbox documentation.**

## What was tried (2026-10-24)

The official documentation host did not answer, twice (this run, and again at the end of the run), for me and for a separate fetch agent:

| Page tried | Result |
|---|---|
| `https://sandbox.abdm.gov.in/docs` | HTTP 503 |
| `https://sandbox.abdm.gov.in/abdm-docs` | HTTP 503 |
| `https://sandbox.abdm.gov.in/docs/abha-v3` | HTTP 503 |
| `https://sandbox.abdm.gov.in/swagger`, `/api-docs` | HTTP 503 |
| `https://abdm.gov.in` | loads, but holds no API documentation |

So **no page is cited as a source in this file**, on purpose. The PRD's mirror of the ABDM text is unofficial (PRD_ERRATA row 63) and was not used as a source either.

## What the code assumes (all UNVERIFIED)

The sandbox provider (`apps/api-node/src/abdm/client.ts`, `sandboxProvider.ts`, `encryption.ts`) follows the ABDM V3 ABHA login-by-OTP flow as known to the project. Each of these is a guess until it is checked against the official pages:

1. An access token from a "sessions" endpoint with client id and secret (`ABDM_SESSION_URL`).
2. A public certificate endpoint for the RSA key (`ABDM_CERT_URL`).
3. Sensitive values (the ABHA number or address, the OTP) are RSA-encrypted with that key, **OAEP padding with SHA-1** (`encryption.ts`), sent as base64.
4. `POST {ABDM_ABHA_URL}/profile/login/request/otp` with `scope`, `loginHint`, `loginId` (encrypted) and `otpSystem`, answered with a transaction id.
5. `POST {ABDM_ABHA_URL}/profile/login/verify` with `authData.otp` (`txnId`, encrypted `otpValue`), answered with a profile holding the ABHA address and number.
6. Headers `REQUEST-ID`, `TIMESTAMP`, `X-CM-ID: sbx`.

Every URL can be overridden by environment variable, so a wrong default does not need a code change. The default for the provider is the **mock**: the sandbox provider is never created unless `ABDM_PROVIDER=sandbox`, `ABDM_ENABLE_SANDBOX=true` and both credentials are set, and it never falls back to the mock when asked for (it reports "not configured").

## What to do when the docs are reachable (owner or next run)

1. Read the official ABHA V3 pages for: base URLs, the session endpoint, the certificate endpoint, the encryption padding and hash, the request-OTP and verify-OTP bodies, the error responses.
2. Compare with the list above and fix `client.ts`, `sandboxProvider.ts` and `encryption.ts`; add the page URLs to this file.
3. Run `node scripts/abdm-smoke.mjs` (see OWNER_ACTIONS). It is documented and has **not** been run.

## Safety rules in force

- Only mock fixtures and ABDM **sandbox test identities** are accepted (`identityGuard.ts`). A 12-digit number (Aadhaar-like), a production-looking address (`@abdm`, `@ndhm`) or anything outside the allowlist is refused **before** any provider is called.
- The ABHA number, the OTP and every token are never stored, logged or audited. Stored: the ABHA address, the time, the mode (`mock` or `sandbox`) and a salted keyed hash (HMAC-SHA-256) of the number. A test proves no value reaches stdout, stderr or the audit log.
- Every response and screen carries `mode` and a MOCK or SANDBOX notice.
- No care-context linking (F14).
- Not in the build: a real, production ABDM connection of any kind.
