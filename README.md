# VaaniEHR

**Research prototype. Simulated data only. Not for real patients, not for clinical use, not a medical device.** All rights reserved (no licence file yet, ADR-D17).

VaaniEHR is a B.Tech capstone project: a voice-assisted, guideline-grounded consultation module for a general-medicine OPD doctor, built to be ABDM-ready. The doctor records a consultation after consent; speech becomes a transcript and structured facts that the doctor confirms; a rules engine suggests the next question from a versioned pathway; the doctor builds a prescription and signs; the signed record becomes a validated FHIR bundle and a Gujarati WhatsApp summary that the doctor approves.

## What it is not

- **Not for real patients.** The server refuses to start with `SIMULATED_DATA_ONLY=false`. Every page carries a "research prototype, simulated data" banner. Use fake or acted data only.
- **Not a diagnosis tool.** It proposes questions and a shortlist; the doctor decides and signs.
- **Not finished.** The medicine suggestion and safety engine (PRD feature F6), the evaluation console screen, the ClinicOS integration, HIP care-context linking and prescription PDF are **not built**. Real clinical pathways are not loaded (only labelled toy pathways). ABHA and WhatsApp run against mocks only. What exists and what does not, requirement by requirement: [docs/SRS.md](docs/SRS.md) and [docs/TRACEABILITY.md](docs/TRACEABILITY.md).
- **Not reviewed** by a clinician, a lawyer, a native Gujarati speaker or a screen-reader user (see [Limitations](#limitations)).

## Architecture in one table

| Part | What | Technology |
|---|---|---|
| `apps/web` | Doctor, staff and admin interface, English and Gujarati | React 18, Vite, TypeScript, Tailwind 4 |
| `apps/api-node` | REST API, roles, audit log, consent, visits, FHIR, WhatsApp, ABHA, privacy requests | Node 20+, Express 5, PostgreSQL 16 |
| `apps/asr-py` | Speech service (audio over a WebSocket, encrypted storage, purge), fact extraction, evaluation tools | Python 3.11, FastAPI |
| `packages/rules` | Pathway format, validator, question engine | TypeScript |
| `infra` | Docker Compose: the database (PostgreSQL 16 + pgvector) and optional containers for the three services | Docker |
| `seed`, `bench`, `scripts`, `docs` | Committed seed content, the evaluation dataset spec, cross-platform Node scripts, documentation | |

Every external service is **mock by default** (speech engine, language model, WhatsApp, ABHA). Real ones need several explicit switches; see [docs/ENV_VARS.md](docs/ENV_VARS.md). ClinicOS (`..\AWT-Project`) is read-only and is not used or run by anything here. Decisions: [docs/DECISIONS.md](docs/DECISIONS.md). Orientation: [docs/CONTEXT.md](docs/CONTEXT.md). Every document: [docs/DOC_INDEX.md](docs/DOC_INDEX.md).

## Quick start (about 30 minutes, most of it downloads)

Tested on Windows 11 with PowerShell. The scripts are cross-platform Node and Python and should work elsewhere, but only Windows has been tried. The time taken and the problems found on a fresh clone are recorded in [docs/QUICKSTART_TEST.md](docs/QUICKSTART_TEST.md).

**You need:** Git, Node.js 20.19 or newer with npm 10 or newer, Python 3.11 (`py -3.11 --version` must work), and Docker Desktop **running** (`docker info` must succeed). Chrome is needed only for `npm run e2e` and `npm run a11y`.

Run from the repository root:

```powershell
git clone <this repository> VaaniEHR
cd VaaniEHR
npm install                 # all npm workspaces, exact pinned versions
npm run py:setup            # creates apps\asr-py\.venv and installs the pinned Python packages
npm run setup:env           # creates the .env files with random dev secrets (never overwrites, never prints them)
npm run db:up               # PostgreSQL 16 in Docker; waits until healthy
npm run db:migrate          # applies all migrations
npm run seed:dev            # FAKE data: 1 clinic, 5 users, 15 patients; passwords go to data\dev-credentials.json (git-ignored)
```

Check that it all works (about 5 to 10 minutes; the database tests need `db:up`):

```powershell
npm run check
```

Then switch on the demo settings. These are **not secrets**; they allow the toy pathways and the fake speech engine, and are refused in production:

```powershell
Add-Content apps\api-node\.env "PATHWAYS_ALLOW_TEST=true"
Add-Content apps\api-node\.env "PATHWAYS_DIR=$PWD\packages\rules\fixtures\pathways"
Add-Content apps\api-node\.env "PATHWAYS_SLOT_MAP=$PWD\packages\rules\fixtures\pathways\_toy\slot-map.json"
Add-Content apps\asr-py\.env "ASR_ENABLE_MOCK=true"
```

Start the three services, each in its own terminal, from the repository root:

```powershell
npm run dev:api             # http://localhost:4000
npm run dev:asr             # http://localhost:8000
npm run dev:web             # http://localhost:5173
```

Open http://localhost:5173. The fake users are `admin@example.invalid`, `doctor1@example.invalid`, `staff@example.invalid` and `researcher@example.invalid` (the researcher role is not built in the interface). Their random passwords are in `data\dev-credentials.json`; open that file yourself, do not paste it anywhere.

To run everything in containers instead of three terminals: `npm run stack:up`, then `npm run stack:status` and `npm run stack:down` (ports: web 5173, api 4000, speech 8000, database 5433, all bound to 127.0.0.1).

## Run the demo

[docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md) is the five-minute walk-through: sign in as the doctor, start a session, record consent, record (the mock engine returns two made-up lines), extract and confirm facts, answer the toy question, add a fake medicine, sign, amend, and show the audit chain as the admin. The medicine search needs one medicine: add a fake row named `Drug-A (FAKE)` in the admin page (Medicine master, Add medicine), or run the NLEM import with your own copy of the PDF (`npm run import:nlem`, see [docs/MEDICINES.md](docs/MEDICINES.md)); the PDF is not in the repository.

## Evaluations

These need no paid service and no private data by default. Numbers they print come from tiny acted or synthetic data and are protocol demonstrations, not results ([docs/EVALUATION_PLAN.md](docs/EVALUATION_PLAN.md) says what each metric needs).

```powershell
npm run bench:validate -- --dir bench/fixtures      # check the dataset format on the three synthetic cases
npm run pathways:cases                              # the pathway engine on its test cases (toy pathways)
npm run eval:extraction -- --fixtures apps/asr-py/tests/fixtures/extraction --texts ""   # fact extraction on synthetic fixtures (mock model)
```

The paid speech engine (Sarvam) and a real language model are off unless you set the keys and the safety switches; the guides are [docs/ASR_EVAL_GUIDE.md](docs/ASR_EVAL_GUIDE.md) and [docs/EXTRACTION_EVAL_GUIDE.md](docs/EXTRACTION_EVAL_GUIDE.md). The benchmark format, split and runner: [bench/README.md](bench/README.md).

## Tests

```powershell
npm run check               # lint, typecheck, all tests (needs db:up), repo guards, ruff, pytest, traceability checker
npm run check:unit          # the same without the database tests (no Docker needed)
npm run e2e                 # real API + Chrome on a throwaway database: whole journey, accessibility sweep of every route, keyboard pass
npm run a11y                # accessibility check of the design page
npm run test:results        # records the latest results in results\tests (git-ignored)
npm run trace               # rewrites docs\TRACEABILITY.md (requirement -> code -> tests -> latest result); fails if an Implemented requirement lacks code or a test
npm run srs                 # refreshes the generated requirement tables in docs\SRS.md from the PRD
```

Security checks that run in CI (dependency audit, Semgrep, Bandit, Trivy, gitleaks) are described in [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) and [docs/ASVS_L1.md](docs/ASVS_L1.md).

## FHIR validator

Signing builds a FHIR R4 bundle for the NRCeS ABDM guide (6.5.0) and validates it with the HL7 validator. The validator is optional for the quick start; without it the visit page says "Not validated". It needs Java 11+ or Docker, downloads the guide packages, and takes several minutes to start the first time (not covered by the quick-start test):

```powershell
npm run fhir:fetch          # downloads the pinned validator and IG packages (checksummed)
npm run fhir:server         # starts the validator on http://localhost:8090; put FHIR_VALIDATOR_URL=http://localhost:8090 in apps\api-node\.env
npm run fhir:check          # validates the golden and deliberately broken examples (the CI check)
```

Mapping and known gaps: [docs/FHIR_MAPPING.md](docs/FHIR_MAPPING.md), [docs/FHIR_GAPS.md](docs/FHIR_GAPS.md).

## Environment variables

Every variable, where it is read, whether it is a secret, and its safe default: [docs/ENV_VARS.md](docs/ENV_VARS.md). Secrets live only in git-ignored `.env` files created by `npm run setup:env`; `.env.example` files list the names. Never paste `.env` contents into a chat, an issue or a commit.

## Other everyday commands

```powershell
npm run dev:api | dev:web | dev:asr    # one service each
npm run verify:audit                    # recompute the audit hash chain (docs\AUDIT_CHAIN.md)
npm run openapi                         # regenerate apps\api-node\openapi.json (a test fails if stale)
npm run build                           # production builds of web and api-node
npm run db:down                         # stop the database (data kept)
npm run db:reset                        # DESTROY the local dev database, recreate, migrate
npm run sbom                            # regenerate docs\SBOM.md
npm run docs:index                      # regenerate docs\DOC_INDEX.md from the PRD
```

## Limitations

- **Safety engine and medicine suggestions: not built.** Signing asks the doctor to acknowledge "Safety checks were not run". No dose, interaction or allergy check exists.
- **No real clinical pathways.** Only toy pathways, labelled "not clinical". Clinical content (pathways, red flags, doses) is never invented; the gaps are listed in [docs/OPEN_CLINICAL_ITEMS.md](docs/OPEN_CLINICAL_ITEMS.md).
- **Mocks by default.** ABHA verification (the sandbox has never been called), WhatsApp (Meta has never been called, no template approved) and the language model. The speech engine Sarvam was tried on one clip of the owner's own voice.
- **Unreviewed Gujarati.** All Gujarati text, including the consent notice (version 0.1, a placeholder), awaits a native speaker ([docs/NOTICE_REVIEW.md](docs/NOTICE_REVIEW.md)).
- **No screen-reader test** has been done; the accessibility checks are automated plus a keyboard pass and make no conformance claim ([docs/A11Y_REPORT.md](docs/A11Y_REPORT.md)).
- **Legal questions are open** (retention of signed records after an erasure request, consent wording, medical-device status). The software keeps the signed record and removes the rest until told otherwise. These are **to be checked by my guide / institution** (OCI-016, SRS appendix B).
- **ClinicOS integration is not built** (the real calls need the owner's explicit approval); a mock adapter stands in.
- **No measured performance.** Latency and accuracy targets in the PRD have not been measured on real data; the evaluation harness exists, the data does not ([docs/EVALUATION_PLAN.md](docs/EVALUATION_PLAN.md)).

## Conventions

- Success: `{ "success": true, "data": ... }`. Error: `{ "success": false, "error": { "code": "...", "message": "..." } }`. camelCase JSON, UUID ids, `X-Request-Id` on every response.
- Config is validated at startup and fails fast. Auth goes through an `AuthProvider` interface; the standalone provider issues short-lived tokens signed with a VaaniEHR-only secret.
- Sockets: namespace `/vaani` on the API; connections are authenticated at the handshake. Audio goes over a plain WebSocket on the speech service (ADR-D25).
- Project rules for contributors and AI assistants: [AGENTS.md](AGENTS.md).

## Troubleshooting

- `docker compose failed` or `Database is not reachable`: start Docker Desktop and wait for the engine (`docker info` must succeed), then `npm run db:up`.
- Port 5433 busy: change `POSTGRES_PORT` in `infra\.env` and the port in `DATABASE_URL` in `apps\api-node\.env`.
- `Python 3.11 not found`: install Python 3.11 and re-run `npm run py:setup`.
- The record button stays disabled: consent for audio and AI processing must be saved first (by design).
