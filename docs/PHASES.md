# PHASES.md - phase list and exit criteria

> **Resume status (one line, updated after every step):** Phase 4A in progress: steps 1-6 of 10 done (engine interface + MockEngine; VAD; usage log + spend caps; consent token: api-node route + asr-py guard; encrypted audio store + purge + internal service routes; WebSocket endpoint). NEXT: steps 7-10 (Sarvam adapter, IndicConformer + faster-whisper adapters, diarizer, smoke script, docs) on the owner's go. Plan in the 2026-10-17 conversation; details in docs/ASR.md and docs/vendor-notes.md. Steps 1-6 first, then 7-10 on the owner's go.

Copied from `DOCUMENTS/VaaniEHR_Phase_Plan_and_AI_Prompts.md` (v1.0, 14 Oct 2026; **not updated for PRD v1.1** - requirement IDs below are unchanged in v1.1 except as noted) §0.5 and the per-phase headers. The prompts themselves stay in that file (section and prompt numbers given below). **Where this plan conflicts with `DECISIONS.md` (ADR-D1..D11), the decisions win**; known conflicts are listed at the end. A phase is done only when its exit criteria are met and the owner has said so.

## Phase map (plan §0.5)

| Phase | Name | Weeks | Review milestone | Main PRD features |
|---|---|---|---|---|
| 0 | Orientation: understand ClinicOS, ingest documents, discover skills, set rules | 1 | - | - |
| 1 | Foundation and design system | 1-2 | Review-I | Skeleton, CI, UI kit |
| 2 | Identity, patients, consent, audit (ClinicOS-compatible) | 2-3 | Review-I | F1, F7 (audit) |
| 3 | Medicine master and prescription templates | 3-4 | Review-I | F5, F11 |
| 4 | Audio capture and speech recognition | 4-5 | Review-I -> II | F2 |
| 5 | Fact extraction with negation and evidence spans | 5-6 | Review-II | F3 |
| 6 | Guideline pathways and guided-question engine | 6-8 | Review-II | F4 |
| 7 | Suggestions and safety engine | 7-9 | Review-II | F6 |
| 8 | Consultation workspace and sign-off | 9-10 | - | F7, PG-06...PG-10 |
| 9 | FHIR builder, validator, ABHA sandbox | 8-11 | Review-II -> | F8, F9 |
| 10 | Gujarati WhatsApp summary | 11-12 | - | F10 |
| 11 | Evaluation console and benchmark | 10-14 | Viva | F12 |
| 12 | ClinicOS integration and hardening | 13-15 | Viva | F13, security, a11y, SBOM |
| 13 | Documentation, demo, paper, viva pack | 14-16 | Viva | Deliverables |

Phases 4-7 are the technical heart; Phase 9 depends on external approvals (apply in week 1).
Working loop per phase (plan §0.2): new session per phase; read the plan first; build; run the verification commands yourself; commit; phase review (plan §15); move on only when exit criteria are met.

## Phase 0 - Orientation (prompts 0.1-0.4)
- **Goal:** the AI understands what ClinicOS already is, what VaaniEHR must become, and which rules and skills apply, before any code.
- **Deliverables (plan):** `AGENTS.md` + the IDE auto-load copy; `docs/CONTEXT.md`; `docs/CLINICOS_AUDIT.md`; `docs/DOC_INDEX.md`; `docs/SKILLS.md`; `docs/OPEN_CLINICAL_ITEMS.md` and `docs/DECISIONS.md`; (added in this repo: `CLINICOS_INTEGRATION_FACTS.md`, `PRD_ERRATA.md`, `PHASES.md`, `CLAUDE.md`).
- **Exit criteria:** the owner has read `CLINICOS_AUDIT.md` and corrected anything wrong; open decisions D1 (database) and D2 (real build status) have an answer. *(Status: D1/D2 answered by the owner on 2026-10-14; owner review of Phase 0 files pending.)*

## Phase 1 - Foundation and design system (prompts 1.1, 1.2)
- **Goal:** a running skeleton (web + api + asr service + database), CI, and a clinical-grade design system, so every later phase only adds features.
- **PRD references:** §11 architecture, NFR-MAINT-01/02, NFR-COMP-02, NFR-UX-01/02.
- **Deliverables:** monorepo layout, `docker-compose.yml`, `.env.example`, health endpoints, migrations tool, CI workflow, lint/format/test setups, OpenAPI stub, `docs/SBOM.md` generator, design tokens + base components, i18n (English + Gujarati) scaffolding, persistent "simulated data" banner.
- **Exit criteria:** `docker compose up` starts all services; `/health` returns OK for web, api and asr; CI is green on an empty-feature commit; design system page renders; Gujarati text displays correctly (Noto Sans Gujarati or similar).

## Phase 2 - Identity, patients, consent and audit (prompts 2.1, 2.2)
- **Goal:** the safety and trust foundations: who is logged in, which patient, what was consented, and an unalterable record of actions.
- **PRD references:** F1, F7 (audit), NFR-SEC-01...04, NFR-REL-01, NFR-PRIV-01...03, PG-01, PG-02, PG-03, PG-05, PG-16, PG-18.
- **Deliverables:** login with ClinicOS-style JWT and RBAC (plus `researcher` role), patient lookup/create (standalone adapter with seed data), consent events (audio, ai_processing, whatsapp) with Gujarati/English notice, append-only hash-chained audit log with a verify script, session creation, the pages above.
- **Exit criteria:** recording controls stay disabled without both consent scopes (test proves it); audit chain verifies and a tampered row is detected (test proves it); RBAC matrix from PRD §2.2 is covered by tests.

## Phase 3 - Medicine master and prescription templates (M1) (prompts 3.1, 3.2)
- **Goal:** a trustworthy, source-tracked medicine library and fast prescription templates.
- **PRD references:** F5, F11, PG-12, PG-13, FR-F5-01...05.
- **Deliverables:** `medicine_master`, `medicine_brand`, `med_template`, `med_template_item`; NLEM 2022 import pipeline; autocomplete API (English + Gujarati transliteration); admin CRUD pages; template builder.
- **Exit criteria:** import is repeatable and reports row counts and rejects; every medicine row has `source` and `reviewed_on`; autocomplete returns in < 200 ms on the full list; SNOMED codes remain empty until the licence arrives (no invented codes).

## Phase 4 - Audio capture and speech recognition (M2) (prompts 4.1, 4.2)
- **Goal:** talk into the browser, see a live Gujarati/Hindi/English transcript, with swappable ASR engines so you can compare them.
- **PRD references:** F2, FR-F2-01...07, NFR-PERF-01, PG-06 (record bar + transcript pane), M-01, M-02.
- **Deliverables:** microphone capture (AudioWorklet), WebSocket streaming, VAD, ASR adapter interface with engines (Sarvam primary, IndicConformer baseline, faster-whisper baseline), diarization, transcript storage with edit history, mock engine for tests, cost counter.
- **Exit criteria:** a 2-minute acted clip yields first partial text <= 3 s and final text <= 10 s after stopping; engines can be switched by config; WER script runs on 20 labelled clips and prints a table; no audio sent anywhere without the consent scopes.

## Phase 5 - Fact extraction with negation and evidence spans (prompts 5.1, 5.2)
- **Goal:** turn transcript into structured, *grounded* facts the doctor can confirm.
- **PRD references:** F3, FR-F3-01...05, M-03, M-04.
- **Deliverables:** Pydantic schema; LLM extraction via Instructor; span grounding validator that rejects ungrounded facts; negation/uncertainty flags; Parrotlet-e entity linking (SNOMED optional until licence); fact panel UI; extraction ablation harness.
- **Exit criteria:** zero facts persisted without a valid span (test); negation F1 reported separately; plain-LLM vs constrained+grounded comparison table produced on dev cases.

## Phase 6 - Guideline pathways and the guided-question engine (M3), core novelty (prompts 6.1-6.3)
- **Goal:** a rules-driven engine that suggests the next *doctor-style* question, shows why, and never forces a guess.
- **PRD references:** F4, section 7.1, M-05...M-08, PG-14.
- **Deliverables:** pathway JSON schema + validator; loader; pathway versioning; engine (candidate scoring, red-flag-first, next-question by information gain proxy, abstention, question cap); LLM-only and rules-only baselines; pathway admin viewer; question panel UI; regression test suite per pathway.
- **Exit criteria:** engine passes unit tests on **hand-written toy pathways** immediately; real STW-based pathways load only after clinician review (`reviewed_by` present); red-flag case always stops suggestions; baselines produce comparable outputs on the same cases.
- **Plan note:** the assistant builds machinery and toy examples; the owner and clinician transcribe real ICMR STW content.

## Phase 7 - Suggestions and safety engine (M4), core novelty (prompts 7.1, 7.2)
- **Goal:** suggestions with reasons and five hard safety checks that fail closed.
- **PRD references:** F6, section 7.2, M-08...M-10, PG-08, PG-15.
- **Deliverables:** suggestion generator (matched pathway first-line items -> NLEM medicines), safety engine (allergy, max dose, duplicate class, interaction, out-of-scope/red flag, missing-info), rule tables with mandatory sources, override flow with reason, seeded unsafe-case suite, safety admin page, prescription builder.
- **Exit criteria:** **100% of seeded unsafe cases are flagged**; engine failure blocks signing (test); every rule row has a source; DDInter (non-commercial) usage is recorded in the SBOM; suggestions never appear while a red flag is active.
- **Plan note:** doses, interactions and cross-reactivity values come from sources the owner provides; the assistant builds structure and tests only.

## Phase 8 - Consultation workspace and sign-off (prompt 8.1)
- **Goal:** bring everything into one calm screen, then make signing a safe, auditable act.
- **PRD references:** F7, PG-06...PG-10, journeys 6.1 and 6.2.
- **Deliverables:** unified consultation workspace layout, history sidebar, sign-off page with AI-vs-final diff, amendment flow, immutable signed visit, visit record page.
- **Exit criteria:** end-to-end demo with the mock engine and toy pathway: consent -> record -> facts -> question -> select condition -> prescription -> sign; signing blocked by unresolved red alerts or unconfirmed facts; signed record cannot be edited except by logged amendment; keyboard-only run-through works.

## Phase 9 - FHIR builder, validator and ABHA sandbox (M6) (prompts 9.1, 9.2)
- **Goal:** every signed visit becomes a validated NRCeS-profile FHIR bundle; ABHA verification works against the sandbox.
- **PRD references:** F8, F9, FR-F8-01...05, FR-F9-01...03, section 8.3, M-11, M-15.
- **Deliverables:** FHIR builder, local copy of NRCeS IG package, validator in CI with golden examples, bundle storage with validation output, FHIR tab in the visit page, ABHA service (sandbox) with encryption helpers, ABHA UI, sandbox mock for offline development.
- **Exit criteria:** golden bundle(s) validate with 0 errors in CI; invalid bundle test shows errors surfaced without losing the signed record; ABHA flow demonstrated in sandbox (or against recorded fixtures if credentials are still pending, clearly labelled).

## Phase 10 - Gujarati WhatsApp summary (M7) (prompt 10.1)
- **Goal:** after sign-off, the doctor approves a plain Gujarati summary that is sent to a test number.
- **PRD references:** F10, FR-F10-01...04, Appendix B, M-16.
- **Deliverables:** summary generator from the *signed* record only, doctor approval screen, WhatsApp Cloud API sender with approved template, delivery webhook, send log, STOP handling.
- **Exit criteria:** summary cannot be generated or sent before sign-off or without whatsapp consent (tests); exact sent text stored; Gujarati reviewed by a Gujarati speaker before the template is submitted.

## Phase 11 - Evaluation console and benchmark (research core) (prompts 11.1, 11.2)
- **Goal:** produce the numbers that make this a research project and the dataset you can publish.
- **PRD references:** F12, sections 7.3 and 14, M-01...M-17.
- **Deliverables:** recording and annotation protocol, consent/release forms, dataset format, evaluation console (PG-17), batch runner for pipelines, metrics computation, ablation tables, error browser, dataset card, doctor usability study kit (SUS/NASA-TLX), figure/table export for the paper.
- **Exit criteria:** 100 acted consultations recorded and annotated (10% double-annotated, agreement reported); all metrics computed reproducibly from one command; results tables exported as CSV and Markdown/LaTeX.

## Phase 12 - ClinicOS integration and hardening (prompts 12.1, 12.2)
- **Goal:** plug VaaniEHR into ClinicOS through one API, then harden security and accessibility.
- **PRD references (v1.1):** F13 (FR-F13-01...04; FR-F13-03/04 are new in v1.1), section 9.4 (real endpoints), section 8.4 (**no ClinicOS schema changes in v1**; only the optional rate-limit and socket-auth proposals), NFR-SEC-*, NFR-UX-01, NFR-COMP-02.
- **Preconditions (do not start without):** ClinicOS runs locally for you; you have a git branch/backup of ClinicOS; `docs/DECISIONS.md` D1 and D2 are resolved; you have typed the approval phrase "Phase 12 integration approved".
- **Deliverables:** `ClinicOSVisitRepository` adapter, migration scripts proposed as *files for your review*, integration contract tests, feature flag, threat-model document, security test report, accessibility audit, SBOM, release notes.
- **Exit criteria:** with the flag off, ClinicOS behaves exactly as before (regression tests); with the flag on, a signed VaaniEHR visit appears in ClinicOS's visit history with coded fields; all migrations reversible.

## Phase 13 - Documentation, demo, paper and viva pack (prompts 13.1, 13.2)
- **Goal:** everything the review panel and your guide expect, produced from the real project, not from memory.
- **Deliverables:** SRS (IEEE 29148) generated from the PRD + built system, UML/DFD/ERD/block diagrams (macro and micro level), flow charts, test plan and report, user manual, deployment guide, SBOM and licence notes, intended-use statement and CDSCO class self-assessment (labelled as our reading), DPDP consent log description, copyright deposit pack, paper draft, slide deck outline, demo video script.
- **Exit criteria:** a fresh clone can be set up using only the README in under 30 minutes; every PRD requirement ID maps to a test and a code location (traceability matrix); demo script rehearsed twice.
- **Added by decision ADR-D8:** also write the ClinicOS docs-vs-code errata page (seed: `CLINICOS_AUDIT.md`, `PRD_ERRATA.md`).

## Plan text that conflicts with settled decisions (decisions win)

| Plan text | Conflict | Rule |
|---|---|---|
| §0.1 sibling folders, `Documents/` | Real layout is `ClinicOS/AWT-Project` + `ClinicOS/VaaniEHR`, folder `DOCUMENTS` | Use `AGENTS.md` paths |
| Phase 2 prompt 2.1: copy ClinicOS patient columns (`phone_normalized`, `allergies text[]`), "JWT claims identical to ClinicOS", refresh tokens | ClinicOS has no such columns; JWT is `{userId}` only; ADR-D4, ADR-D11 | Store ClinicOS ids as references; `AuthProvider`; VaaniEHR owns allergies, doctor profile, consent, signed state |
| Phase 2 deliverable "login with ClinicOS-style JWT" | ADR-D4 | Dev provider now, `ClinicOSTokenAuth` in Phase 12 |
| Phase 4/8 socket relay | ADR-D10 | Authenticate at handshake; no PHI via ClinicOS sockets |
| Phase 7 prompt 7.1 "30+ test cases" | PRD v1.1 (§7.2 / M-09 / App. F) says at least 50 | At least 50 |
| Phase 8 "re-enters password or PIN to sign" | Under `ClinicOSTokenAuth` there is no password in VaaniEHR | Decide in Phase 8 (open question) |
| Phase 10 "reuse the ClinicOS message_log table shape" | ClinicOS shape is `patientId, channel, template, status(sent/failed/delivered)`; PRD §8.2 `whatsapp_summary` is richer | Use the PRD §8.2 shape; do not depend on ClinicOS messaging |
| Phase 12 prompt 12.1 step 1 proposes ClinicOS schema changes (ABHA, HPR, coded visit fields, consent scopes) | PRD v1.1 §8.4: none in v1; those fields live in VaaniEHR tables (ADR-D11) | Propose only the two changes in §8.4 (rate-limit exemption, optional socket auth), each needing approval |
| Plan paths `data/pathways`, `data/medicines`, `data/safety`, `data/fhir/golden` (prompts 3.1, 6.1, 7.1, 9.1) | ADR-D18: committed seed content lives in `seed/`; `data/` and `audio/` are private and ignored | Use `seed/pathways`, `seed/medicines`, `seed/safety`, `seed/fhir/golden`; raw NLEM PDF stays in private `data/medicines/raw/`; every seed row has a `source` |
| Phase 12 prompt 12.1 step 2 edits ClinicOS | Only after the approval phrase (AGENTS.md) | Unchanged |
| Phase 12 hardening | ADR-D16: the `SIMULATED_DATA_ONLY=false` refusal must not be weakened | Keep the guard |
