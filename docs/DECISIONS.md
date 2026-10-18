# DECISIONS.md - Architecture Decision Records

**ADR-D1 to ADR-D30 are SETTLED - do not reopen without asking the owner.** (The PRD's own open decisions are called PRD-D1..PRD-D7 in this repo; PRD-D1 and PRD-D2 are closed by ADR-D1 and ADR-D2.)

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


## D18 - Committed seed content goes in `seed/`; `data/` and `audio/` stay private
- **Context:** The 2026-10-15 rule that git ignores `data/` and `audio/` conflicts with PRD §17, which planned versioned pathways, medicine CSVs and rule tables under `data/`. Those are exactly the files that must be tracked, reviewed and tested in CI.
- **Decision (owner, 2026-10-15):** Committed seed content (NLEM medicine CSV, pathway JSON, safety-rule tables, golden FHIR bundles from fake visits, and the scripts that build or load them) lives in **`seed/`**, tracked, **with a `source` column/field on every row** (enforced by `scripts/check-seed-sources.mjs`, self-tested by `scripts/seed-sources.test.mjs`, in `npm run check` and CI). `data/` and `audio/` stay private and git-ignored (raw or licensed downloads, recordings, benchmark audio); `scripts/check-no-data-files.mjs` keeps blocking them.
- **Path mapping** (PRD §17 and the phase plan used `data/...`):

| Planned path | Now |
|---|---|
| `data/pathways/` (incl. `_toy/`) | `seed/pathways/` (tracked) |
| `data/medicines/` (NLEM CSV, rule tables) | `seed/medicines/` (tracked); raw NLEM PDF stays in `data/medicines/raw/` (private) |
| `data/safety/` | `seed/safety/` (tracked) |
| `data/fhir/golden/` | `seed/fhir/golden/` (tracked, fake data) |
| `data/fhir/ig/` (NRCeS package) | not committed: fetched by a script with a pinned checksum into private `data/fhir/ig/` |
| `data/bench/` (VaaniBench-Gu audio and labels) | private `data/bench/`; whether and how labels are published is decided in Phase 11 |

- **Content limits (carry into every seed file):** (1) no SNOMED CT / CDCI / ATC codes or release files until the licence terms allow redistribution; (2) no DDInter-derived rows (CC BY-NC-SA 4.0) until the licence decision in ADR-D17; (3) every value cited, otherwise `TODO(source)` (Hard Rule 3); (4) fake data only for toy pathways and golden bundles.
- **Consequences:** PRD v1.1 §17 layout is updated; the phase plan (v1.0) still says `data/...` and is mapped in `PHASES.md`. `seed/` allows only `.csv`, `.json`, `.md` and scripts.

---

## D19 - Design system: Option A "Ink and Cream", light theme only; contrast is a test
- **Decision (owner, 2026-10-15):** ClinicOS-family look (cream page, ink text and action, no crimson primary). Colour is reserved for five safety states, each with an icon and a text label. Light theme only in Phase 1.2; tokens are layered so dark can follow. Details: `docs/DESIGN.md`.
- **Gates:** `tokens.contrast.test.ts` (real tokens, WCAG AA, in `npm run check` and CI); i18n parity and no-hard-coded-text tests; ban on `uppercase` / `tracking-*` / `italic` (Gujarati). Browser check `npm run a11y` (Playwright-core + axe + system Chrome) runs as its own CI job, not in `npm run check`, because it needs a browser.
- **Known gaps:** all Gujarati text is placeholder and needs review by a Gujarati speaker; axe lists the Switch for manual review ("label-content-name-mismatch", not a violation); no screen-reader run with NVDA/TalkBack yet (owner or tester to do before the pilot).

---

## D20 - Phase 2A: standalone identity, consent and audit
**Date 2026-10-15, Status: Accepted, Decider: Ansh (owner).** Where the Phase 2A brief and earlier decisions differed, the owner chose as below.
- **ClinicOS stand-ins.** Tables `mock_clinicos_clinic`, `mock_clinicos_user`, `mock_clinicos_patient` imitate the ClinicOS data VaaniEHR needs while standalone. They are reached **only** through the `ClinicOSAdapter` interface (`src/clinicos/`), have **no foreign keys** from any VaaniEHR table, and are **dropped in Phase 12**. Two tests enforce this (only the adapter implementation and the seed script may name them; no migration may reference them). Columns mirror ClinicOS: UUID `id`, 10-digit `phone` (no E.164, no `phone_normalized`), `name`, `dob`, free-text `gender`, `opt_in_msg`. There is no `blood_group` (not in the PRD). `is_simulated` is kept on every stand-in table.
- **VaaniEHR-owned tables:** `doctor_profile` (registration number, HPR id, `researcher_flag`), `patient_clinical_profile` (allergies as a list of free-text entries), `consultation_session`, `consent_event`, `audit_log`, `login_lockout`, `revoked_token`.
- **Researcher.** The seed contains a researcher user. In the stand-in table `researcher` is an allowed role (ClinicOS has none). In **Phase 12 the role is mapped from `doctor_profile.researcher_flag`** and is never written to ClinicOS (PRD 2.2).
- **Tokens.** Kept from ADR-D4: about 1 hour, claims `{ sub, role, clinicId, devUser, jti }`, HS256, VaaniEHR-only secret, **no refresh token** (the brief's "refresh" and "claims identical to ClinicOS" were not followed: ClinicOS tokens carry only `userId`). `POST /api/v1/auth/logout` revokes the `jti` server-side. Every request also re-checks the user in the directory (approved, same role and clinic), as ClinicOS `rbac` does. The passwordless `/auth/dev-login` was removed.
- **Passwords:** `bcryptjs`, cost 12 (minimum 10 outside tests), same scheme as ClinicOS. Login failures give one identical message for wrong password and unknown e-mail, and always run one bcrypt comparison. Rate limiting: 10 attempts per 15 minutes per IP (`express-rate-limit`) and a database-backed lockout of 5 failures for 15 minutes per hashed e-mail (mirrors ClinicOS).
- **Consent permissions (deviation from PRD 2.2, see PRD_ERRATA row 30):** grant, read and withdraw are allowed for **staff, admin and doctor**, because PRD section 4 (PG-05: staff, doctor) and Journey A step 2 (doctor confirms consent) disagree with section 2.2. The single permissions table (`src/auth/permissions.ts`) is checked against a separate hand-written copy of the PRD in the tests.
- **Audit log:** append-only table with a SHA-256 hash chain (canonical JSON, genesis hash, app-assigned `seq` under an advisory lock). The runtime role `vaani_app` has SELECT and INSERT only on `audit_log` and `consent_event`; triggers also refuse UPDATE, DELETE and TRUNCATE for the owner. Every non-GET route runs in one transaction and **must** write an audit row there (the route wrapper turns a missing row into a 500 and rolls back). Audit metadata may hold identifiers and counts only (a key guard rejects names, phones, e-mails, allergies, tokens). `npm run verify:audit` reports the first broken row; deleting the **last** rows cannot be seen from the chain alone, so the script also accepts `--expect-head` / `--expect-count` from a copy kept elsewhere.
- **Clinic isolation (2A close-out, 2026-10-15):** every endpoint is scoped to the caller's clinic; another clinic's patient, session, consent or audit row is "not found" (404) or simply absent from lists. `GET /api/v1/audit` returns only the caller's clinic rows, and `GET /api/v1/audit/verify` answers only `{ok}` (counts and head hashes come from `npm run verify:audit`, see `docs/AUDIT_CHAIN.md`). `test/clinic-isolation.db.test.ts` attacks every route in both directions and fails if a route is not covered.
- **Failed logins:** the audit row holds only a reason (and the user id when the account is known), never an e-mail address or password; the lockout table stores a keyed HMAC of the e-mail, not a plain hash. `test/login-privacy.db.test.ts` checks the audit log, lockout table and application log.
- **Two database roles.** Migrations and the seed run as the owner (`MIGRATION_DATABASE_URL`); the API runs as `vaani_app` (`DATABASE_URL`, password `APP_DB_PASSWORD`, set by `npm run db:migrate`, never inside a migration because node-pg-migrate echoes SQL). `npm run setup:env` upgrades an existing `.env` once.
- **Real-data guard:** the API (and the seed) refuse to start if any stand-in row has `is_simulated=false`, in every mode (ADR-D16 is not weakened).
- **Tests.** Database tests (`*.db.test.ts`) run on real PostgreSQL (Docker locally, a service container in CI). `npm run check` includes them; **`npm run check:unit`** runs everything except them (no Docker) and says so in its summary.
- **Not in Phase 2A:** any UI, a refresh token, `ClinicOSTokenAuth`, final consent wording (the notices are bracketed placeholders; Gujarati is `needsReview`), real allergens (the seed uses `Drug-A (FAKE)` style labels until Phase 7).

---

## D21 - Phase 2B: the first pages, and the small API additions they needed
**Date 2026-10-15, Status: Accepted, Decider: Ansh (owner).** Pages built: PG-01 login, PG-02 doctor dashboard, PG-03 patients, PG-05 consent, PG-16 audit log, PG-18 settings and about, PG-19 error pages (403, 404, 500). No new dependencies.
- **API additions (owner-approved, each with a permissions entry, audit coverage, clinic-isolation case, OpenAPI and tests):**
  - `GET /api/v1/audit` takes **user, action and date range** filters only (zod-validated, clinic-scoped, page size capped at 100). A researcher cannot filter by user (it would un-anonymise the view one person at a time) and gets anonymised rows.
  - `POST /api/v1/audit/export` returns a CSV. **Admin only** (the researcher reads anonymised rows on screen but cannot take a file away). The export is itself an audit event (`AUDIT_EXPORTED`: row count, whether it was cut, which filters were used, never their values). Capped at **5000 rows**; when cut, the response says so and the page tells the admin. Columns are identifiers only (no IP address, no free-form metadata). **Every text cell is neutralised against spreadsheet formula injection** (a leading `=`, `+`, `-`, `@`, TAB, CR or LF gets a leading single quote) and quoted per RFC 4180; tests plant hostile values and read the file back like a spreadsheet would.
  - `GET /api/v1/sessions` is the signed-in doctor's **own** sessions in their clinic (never another doctor's), with the patient's name and a consent summary, paged.
  - `GET /api/v1/consent/notice` returns **both languages in one response**, with the placeholder markers and the Gujarati `needsReview` flag in the payload.
- **Doctor dashboard shows only what exists:** the doctor's sessions ("open" = not ended; sign-off arrives in Phase 8, so nothing is shown as signed) and a way to start a session. The **queue and tokens are a clearly labelled placeholder** ("Not available until the ClinicOS integration"); no queue, no numbers are invented (a test checks the section contains no digits).
- **How staff reach a doctor's session:** only doctors may open a session, and staff have no session list (owner scope). The doctor's dashboard has "Copy link" for each session; staff open the consent page from that link or by pasting the session code on the Patients page. A staff-side "sessions waiting for consent" list is a possible later addition if wanted.
- **Token handling:** the access token lives **only in memory** (a ref inside the auth provider). It is never written to localStorage, sessionStorage, cookies or a URL (tested). Reloading the page therefore signs the person out (there is no refresh token in standalone mode, ADR-D4). It is dropped on logout (which also revokes it on the server), on a 401 and when its lifetime ends; the login page then says the session ended. ClinicOS keeps its token in localStorage; this is deliberately stricter.
- **Errors:** people see our own plain messages chosen by status and code; server error text is never displayed. Login never says which part was wrong.
- **Forms:** after a failed submit a focusable error summary takes focus and links to each field, with the inline errors kept (guidance taken from ui-ux-pro-max, see docs/DESIGN.md); double submits are blocked with a ref (a test found that a state flag was not enough).
- **Consent page:** English and Gujarati notices side by side, three independent switches, "who confirmed this" is required before saving, withdraw-all asks for confirmation and who withdrew, history table. A failed save keeps the person's choices. `ConsentGate` is the component Phases 4 and 8 put in front of recording; the API already enforces the same rule (`requireConsent`).
- **`/design` is viewable without signing in** (it shows no data) so the standalone `npm run a11y` keeps checking the design system; when signed in it uses the normal shell.
- **Settings page:** intended-use statement quoted from PRD section 1.6 (the Gujarati version is a placeholder flagged for review); the licence list is generated from `package-lock.json` (`npm run licences:web`) and a guard in `npm run check` fails if it is stale.
- **End-to-end test (`npm run e2e`, CI job `e2e`):** real API, PostgreSQL and system Chrome (playwright-core, no download), fake data only. Logins come from the git-ignored `data/dev-credentials.json` generated by `npm run seed:dev` (locally, and generated fresh in CI); they are never printed. It signs in with the keyboard only and runs axe (colour contrast on), the 44px target check and a 375px overflow check on every page state, in English and for the main pages in Gujarati.
- **Known limits:** all Gujarati text is placeholder and needs review by a Gujarati speaker (docs/OWNER_ACTIONS.md); the audit user filter takes a user ID (rows offer "Filter by this user"; there is no user picker because there is no user-list endpoint); rows with no clinic (the seed run, failed logins for unknown e-mails) are not shown in the clinic view.

---

## D22 - Premium polish and motion layer (owner request 2026-10-16)
- **Decision.** Phase 2B pages get a premium finish: layered shadows, a glass sticky top bar, a cream "aurora" page background, a sliding navigation highlight, an ink hero panel with a decorative voice waveform on the login page, count-up stat cards on the doctor dashboard, staggered entrances for lists and table rows, spring dialogs and toasts, shimmer skeletons and press/hover feedback.
- **Unchanged (owner choice "keep palette").** Palette, fonts, light-only theme and the five safety colours. No new hue was added; the aurora and shimmer use existing cream tokens only.
- **Dependency.** `motion` 13.4.6 (MIT), exact pin, recorded in `docs/SBOM.md`. Owner approved on 2026-10-16.
- **Safety of motion.** All motion is decoration; content is in the DOM from the first render. `MotionConfig reducedMotion="user"` plus the global CSS rule switch it off for people who ask. Page changes animate on enter only (no exit delay). Tests set `skipAnimations`, and the browser scans wait for entrances to finish before measuring contrast.
- **Skill.** `ui-ux-pro-max` was installed from `nextlevelbuilder/ui-ux-pro-max-skill` (owner request) and used for motion timing, feedback and loading guidance. Its advice to animate sparingly was followed for safety-relevant content: allergy panels, consent state and audit data do not move once shown.

## D23 - Phase 3A: medicine master from NLEM 2022 (2026-10-17)
- **Context.** FR-F5-01..05 need a generic-first medicine list with a source on every row. The only source is the NLEM 2022 PDF, a Government of India publication kept private (ADR-D18). PDF extraction is imperfect, so the rules matter more than the code.
- **One row per FORMULATION** (generic name + dose form + strength + route). The unique index is on `lower(generic_name), coalesce(dose_form,''), coalesce(strength,''), coalesce(route,'')` (migration 0006), so a NULL route or strength cannot create a duplicate and it works on every PostgreSQL version (`NULLS NOT DISTINCT` is 15+ only). Test: a second import inserts 0 rows, updates 0 rows and the diff is empty.
- **Never guess, and check twice.** The importer (`npm run import:nlem`, `apps/api-node/src/medicines`) reads each row from the PDF's own content-stream order, which writes a row's cells (number, name, level, forms) together. A second, independent method, geometry (each cell is vertically centred on its item number, matched by dynamic programming over the page), cross-checks it, and a row on which the two disagree is HELD. Anything uncertain is HELD (not loaded; listed in `data/medicines/nlem2022.review.csv`) or, for harmless facts such as "no strength stated", loaded with a note and listed. Text beside no number goes to `nlem2022.rejected.csv`, and a margin paragraph holds the rows beside it. Wrapped form lines are joined only on strict cues and counted. An earlier, geometry-only version silently loaded a few wrong rows (for example a line taken from the next row); that is why the stream order is primary, why the import reports rows that are in the database but no longer in the import (`In the database but not in this import`), and why `--retire-stale` retires them (never deletes).
- **Empty on purpose.** `route` is NULL on every row (the NLEM does not state one; the prescribing doctor chooses it). `snomed_code` and `atc_code` are NULL until a licensed release is loaded by `npm run medicines:codes` (every row needs a licence note; dry run by default). `reviewed_on` / `reviewed_by` are NULL until a clinician reviews.
- **Review fields are guarded by the database, not only by code.** A trigger forces them to NULL on any insert by the API role, keeps the old values on an API update, and clears them on any change to an identifying or source field by ANY role (so a re-import that changes a value also clears a review). No endpoint accepts them (strict request bodies).
- **Reconciliation.** The publication's own numbered "Alphabetical List of Medicines" (PDF pages 86-101) runs 1 to 384, so 384 is its official count. The tables give 459 medicine entries (470 numbered lines, 11 of them category headings), 940 formulation lines, 811 formulation rows and 384 distinct names; 373 of those match the official list by name and 11 + 11 differ by spelling (`Hydroxocobalamine` / `Hydroxocobalamin`, `Irinotecan HCI`), by naming (`Diethylcarbamazine (DEC)`, the three HIV combinations that the list abbreviates) or because a row was held. The 384 distinct names therefore agree in number with the official list, but not name for name. The committee report disagrees with itself (386 then 384; 342 + 41 + 11 + 4 = 398; 440 and 460 as totals), so the count is flagged, not decided (PRD_ERRATA 34).
- **Category.** `therapeutic_category` is the path "section > sub-section > heading". A formulation listed under several categories keeps the first; the other item numbers go in `also_listed_in`. Other source facts kept: `nlem_ref`, `healthcare_levels` (a row with two levels gives each form line the nearest one and is listed for review), `source_notes`, `source_page`.
- **API.** `GET /medicines?q=` (generic or brand, case-insensitive, pg_trgm; generic names always rank above brand names; every item returns its source) and `GET /medicines/:id` for every signed-in role; admin `POST`, `PATCH`, `retire`, `restore` and brand add/retire, each audited with ids and the NAMES of changed fields only. Rows are retired, never deleted (the API role has no DELETE grant).
- **Shared reference data.** Medicines are not clinic data, so these routes have no clinic filter and a documented exemption in the clinic-isolation test, which also pins the known consequence: an admin of any clinic can edit shared medicines. **In a multi-clinic deployment a separate platform-admin role must own the writes (Phase 12 item).**
- **Gujarati search.** `medicine_translit_gu` is empty and search works in English without it. A machine-drafted Gujarati list stays in `data/` (git-ignored) and is marked "needs review". `npm run medicines:translit` refuses any row without a named reviewer and review date, so an unreviewed list cannot reach the live table. Nothing goes into `seed/` or the live table until the owner confirms a Gujarati reviewer approved it.
- **Private files.** The PDF and every file the importer writes stay under `data/medicines/` (git-ignored). Tests use synthetic fixtures only. Whether the extracted CSV may be tracked in `seed/` with attribution depends on the NLEM reuse terms (OWNER_ACTIONS).
- **Corrections after the spot-check (2026-10-17).** A 20-row random sample and a systematic cell check found that prefix lines ("Modified Release -") were mishandled (7 items), that a "#" note inside a cell became a junk dose form, that footnote text never reached `source_notes` (0 of 129 markers), and that "nearest level" gave some lines the wrong level. All are fixed (see docs/MEDICINES.md, "Rules learned from the spot-check") with regression tests; the 7 prefix items were compared mechanically with the owner's reading and match exactly. The 10 held rows were transcribed by the owner into the private overrides file (any item with override rows has ALL its parsed rows replaced). **Page numbers:** `source_page` is the PDF page; the printed page is one lower; both are shown wherever a page is shown to a person.
- **Tool.** `pdfjs-dist` 5.5.207 (Apache-2.0, exact pin, dev only) reads the PDF in the importer. PyMuPDF is not used in the repository (AGPL). Templates (`med_template`, `med_template_item`) exist as tables only; their API and UI are F11.
- **Consequences.** `pg_trgm` is created by migration 0006; a test asserts it exists, so CI proves it on the CI Postgres service (the same pinned image as Docker Compose).

## D24 - Phase 3B: prescription templates and the medicine pages (2026-10-17)
- **Context.** FR-F5-04 (templates) and PG-12 / PG-13. Templates only prepare a draft; nothing is prescribed or final before the doctor signs off.
- **Permissions (proposed by me, accepted with the Phase 3B go-ahead; flagged for the owner).** `template.read` and `template.write` belong to **doctor and admin** only. Staff and researchers get 403. Every template route is clinic-scoped: another clinic's template is "not found".
- **Visibility.** A **personal** template is visible only to its owner: anyone else gets 404, not 403, so its existence is not revealed (an admin cannot see it either). A **clinic-wide** template is visible to every doctor and admin of the clinic. It can be edited or retired by its owner, or by an admin when it is clinic-wide. Only the owner can change visibility. Creating, editing, retiring and restoring are audited with ids and changed-field names only (never the template name or free text).
- **Items.** An item holds medicine id, dose, frequency, duration and instructions (free text capped at 120 / 120 / 500 characters; an empty string means "not given"). **Frequency is a code, never free text**: `OD` once daily, `BD` twice daily, `TDS` three times daily, `QID` four times daily, `SOS` as needed. The list is enforced by a database CHECK (migration 0008) and by the API; the web app keeps a copy that a test compares with the API's (`FREQUENCY_CODES`). The English labels are ours; the Gujarati labels are placeholders that need review by a Gujarati speaker. Whether the five codes are enough is a clinician question (OCI-013, OCI-014).
- **Retired medicines.** A retired medicine cannot be added to a template (400). One that was retired after it was added **stays in the template** and is flagged `MEDICINE_RETIRED` when the template is loaded (`GET /templates/:id/load` returns the lines, a `problem` per line, `warnings` and `hasRetiredMedicine`). It is never dropped and never replaced by another medicine. A retired template cannot be loaded (409). Medicine retire / restore (admin) is unchanged.
- **Database.** `med_template` is never deleted (retire / restore). `med_template_item` rows are replaced on save, so the API role has `DELETE` on that one table only (migration 0008); it still has no DELETE on `med_template` or `medicine_master`.
- **PG-12 has no CSV upload** (owner confirmed 2026-10-17). NLEM rows come from the importer script; the page says so in its help text. The PRD's "import CSV" is therefore met by the script (PRD_ERRATA 38). Codes come only from the licensed-file loader.
- **Medicine search for pickers.** `GET /medicines` gains `category`, `sort` (name, strength, form, category, page, reviewed; a whitelist) and `order`, and `GET /medicines/categories`. A search is ordered by relevance, not by the chosen column. Every medicine view carries `sourcePage` (PDF page) and `sourcePagePrinted` (one lower).
- **Consequences.** Seed and demo templates use made-up names ("Drug-A", "(FAKE)") and say so; no ready-made clinical template exists.

## D25 - Phase 4A: the audio transport is a plain WebSocket on asr-py (2026-10-17)
- **Context.** FR-F2-01 names Socket.IO "as in ClinicOS". ADR-D10 already says VaaniEHR runs its own authenticated endpoint and sends no PHI through ClinicOS sockets. Socket.IO would add a Python dependency and a framing layer for a one-way stream of binary frames.
- **Decision.** The browser opens `/ws/sessions/{id}/audio` on asr-py with the platform WebSocket (FastAPI/Starlette; `websockets` for uvicorn). Rules, all tested: the `Origin` header must be on an allow-list (checked before the connection is accepted; a missing Origin is refused); the consent token travels in the FIRST message, never in the URL (URLs end up in logs), within 5 s; the token is verified, session-bound and single-use; each binary frame is at most 32 KiB (close 1009); a connection with no message for 15 s is closed (4408); a stream is capped at one hour and, for paid engines, at the remaining monthly allowance (4429). Close codes are listed in `app/ws.py`.
- **Consequences.** PRD FR-F2-01 is changed from Socket.IO to a plain WebSocket (PRD_ERRATA 42). Rooms, acknowledgements and reconnection are not needed: a dropped stream starts again with a new token.

## D26 - Phase 4A: consent token, internal routes, encrypted audio, spend caps (2026-10-17)
- **Consent guard.** The browser asks api-node (`POST /sessions/:id/asr-token`, doctor only, own sessions only) for a token. api-node checks that audio AND ai_processing consent are effective for that session and then signs `{aud: asr-py, sid, scopes, uid, cid, iat, exp (+120 s), jti}` with HMAC-SHA256 and `INTERNAL_SERVICE_SECRET`. asr-py verifies the signature in constant time, the audience, expiry, session, scopes and single use. While a stream runs asr-py asks api-node again every 10 s; if consent is withdrawn, or cannot be checked three times in a row, the stream stops and nothing is stored (fail closed).
- **Internal routes.** asr-py calls three routes on api-node, authenticated by a request signature (timestamp, method, path and body hash, 60 s window) and by nothing else; a user token of any role gets 401. They are a new access kind `service` in the route registry, so the RBAC matrix, OpenAPI and audit tests cover them. Only the token route is browser-facing. The clinic of a recording comes from its session.
- **Audio at rest.** AES-256-GCM, a fresh data key per recording wrapped by `AUDIO_MASTER_KEY`; asset id and session id are authenticated data. `audio_asset` (migration 0009) records existence, `retention_until` (default 90 days, NFR-PRIV-01) and deletion; the runtime role has no DELETE. A purge job (hourly in the service, or `python -m app.purge`) deletes expired recordings and recordings whose consent was withdrawn, overwrites then removes the file, keeps a manifest as the record, and tells api-node (audited as AUDIO_PURGED). If api-node is down the file is still deleted and the report retried. **If the master key is lost the audio is unrecoverable** (docs/ASR.md).
- **Spend.** Every request writes one line (ids, engine, seconds, INR estimate) to `data/asr/usage.jsonl`. Paid engines (Sarvam) are refused at the start of a stream once the monthly allowance (default 300 minutes, UTC month) is used, and a stream is cut when it reaches the remainder; manual smoke runs are capped at 300 s each. Rates come from the Sarvam pricing page (30 INR/hour, 45 with diarization).
- **Dependencies (owner approved 2026-10-17).** websockets, numpy, cryptography (runtime); silero-vad and torch (optional, `requirements-vad.txt`). The service uses the standard library for its calls to api-node.

## D27 - Phase 4B Run 1: browser capture, no browser storage, consent handling (2026-10-18)
- **Capture.** `getUserMedia` (mono, echo cancellation on) feeds an AudioWorklet that averages down to 16 kHz mono PCM16 in frames of 4000 samples = 250 ms = 8000 bytes (the service accepts 32 KiB). The microphone tracks are stopped on stop, on page leave, when the track ends (unplugged), and on every error.
- **Transport.** The page opens the plain WebSocket of ADR-D25 straight to asr-py (`VITE_ASR_WS_URL`) after `POST /sessions/:id/asr-token`; the token is the FIRST message, never in the URL. The second paste of the Phase 4B prompt (Socket.IO relayed through api-node) is not followed: ADR-D25 settled the transport and a relay would put audio through a second hop for no gain.
- **No browser storage.** Audio, transcript text and tokens live in memory only: nothing goes to localStorage, sessionStorage, IndexedDB or the console (tested, and checked in the Playwright run: only the language choice is stored). The only audio kept in memory beyond the 250 ms frame is a reconnect buffer of at most 10 s, cleared on any failure.
- **Consent.** Start is disabled unless the consent API shows audio AND ai_processing, with the missing ones named and a link to the consent screen. api-node refuses the token without consent and asr-py re-checks every 10 s. Close code 4403 (withdrawn, or consent cannot be checked) stops the microphone and clears the buffer at once, shows a plain message, never reconnects, and reloads the consent state.
- **Connection.** One automatic reconnect with a fresh token (also used to repair an expired or used token), then a clear error. Spend cap (4429), idle (4408), not configured (4503), engine (1011) and protocol errors (1009/4400) are shown and not retried. Messages are in `consult.json` under `error.*`.
- **Transcript = draft.** Every transcript view carries "Draft — doctor must review". Every segment starts as speaker unknown; the doctor sets it per segment, and a "next speaker is" choice on the RecordBar sets it for segments that arrive afterwards. Inline edits keep the engine's original text beside the edited text; edits stay in memory in this run (saving comes with the transcript API).
- **Nothing invented.** No confidence is shown (Sarvam gives none; PRD_ERRATA 41, 45); partial results show approximate times; text is shown exactly as the engine wrote it, with no transliteration (PRD_ERRATA 46).
- **Safer defaults chosen.** Sarvam mode stays `codemix`; keyterms are OFF (the page sends none) until the clinician reviews OCI-015; no pause control in Run 1 (a pause would hold an open consented stream in an extra state); the ASR engine name is not shown on this screen (research mode comes with the evaluation console).

## D28 - Phase 4B Run 2: saved transcripts and the withdrawal rule (2026-10-18)
- **Table and routes.** `transcript_segment` (migration 0010): per session and sequence number, the engine's ORIGINAL text (never changed afterwards), the doctor's edited text, speaker (unknown/doctor/patient), language, times, engine and version, status `draft` or `confirmed`. `GET /sessions/:id/transcript`, `PUT /sessions/:id/transcript/segments` (autosave: create or update drafts by sequence number) and `POST /sessions/:id/transcript/confirm`, all for the session's own doctor only (`transcript.read` / `transcript.write`), clinic-scoped (another clinic's or doctor's session is "not found").
- **Consent at save time.** Saving and confirming need audio + ai_processing consent at that moment (403 CONSENT_REQUIRED otherwise). Reading what is already saved does not.
- **Confirmed text is part of the record.** Confirming turns every draft segment into confirmed text with a time and the doctor's id. A trigger makes a confirmed segment unchangeable and undeletable for the runtime role, and no segment's engine text can be rewritten. (Erasure requests, PG-20, will need an explicit owner-run procedure; the trigger does not stop the database owner.)
- **Withdrawal rule (default chosen, to be confirmed: OCI-016).** When audio or ai_processing consent is withdrawn: the audio is deleted (asr-py purge, ADR-D26), UNCONFIRMED draft transcript text is deleted in the same transaction as the withdrawal (audited as TRANSCRIPT_DRAFT_DELETED with a count), and doctor-CONFIRMED text is kept because it has become part of the clinical record. This is the safer reading for the person who withdrew only as far as unreviewed machine text is concerned; keeping confirmed text is a legal and clinical question for the owner and the clinician.
- **What is logged.** Transcript text goes only into the table and the HTTPS response to the doctor. The audit rows hold the session id and a segment COUNT (a test fails if any text appears in them), the autosave sends text only in the request body (never a URL), and the page writes nothing to browser storage or the console.
- **Autosave on the consult screen.** Changes are saved 1.5 s after they stop and immediately when a recording ends; a failed save is retried up to 5 times then left to "Save now"; a refusal for missing consent stops saving and says so. The state is written in words with an icon and announced politely. "Confirm transcript" asks first, saves anything pending, then locks the segments. A returning doctor sees what was saved (confirmed segments locked).

## D29 - Phase 5A Run 1: extracted facts, the stale rule and the version hash (2026-10-18)
- **Table.** `extracted_fact` (migration 0011): type (symptom, duration, severity, vital, allergy, past_condition, current_medicine, red_flag_mention), value, negated, uncertain, speaker, status `heard` / `confirmed` / `rejected` / `stale`, the source segment, the span, the evidence quote, how it matched (`exact` or `fuzzy`), pipeline, model id, run id, and `concept_id` / `snomed_id` (empty: entity linking is not in Run 1).
- **No fact without evidence (FR-F3-03), enforced by the database.** An extracted fact needs its source segment, a span with end after start, the evidence quote, a match type and the text hash, or the row is refused. Only a MANUAL fact (typed by the doctor) is exempt and is flagged `source = manual`. The grounding validator in asr-py drops ungrounded facts before anything is sent; api-node re-checks every submitted fact (segment belongs to the session, hash matches, span inside the text, an exact quote equals what the span covers) and counts what it skips.
- **Spans and the version hash.** A span is a character range in the NORMALISED segment text: Unicode NFC, whitespace runs collapsed to one space, trimmed (`normalise` in asr-py and `normaliseText` in api-node, compared by a test with vectors computed by Node). The fact stores `segment_text_hash` = SHA-256 of that text, so "the text this span refers to" is identified exactly.
- **Stale rule.** When a segment's text changes (an edit saved through the transcript route), every `heard` or `confirmed` fact linked to it whose hash no longer matches becomes `stale` (a count goes to the audit row). Nothing is rewritten. The doctor re-confirms a stale fact; that works only if its evidence quote is still in the segment (the span and hash are then updated by that explicit action), otherwise the fact must be edited or rejected (409).
- **Confirmed facts are not silently changed.** The extraction pipeline can only INSERT `heard` facts (duplicates are skipped; existing confirmed, rejected or stale rows are never touched: tested). Only an explicit doctor action (confirm, reject, edit) changes a fact, each audited with the fact TYPE only. An edit keeps the original value and flags. A trigger stops the runtime role from changing a fact's identity or evidence, or deleting a confirmed fact.
- **Withdrawal.** Withdrawing audio or AI-processing consent now also deletes every fact that is not confirmed (heard, rejected, stale) in the same transaction as the draft transcript (ADR-D28); confirmed facts stay, and a confirmed fact whose draft segment was deleted keeps its quote and records `segment_deleted_at`. The audit row holds counts.
- **Privacy.** Fact text, quotes and segment text never go to logs or the audit log (a test searches the audit rows for them). Saving, confirming and extracting need audio + ai_processing consent at that moment.

## D30 - Phase 5A Run 1: the language-model interface, its input and its safety gate (2026-10-18)
- **Provider interface.** The pipeline talks to `LlmProvider.complete(system, user)`. Two adapters: `MockProvider` (default; canned replies including bad JSON, wrong types, ungrounded facts and obeyed injections; free) and `OpenAICompatibleProvider` (an OpenAI-compatible chat-completions client configured ONLY by `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY`; a STUB in Run 1: it makes no request). `LLM_PROVIDER` (default `mock`) and `LLM_MODEL` pick them.
- **Real-data gate.** The real adapter refuses to be built unless `LLM_ALLOW_REAL_DATA=true` (default false; sessions carry no simulated flag to use instead). Free endpoints may log prompts, so even with the switch on only simulated data goes there until the owner has the provider's no-training terms in writing (OWNER_ACTIONS).
- **What the model sees.** Only short local segment labels (s1, s2, ...) and the segment TEXT, escaped so a transcript cannot close the `<transcript>` tag. Never a session, patient, clinic or user id, a name, or any database field; the speaker of a fact is taken from the segment, not from the model. A test searches the prompt for ids.
- **Prompt.** `prompts/extract_v1.md` (versioned: a change is a new file). It tells the model the transcript is data, to copy quotes verbatim, to mark negation and uncertainty, and not to use `red_flag_mention` until a clinician supplies the list. The prompt version and its SHA-256 are written to the usage log and the evaluation output with the model id and the run date.
- **Injection hardening.** Delimiters and escaping, no tools, strict schema with extra fields refused, whole-reply rejection on any violation (never repaired), grounding, and doctor confirmation. Ten adversarial transcripts are tests. KNOWN LIMIT: a patient line that the model copies as a "fact" with a real quote grounds successfully (the words were said); it becomes a `heard` fact the doctor must confirm, never an action. Only the doctor's review stops it.
- **Three pipelines (ablation).** `plain` (free text to JSON, lenient), `constrained` (strict schema), `grounded` (constrained + grounding, the only one that stores facts). The ungrounded count is the hallucination metric.
- **Usage and caps.** `data/asr/llm-usage.jsonl`: model id, run date, prompt version/hash, tokens, cost estimate, counts kept/dropped, never text. Monthly caps `LLM_MONTHLY_CAP_INR` (50) and `LLM_MONTHLY_CAP_TOKENS` (200000) are checked before a paid call; the mock costs nothing.
- **Not in this run.** Entity linking (concept ids, SNOMED), the real call, a button on the consult screen.

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
| bcryptjs | Password hashing for the standalone login (Phase 2A, NFR-SEC-01). Pure JavaScript (no native build on Windows or Node 20/24); same scheme and cost 12 as ClinicOS. 3.0.3. |
| express-rate-limit | Per-IP login rate limiting (Phase 2A); same library and 10-per-15-minutes policy as ClinicOS. 8.7.1. |
| @vitest/coverage-v8 | Coverage report for the Phase 2A auth, audit and consent modules (NFR-MAINT-01). Pinned to 4.1.11 to match vitest. |
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
| websockets | WebSocket support for uvicorn (the audio endpoint, ADR-D25) and the client to Sarvam's realtime API. BSD-3-Clause. Owner approved 2026-10-17. |
| numpy | Audio frames for the VAD and engines. BSD-3-Clause. Owner approved 2026-10-17. |
| cryptography | AES-256-GCM encryption of stored audio (NFR-SEC-03). Apache-2.0 or BSD. Owner approved 2026-10-17. |
| silero-vad | Voice-activity detection (FR-F2-02), MIT, optional (`requirements-vad.txt`). Owner approved 2026-10-17. |
| torchaudio | Audio loading for the local-model container (`requirements-models.txt`, container only), BSD-2-Clause. Owner approved 2026-10-17. |
| transformers | Loads IndicConformer at a pinned revision (container only), Apache-2.0. Owner approved 2026-10-17. |
| huggingface_hub | Downloads the pinned model files on request (`python -m app.models_cli`), Apache-2.0. Owner approved 2026-10-17. |
| onnxruntime | Pinned as on the IndicConformer model card (container only), MIT. Owner approved 2026-10-17. |
| onnx | Pinned as on the IndicConformer model card (container only), Apache-2.0. Owner approved 2026-10-17. |
| faster-whisper | CPU Whisper baseline for experiment 1 (container only), MIT. Owner approved 2026-10-17. |
| torch | Required by silero-vad (CPU build), BSD-3-Clause, optional (`requirements-vad.txt`). Owner approved 2026-10-17. |
| httpx | Required by FastAPI's TestClient for API tests (dev only). |
| pytest | Python test runner (NFR-MAINT-01). |
| ruff | Python linter and formatter (one fast tool for lint + format). |
| react-router-dom | Client-side routing for the app shell and the /design page (PRD §4 page routes). |
| i18next | Internationalisation core: English and Gujarati namespaces, no hard-coded UI strings (NFR-UX-02). |
| react-i18next | React bindings for i18next (hooks, language switching). |
| lucide-react | Icon set (already used by ClinicOS); every safety state pairs an icon with a text label, never colour alone. |
| pdfjs-dist | Reads the NLEM 2022 PDF as positioned text in the medicine importer (ADR-D23), dev only, never loaded by the API. Apache-2.0. PyMuPDF (AGPL) is deliberately not used. Owner approved 2026-10-17. |
| motion | Animation for the premium finish (ADR-D22): entrances, sliding nav highlight, count-up, spring dialogs; honours reduced motion. Owner approved 2026-10-16. |
| @fontsource-variable/dm-sans | Self-hosted body font (ClinicOS body font, OFL-1.1); no runtime requests to Google Fonts. |
| @fontsource-variable/fredoka | Self-hosted page-title font (ClinicOS display font, OFL-1.1). Latin only, so every stack falls back to Noto Sans Gujarati. |
| @fontsource-variable/noto-sans-gujarati | Self-hosted Gujarati font (OFL-1.1); ClinicOS fonts have no Gujarati glyphs. Loaded by unicode-range only when Gujarati text appears. |
| axe-core | Automated accessibility rules (WCAG) run against the real /design page and in jsdom tests (NFR-UX-01). MPL-2.0, dev only. |
| playwright-core | Drives the Chrome already installed (CI runner and developer machine) to run axe and measure touch targets on /design. Apache-2.0, dev only; no browser binaries are downloaded, so it stays light. |
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

- **Data and audio are never tracked**: `.gitignore` blocks `data/`, `audio/`, `*.wav`, `*.mp3`, `*.m4a`, `*.webm`; `scripts/check-no-data-files.mjs` (in `npm run check` and CI) fails if any such file is tracked. Committed seed content lives in `seed/` (ADR-D18).
- **ClinicOS secret-exposure details are withheld** from every tracked file and from git history (ADR-D13). The full original wording is kept privately outside the repository.
- A gitleaks-style scan over all commits runs before each first push of new history (done 2026-10-15) and in CI on every push.

---

## CI tooling (not shipped)

| Tool | Version | Licence | Reason |
|---|---|---|---|
| gitleaks CLI | 8.30.1 (Linux x64 tarball, SHA-256 pinned in `.github/workflows/ci.yml`) | MIT | Secret scan over every commit (Hard Rule 5). Replaced `gitleaks/gitleaks-action@v2`, whose first CI run on the public repo failed with "Unexpected exit code [1]" while the same scan run locally with this CLI found nothing (11 commits). The same command is documented in the README. |
