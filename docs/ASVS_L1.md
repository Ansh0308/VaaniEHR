# OWASP ASVS Level 1 walk-through (Phase 12B, ADR-D44)

**Standard:** OWASP Application Security Verification Standard **5.0.0** (the current published version), requirements list `OWASP_Application_Security_Verification_Standard_5.0.0_en.csv` in https://github.com/OWASP/ASVS (path `5.0/docs_en/`), read on 2026-10-26. It has 345 requirements: 70 at Level 1, 183 at Level 2, 92 at Level 3. Chapters V16 (Logging and Error Handling) and V17 (WebRTC) have no Level 1 requirements. This file covers **all 70 Level 1 requirements**; the wording below is shortened, so read the standard for the exact text.

**Scope and honesty.** A research prototype with simulated data, checked by its own authors: this is a self-assessment, not a certification and not a penetration test. A row is **PASS** only with a test, a file or a document that shows it. **FAIL** means the requirement is not met (severity and plan given). **N/A** means the feature the requirement is about does not exist in this build (reason given). Where a requirement can only be met at deployment (TLS, hosting) it is a FAIL with owner action, because nothing in this repository can satisfy it.

**Result: 48 PASS, 7 FAIL, 15 N/A (70).** No Critical or High finding. Findings by severity: Medium 3 (TLS and WSS at deployment, public certificate), Low 4 (password change, bcrypt 72-byte limit, initial password lifetime, token not ended at re-login).

Test paths are under `apps/api-node/test/` unless written in full. "New" marks a test added in this phase.

## Findings (all FAIL rows)

| ID | Severity | Finding | Plan / owner |
|---|---|---|---|
| V12.1.1 | Medium (deployment) | The repository ships no TLS: local and compose traffic is plain HTTP/WS | Owner: terminate TLS 1.2+/1.3 at the host or a reverse proxy (OWNER_ACTIONS "TLS and hosting") |
| V4.4.1 | Medium (deployment) | The audio WebSocket and Socket.IO use `ws://` locally | Same TLS step; set `VITE_ASR_WS_URL=wss://...` and update the nginx `connect-src` |
| V12.2.2 | Medium (deployment) | No publicly trusted certificate (no public host yet) | Owner, at hosting |
| V6.2.2 | Low | There is no self-service password change | Standalone mode only; Phase 12 replaces authentication with ClinicOS tokens (ADR-D4). Accepted for the prototype |
| V6.2.8 | Low | bcrypt (bcryptjs) uses only the first 72 bytes of a password, so a longer password is silently shortened | Generated passwords are shorter. Fix with the Phase 12 authentication, or add a maximum length of 72 bytes where passwords are set |
| V6.4.1 | Low | Seeded initial passwords are random but do not expire | Dev seed only (refused in production: `src/seed/seedDev.ts`); Phase 12 authentication |
| V7.2.4 | Low (accepted) | A new login makes a new token, but earlier tokens stay valid until expiry or logout (several devices at once) | No token exists before login, so session fixation is not possible; multi-device use is deliberate (`auth.db.test.ts`, "a second device") |

Other observations, not ASVS Level 1 failures: route `response` schemas are documentation only (OpenAPI) and are not enforced at run time, so a future handler that returns a whole database row would not be caught (V15.3.1 passes today because handlers map rows to explicit views; see the row). The Semgrep community rules and a penetration test are not part of the gate (SBOM notes, OWNER_ACTIONS).

## Remediation timeframes (V15.1.1)

| Severity of a known vulnerability in a third-party component | Fix, replace or accept in writing within |
|---|---|
| Critical | 7 days |
| High | 30 days |
| Moderate | 90 days |
| Low | the next planned release |

Accepted risks are written into `security/audit-allowlist.json` (npm and PyPI) or `.trivyignore` (images) with a reason, an owner and an expiry date; an expired entry fails the build again. CI runs the gates on every push and pull request (dependency audit, SAST) and nightly (images): `.github/workflows/security.yml`.

## Level 1 requirements

### V1 Encoding and Sanitization

| Req | Requirement (short) | Result | Evidence |
|---|---|---|---|
| 1.2.1 | Output-encode for the context (HTML, attributes, headers) | PASS | React escapes all text; hostile strings render as text: `apps/web/src/security.xss.test.tsx` (new); no raw HTML anywhere: `security-static.test.ts` (new) |
| 1.2.2 | Encode untrusted data in URLs, allow safe protocols only | PASS | The app builds links from route patterns and UUIDs only; a `javascript:` link from data is never created: `security.xss.test.tsx`; `security-static.test.ts` |
| 1.2.3 | Encode when building JavaScript or JSON | PASS | JSON is produced by `JSON.stringify` through `src/http/respond.ts`; no JSON or script is assembled from strings (`security-static.test.ts`, Semgrep rule `vaani-no-eval`) |
| 1.2.4 | Parameterised queries | PASS | Only whitelisted constant fragments are interpolated into SQL: `security-static.test.ts` (new); injection probes on every search and filter: `security.db.test.ts` (new); one string-interpolated value was found and fixed (`fhir/service.ts`) |
| 1.2.5 | Protect against OS command injection | PASS | No shell in the API or the speech service: `security-static.test.ts`; Semgrep rules `vaani-no-shell-exec`, `vaani-py-no-shell` |
| 1.3.1 | Sanitise untrusted HTML from rich editors | N/A | There is no rich-text or HTML editor |
| 1.3.2 | Avoid `eval` and dynamic code | PASS | `security-static.test.ts` (API, web and Python); Semgrep `vaani-no-eval`, `vaani-py-no-eval` |
| 1.5.1 | Restrictive XML parsers (XXE) | N/A | No XML is parsed by the application: FHIR is JSON (`src/fhir/builder.ts`); the HL7 validator runs in its own container |

### V2 Validation and Business Logic

| Req | Requirement (short) | Result | Evidence |
|---|---|---|---|
| 2.1.1 | Documented validation rules | PASS | Every route has a zod schema (params, query, body); `apps/api-node/openapi.json` is generated from them (`npm run openapi`) |
| 2.2.1 | Validate input against allowlists, ranges, structure | PASS | Strict zod objects reject unknown fields: `security.db.test.ts` ("unknown fields on a strict body"); NUL characters are refused (found by the injection probes, fixed in `src/http/noNul.ts`) |
| 2.2.2 | Validate at a trusted service layer, not only in the client | PASS | All gates are server side (consent, sign, send, ABHA); the web app only mirrors them: `visit-sign.db.test.ts`, `abha.db.test.ts`, `whatsapp.db.test.ts` |
| 2.3.1 | Business flows run in the expected order | PASS | Consent before the audio token (`asr-token.db.test.ts`), sign needs confirmed facts and the doctor's password (`visit-sign.db.test.ts`), WhatsApp needs signed visit, consent and approval (`whatsapp.db.test.ts`), ABHA start before OTP (`abha.db.test.ts`) |

### V3 Web Frontend Security

| Req | Requirement (short) | Result | Evidence |
|---|---|---|---|
| 3.2.1 | Responses are not rendered in the wrong context | PASS | JSON content type and `nosniff` on every API response, the CSV export is an attachment with `no-store`: `security.db.test.ts` ("every response carries nosniff...") |
| 3.2.2 | Render untrusted text with safe functions | PASS | `security.xss.test.tsx` (fact chip, transcript, WhatsApp preview) |
| 3.3.1 | Cookies are `Secure` | N/A | The app sets no cookies; a token in a cookie is not accepted: `security.db.test.ts` ("a token in a query string or a cookie") |
| 3.4.1 | `Strict-Transport-Security` of at least a year | PASS | API: `security.db.test.ts` (max-age at least 31536000). Web host: `apps/web/nginx.conf` + `security-static.test.ts`. It only takes effect over HTTPS (see V12.1.1) |
| 3.4.2 | CORS allowed origin is fixed or allowlisted | PASS | One configured origin, never `*`, a foreign origin is never echoed: `security.db.test.ts` ("CORS answers only the configured origin") |
| 3.5.1 | Sensitive cross-origin requests come from the app itself | PASS | Authentication is a bearer header, never a cookie, so a cross-site form or image cannot carry it: `security.db.test.ts` (token in a cookie or query is refused; no token gives 401 on every non-public route) |
| 3.5.2 | Preflight protection cannot be skipped | PASS | The `Authorization` header forces a preflight; the only public write route is the signature-checked webhook (`whatsapp.db.test.ts`, `security.db.test.ts`) |
| 3.5.3 | Sensitive functions use POST, PUT, PATCH or DELETE | PASS | `security.db.test.ts` ("no GET route writes") |

### V4 API and Web Service

| Req | Requirement (short) | Result | Evidence |
|---|---|---|---|
| 4.1.1 | Content-Type matches the body, with a charset | PASS | `security.db.test.ts` (JSON `charset=utf-8`, CSV `text/csv`) |
| 4.4.1 | WebSockets over TLS | FAIL | Medium, deployment: `ws://` locally. See Findings (V4.4.1) |

### V5 File Handling

| Req | Requirement (short) | Result | Evidence |
|---|---|---|---|
| 5.2.1 | Accept only files of a size the app can handle | PASS | The API has no file upload route (`openapi.json`); JSON bodies are capped at 100 kb: `security.db.test.ts` ("a body over 100 kb"); the audio stream has a length cap (`apps/asr-py/app/ws.py MAX_STREAM_SECONDS`) |
| 5.2.2 | File content matches its extension | N/A | No user file upload exists. The medicine import is an operator command line tool (`src/medicines/importCli.ts`), not a web route |
| 5.3.1 | Uploaded or generated files are not executed | PASS | Nothing uploaded is served; audio is stored encrypted and never served as a file (`apps/asr-py/app/storage.py`); the web host serves only the built bundle |
| 5.3.2 | File paths come from trusted data | PASS | Audio file names are server-generated UUIDs (`apps/asr-py/app/storage.py`, `_file`); the session id only goes into the encrypted record; no file name or path is accepted from a client |

### V6 Authentication

| Req | Requirement (short) | Result | Evidence |
|---|---|---|---|
| 6.1.1 | Documented defences against credential stuffing and brute force | PASS | This file, `docs/THREAT_MODEL.md` (threat 4) and `docs/ENV_VARS.md` (the limits and their settings) |
| 6.2.1 | Passwords of at least 8 characters | N/A | Users cannot set a password in this build; the seed generates them (`src/seed/seedDev.ts`) |
| 6.2.2 | Users can change their password | FAIL | Low. See Findings (V6.2.2) |
| 6.2.3 | Change needs current and new password | N/A | There is no change feature |
| 6.2.4 | Passwords checked against common passwords | N/A | Users cannot set a password |
| 6.2.5 | No composition rules | N/A | Users cannot set a password; the login accepts any characters |
| 6.2.6 | Password fields use `type=password` | PASS | `apps/web/src/pages/LoginPage.tsx`, `SignPage.tsx`, `AmendPage.tsx` |
| 6.2.7 | Paste and password managers allowed | PASS | No paste blocking in the web app: `security-static.test.ts` ("no paste blocking", new) |
| 6.2.8 | Passwords verified exactly as received | FAIL | Low. See Findings (V6.2.8) |
| 6.3.1 | Controls against credential stuffing and brute force | PASS | Per-address rate limit and account lockout: `auth.db.test.ts`; no user enumeration: `login-privacy.db.test.ts`; sign-off password throttle: `visit-sign.db.test.ts` |
| 6.3.2 | No default accounts | PASS | The seed accounts have random generated passwords and the seed refuses to run in production (`src/seed/seedDev.ts`, code review; no dedicated test) |
| 6.4.1 | Initial passwords are random and expire | FAIL | Low. See Findings (V6.4.1) |
| 6.4.2 | No password hints or secret questions | N/A | The feature does not exist |

### V7 Session Management

| Req | Requirement (short) | Result | Evidence |
|---|---|---|---|
| 7.2.1 | Token verification by a trusted backend | PASS | `src/auth/DevAuthProvider.ts`, `DbBackedAuthProvider.ts`; `auth.db.test.ts` |
| 7.2.2 | Dynamically generated tokens, not static keys | PASS | A token is issued per login with a fresh `jti` (`DevAuthProvider.issueToken`); the service secret is for service-to-service calls only |
| 7.2.3 | Reference tokens are random, 128 bits | N/A | Tokens are self-contained JWTs, not reference tokens |
| 7.2.4 | New token at login, current one ended | FAIL | Low, accepted. See Findings (V7.2.4) |
| 7.4.1 | A terminated session cannot be used again | PASS | Logout revokes the `jti`: `auth.db.test.ts` ("logout revokes the token") |
| 7.4.2 | Disabling an account ends its sessions | PASS | The user status is checked on every request: `auth.db.test.ts` ("a user suspended after the token was issued is refused immediately") |

### V8 Authorization

| Req | Requirement (short) | Result | Evidence |
|---|---|---|---|
| 8.1.1 | Documented access rules | PASS | `src/auth/permissions.ts`, `test/prdExpectations.ts` (the matrix), `docs/PRD_ERRATA.md` (role deviations), `docs/THREAT_MODEL.md` |
| 8.2.1 | Function-level access needs explicit permission | PASS | `rbac.db.test.ts` (every route, every role); `security.db.test.ts` (no token, header or body can change the role) |
| 8.2.2 | Data-specific access (IDOR) | PASS | `clinic-isolation.db.test.ts` (every route, both clinics); a session is only reachable by its own doctor (`asr-token.db.test.ts`) |
| 8.3.1 | Authorisation at a trusted layer | PASS | The route registry checks the permission before any handler (`src/http/routeRegistry.ts`); `security.db.test.ts` ("a correctly signed token naming a role the user does not have is refused") |

### V9 Self-contained Tokens

| Req | Requirement (short) | Result | Evidence |
|---|---|---|---|
| 9.1.1 | Signature or MAC validated first | PASS | `security.db.test.ts` (altered payload, altered signature, removed signature, admin payload with the old signature) |
| 9.1.2 | Algorithm allowlist, no `none` | PASS | `algorithms: ['HS256']` in `DevAuthProvider.ts`; `auth.test.ts` (`alg=none`), `security.db.test.ts` (HS512) |
| 9.1.3 | Keys from trusted sources; `jku`, `x5u`, `jwk` not trusted | PASS | One symmetric key from configuration; header key references are never read (`DevAuthProvider.ts`) |
| 9.2.1 | `exp` and `nbf` checked | PASS | `security.db.test.ts` (expired, wrong audience, wrong issuer); `auth.test.ts` |

### V10 OAuth and OIDC

| Req | Requirement (short) | Result | Evidence |
|---|---|---|---|
| 10.4.1 to 10.4.5 | Authorisation-server rules (redirect URIs, code lifetime and reuse, grants, refresh tokens) | N/A | The app is neither an OAuth client nor an authorisation server. ClinicOS token validation arrives in Phase 12 (`AUTH_PROVIDER=clinicos`, a stub today) and must be re-checked then |

### V11 Cryptography

| Req | Requirement (short) | Result | Evidence |
|---|---|---|---|
| 11.3.1 | No insecure block modes or weak padding | PASS | No ECB, no PKCS#1 v1.5 encryption: `security-static.test.ts`; the ABDM helper uses RSA-OAEP (`src/abdm/encryption.ts`) |
| 11.3.2 | Approved ciphers and modes | PASS | AES-256-GCM for audio (`apps/asr-py/app/storage.py`, `tests/test_storage.py`); bcrypt for passwords; HMAC-SHA-256 for tokens and signatures |
| 11.4.1 | Approved hash functions only | PASS | No MD5 or SHA-1 hashing: `security-static.test.ts`. SHA-1 appears only as the OAEP hash the ABDM interface asks for (`abdm/encryption.ts`, unverified, docs/ABDM.md) and in uuid v5 ids (`fhir/builder.ts`, RFC 4122), neither a security control |

### V12 Secure Communication

| Req | Requirement (short) | Result | Evidence |
|---|---|---|---|
| 12.1.1 | Only current TLS versions | FAIL | Medium, deployment. See Findings (V12.1.1) |
| 12.2.1 | TLS for all connections to external services | PASS | ABDM addresses must be https (local test servers excepted): `src/abdm/client.ts isSecureUrl`, `abdm.test.ts` (new); The Meta default is https and the Sarvam default is wss (`whatsapp/provider.ts`, `asr/sarvam.py`), the ABDM defaults are https; Semgrep rules `vaani-no-plain-http`, `vaani-py-no-plain-http`. Traffic between the app's own services inside the compose network is internal, not external |
| 12.2.2 | Publicly trusted certificates | FAIL | Medium, deployment. See Findings (V12.2.2) |

### V13 Configuration

| Req | Requirement (short) | Result | Evidence |
|---|---|---|---|
| 13.4.1 | No source-control metadata in the deployment | PASS | `.dockerignore` excludes `.git`; images copy built output only: `security-static.test.ts` |

### V14 Data Protection

| Req | Requirement (short) | Result | Evidence |
|---|---|---|---|
| 14.2.1 | Sensitive data is not sent in the URL | PASS | Phone lookup, ABHA, consent and sign-off use bodies: `apps/web/src/pages/PatientsPage.test.tsx` ("never in the URL"), `abha.db.test.ts`; the only query strings are filters and the Meta verification parameters; path ids are UUIDs |
| 14.3.1 | Client storage cleared after the session | PASS | The token lives in memory only, and the end-to-end run asserts that browser storage holds nothing but the language choice (`scripts/e2e.mjs`, "signing wrote nothing but the language choice"); logout clears it (`apps/web/src/auth/AuthContext.tsx`) |

### V15 Secure Coding and Architecture

| Req | Requirement (short) | Result | Evidence |
|---|---|---|---|
| 15.1.1 | Documented remediation timeframes | PASS | Section "Remediation timeframes" above |
| 15.2.1 | No component past its timeframe | PASS | `npm audit`: 0 vulnerabilities on 2026-10-26 (body-parser and vitest updated in this phase); `pip-audit` of the speech service: none; both gated in CI (`scripts/audit-gate.mjs`, `security/audit-allowlist.json`, empty) |
| 15.3.1 | Return only the required fields | PASS | Handlers map rows to explicit views (for example the ABHA status view never holds the number: `abha.db.test.ts`; `GET /auth/me`; the patient and session views). See the observation above about response schemas not being enforced |
