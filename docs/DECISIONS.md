# DECISIONS.md - Architecture Decision Records

**ADR-D1 to ADR-D17 are SETTLED - do not reopen without asking the owner.** (The PRD's own open decisions are called PRD-D1..PRD-D7 in this repo; PRD-D1 and PRD-D2 are closed by ADR-D1 and ADR-D2.)

All records below: **Date 2026-10-14**, **Status: Accepted**, **Decider: Ansh (project owner)**. Recorded by the assistant from the owner's instructions. Evidence for ClinicOS facts is in `CLINICOS_AUDIT.md` and `CLINICOS_INTEGRATION_FACTS.md`.

---

## D1 - Databases: ClinicOS stays MySQL; VaaniEHR gets its own PostgreSQL 16 + pgvector
- **Context:** ClinicOS code uses MySQL via Sequelize (`mysql2`); three ClinicOS documents and the VaaniEHR PRD (§3.3 A5, §11, §16.2 D1) assumed PostgreSQL 16.
- **Decision:** ClinicOS = MySQL/Sequelize (code is truth). VaaniEHR = its own PostgreSQL 16 with pgvector. The two integrate **over REST only**; no shared database, no cross-database joins.
- **Consequences:** VaaniEHR stores ClinicOS ids (`patients.id`, `users.id`, `visits.id`, `tokens.id`, `clinics.id`, all UUID strings) as plain reference columns with no foreign keys. PRD §3.3 A5 and §16.2 D1 are resolved by this record.

## D2 - ClinicOS real status is as documented in `docs/CLINICOS_AUDIT.md`
- **Context:** The PRD (§3.5) relied on a checklist dated 18 March 2026 that showed almost nothing built.
- **Decision:** The audit is the reference for what ClinicOS has: auth, lookup, queue/sockets, visit/EHR (basic), billing, analytics, portal and admin pages are implemented; appointments, lab orders, referrals, consent records and attachments are not.
- **Consequences:** PRD §3.5 and §16.2 D2 are superseded. See `PRD_ERRATA.md`.

## D3 - Integration style: VaaniEHR is a separate service that calls ClinicOS REST
- **Context:** Options were a separate service, code inside ClinicOS, or a shared database.
- **Decision:** Separate service calling ClinicOS REST endpoints.
- **Consequences:** ClinicOS is not modified before "Phase 12 integration approved". Anything ClinicOS lacks (webhooks, signed state, coded fields) is stored on the VaaniEHR side (see D11). PRD §8.4 (schema changes inside ClinicOS) and parts of §9.4 no longer apply as written.

## D4 - Authentication: no shared JWT secret; `AuthProvider` interface
- **Context:** The ClinicOS JWT contains only `userId` and is signed with an HS256 secret. Sharing that secret would let VaaniEHR (and anyone who compromises it) mint ClinicOS tokens.
- **Decision:** VaaniEHR does **not** share `JWT_SECRET`. Standalone phases use an `AuthProvider` interface with a seeded **dev provider**. Phase 12 adds `ClinicOSTokenAuth`, which validates the user's ClinicOS bearer token by calling `GET /api/auth/me` and caches the result briefly. ClinicOS is not to be edited yet. *(Amended 2026-10-14: the dev provider's token format is fixed - see "Owner answers applied" at the end.)*
- **Consequences:** `ClinicOSTokenAuth` must check `status === 'approved'` itself, because `/api/auth/me` returns 200 for suspended/pending users (see facts Q1). `/api/auth/me` sits behind a **10-requests-per-15-minutes-per-IP** limiter (`server.js:46-52,74`); server-to-server validation from one VaaniEHR IP would exhaust it, so the cache must be effective and the limiter may need a Phase 12 change (needs approval). Open item for Phase 12, not solved here.

## D5 - Source of truth: code wins for ClinicOS facts; the VaaniEHR PRD wins for VaaniEHR
- **Decision:** Where ClinicOS docs and code differ, treat the code as correct. For VaaniEHR scope, the VaaniEHR PRD (plus these ADRs) governs.
- **Consequences:** Contradictions between the PRD and verified ClinicOS code are listed in `PRD_ERRATA.md`; the PRD file itself is not edited.

## D6 - ClinicOS `Medicine` table is not a clinical source
- **Context:** ClinicOS has a per-clinic `medicines` table with default dose/frequency/duration, entered by clinic staff with no cited source.
- **Decision:** It is never used as a source of drug, dose or interaction data (Hard Rule 3). VaaniEHR builds `medicine_master` from cited sources (PRD F5), with `TODO(source)` placeholders where a value is not yet supplied.

## D7 - UI: reuse ClinicOS fonts, radii and cream background; primary action colour is not crimson
- **Context:** ClinicOS uses crimson as brand colour; VaaniEHR uses red for the "blocked" safety state, so a crimson primary action would be ambiguous.
- **Decision:** Reuse Fredoka/DM Sans, the radius scale (16/24/32/pill) and the cream page background. The primary action colour must **not** be crimson/red. `ui-ux-pro-max` proposes the palette; the owner approves it.
- **Consequences:** Red/amber/green are reserved for safety states. Contrast and colour-blind-safe cues (icon + text, not colour alone) are required.

## D8 - ClinicOS documents are not edited; Phase 13 writes an errata page
- **Decision:** ClinicOS docs stay as they are. Phase 13 produces a docs-vs-code errata page inside VaaniEHR (`docs/`), seeded from `CLINICOS_AUDIT.md`.

## D9 - Developer machine is Windows
- **Decision:** All scripts are cross-platform (Node or Python); no bash-only tooling. Documentation gives PowerShell commands. Paths use `path.join`/`pathlib`, never hard-coded separators. Line endings: do not rely on shell globbing or `sed`/`awk` in project scripts.

## D10 - VaaniEHR sockets authenticate at handshake; no PHI over ClinicOS sockets
- **Context:** ClinicOS Socket.IO performs no token check on connection or on `join:clinic` / `join:patient` (`socket.service.js:17-30`).
- **Decision:** VaaniEHR runs its own Socket.IO/WebSocket endpoint and authenticates every connection at the handshake (via `AuthProvider`). No PHI, transcripts or facts are sent through the ClinicOS socket server.

## D11 - VaaniEHR owns clinical profile, doctor profile, consent and sign-off state
- **Decision:** VaaniEHR stores, in its own database:
  - patient clinical profile (e.g. allergies), keyed by ClinicOS `patients.id`;
  - doctor profile (registration number, HPR id), keyed by ClinicOS `users.id`;
  - consent events (audio / AI processing / WhatsApp), append-only;
  - draft/signed state of each consultation record.
- **Consequences:** ClinicOS has none of these (no allergies column, no doctor table, one `optInMsg` boolean, `visits.isComplete` only). Nothing becomes final before doctor sign-off (Hard Rule 2) is enforced on the VaaniEHR side; data is pushed to ClinicOS only after sign-off, and only in Phase 12.

---

## D12 - ClinicOS rate-limits `/api/auth/*`; `ClinicOSTokenAuth` cannot rely on `/me` at volume
- **Context:** `GET /api/auth/me` sits behind `authLimiter` (10 requests per 15 min per IP) plus a global 200 per 15 min (`server.js:38-52,70,74`). Server-to-server validation from one VaaniEHR host shares one bucket (CLINICOS_INTEGRATION_FACTS Q1d).
- **Decision:** Phase 12 needs an **approved ClinicOS change** (exempt `/me` from the auth limiter, or add a dedicated verify endpoint). Nothing is done about it now; ClinicOS is not edited.
- **Consequences:** `ClinicOSTokenAuth` stays a stub that throws `NOT_IMPLEMENTED` until Phase 12 and the approval phrase. The Phase 12 plan must include this change as a proposed, reversible patch for owner review.

## D13 - Historical secret exposure in ClinicOS (details withheld)
- **Context:** A historical secret exposure exists in ClinicOS git history; owner is handling it; details withheld.
- **Decision:** VaaniEHR **never copies or reads ClinicOS `.env` files**; all VaaniEHR configuration is its own `.env` / `.env.example`.
- **Consequences:** A secret scan (gitleaks) runs in VaaniEHR CI and was run over all commits before the first push.

## D14 - How a visit is written to ClinicOS (Phase 12)
- **Decision:** Writing a visit to ClinicOS = `POST /api/visits`, then `PATCH /api/visits/:id`, then `PATCH /api/visits/:id/complete`, using the **doctor's own bearer token**, and **only after VaaniEHR sign-off** (ADR-D11).
- **Consequences:** `complete` has side effects in ClinicOS (token marked `served`, doctor's `avgConsultMins` recomputed, queue positions recalculated, socket update) - Phase 12 must handle or deliberately avoid them (CLINICOS_INTEGRATION_FACTS Q3c). Visit routes are doctor-only and owner-bound, so no service account can write. After `complete`, ClinicOS rejects further edits (400); VaaniEHR amendments cannot be pushed to the same ClinicOS visit. `POST /api/visits` is idempotent per `tokenId` only.


## D15 - PRD v1.1 is the source of truth
- **Context:** `docs/VaaniEHR_PRD_v1.1.md` reconciles the PRD with the code-verified ClinicOS audit (ClinicOS = MySQL, own PostgreSQL for VaaniEHR, `AuthProvider`, real integration contract, VaaniEHR-owned side tables).
- **Decision (owner, 2026-10-14):** PRD v1.1 supersedes v1.0. It becomes `DOCUMENTS/VaaniEHR_PRD.md`; v1.0 is kept as `DOCUMENTS/archive/VaaniEHR_PRD_v1.0.md`. ADR-D5 still applies for ClinicOS facts (code wins).
- **Consequences:** Requirement IDs are read from v1.1. `docs/PRD_ERRATA.md` rows that v1.1 already fixes are marked "applied in PRD v1.1"; rows it does not cover stay open.

## D16 - The `SIMULATED_DATA_ONLY=false` refusal stays
- **Decision (owner, 2026-10-14):** api-node and asr-py refuse to start when `SIMULATED_DATA_ONLY` is anything other than `true` (real-data mode is not permitted; AGENTS.md Hard Rule 1, NFR-PRIV-02).
- **Consequences:** **Phase 12 must not weaken or bypass this guard without the owner's explicit approval.** Tests: `apps/api-node/test/config.test.ts`, `apps/asr-py/tests/test_config.py`.


## D17 - No LICENSE file for now; licence decided later
- **Context:** The repository `Ansh0308/VaaniEHR` is public (owner decision 2026-10-15). Without a licence file the default is "all rights reserved": others may view and fork on GitHub but may not reuse the code.
- **Decision (owner, 2026-10-15):** No `LICENSE` file. The README states: "Research prototype. Simulated data only. All rights reserved." The licence is decided later, **after checking the share-alike and non-commercial terms** of DDInter 2.0 (CC BY-NC-SA 4.0) and Parrotlet-e (CC-BY-SA-4.0), which may constrain what can be published or relicensed (PRD §12.5, §12.3; SBOM section 5 when models/datasets are adopted).
- **Consequences:** `package.json` files say `UNLICENSED`. Do not copy third-party licensed data (DDInter, NLEM extracts, benchmark audio) into the repository; see the repository hygiene rule below.

---

## Owner answers applied 2026-10-14 (configuration, not new ADRs)
- **Docker:** installed with WSL2 (daemon must be running to use compose).
- **ADR-D4 amendment - standalone dev auth:** `DevAuthProvider` issues its **own access token, about 1 hour**, signed with a **VaaniEHR-only secret**, claims `{ sub, role, clinicId, devUser: true }`. **No refresh token in standalone mode** (PRD NFR-SEC-01 "JWT with refresh" is deliberately not met in standalone mode; recorded as a deviation).
- **Git:** remote `origin` = `https://github.com/Ansh0308/VaaniEHR.git`. Tracked: `AGENTS.md`, `CLAUDE.md`, `docs/`, `DOCUMENTS/`, `skills-lock.json`. Git-ignored: `.agents/`, `.claude/`.


---

## Phase 1.1 dependency register

AGENTS.md Hard Rule 6 and the Phase 1.1 brief: no dependency without a stated reason here. `scripts/sbom.mjs --reasons-only` (part of `npm run check`) fails if any **direct** dependency in any `package.json` or `requirements*.txt` is missing from this table. All versions are pinned exactly (`.npmrc` `save-exact`, `==` in requirements). Transitive packages are listed with licences in `docs/SBOM.md`.

Version-choice notes (checked against npm/PyPI engines and peer ranges on 2026-10-14): the PRD targets **Node 20**, so tools whose latest major needs Node 22+ (vitest 5, jsdom 30) are not used; typescript-eslint 8.x supports TypeScript below 6.1, so TypeScript is pinned to 5.9.3; React stays at 18.3.1 per the PRD. The developer machine runs Node 24; CI tests Node 20 and 24.

<!-- DEP-REASONS:START -->
| Dependency | Reason |
|---|---|
| @eslint/js | ESLint's recommended JavaScript rule set (flat config); official companion of eslint. |
| eslint | Linting for all TypeScript/JavaScript (NFR-MAINT-01). v10 (supports Node 20.19+; v9 is flagged as unsupported by npm). |
| eslint-config-prettier | Disables ESLint rules that conflict with Prettier so the two tools never fight. |
| globals | Declares Node/browser global names for ESLint so no-undef style rules work. |
| prettier | Single code formatter (NFR-MAINT-01); checked in `npm run lint`. |
| typescript | Strict typing for api-node, web, rules (PRD §17). 5.9.3 because typescript-eslint 8.x does not yet support TypeScript 6.1+/7. |
| typescript-eslint | TypeScript parser and rules for ESLint. |
| cors | Restricts browser origins for the HTTP API to CORS_ORIGIN (NFR-SEC-06). |
| express | HTTP framework named in the PRD stack (§11: Node 20 + Express). Version 5 for native async error handling. |
| helmet | Sets standard security headers (NFR-SEC-06 / ASVS L1); ClinicOS lacks it. |
| jose | Signs/verifies the dev provider's HS256 JWT (ADR-D4 amendment): pure ESM, no native build, strict algorithm and claim checks. |
| pg | PostgreSQL client for api-node (ADR-D1); used for the readiness check and, later, all data access. |
| socket.io | Realtime server named in the PRD stack (§11, FR-F2-01); authenticated at handshake (ADR-D10). |
| zod | Runtime validation of environment variables and request bodies (Phase 1.1 API conventions, NFR-SEC-01). |
| @types/cors | Type declarations for cors. |
| @types/express | Type declarations for express 5. |
| @types/node | Type declarations for Node 20 APIs (matches the minimum supported Node). |
| @types/pg | Type declarations for pg. |
| @types/supertest | Type declarations for supertest. |
| node-pg-migrate | SQL-first migration tool (migration 0001: schema_info + vector extension); standard, Postgres-only, no ORM lock-in. |
| socket.io-client | Test-only: connects real sockets to verify handshake auth and room isolation. |
| supertest | Test-only: HTTP assertions against the Express app without opening a port. |
| tsx | Runs TypeScript directly for `npm run dev` (watch mode) without a build step. |
| vitest | Unit-test runner for all TypeScript packages (PRD NFR-MAINT-01). 4.x chosen: 5.x requires Node 22+, PRD targets Node 20. |
| react | UI library named in the PRD stack (§11). 18.3.1 per PRD (not 19). |
| react-dom | DOM renderer for react. |
| @testing-library/dom | Peer dependency of @testing-library/react. |
| @testing-library/react | Component tests for the web app (banner test now, more in Phase 1.2). |
| @types/react | Type declarations for react 18. |
| @types/react-dom | Type declarations for react-dom 18. |
| @vitejs/plugin-react | Vite plugin for React (JSX transform, fast refresh). 5.x is the line that supports Vite 7. |
| jsdom | Browser-like DOM for Vitest component tests. 27.x chosen: 30.x needs Node 22+. |
| tailwindcss | Styling named in the PRD stack (§11). v4 (4.3.3): v3.4 pulls in vulnerable build tooling (braces, postcss-selector-parser; npm audit high). ClinicOS tokens (ADR-D7) are carried over as CSS `@theme` values in Phase 1.2. |
| @tailwindcss/vite | Official Tailwind 4 integration for Vite (replaces the PostCSS + autoprefixer setup, so those two are no longer dependencies). |
| vite | Build tool and dev server for the web app (PRD §11). 7.x chosen as the conservative line (works on Node 20.19+); 8.x also supports it but is newer and pairs with plugin-react 6; revisit later. |
| fastapi | Python service framework named in the PRD stack (§11: asr-py). |
| pydantic | Validation of asr-py settings (and, later, extraction schemas, FR-F3-01); also a hard dependency of fastapi. |
| uvicorn | ASGI server that runs the FastAPI app. |
| httpx | Required by FastAPI's TestClient for API tests (dev only). |
| pytest | Python test runner (NFR-MAINT-01). |
| ruff | Python linter and formatter (one fast tool for lint + format). |
<!-- DEP-REASONS:END -->

---

## Phase 1 container stack (base images and runtime rules)

Base images count as third-party components (Hard Rule 6); they are listed in `docs/SBOM.md` section 3. All are pinned by exact tag **and** digest (checked on Docker Hub 2026-10-14).

| Image | Reason |
|---|---|
| `pgvector/pgvector:0.8.7-pg16-bookworm` | PostgreSQL 16 + pgvector for ADR-D1 (own database). |
| `node:24.21.0-bookworm-slim` | Build and run api-node, build web. **Node 24, not the PRD's Node 20**: Node 20 reached end of life in April 2026; engines still allow >= 20.19 and CI tests Node 20 and 24. The developer machine runs Node 24. Debian slim (glibc) avoids Alpine/musl surprises for native modules. |
| `nginxinc/nginx-unprivileged:1.30.5-alpine3.24` | Serves the static web build as a non-root user (uid 101) on port 8080; stable nginx line. |
| `python:3.11.17-slim-bookworm` | asr-py runtime; Python 3.11 as in the PRD stack. |

Runtime rules (apply to every new service): non-root user; no secrets in images or build args (`.dockerignore` excludes every `.env*`; configuration arrives from env files at run time); `cap_drop: ALL`, `no-new-privileges`, read-only root filesystem for app containers; ports bound to 127.0.0.1; every service has a healthcheck and `depends_on` waits for `service_healthy`. `NODE_ENV` is not set to `production` in the stack because the dev auth provider is refused in production (ADR-D4, config guard).

---

## Repository hygiene (owner decision 2026-10-15, public repository)

- **Data and audio are never tracked**: `.gitignore` blocks `data/`, `audio/`, `*.wav`, `*.mp3`, `*.m4a`, `*.webm`; `scripts/check-no-data-files.mjs` (part of `npm run check` and a CI job) fails if any such file is tracked. **Conflict to resolve later:** PRD §17 puts versioned pathways, medicine CSVs and benchmark labels under `data/`; those cannot be committed until the owner decides which paths are allowed and updates the rule.
- **ClinicOS secret-exposure details are withheld** from every tracked file and from git history (ADR-D13). The full original wording is kept privately outside the repository.
- A gitleaks-style scan over all commits runs before each first push of new history (done 2026-10-15) and in CI on every push.
