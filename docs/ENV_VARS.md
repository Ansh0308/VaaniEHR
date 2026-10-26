# Environment variables: sensitivity and where they are read (Phase 12B, ADR-D44)

**SECRET** = a credential or key: never logged, never in an error, never in the audit log, never committed. **SENSITIVE** = not a credential but it identifies people or opens a door (allowlists, URLs with accounts). **CONFIG** = harmless.
All `.env` files are git-ignored (`.gitignore`, gitleaks in CI). Only `*.env.example` files are tracked and hold placeholders (`REPLACE_ME_...`) or empty values; `security-static.test.ts` checks this and that every variable below that the API reads appears in `apps/api-node/.env.example`.
Config errors name the variable, never its value (`apps/api-node/test/config.test.ts`, `apps/asr-py/tests/test_config.py`). Where a value is read is listed so a review can follow it.

## api-node (`apps/api-node/src/config/env.ts`, read once at start-up)

| Variable | Class | Read in | Notes |
|---|---|---|---|
| `NODE_ENV` | CONFIG | `config/env.ts`, `logger.ts` | `production` refuses the dev auth provider |
| `PORT` | CONFIG | `config/env.ts` | |
| `DATABASE_URL` | SECRET (holds the app role password) | `config/env.ts`, `db/pool.ts`, `audit/verifyCli.ts` | never printed; config errors do not echo it |
| `AUTH_PROVIDER` | CONFIG | `config/env.ts`, `bootstrap.ts` | `dev` or `clinicos` (stub) |
| `DEV_AUTH_SECRET` | SECRET | `config/env.ts` (length check), `bootstrap.ts` → `DevAuthProvider` | signs bearer tokens; also seeds the lockout key |
| `INTERNAL_SERVICE_SECRET` | SECRET | `config/env.ts`, `auth/serviceAuth.ts`, `asr/token.ts` | same value in asr-py |
| `DEV_TOKEN_TTL_SECONDS` | CONFIG | `config/env.ts` | |
| `CORS_ORIGIN` | CONFIG | `app.ts`, `realtime/socket.ts` | one fixed origin |
| `SIMULATED_DATA_ONLY` | CONFIG (safety switch) | `config/env.ts`, `server.ts` | `false` is refused |
| `CLINICOS_BASE_URL` | CONFIG | `config/env.ts` | Phase 12, unused |
| `TRUST_PROXY` | CONFIG | `app.ts` | set only behind a proxy you control |
| `LOGIN_RATE_LIMIT_MAX`, `LOGIN_RATE_WINDOW_MINUTES`, `LOCKOUT_MAX_FAILURES`, `LOCKOUT_MINUTES` | CONFIG | `auth/routes.ts` | |
| `WEBHOOK_RATE_LIMIT_MAX` | CONFIG | `whatsapp/routes.ts` | requests per minute per address (new, ADR-D44) |
| `BCRYPT_COST` | CONFIG | `auth/password.ts`, `seed/seedDev.ts` | |
| `CONCEPTS_FILE`, `PATHWAYS_DIR`, `PATHWAYS_ALLOW_TEST`, `PATHWAYS_SLOT_MAP`, `PATHWAY_QUESTION_CAP`, `PATHWAY_ABSTAIN_THRESHOLD`, `PATHWAY_AGAINST_PENALTY` | CONFIG | `config/env.ts`, `pathways/` | `PATHWAYS_ALLOW_TEST` refused in production |
| `FHIR_VALIDATOR_URL` | CONFIG | `fhir/validator.ts` | local container |
| `WHATSAPP_PROVIDER`, `WHATSAPP_ENABLE_REAL`, `WHATSAPP_API_VERSION` | CONFIG | `whatsapp/provider.ts` | real sending needs all flags |
| `WHATSAPP_ACCESS_TOKEN` | SECRET | `whatsapp/provider.ts` | Meta bearer token |
| `WHATSAPP_APP_SECRET` | SECRET | `whatsapp/service.ts` (webhook HMAC) | |
| `WHATSAPP_VERIFY_TOKEN` | SECRET | `whatsapp/routes.ts` (GET handshake) | |
| `WHATSAPP_PHONE_NUMBER_ID` | SENSITIVE | `whatsapp/provider.ts` | |
| `WHATSAPP_TEST_ALLOWLIST` | SENSITIVE (phone numbers) | `whatsapp/provider.ts` | only these numbers can receive real messages |
| `ABDM_PROVIDER`, `ABDM_ENABLE_SANDBOX` | CONFIG | `abdm/provider.ts` | mock by default |
| `ABDM_CLIENT_ID` | SENSITIVE | `abdm/provider.ts` → `abdm/client.ts` | |
| `ABDM_CLIENT_SECRET` | SECRET | `abdm/client.ts` | sent only to the token endpoint |
| `ABDM_SESSION_URL`, `ABDM_CERT_URL`, `ABDM_ABHA_URL` | CONFIG | `abdm/client.ts` | must be https (local test servers excepted) |
| `ABDM_SANDBOX_TEST_IDENTITIES` | SENSITIVE | `abdm/service.ts` | sandbox TEST identities only |
| `MIGRATION_DATABASE_URL`, `APP_DB_PASSWORD` | SECRET | migration/seed/CLI tools only (`db/provision.ts`, `seed/seedDev.ts`, `medicines/*Cli.ts`) | the running API never reads them |
| `DEV_CREDENTIALS_FILE` | CONFIG | `seed/seedDev.ts` | the file itself holds fake logins and is git-ignored |
| `LOG_IN_TESTS` | CONFIG | `logger.ts` | tests only |

## asr-py (`apps/asr-py/app/config.py`)

| Variable | Class | Read in | Notes |
|---|---|---|---|
| `INTERNAL_SERVICE_SECRET` | SECRET (`SecretStr`, at least 32 characters) | `consent.py`, `internal_api.py` | |
| `AUDIO_MASTER_KEY` | SECRET (`SecretStr`, 64 hex characters) | `storage.py` | wraps each file's data key; losing it loses the recordings |
| `SARVAM_API_KEY` | SECRET (`SecretStr`) | `main.py` (passed to `asr/sarvam.py`) | |
| `LLM_API_KEY` | SECRET (`SecretStr`) | `extraction/provider.py build_provider` → `openai_compat.py` | |
| `LLM_BASE_URL` | SENSITIVE | `extraction/provider.py` → `openai_compat.py` | |
| `LLM_PROVIDER`, `LLM_MODEL` | CONFIG | `extraction/provider.py` | mock by default |
| `LLM_ALLOW_REAL_DATA`, `SARVAM_ALLOW_THIRD_PARTY_AUDIO` | CONFIG (safety switches) | `extraction/provider.py`, `asr/sarvam.py`, `own_voice.py` | default false |
| `SIMULATED_DATA_ONLY` | CONFIG (safety switch) | `config.py` | `false` refused |
| `LLM_MONTHLY_CAP_INR`, `LLM_MONTHLY_CAP_TOKENS`, `LLM_MONTHLY_CAP_REQUESTS`, `LLM_REQUEST_CAP`, `LLM_INPUT_INR_PER_MILLION`, `LLM_OUTPUT_INR_PER_MILLION`, `ASR_MONTHLY_CAP_MINUTES`, `ASR_SMOKE_MAX_SECONDS` | CONFIG (spend caps) | `usage.py`, `extraction/llm_usage.py` | |
| `AUDIO_RETENTION_DAYS` | CONFIG | `purge.py` | |
| `ASR_PY_PORT`, `ASR_DATA_DIR`, `ASR_VAD`, `ASR_DEFAULT_ENGINE`, `ASR_ENABLE_MOCK`, `API_NODE_URL`, `ALLOWED_ORIGINS` | CONFIG | `config.py`, `main.py` | `ALLOWED_ORIGINS` is the CORS list |

## web (build time, public)

| Variable | Class | Notes |
|---|---|---|
| `VITE_API_BASE_URL`, `VITE_ASR_WS_URL`, `VITE_ASR_HTTP_URL`, `VITE_SIMULATED_DATA_ONLY` | CONFIG (end up in the JavaScript bundle) | never put a secret here (`apps/web/Dockerfile` comment; build args hold no secrets) |

## infra and tooling

| Variable | Class | Notes |
|---|---|---|
| `POSTGRES_PASSWORD`, `APP_DB_PASSWORD` | SECRET | `infra/.env` (git-ignored); CI uses throwaway values |
| `POSTGRES_USER`, `POSTGRES_DB`, `POSTGRES_PORT`, `API_PORT`, `ASR_PORT`, `WEB_PORT` | CONFIG | |
| `CHROME_PATH` | CONFIG | e2e/a11y browser path |
| `LLM_PROVIDER`, `ABDM_*` in `scripts/abdm-smoke.mjs` | see above | the smoke script prints only pass/fail words |

## Review result (2026-10-26)

- No secret is read anywhere except the places listed. No secret has a default value in code (`config/env.ts` has defaults only for CONFIG items).
- Logged fields are fixed names (`requestId`, `role`, `signal`, error name, database code and a redacted, shortened message: `logger.ts redactMessage`). `security-secrets.db.test.ts` runs failing logins, forged tokens, bad signatures, validation errors and a forced internal error with distinctive secret values configured, and fails if any of those values or any secret-shaped string reaches stdout, stderr, the audit log or an API error body.
- Found and fixed in this review: unhandled error messages were logged as thrown and could quote user input or a value (now redacted); `.env.example` did not list the WhatsApp, ABDM, FHIR and webhook variables (now listed).
