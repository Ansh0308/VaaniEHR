# Software Requirements Specification: VaaniEHR (research prototype)

Structure follows ISO/IEC/IEEE 29148 (as named in PRD section 13; the standard's text was not re-checked, so this is a proportionate reading of its headings, **our reading, to be checked by my guide / institution**).

> **What this document is.** It describes what **exists in this repository** today. Where the PRD asks for something that is not built it says **Planned** or **Partial** and gives the reason. The requirement IDs and texts below are copied from the PRD by `scripts/srs.mjs` (`npm run srs`), so they cannot drift; the status, reason and references come from `docs/srs-status.json`. The matrix that links each ID to code, tests and the latest result is `docs/TRACEABILITY.md` (`npm run trace`). Nothing here claims a number, test or feature that is not in the repository.

| Item | Value |
|---|---|
| Source of requirements | `DOCUMENTS/VaaniEHR_PRD.md` v1.1 (the source of truth, ADR-D15) |
| Status of the product | Research prototype, **simulated data only**, not for real patients |
| Document status | Draft for the owner and guide; not reviewed by a clinician, a lawyer or an institution |

## 1. Introduction

### 1.1 Purpose

This SRS states the requirements of VaaniEHR as the PRD defines them and says, for each, whether and how far this repository meets it. It is for the owner, the guide and any reviewer who needs to know what the prototype does and does not do.

### 1.2 Scope

VaaniEHR is a web module for a general-medicine OPD doctor. It records a consultation after consent, turns Gujarati-Hindi-English speech into transcript text and structured facts that the doctor confirms, asks guideline-based follow-up questions from versioned pathways, lets the doctor build a prescription, supports sign-off with an immutable record, builds and validates an ABDM-oriented FHIR bundle, and drafts a Gujarati WhatsApp summary for the doctor to approve. It is built standalone and is meant to plug into the author's clinic system, ClinicOS, through one API (not yet done, see 3.7).

Out of scope (PRD 1.5): real patients or audio, diagnosis, children, pregnancy and emergencies, building an ASR or translation model, billing and queue management, telemedicine, lab integration and offline mode.

**Not a medical device claim.** The intended-use statement is PRD 1.6 and is shown on the Settings page (PG-18). The software informs the doctor and never diagnoses. Whether any medical-device or data-protection rule applies to a pilot is not decided here: **our reading, to be checked by my guide / institution** (appendix B).

### 1.3 Definitions and abbreviations

| Term | Meaning |
|---|---|
| ABDM / ABHA | Ayushman Bharat Digital Mission / the health account number and address it issues |
| ADR (`D<n>`) | Architecture decision record, numbered, in `docs/DECISIONS.md` |
| ASR / WER | Automatic speech recognition / word error rate |
| FHIR / NRCeS IG | HL7 FHIR R4 (4.0.1) / the National Resource Centre for EHR Standards implementation guide for ABDM (version 6.5.0 in the PRD) |
| FR / NFR / PG / M | Functional requirement / non-functional requirement / page / metric, IDs as in the PRD |
| HIP | Health Information Provider (ABDM role) |
| NLEM | National List of Essential Medicines (2022 edition is the medicine source) |
| OCI | Open clinical item (`OCI-nnn`), something the owner or a clinician must supply or decide, in `docs/OPEN_CLINICAL_ITEMS.md` |
| STW | ICMR Standard Treatment Workflows, the intended source of the real pathways |
| Pathway | A versioned graph of questions, answers and red-flag endings for one condition |
| Signed record | The immutable visit record created when the doctor signs |
| Mock-first | A provider defaults to a local fake; the real one needs several explicit switches |

### 1.4 References

`DOCUMENTS/VaaniEHR_PRD.md`; `docs/DECISIONS.md`; `docs/OPEN_CLINICAL_ITEMS.md`; `docs/TRACEABILITY.md`; `docs/THREAT_MODEL.md`; `docs/ASVS_L1.md`; `docs/A11Y_REPORT.md`; `docs/DATA_INVENTORY.md`; `docs/EVALUATION_PLAN.md`; `docs/ENV_VARS.md`; `docs/ABDM.md`; `docs/FHIR_MAPPING.md`; `docs/FHIR_GAPS.md`; `docs/WHATSAPP_SUBMISSION.md`; `docs/ASR.md`; `docs/SBOM.md`. The full list with one line each is `docs/DOC_INDEX.md`.

### 1.5 Count of requirements and their status

<!-- BEGIN GENERATED:counts -->

| Kind | In the PRD | Implemented | Partial | Planned |
|---|---|---|---|---|
| Functional (FR) | 61 | 36 | 18 | 7 |
| Non-functional (NFR) | 23 | 8 | 13 | 2 |
| Pages (PG) | 20 | 14 | 4 | 2 |

<!-- END GENERATED:counts -->

## 2. Overall description

### 2.1 Product perspective

A monorepo with four parts and a database:

| Part | What | Technology |
|---|---|---|
| `apps/web` | The doctor, staff and admin interface (English and Gujarati) | React 18, Vite, TypeScript, Tailwind 4, Vitest |
| `apps/api-node` | REST API, route registry with role checks, audit log, consent, visits, FHIR, WhatsApp, ABHA, privacy requests | Node 20, Express 5, zod, PostgreSQL 16 |
| `apps/asr-py` | Speech service (audio over a WebSocket, storage, purge), fact extraction, evaluation harness | Python 3.11, FastAPI |
| `packages/rules` | Pathway format, validator, question engine, entity-linking word list | TypeScript |
| PostgreSQL 16 | Own database (ClinicOS stays on MySQL, ADR-D1, D3) | Docker Compose |

ClinicOS is read-only to this project. The integration is through REST only, and today only a mock adapter exists (3.7).

### 2.2 Product functions

Consent gate; streaming speech recognition; fact extraction with negation and evidence; guideline-based guided questions; medicine library and templates; sign-off with audit and immutability; FHIR bundle build and validation; ABHA verification (mock); Gujarati WhatsApp summary (mock sender); evaluation harness (command line); privacy and erasure requests; security and accessibility checks in CI. **Not built:** medicine suggestions and the safety engine (PRD F6, "Phase 7"), the evaluation console screen, the ClinicOS integration (Phase 12A), HIP care-context linking (F14), prescription PDF (F15).

### 2.3 User classes

| Role | Can do (as built) |
|---|---|
| doctor | Record after consent, edit transcript and facts, answer pathway questions, build the prescription, sign, amend, approve the WhatsApp summary |
| staff | Register patients, record consent, check ABHA, record privacy requests |
| admin | Manage medicines, templates and pathways view, read the audit log, complete privacy requests |
| researcher | A flag in the PRD; **not built** as a role |
| patient | Receives the WhatsApp summary only; has no login |

The exact permission matrix is in `apps/api-node/src/auth/permissions.ts` and is tested (`rbac.db.test.ts`).

### 2.4 Operating environment

Node 20.19 or newer, Python 3.11, Docker (PostgreSQL and the FHIR validator image), Chrome for the browser tests. Developed on Windows (ADR-D9); CI runs on Linux. Setup is in the README.

### 2.5 Constraints

- A solo developer (PRD 3.4). Budget limits on paid services: spend caps are coded for ASR and the language model (ADR-D26, D31).
- **Simulated data only.** `SIMULATED_DATA_ONLY=false` is refused at start (ADR-D16, NFR-PRIV-02). No real patient, audio, Aadhaar or ABHA data (FR-F9-03).
- The model output is treated as untrusted: facts must have a source span, and nothing reaches a signed record without the doctor (ADR-D29, D30).
- Clinical content is never invented: doses, interactions, red-flag lists and pathways are supplied by the owner or a clinician; every gap is a `TODO(source)` listed in the open items (section 8).
- Third-party licences are recorded in the software bill of materials (NFR-COMP-02, `docs/SBOM.md`); a new dependency needs a decision entry.
- ClinicOS is not modified.

### 2.6 Assumptions and dependencies

The PRD lists assumptions A1 to A5. Their state in this repository:

| # | Assumption (PRD 3.3) | State |
|---|---|---|
| A1 | ABDM sandbox credentials arrive early | **Not obtained.** The sandbox application is an owner action; ABHA runs against a mock (ADR-D42) |
| A2 | An LLM API with a no-training option is available | **Unconfirmed.** A provider switch exists; evaluations used a free model through an OpenAI-compatible endpoint; the no-training setting is a vendor account matter (NFR-PRIV-03) |
| A3 | One practising doctor reviews scripts and rules | **Not secured** as far as this repository shows; the open items in section 8 wait for a clinician |
| A4 | Ethics or faculty approval for recording acted consultations | **Owner step**; only the owner's own voice has been recorded (docs/ASR.md) |
| A5 | (Corrected in the PRD) ClinicOS is MySQL; VaaniEHR has its own PostgreSQL | Resolved (ADR-D1, D3) |

## 3. External interfaces

### 3.1 User interface

Sections 5 (pages) and the design system (`docs/DESIGN.md`). English and Gujarati; all Gujarati text is **unreviewed** by a native speaker (`docs/NOTICE_REVIEW.md`). Accessibility: tested against WCAG 2.1 AA with automated checks and a keyboard pass, no conformance claim, no screen-reader test yet (`docs/A11Y_REPORT.md`).

### 3.2 Sarvam (speech recognition)

| Item | Detail |
|---|---|
| Used for | Streaming transcription (saaras:v4, code-mix mode) from the speech service (FR-F2-03) |
| Interface | Sarvam's streaming WebSocket; billed seconds are read from its end-of-session event (`apps/asr-py/app/asr/sarvam.py`) |
| Default | A mock engine. The real engine needs the API key and `SARVAM_ALLOW_THIRD_PARTY_AUDIO`, and only audio the owner has listed as their own voice may be sent (`own_voice.py`, ADR-D26) |
| Limits | Monthly paid-minute cap and a usage report (`usage.py`) |
| Verified | Run on one 62.6 s clip (docs/ASR.md); never on a patient |

### 3.3 Language-model provider (fact extraction)

| Item | Detail |
|---|---|
| Used for | Turning transcript text into structured facts (FR-F3-01) |
| Interface | An OpenAI-compatible chat-completions HTTP endpoint (`apps/asr-py/app/extraction/openai_compat.py`); temperature 0, JSON output, schema-checked afterwards |
| Default | A mock provider. The real one needs `LLM_API_KEY`, `LLM_BASE_URL` and `LLM_ALLOW_REAL_DATA`, and only texts listed as simulated are sent (`simulated_text.py`, ADR-D31) |
| Safety | Transcript text is untrusted: no tools for the model, input marked as data, injection patterns detected (`injection.py`, ADR-D30), spend caps |
| Not used | The LLM does not choose questions or medicines (FR-F4-05 is Partial in the safer direction) |

### 3.4 WhatsApp (Meta Cloud API)

A Meta client with a fixed Gujarati utility template (`apps/api-node/src/whatsapp/provider.ts`). **Default is a mock sender.** Real sending needs the provider flags and an allowlist of test numbers; it has **never been run against Meta** and no template is approved. The webhook (status and STOP) is implemented and tested with signed test payloads. Submission notes: `docs/WHATSAPP_SUBMISSION.md`.

### 3.5 ABDM (ABHA verification)

A client for the ABDM V3 sandbox (`apps/api-node/src/abdm/`), **mock by default**. The sandbox provider is switched off, its endpoint paths and public key are **unverified** (the official pages were not reachable when checked), and it has never been run against the sandbox. Real Aadhaar or ABHA data is refused by an identity guard. Details: `docs/ABDM.md`.

### 3.6 FHIR validator

The HL7 validator runs in server mode (local Java 11+, otherwise a pinned container) through `scripts/fhir-validator-server.mjs`, with the NRCeS package fetched by `scripts/fhir-fetch.mjs`; the API calls it when a visit is signed (FR-F8-02). CI validates golden and deliberately broken examples (`scripts/fhir-golden-check.mjs`). Known mapping gaps: `docs/FHIR_GAPS.md`; SNOMED codes are empty until a licence is supplied (OCI-002).

### 3.7 ClinicOS (mock)

The PRD's contract (FR-F13-01) is to read patients and visit history from ClinicOS and write the visit after sign-off with the doctor's own token. **Built:** the adapter interface and mock adapters that mirror the verified response shapes (FR-F13-02). **Not built:** the real calls, `ClinicOSTokenAuth` (a stub that throws) and the sign-off-then-write rule (FR-F13-01, 03, 04). Phase 12A needs the owner's approval phrase. The audited facts about ClinicOS are in `docs/CLINICOS_AUDIT.md` and `docs/CLINICOS_INTEGRATION_FACTS.md`.

## 4. Functional requirements

Status values: **Implemented** (a code path and at least one test exist; the reason column says what is still unreviewed or unmeasured), **Partial** (part of the sentence is met; the reason says which part), **Planned** (not built). A reference "ADR-D<n>" is in `docs/DECISIONS.md`; "OCI-nnn" is in `docs/OPEN_CLINICAL_ITEMS.md`.

<!-- BEGIN GENERATED:fr -->

### 4.1 F1 - Consent gate (P0)

| ID | Requirement (PRD text, unchanged) | Status | What exists, or what is missing | ADR / OCI |
|---|---|---|---|---|
| FR-F1-01 | The "Record" button is disabled until a consent record exists with scope `audio` and scope `ai_processing` for this session. | Implemented | Record button is gated by the audio and AI-processing consent scopes; the speech service also refuses audio without a consent token. | ADR-D20, ADR-D26, ADR-D27 |
| FR-F1-02 | Consent text is shown in Gujarati and English, versioned (`notice_version`), with timestamp and source (staff / patient). | Implemented | Versioned notice in English and Gujarati with timestamp and source. The notice wording is a placeholder and unreviewed. | ADR-D20, OCI-016 |
| FR-F1-03 | WhatsApp sending needs a separate `whatsapp` consent scope. | Implemented | A separate whatsapp scope is required before a summary is drafted or sent. | ADR-D20, ADR-D41 |
| FR-F1-04 | Withdrawal is possible at any time; withdrawing stops recording and marks audio for deletion. | Implemented | Withdrawal stops recording and the audio is purged by the speech service; transcripts follow the withdrawal rule. Whether this is legally enough is open. | ADR-D28, ADR-D45, OCI-016, OCI-020 |
| FR-F1-05 | Every consent event is written to the append-only consent log and audit log. | Implemented | Every consent event goes to the append-only consent log and the audit log. | ADR-D20 |

### 4.2 F2 - Streaming code-switched speech recognition (P0)

| ID | Requirement (PRD text, unchanged) | Status | What exists, or what is missing | ADR / OCI |
|---|---|---|---|---|
| FR-F2-01 | Browser captures microphone audio (MediaRecorder/AudioWorklet), sends 250–500 ms chunks over WebSocket (Socket.IO library, as in ClinicOS, but a **separate authenticated namespace**; ADR-D10) to the Python ASR service. | Implemented | AudioWorklet capture sends PCM chunks over a plain WebSocket, not Socket.IO (deviation, ADR-D25). | ADR-D25, ADR-D27 |
| FR-F2-02 | Voice-activity detection (Silero VAD) trims silence before ASR. | Partial | The silence gate is implemented, but the Silero model is an optional install (requirements-vad.txt); without it nothing is trimmed. | ADR-D25 |
| FR-F2-03 | Primary ASR is Sarvam Saaras V4 in code-mix mode with up to 50 NLEM medicine names as biasing keyterms **[Source: MarkTechPost summary; verify on Sarvam docs]**. | Implemented | Sarvam saaras:v4 adapter with up to 50 keyterms. Run on one 62.6 s clip only (docs/ASR.md); the starter keyterm list is unreviewed. | ADR-D25, ADR-D26, OCI-015 |
| FR-F2-04 | Baseline ASR (IndicConformer-600M and/or faster-whisper) is selectable for evaluation runs. | Implemented | IndicConformer and faster-whisper adapters selectable by name; the faster-whisper small model was run on one clip (74.5% WER). | ADR-D25 |
| FR-F2-05 | Speaker turns labelled `doctor` / `patient` (Sarvam diarization or pyannote). | Partial | Speaker labels exist (a mock diarizer, assignment of turns to segments, and the doctor confirming each role). The default is off; pyannote and Sarvam diarization are not wired. | ADR-D25 |
| FR-F2-06 | Transcript is editable by the doctor; every edit is stored (original + edited). | Implemented | Saved transcripts keep the original and the edited text; confirmed segments are guarded in the database. | ADR-D28 |
| FR-F2-07 | Each segment stores start/end time, speaker, text, language tags, ASR engine and version, and confidence if available. | Implemented | Segments store times, speaker, text, language, engine and version; confidence only when the engine gives one. | ADR-D28 |

### 4.3 F3 - Fact extraction with negation and evidence (P0)

| ID | Requirement (PRD text, unchanged) | Status | What exists, or what is missing | ADR / OCI |
|---|---|---|---|---|
| FR-F3-01 | An LLM, constrained to a JSON schema (Instructor + Pydantic), extracts: symptoms, duration, severity, vitals mentioned, allergies, past conditions, current medicines, red-flag mentions. | Partial | Extraction is schema-checked (Pydantic, JSON mode) and runs against a model adapter, but the Instructor library is not used, and red-flag mentions are deliberately not extracted by the model (OCI-018). | ADR-D30, ADR-D31, OCI-018 |
| FR-F3-02 | Every fact carries `negated` (true/false), `uncertain` (true/false), `source_span` (transcript segment ID + character offsets) and a SNOMED concept ID where mapping succeeds. | Implemented | Every fact carries negated, uncertain and a source span. | ADR-D29 |
| FR-F3-03 | A fact with no valid `source_span` is rejected as ungrounded (this defines the **hallucination** metric). | Implemented | A fact without a valid span is dropped as ungrounded and counted. | ADR-D29 |
| FR-F3-04 | Entity linking uses Parrotlet-e embeddings against the licensed SNOMED subset; unmapped facts stay as free text and are shown in grey. | Partial | Linking uses a word list, not Parrotlet-e embeddings (not added, ADR-D32); the SNOMED subset is not loaded (OCI-002); the doctor confirms a link by hand; unmapped facts stay free text. | ADR-D32, ADR-D37, OCI-002, OCI-017 |
| FR-F3-05 | Doctor can add, edit, delete or confirm each fact. Confirmed facts feed M3/M4; unconfirmed facts are shown as "heard" only. | Implemented | The doctor adds, edits, rejects and confirms facts; only confirmed facts feed the pathway engine. | ADR-D29, ADR-D33 |

### 4.4 F4 - Guideline-based guided questions (P0)

| ID | Requirement (PRD text, unchanged) | Status | What exists, or what is missing | ADR / OCI |
|---|---|---|---|---|
| FR-F4-01 | Each supported condition is a versioned **pathway** (graph of question nodes, answer types, edges, red-flag terminals) hand-encoded from an ICMR STW and reviewed by a clinician. | Partial | The versioned pathway format, loader, linter and lock file work, but only toy pathways exist; the real ICMR STW pathways are not transcribed (OCI-019). | ADR-D34, ADR-D35, OCI-019, OCI-021 |
| FR-F4-02 | The engine keeps a shortlist of candidate conditions with scores, updated after each confirmed fact. | Implemented | The engine scores candidate conditions after each confirmed fact (toy pathways only). | ADR-D34 |
| FR-F4-03 | Next question = unanswered node with highest expected information gain, **but red-flag questions always come first** when any red-flag-compatible symptom is present. | Implemented | Highest information weight first; red-flag questions come first when a red flag is possible. | ADR-D34 |
| FR-F4-04 | Questions are shown **to the doctor** as suggestions with the STW node and one-line reason ("asks because: fever > 5 days → rule out typhoid/dengue"). | Implemented | Questions are suggestions to the doctor with the node and a one-line reason. | ADR-D36 |
| FR-F4-05 | The LLM only (a) maps utterances to answer slots, and (b) phrases the suggested question in Gujarati/Hindi/English. The rules choose *which* question. | Partial | The rules choose the question (as required), but facts are mapped to answer slots by rules, not by an LLM, and the question text is authored in the pathway (en, gu, hi), not phrased by an LLM. Safer than specified. | ADR-D34 |
| FR-F4-06 | The engine abstains (shows "need more information") when no candidate exceeds a confidence threshold, instead of forcing a guess. | Implemented | The engine abstains below the confidence threshold (default 0.5, unreviewed). | ADR-D34, OCI-021 |
| FR-F4-07 | A cap on questions (default 8) prevents endless prompting. | Implemented | Question cap, default 8. | ADR-D34, OCI-021 |
| FR-F4-08 | The doctor can dismiss a question; dismissals and the doctor's real questions are logged for evaluation. | Implemented | Dismissals and answers are stored as events and audited (QUESTION_ACTED). | ADR-D34, ADR-D36, OCI-020 |
| FR-F4-09 | Output: ranked shortlist (top-3) with evidence for and against, each linked to its STW node. No "final diagnosis" wording anywhere in the UI. | Implemented | Ranked top-3 shortlist with evidence for and against, no diagnosis wording (toy pathways only). | ADR-D36 |

### 4.5 F5 - Medicine library and templates (P0)

| ID | Requirement (PRD text, unchanged) | Status | What exists, or what is missing | ADR / OCI |
|---|---|---|---|---|
| FR-F5-01 | `medicine_master` is seeded from NLEM 2022 (**384 medicines** per the committee list; the committee report text also says 386, so use 384 and note it) with generic name, strength, dose form, route, therapeutic category, SNOMED code (after the licence arrives) and source. | Implemented | NLEM 2022 imported; the loaded rows number 388 against the 384 printed (OCI-005); clinician review of rows is pending. | ADR-D23, OCI-003, OCI-004, OCI-005 |
| FR-F5-02 | **Generic-first**: search and display show generic name; brand names are optional children (`medicine_brand`). | Implemented | Generic name first; brands are child rows. | ADR-D23, ADR-D24 |
| FR-F5-03 | Autocomplete by generic or brand, in English and Gujarati transliteration. | Partial | Autocomplete by generic or brand works; the Gujarati transliteration list is machine-drafted and unreviewed (OCI-007). | ADR-D24, OCI-007 |
| FR-F5-04 | Prescription templates (personal or clinic-wide) hold medicine items with default dose, frequency, duration and instructions; the doctor can load, edit and save templates (extends ClinicOS F20). | Implemented | Personal and clinic templates with items, builder page and load dialog. | ADR-D24 |
| FR-F5-05 | Every medicine row stores its data source and last-reviewed date. | Partial | Source is stored per row; the last-reviewed date column exists but is empty until a clinician reviews the rows (OCI-003). | ADR-D23, OCI-003 |

### 4.6 F6 - Suggestions with safety checks (P0)

| ID | Requirement (PRD text, unchanged) | Status | What exists, or what is missing | ADR / OCI |
|---|---|---|---|---|
| FR-F6-01 | Suggestions come from the first-line options in the matched pathway (STW), mapped to NLEM medicines. They appear only after the doctor confirms a working condition. | Planned | Medicine suggestions from the pathway's first-line items are not built (Phase 7, not started). The doctor adds medicines by hand. | ADR-D38 |
| FR-F6-02 | Each suggestion shows the reason, the STW source, dose range and a safety status: 🟢 clear, 🟠 acknowledge, 🔴 blocked until override. | Planned | Suggestion cards with safety status are not built; AlertCard exists as a design component only. | ADR-D38 |
| FR-F6-03 | Checks run on every add/edit: (1) allergy and cross-reactivity, (2) maximum daily dose, (3) duplicate drug class, (4) major drug–drug interaction, (5) red-flag/out-of-scope stop (pregnancy, age under 18, emergency features). | Planned | The five safety checks do not exist. Only the SafetyChecks seam and the 'Safety checks were not run' acknowledgement are built (ADR-D38). | ADR-D38 |
| FR-F6-04 | A 🔴 alert can be overridden only with a typed reason; the override is logged. | Planned | No red alerts exist to override; the typed-reason override flow is not built. | ADR-D38 |
| FR-F6-05 | When a red flag is active, **medicine suggestions are suppressed** and a refer/urgent banner is shown; the doctor must acknowledge it. | Partial | A red flag shows an assertive banner that must be acknowledged; the pathway engine stops asking. There are no medicine suggestions to suppress yet. | ADR-D36, OCI-018 |
| FR-F6-06 | Nothing is written to the final record until sign-off (F7). | Implemented | The prescription is a draft until sign-off; only signing writes the immutable record. | ADR-D38 |

### 4.7 F7 - Doctor sign-off and audit (P0)

| ID | Requirement (PRD text, unchanged) | Status | What exists, or what is missing | ADR / OCI |
|---|---|---|---|---|
| FR-F7-01 | The sign-off page shows a diff between AI-proposed content and the doctor's final content. | Implemented | Sign page shows the AI-proposed versus final content. | ADR-D39 |
| FR-F7-02 | Signing requires all 🔴 alerts resolved or overridden with reason, and all unconfirmed facts either confirmed or dropped. | Partial | Signing is refused for unconfirmed facts, an unacknowledged red flag and similar named blockers. Red alerts from a safety engine cannot exist yet, so the doctor must acknowledge 'Safety checks were not run'. | ADR-D38, ADR-D39 |
| FR-F7-03 | On sign: VaaniEHR visit-record status `draft → signed`; the record becomes immutable except via a logged amendment with reason. This state lives in VaaniEHR because ClinicOS has only `isComplete`; ClinicOS receives content only after sign-off (ADR-D11). | Implemented | draft to signed with a snapshot hash; immutable in the registry and by database triggers; amendments need a reason and keep versions. | ADR-D38, ADR-D39 |
| FR-F7-04 | Audit log entries (append-only, hash-chained) for: consent, record start/stop, transcript edits, fact edits, suggestion accept/reject, override, sign, amendment, FHIR generation, WhatsApp send. | Partial | Audit entries exist for consent, audio, transcript, fact, question, sign, amendment, FHIR and WhatsApp actions, hash-chained. Suggestion accept/reject and override entries do not exist because those features are not built. | ADR-D20, ADR-D38 |

### 4.8 F8 - FHIR record builder and validator (P0)

| ID | Requirement (PRD text, unchanged) | Status | What exists, or what is missing | ADR / OCI |
|---|---|---|---|---|
| FR-F8-01 | On sign, build a FHIR R4 (4.0.1) Bundle conforming to NRCeS IG for ABDM **v6.5.0** (OPConsultRecord, with PrescriptionRecord content). | Implemented | Bundle builder for the NRCeS profiles at 6.5.0; known gaps are listed in docs/FHIR_GAPS.md. | ADR-D40 |
| FR-F8-02 | Validate with the HL7 validator against the `ndhm.in` package before storing; store the validation output with the bundle. | Implemented | The bundle is validated by the HL7 validator service and the output is stored with it. | ADR-D40 |
| FR-F8-03 | If validation fails, the visit stays signed (clinical record is safe) but the bundle is marked `invalid` with errors shown to the admin; no export. | Implemented | A failed validation leaves the visit signed and marks the bundle invalid with the errors. | ADR-D40 |
| FR-F8-04 | Medicines use SNOMED CT codes (NRCeS/CDCI) in `MedicationRequest`; diagnosis in `Condition`; vitals in `Observation`; allergies in `AllergyIntolerance`. | Partial | Resources are mapped, but SNOMED codes are empty until a licensed release is supplied (OCI-002), so coded medicines are not produced. | ADR-D40, OCI-002 |
| FR-F8-05 | Validator runs in CI against a fixed set of golden examples. | Implemented | CI job runs the validator over golden and broken examples (scripts/fhir-golden-check.mjs). | ADR-D40 |

### 4.9 F9 - ABHA verification (P1)

| ID | Requirement (PRD text, unchanged) | Status | What exists, or what is missing | ADR / OCI |
|---|---|---|---|---|
| FR-F9-01 | Staff can verify an ABHA number/address in the ABDM **V3 sandbox** using OTP flow; status stored on the patient. | Partial | Verify flow, status badge and page exist against a MOCK provider. The sandbox provider is unverified and has never been run against the ABDM sandbox. | ADR-D42 |
| FR-F9-02 | Aadhaar and OTP values are RSA-encrypted before sending, per ABDM requirements **[Unverified — practitioner sources]**. | Partial | RSA encryption step is implemented and tested with a test key; the real ABDM public key and the endpoint details are unverified. | ADR-D42 |
| FR-F9-03 | No real Aadhaar or ABHA data is used; only sandbox test identities. | Implemented | An identity guard refuses anything that looks like real identity data outside the mock or sandbox. | ADR-D42 |

### 4.10 F10 - Gujarati WhatsApp summary (P1)

| ID | Requirement (PRD text, unchanged) | Status | What exists, or what is missing | ADR / OCI |
|---|---|---|---|---|
| FR-F10-01 | After sign-off and with `whatsapp` consent, generate a plain-language Gujarati summary: what the doctor found, medicines with timing, warning signs, follow-up. | Implemented | The summary is built from fixed Gujarati phrases and verbatim doctor text; the phrases are unreviewed. | ADR-D41 |
| FR-F10-02 | The Gujarati text is generated from the **signed** record only and shown to the doctor for approval before sending. | Implemented | Generated from the signed record only; the doctor approves a preview before any send. | ADR-D41 |
| FR-F10-03 | Send through the WhatsApp Cloud API with an approved Gujarati (`gu`) utility template; the exact message sent is stored. | Partial | A Meta client and the stored message exist, but it has never been run against Meta and no Gujarati template is approved; the default sender is a mock. | ADR-D41 |
| FR-F10-04 | Never send before sign-off. Use test numbers only during the project. | Implemented | Sending needs a signed visit, the whatsapp scope and an approved summary; the mock is the default. | ADR-D41 |

### 4.11 F11 - Prescription templates UI (P1)

The PRD gives F11 no requirement rows (the PRD points to FR-F5-04; the templates pages (PG-13) are built). Status: **Implemented**.

### 4.12 F12 - Evaluation console (P1)

| ID | Requirement (PRD text, unchanged) | Status | What exists, or what is missing | ADR / OCI |
|---|---|---|---|---|
| FR-F12-01 | Upload acted audio with gold labels (transcript, facts, question path, prescription). | Partial | The dataset format, validator and converter exist as a command line (bench/); there is no upload screen. 11 acted clips exist, 1 with audio. | ADR-D43 |
| FR-F12-02 | Run the same case through three pipelines: rules-only, LLM-only, hybrid. | Partial | The runner and cache exist; the LLM-only and hybrid engines are not built, so the three-way comparison cannot run. | ADR-D43 |
| FR-F12-03 | Compute and display the metrics in §14; export CSV for the paper. | Partial | Metric code and a CSV exist on the command line; nothing is displayed in a console (PG-17 not built). | ADR-D43 |
| FR-F12-04 | Store engine versions and prompts for every run (reproducibility). | Implemented | The cache key is engine, version and prompt hash; the frozen split refuses tuning. | ADR-D43 |

### 4.13 F13 - ClinicOS integration (P1)

| ID | Requirement (PRD text, unchanged) | Status | What exists, or what is missing | ADR / OCI |
|---|---|---|---|---|
| FR-F13-01 | A single documented REST contract (§9.4) using the **real** ClinicOS endpoints: read patient and visit history; after VaaniEHR sign-off, write the visit with the doctor's own token (create, autosave, complete). Allergies come from VaaniEHR, not ClinicOS. | Planned | Phase 12A (the real ClinicOS calls) is not started; it needs the owner's approval phrase. Only the adapter interface and the mock exist. | ADR-D3, ADR-D14 |
| FR-F13-02 | VaaniEHR runs standalone with a mock ClinicOS adapter that **mirrors the verified ClinicOS response shapes** (e.g. lookup returns HTTP 200 `{found:false}`, `/me` includes `status`). Contract tests run against it. | Implemented | Mock adapters mirror the verified ClinicOS response shapes and contract tests run against them. | ADR-D3 |
| FR-F13-03 | `ClinicOSTokenAuth` validates the user's ClinicOS bearer token via `GET /api/auth/me`, caches the result briefly, and rejects any user whose `status` is not `approved` (ClinicOS `/me` and login do not check status). The ClinicOS `JWT_SECRET` is never shared. | Planned | ClinicOSTokenAuth is a stub that throws until Phase 12. | ADR-D4, ADR-D12 |
| FR-F13-04 | Every ClinicOS write is preceded by a VaaniEHR sign-off check and followed by a VaaniEHR audit entry. Completing a ClinicOS visit also marks its token `served` and recalculates the queue; the integration must expect and test this side effect. | Planned | No ClinicOS write exists yet, so the sign-off check, the audit entry and the served-token side effect are not built. | ADR-D14 |

### 4.14 F14 - HIP care-context linking (P2)

The PRD gives F14 no requirement rows (P2 feature; nothing is built and the PRD lists no requirement rows). Status: **Planned**.

### 4.15 F15 - Prescription PDF (P2)

The PRD gives F15 no requirement rows (P2 feature (prescription PDF); nothing is built and the PRD lists no requirement rows). Status: **Planned**.

<!-- END GENERATED:fr -->

## 5. Pages (user interface requirements)

Routes in the "Route in the PRD" column are the PRD's; where the built route differs, the reason column says so.

<!-- BEGIN GENERATED:pg -->

| ID | Page | Route in the PRD | Who | Priority | Status | What exists, or what is missing | ADR / OCI |
|---|---|---|---|---|---|---|---|
| PG-01 | Login | `/login` | all | P0 | Implemented | Login with the dev provider; the ClinicOS token provider is not built. | ADR-D4 |
| PG-02 | Doctor dashboard | `/doctor` | doctor | P0 | Implemented | Dashboard with the doctor's sessions and drafts. | ADR-D21 |
| PG-03 | Patient lookup / register | `/patients` | staff, admin | P0 | Implemented | Phone lookup and quick-create against the stand-in patient table, not the real ClinicOS. | ADR-D21 |
| PG-04 | ABHA verification | `/patients/:id/abha` | staff, admin | P1 | Partial | Page exists; it talks to the MOCK ABHA provider only (see FR-F9-01). | ADR-D42 |
| PG-05 | Consent capture | `/consult/:sessionId/consent` | staff, doctor | P0 | Implemented | Three scopes, notice in both languages, withdrawal. | ADR-D20 |
| PG-06 | Consultation workspace | `/consult/:sessionId` | doctor | P0 | Implemented | Workspace with record bar, transcript, facts, questions, red-flag banner and history. | ADR-D27, ADR-D33, ADR-D36, ADR-D38 |
| PG-07 | Diagnosis review | `/consult/:sessionId/diagnosis` (also a panel in PG-06) | doctor | P0 | Partial | Exists as a panel in the workspace (not a separate route); toy pathways only. | ADR-D36, OCI-019 |
| PG-08 | Prescription builder | `/consult/:sessionId/rx` (also a panel) | doctor | P0 | Partial | Prescription tab exists (autocomplete, doses, templates); inline safety alerts are not built because the safety engine is not. | ADR-D38 |
| PG-09 | Review and sign-off | `/consult/:sessionId/sign` | doctor | P0 | Implemented | Checklist of named blockers, AI-versus-final diff, sign with password re-entry. | ADR-D39 |
| PG-10 | Visit record / FHIR viewer | `/visits/:id` | doctor, admin, researcher | P0 | Implemented | Visit record with the FHIR tab and validator result; the route is /consult/:id/record, not /visits/:id. | ADR-D39, ADR-D40 |
| PG-11 | Patient summary + WhatsApp log | `/visits/:id/summary` | doctor, staff | P1 | Implemented | Gujarati preview, approval and send log; route is /consult/:id/summary. | ADR-D41 |
| PG-12 | Medicine master admin | `/admin/medicines` | admin | P0 | Implemented | Medicine table, edit, retire, brands. | ADR-D24 |
| PG-13 | Prescription template admin | `/admin/templates` | admin, doctor | P1 | Implemented | Template list and builder. | ADR-D24 |
| PG-14 | Guideline pathway admin | `/admin/pathways` | admin | P1 | Partial | Read-only pathway viewer; there is no graph editor or version diff (authoring is by command line). | ADR-D35 |
| PG-15 | Safety rules admin | `/admin/safety` | admin | P1 | Planned | Safety rules admin is part of Phase 7, not started. | ADR-D38 |
| PG-16 | Audit log | `/admin/audit` | admin, researcher | P1 | Implemented | Filters, CSV export, hash-chain status. The researcher role is not built. | ADR-D20 |
| PG-17 | Evaluation console | `/research/eval` | researcher, admin | P1 | Planned | No console screen; the evaluation harness is a command line (FR-F12). | ADR-D43 |
| PG-18 | Settings and About | `/settings` | all | P1 | Implemented | Language, intended-use text and licence list. | ADR-D21 |
| PG-19 | Error pages | `/404`, `/500` | all | P0 | Implemented | 404, 403 and 500 pages with a main landmark. | ADR-D45 |
| PG-20 | Consent withdrawal / data erasure request | `/privacy/request` | staff, admin | P2 | Implemented | Request queue and completion at /privacy/requests; the legal rule on signed records is open. | ADR-D45, OCI-016 |

<!-- END GENERATED:pg -->

## 6. Non-functional requirements

"Evidence" says whether an automated test or check backs the status. "Not measured" means no measurement exists in the repository; it does not mean the target is met or missed.

<!-- BEGIN GENERATED:nfr -->

### 6.1 Performance

| ID | Requirement (PRD text, unchanged) | Target (PRD) | Status | Evidence | What exists, or what is missing | ADR / OCI |
|---|---|---|---|---|---|---|
| NFR-PERF-01 | Latency: First partial transcript after speech starts | ≤ 3 s (95th percentile) [Assumption] | Partial | Not measured | First transcript result came after 0.5-0.7 s on one clip with Sarvam (docs/ASR.md). That is one observation, not a 95th percentile. | ADR-D25 |
| NFR-PERF-02 | Latency: Next-question suggestion after a confirmed fact | ≤ 1.5 s (rules) / ≤ 4 s (with LLM phrasing) | Partial | Not measured | The rules engine runs in process; no latency measurement exists, and the LLM phrasing path is not built. | ADR-D34 |
| NFR-PERF-03 | Latency: Safety re-check after prescription edit | ≤ 500 ms | Planned | Not measured | There is no safety engine to time. | ADR-D38 |
| NFR-PERF-04 | Latency: FHIR build + validate | ≤ 10 s | Partial | Not measured | Build and validate run on sign and in CI; the time was not measured against the 10 s target. | ADR-D40 |

### 6.2 Security

| ID | Requirement (PRD text, unchanged) | Target (PRD) | Status | Evidence | What exists, or what is missing | ADR / OCI |
|---|---|---|---|---|---|---|
| NFR-SEC-01 | Auth: Every endpoint and socket connection authenticated through `AuthProvider` and RBAC-enforced. Standalone mode: VaaniEHR-signed short-lived access token (about 1 h), no refresh token. Integrated mode: ClinicOS token validated via `/api/auth/me`; `JWT_SECRET` never shared | 100% | Implemented | Automated test or check | Every route goes through the route registry with a permission or an explicit public marker; sockets authenticate at the handshake; a role matrix test covers every route. ClinicOS token auth is not built. | ADR-D4, ADR-D10, ADR-D20 |
| NFR-SEC-02 | Transport: TLS everywhere | TLS 1.2+ (1.3 preferred) | Planned | Not measured | TLS is a hosting step for the owner; the repository ships HSTS and CSP headers in nginx but no TLS termination. | ADR-D44 |
| NFR-SEC-03 | At rest: Audio and PHI encrypted at rest | AES-256 | Partial | Not measured | Stored audio is encrypted (ADR-D26). Database contents are not encrypted by the application; disk-level encryption is a deployment matter. | ADR-D26 |
| NFR-SEC-04 | Secrets: No keys in code; env/secret manager | Enforced in CI (secret scan) | Implemented | Automated test or check | gitleaks in the security workflow, a secrets review, and tests that the logger redacts. | ADR-D44 |
| NFR-SEC-05 | LLM safety: Treat transcript text as untrusted: schema-constrained output, no tool access, strip instructions; test OWASP LLM Top 10 items (prompt injection, sensitive info disclosure, improper output handling, excessive agency) | Test report | Partial | Automated test or check | Prompt-injection and disclosure tests exist and the model has no tools; the OWASP LLM Top 10 list was not walked item by item. | ADR-D30, ADR-D44 |
| NFR-SEC-06 | Web: OWASP ASVS L1 checklist (L2 where time allows); STRIDE threat model | Document in SRS | Implemented | Automated test or check | ASVS Level 1 checklist and STRIDE threat model written, each item with evidence; items without a test are listed as such. | ADR-D44 |

### 6.3 Privacy

| ID | Requirement (PRD text, unchanged) | Target (PRD) | Status | Evidence | What exists, or what is missing | ADR / OCI |
|---|---|---|---|---|---|---|
| NFR-PRIV-01 | Retention: Audio deleted after evaluation window | Default 90 days [Assumption] | Implemented | Automated test or check | Audio older than 90 days is purged; boundary tests exist. The 90-day value is an assumption. | ADR-D26, ADR-D45, OCI-016 |
| NFR-PRIV-02 | Data: Acted/simulated data only; real-data guard | Banner + config flag | Implemented | Automated test or check | SIMULATED_DATA_ONLY=false is refused at start; a banner is on every page. | ADR-D16 |
| NFR-PRIV-03 | Third parties: LLM and ASR vendors configured for no training on data | Record in SBOM | Partial | Not measured | Vendor no-training settings are an account setting the owner must confirm; the repository records the vendors (SBOM) but cannot prove the setting. | ADR-D31 |

### 6.4 Reliability

| ID | Requirement (PRD text, unchanged) | Target (PRD) | Status | Evidence | What exists, or what is missing | ADR / OCI |
|---|---|---|---|---|---|---|
| NFR-REL-01 | Integrity: Audit log append-only, hash-chained | Verified by a script | Implemented | Automated test or check | Append-only table with a hash chain and a verify script. | ADR-D20 |
| NFR-REL-02 | Degradation: If ASR or LLM is down, doctor can type notes and continue | Manual path always available | Partial | Not measured | When extraction is down the doctor can add facts by hand and edit the transcript; a full typed-notes mode when ASR is down was not tested end to end. | ADR-D33 |
| NFR-REL-03 | Safety: If safety engine fails, prescription cannot be signed | Fail closed | Partial | Automated test or check | If the SafetyChecks seam reports an error, signing is refused (tested). The engine itself does not exist. | ADR-D38 |

### 6.5 Usability

| ID | Requirement (PRD text, unchanged) | Target (PRD) | Status | Evidence | What exists, or what is missing | ADR / OCI |
|---|---|---|---|---|---|---|
| NFR-UX-01 | Accessibility: WCAG 2.1 AA on core pages | Audit report | Partial | Automated test or check | Tested against WCAG 2.1 AA with automated checks plus a keyboard walkthrough on every route; this is not a conformance claim and no screen-reader test was done. | ADR-D45 |
| NFR-UX-02 | i18n: UI strings and patient text in English + Gujarati; Hindi labels where feasible | i18next | Partial | Automated test or check | English and Gujarati on all screens; Hindi appears in pathway text only. All Gujarati strings are unreviewed. | ADR-D19, ADR-D45 |
| NFR-UX-03 | Device: Laptop-first; tablet usable | Responsive | Implemented | Automated test or check | Layouts are checked at 1280 px and 375 px (no sideways scroll, 44 px targets) in the browser sweep. | ADR-D45 |

### 6.6 Maintainability

| ID | Requirement (PRD text, unchanged) | Target (PRD) | Status | Evidence | What exists, or what is missing | ADR / OCI |
|---|---|---|---|---|---|---|
| NFR-MAINT-01 | Quality: Unit tests (Jest, PyTest); API tests; CI on every push | Coverage target 70% core modules [Assumption] | Partial | Not measured | Unit, database, web and Python tests run in CI on every push. The 70 percent coverage target is not recorded anywhere. | - |
| NFR-MAINT-02 | Traceability: Every FR has at least one test | Traceability matrix | Partial | Automated test or check | docs/TRACEABILITY.md is generated by `npm run trace`, which fails if an Implemented requirement has no code path or test. Several requirements still have no test (listed in the matrix). | ADR-D46 |

### 6.7 Compliance

| ID | Requirement (PRD text, unchanged) | Target (PRD) | Status | Evidence | What exists, or what is missing | ADR / OCI |
|---|---|---|---|---|---|---|
| NFR-COMP-01 | Standards: FHIR R4 4.0.1; NRCeS IG 6.5.0; SNOMED CT under NRCeS affiliate licence | Validator in CI | Partial | Automated test or check | FHIR R4 and NRCeS 6.5.0 validated in CI on golden examples. The SNOMED CT licence is not held (OCI-002). | ADR-D40, OCI-002 |
| NFR-COMP-02 | Supply chain: SBOM listing every dependency, model, dataset and licence | Generated in CI | Implemented | Automated test or check | scripts/sbom.mjs writes docs/SBOM.md and CI has an sbom job; licences marked unknown are listed as such. | - |

<!-- END GENERATED:nfr -->

## 7. Success metrics (PRD 14.1) and what has been measured

Every number from the current data is a protocol demonstration: one speaker, acted text, no real patients (`docs/EVALUATION_PLAN.md`). No metric target is claimed as met.

<!-- BEGIN GENERATED:metrics -->

| ID | Metric | Target (PRD) | Measured? | Note |
|---|---|---|---|---|
| M-01 | ASR WER / CER | Report vs Vistaar general-domain Gujarati range (17.8–33.2% WER) | One clip only | Strict WER 42.6% on one 62.6 s clip by one speaker with Sarvam (docs/ASR.md). A protocol demonstration, not a result. |
| M-02 | Medicine-name accuracy | ≥ 90% with keyterm biasing | No | Code and 11 acted texts exist; no gold medicine mentions yet (docs/EVALUATION_PLAN.md). |
| M-03 | Fact extraction P/R/F1 | ≥ 0.85 F1 (negation F1 reported separately) | Small acted/synthetic set only | The extraction evaluation ran on 13 small acted or synthetic cases with first-draft gold labels (docs/EXTRACTION_EVAL_GUIDE.md). Not a result about real consultations. |
| M-04 | Hallucination rate | ≤ 2% | Small acted/synthetic set only | Counted by the grounding step on the same small set. |
| M-05 | Pathway top-1 / top-3 accuracy | ≥ 65% / ≥ 85% | Toy pathways only | No real pathways exist (OCI-019). |
| M-06 | Questions to reach top-3 | ≤ 6 | Toy pathways only | As M-05. |
| M-07 | Hybrid gain | Hybrid best or equal-best on both | No | The LLM-only and hybrid question engines are not built. |
| M-08 | Red-flag recall | 100% on seeded set | Toy red-flag cases only | Needs a clinician's red-flag list (OCI-018). |
| M-09 | Safety recall | 100% (target); every miss is a bug | No | The safety engine is not built. |
| M-10 | Safety precision | Report (no hard target) | No | Needs the safety engine and a clinician reviewer. |
| M-11 | FHIR validity | 100% | Golden fixtures only | The validator runs in CI on golden and broken examples; no signed real visits. |
| M-12 | Time to signed record | Lower than manual-typing baseline on the same cases | No | Needs timed trials with doctors. |
| M-13 | Doctor usability | SUS ≥ 70 [Assumption] | No | Needs 5 to 10 doctor testers; scoring code only. |
| M-14 | Suggestion acceptance | Report | No | Needs suggestions (Phase 7) and real use. |
| M-15 | ABHA sandbox | Works end to end | No | Mock flow only; the ABDM sandbox is not applied for. |
| M-16 | WhatsApp summary | ≥ 95% delivered | No | Mock sender only; no Meta account or template. |
| M-17 | Benchmark release | Done by viva | Drafts only | Drafts in bench/drafts/, legal and ethical text to be checked by my guide / institution. |

<!-- END GENERATED:metrics -->

## 8. Open clinical items

Content the software must not invent. Each row has an owner action and the place in the code that holds the `TODO(source)`; the full list is `docs/OPEN_CLINICAL_ITEMS.md` and the owner's task list is `docs/OWNER_ACTIONS.md`.

<!-- BEGIN GENERATED:oci -->

| ID | Open item (first sentence; the full text and the owner action are in docs/OPEN_CLINICAL_ITEMS.md) |
|---|---|
| OCI-001 | Route of administration for every medicine row. |
| OCI-002 | SNOMED CT and ATC codes. |
| OCI-003 | Clinician review of every imported medicine row. |
| OCI-004 | NLEM rows that needed a manual check against the PDF. |
| OCI-005 | Medicine count. |
| OCI-006 | Healthcare level (P / S / T) for rows whose cell carries more than one level. |
| OCI-007 | Gujarati spellings of medicine names for search (FR-F5-03). |
| OCI-008 | Prefix lines in dose-form lists ("Modified Release -", "Conventional/Effervescent/ Dispersible/ Enteric coated", "Soluble/ liquid polyvalent -") were mishandled by the first importer (7 items). |
| OCI-009 | Restriction notes inside a medicine row (for example Mefloquine 6.10.2.2: |
| OCI-010 | Naming of the iron rows of item 8.1.2. |
| OCI-011 | Snake Venom Antiserum appears under 4.2.10 ("As licensed") and 19.2.7 ("As Licensed", same wording, different capital). |
| OCI-012 | Footnote markers whose text is not printed on the same PDF page (Lactulose 7.4.8, Amphotericin B 6.5.1): |
| OCI-013 | Gujarati labels for the five dose-frequency codes (once daily, twice daily, three times daily, four times daily, as needed). |
| OCI-014 | Whether the controlled frequency list (OD, BD, TDS, QID, SOS) is complete and correct for the clinic. |
| OCI-015 | The starter speech-recognition keyterm list (50 words) was made by a mechanical rule from the NLEM generic names (the 50 most common first words, rule version 1 in `app/keyterm_starter.py`), NOT by... |
| OCI-016 | Withdrawal rule for transcripts (ADR-D28). |
| OCI-017 | The concept word list for entity linking (FR-F3-04). |
| OCI-018 | The red-flag list. |
| OCI-019 | The REAL pathways. |
| OCI-020 | The withdrawal rule for pathway data. |
| OCI-021 | Engine parameters. |

<!-- END GENERATED:oci -->

## Appendix A. How this document and the matrix are produced

1. `scripts/srs-lib.mjs` reads the requirement IDs and texts from the PRD. `docs/srs-status.json` holds, for each ID, the status, the reason, ADR and OCI references, the code paths and the tests.
2. `npm run srs` rewrites the generated regions of this file; `npm run trace` writes `docs/TRACEABILITY.md`. Both fail when an ID is missing from or unknown to the status file; `trace` also fails when a listed path does not exist or a requirement marked Implemented has no code path or no test (self-test: `scripts/trace.test.mjs`, run by `npm run check`).
3. `npm run test:results` records the latest results in `results/tests/` (not committed); the matrix reads them.
4. A passing check shows that a test exists and runs; it does not prove the test covers every word of the requirement. That judgement is the Status and Why columns, made by hand.

## Appendix B. Regulatory and ethics statements (our reading, to be checked by my guide / institution)

- The PRD positions VaaniEHR as software that **informs** a registered practitioner and does not diagnose, which it connects to the CDSCO medical-device-software guidance (PRD 1.6 and 13). The PRD marks its source for that guidance as a secondary summary. Whether the guidance applies to a research prototype, and at which class, is **not decided here**.
- The PRD cites the DPDP Act 2023 and its Rules for notice, consent, withdrawal and erasure. The software implements notice, three consent scopes, withdrawal and an erasure-request queue; whether a signed clinical record must be kept after an erasure request is **open (OCI-016)** and the software keeps the signed record and removes the rest until told otherwise (ADR-D45).
- The consent notice text (version 0.1) is a **placeholder**; its legal sufficiency and its Gujarati wording are unreviewed.
- Ethics or faculty approval for recording acted consultations is an institutional step that this repository cannot show (assumption A4).
- Nothing in this repository is legal advice.

## Appendix C. Document map

See `docs/DOC_INDEX.md` for every document in `docs/` with one line each.
