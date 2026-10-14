# DECISIONS.md - Architecture Decision Records

**ADR-D1 to ADR-D14 are SETTLED - do not reopen without asking the owner.** (The PRD's own open decisions are called PRD-D1..PRD-D7 in this repo; PRD-D1 and PRD-D2 are closed by ADR-D1 and ADR-D2.)

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

---

## Owner answers applied 2026-10-14 (configuration, not new ADRs)
- **Docker:** installed with WSL2 (daemon must be running to use compose).
- **ADR-D4 amendment - standalone dev auth:** `DevAuthProvider` issues its **own access token, about 1 hour**, signed with a **VaaniEHR-only secret**, claims `{ sub, role, clinicId, devUser: true }`. **No refresh token in standalone mode** (PRD NFR-SEC-01 "JWT with refresh" is deliberately not met in standalone mode; recorded as a deviation).
- **Git:** remote `origin` = `https://github.com/Ansh0308/VaaniEHR.git`. Tracked: `AGENTS.md`, `CLAUDE.md`, `docs/`, `DOCUMENTS/`, `skills-lock.json`. Git-ignored: `.agents/`, `.claude/`.
