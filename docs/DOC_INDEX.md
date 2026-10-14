# DOC_INDEX.md - documents in `VaaniEHR/DOCUMENTS` (Phase 0.3)

**Generated** by `npm run docs:index` (`scripts/build_doc_index.py`, template `docs/templates/DOC_INDEX.template.md`). Sections 2 and 3.0-3.1/3.3 are extracted by script from `DOCUMENTS/VaaniEHR_PRD.md` (**PRD v1.1**, ADR-D15), so requirement text is exact. Edit the template, not this file.
Numbering: the PRD's own open decisions are **PRD-D1..PRD-D7** (§16.2); our architecture decisions are **ADR-D1..ADR-D16** (`DECISIONS.md`).

## 1. Files

| File | What it is | Key facts relied on | Version / date |
|---|---|---|---|
| `VaaniEHR_PRD.md` | **The PRD, v1.1 - source of truth (ADR-D15).** 18 sections + Appendix F changelog | Voice-assisted, guideline-grounded, ABDM-ready consultation module for a general-medicine OPD; research prototype, acted/simulated data only, not for clinical use (§1.6). ClinicOS facts are code-verified (§3.5, §9.4); VaaniEHR has its own PostgreSQL 16 + pgvector and talks to ClinicOS over REST only; `AuthProvider` seam; VaaniEHR-owned side tables (§8.2). Stack §11, build-vs-reuse §12, delivery plan §15, build brief §17 | v1.1, 14 Oct 2026, reconciled with the code audit; status "Phase 0 complete; building" |
| `archive/VaaniEHR_PRD_v1.0.md` (+ `.docx`) | Superseded PRD v1.0 | Kept for traceability; `PRD_ERRATA.md` rows refer to its line numbers | v1.0, 14 Oct 2026 |
| `VaaniEHR_Phase_Plan_and_AI_Prompts.md` (+ `.docx`) | Phase-wise build plan (Phases 0-13) with prompts, recovery prompts, checklists | Phase map, goals, exit criteria (copied to `PHASES.md`). **Not updated for v1.1/ADRs**: where it conflicts, ADRs and the PRD win | v1.0, 14 Oct 2026 |
| `compass_artifact_wf-34413097-...text_markdown.md` | Research dossier, SRS inputs and an early PRD (Build-vs-Reuse edition), 84 sources | Build only M3, M4, benchmark; reuse the rest; licence traps; regulatory framing; accounts to apply for. Not updated for the ClinicOS audit | dossier dated 14 Oct 2026 |
| `Researchdoc.pdf` | 14-page "Print to PDF" of the dossier | **No text layer** (image-only); pages 1 and 14 viewed and match; ends at "Caveats", no Sources list; pages 2-13 not viewed. Use the `.md` | 2026-10-14 |

Other docs already in `docs/`: `AGENTS.md` (repo root), `CONTEXT.md`, `PHASES.md`, `DECISIONS.md`, `SKILLS.md`, `CLINICOS_AUDIT.md`, `CLINICOS_INTEGRATION_FACTS.md`, `PRD_ERRATA.md`, `SBOM.md` (generated), `OPEN_CLINICAL_ITEMS.md`. The five ClinicOS documents stay in `AWT-Project/Documents` (ClinicOS is read-only).

## 2. Requirements digest (copied exactly from PRD v1.1)

### 2.1 Features F1-F15 (priority from each heading; summary table is PRD §5.1)

- F1 — Consent gate (M2/M5) — **P0**
- F2 — Streaming code-switched speech recognition (M2) — **P0**
- F3 — Fact extraction with negation and evidence (M2/M3) — **P0**
- F4 — Guideline-based guided questions (M3) — **P0** *(core novelty)*
- F5 — Medicine library and templates (M1) — **P0**
- F6 — Suggestions with safety checks (M4) — **P0** *(core novelty)*
- F7 — Doctor sign-off and audit (M5) — **P0**
- F8 — FHIR record builder and validator (M6) — **P0**
- F9 — ABHA verification (M6) — **P1**
- F10 — Gujarati WhatsApp summary (M7) — **P1**
- F11 — Prescription templates UI (M1) — **P1** (see FR-F5-04)
- F12 — Evaluation console (research) — **P1**
- F13 — ClinicOS integration (M8) — **P1**
- F14 — HIP care-context linking (M2 in ABDM terms) — **P2**
- F15 — Prescription PDF — **P2**

PRD §5.1 priority summary:
- **P0**: F1 consent, F2 ASR, F3 extraction, F4 guided questions, F5 medicine DB, F6 suggestions + safety, F7 sign-off + audit, F8 FHIR
- **P1**: F9 ABHA, F10 WhatsApp, F11 templates UI, F12 evaluation console, F13 ClinicOS link
- **P2**: F14 care-context linking, F15 PDF, patient pre-visit questionnaire, offline mode

(PRD F-numbers are VaaniEHR's. ClinicOS documents use their own F1-F25 with different meanings, e.g. ClinicOS F5 = one-tap controls. Always write "VaaniEHR F5" or "FR-F5-xx".)

### 2.2 Functional requirements FR-*

| ID | Requirement |
|---|---|
| FR-F1-01 | The "Record" button is disabled until a consent record exists with scope `audio` and scope `ai_processing` for this session. |
| FR-F1-02 | Consent text is shown in Gujarati and English, versioned (`notice_version`), with timestamp and source (staff / patient). |
| FR-F1-03 | WhatsApp sending needs a separate `whatsapp` consent scope. |
| FR-F1-04 | Withdrawal is possible at any time; withdrawing stops recording and marks audio for deletion. |
| FR-F1-05 | Every consent event is written to the append-only consent log and audit log. |
| FR-F2-01 | Browser captures microphone audio (MediaRecorder/AudioWorklet), sends 250–500 ms chunks over WebSocket (Socket.IO library, as in ClinicOS, but a **separate authenticated namespace**; ADR-D10) to the Python ASR service. |
| FR-F2-02 | Voice-activity detection (Silero VAD) trims silence before ASR. |
| FR-F2-03 | Primary ASR is Sarvam Saaras V4 in code-mix mode with up to 50 NLEM medicine names as biasing keyterms **[Source: MarkTechPost summary; verify on Sarvam docs]**. |
| FR-F2-04 | Baseline ASR (IndicConformer-600M and/or faster-whisper) is selectable for evaluation runs. |
| FR-F2-05 | Speaker turns labelled `doctor` / `patient` (Sarvam diarization or pyannote). |
| FR-F2-06 | Transcript is editable by the doctor; every edit is stored (original + edited). |
| FR-F2-07 | Each segment stores start/end time, speaker, text, language tags, ASR engine and version, and confidence if available. |
| FR-F3-01 | An LLM, constrained to a JSON schema (Instructor + Pydantic), extracts: symptoms, duration, severity, vitals mentioned, allergies, past conditions, current medicines, red-flag mentions. |
| FR-F3-02 | Every fact carries `negated` (true/false), `uncertain` (true/false), `source_span` (transcript segment ID + character offsets) and a SNOMED concept ID where mapping succeeds. |
| FR-F3-03 | A fact with no valid `source_span` is rejected as ungrounded (this defines the **hallucination** metric). |
| FR-F3-04 | Entity linking uses Parrotlet-e embeddings against the licensed SNOMED subset; unmapped facts stay as free text and are shown in grey. |
| FR-F3-05 | Doctor can add, edit, delete or confirm each fact. Confirmed facts feed M3/M4; unconfirmed facts are shown as "heard" only. |
| FR-F4-01 | Each supported condition is a versioned **pathway** (graph of question nodes, answer types, edges, red-flag terminals) hand-encoded from an ICMR STW and reviewed by a clinician. |
| FR-F4-02 | The engine keeps a shortlist of candidate conditions with scores, updated after each confirmed fact. |
| FR-F4-03 | Next question = unanswered node with highest expected information gain, **but red-flag questions always come first** when any red-flag-compatible symptom is present. |
| FR-F4-04 | Questions are shown **to the doctor** as suggestions with the STW node and one-line reason ("asks because: fever > 5 days → rule out typhoid/dengue"). |
| FR-F4-05 | The LLM only (a) maps utterances to answer slots, and (b) phrases the suggested question in Gujarati/Hindi/English. The rules choose *which* question. |
| FR-F4-06 | The engine abstains (shows "need more information") when no candidate exceeds a confidence threshold, instead of forcing a guess. |
| FR-F4-07 | A cap on questions (default 8) prevents endless prompting. |
| FR-F4-08 | The doctor can dismiss a question; dismissals and the doctor's real questions are logged for evaluation. |
| FR-F4-09 | Output: ranked shortlist (top-3) with evidence for and against, each linked to its STW node. No "final diagnosis" wording anywhere in the UI. |
| FR-F5-01 | `medicine_master` is seeded from NLEM 2022 (**384 medicines** per the committee list; the committee report text also says 386, so use 384 and note it) with generic name, strength, dose form, route, therapeutic category, SNOMED code (after the licence arrives) and source. |
| FR-F5-02 | **Generic-first**: search and display show generic name; brand names are optional children (`medicine_brand`). |
| FR-F5-03 | Autocomplete by generic or brand, in English and Gujarati transliteration. |
| FR-F5-04 | Prescription templates (personal or clinic-wide) hold medicine items with default dose, frequency, duration and instructions; the doctor can load, edit and save templates (extends ClinicOS F20). |
| FR-F5-05 | Every medicine row stores its data source and last-reviewed date. |
| FR-F6-01 | Suggestions come from the first-line options in the matched pathway (STW), mapped to NLEM medicines. They appear only after the doctor confirms a working condition. |
| FR-F6-02 | Each suggestion shows the reason, the STW source, dose range and a safety status: 🟢 clear, 🟠 acknowledge, 🔴 blocked until override. |
| FR-F6-03 | Checks run on every add/edit: (1) allergy and cross-reactivity, (2) maximum daily dose, (3) duplicate drug class, (4) major drug–drug interaction, (5) red-flag/out-of-scope stop (pregnancy, age under 18, emergency features). |
| FR-F6-04 | A 🔴 alert can be overridden only with a typed reason; the override is logged. |
| FR-F6-05 | When a red flag is active, **medicine suggestions are suppressed** and a refer/urgent banner is shown; the doctor must acknowledge it. |
| FR-F6-06 | Nothing is written to the final record until sign-off (F7). |
| FR-F7-01 | The sign-off page shows a diff between AI-proposed content and the doctor's final content. |
| FR-F7-02 | Signing requires all 🔴 alerts resolved or overridden with reason, and all unconfirmed facts either confirmed or dropped. |
| FR-F7-03 | On sign: VaaniEHR visit-record status `draft → signed`; the record becomes immutable except via a logged amendment with reason. This state lives in VaaniEHR because ClinicOS has only `isComplete`; ClinicOS receives content only after sign-off (ADR-D11). |
| FR-F7-04 | Audit log entries (append-only, hash-chained) for: consent, record start/stop, transcript edits, fact edits, suggestion accept/reject, override, sign, amendment, FHIR generation, WhatsApp send. |
| FR-F8-01 | On sign, build a FHIR R4 (4.0.1) Bundle conforming to NRCeS IG for ABDM **v6.5.0** (OPConsultRecord, with PrescriptionRecord content). |
| FR-F8-02 | Validate with the HL7 validator against the `ndhm.in` package before storing; store the validation output with the bundle. |
| FR-F8-03 | If validation fails, the visit stays signed (clinical record is safe) but the bundle is marked `invalid` with errors shown to the admin; no export. |
| FR-F8-04 | Medicines use SNOMED CT codes (NRCeS/CDCI) in `MedicationRequest`; diagnosis in `Condition`; vitals in `Observation`; allergies in `AllergyIntolerance`. |
| FR-F8-05 | Validator runs in CI against a fixed set of golden examples. |
| FR-F9-01 | Staff can verify an ABHA number/address in the ABDM **V3 sandbox** using OTP flow; status stored on the patient. |
| FR-F9-02 | Aadhaar and OTP values are RSA-encrypted before sending, per ABDM requirements **[Unverified — practitioner sources]**. |
| FR-F9-03 | No real Aadhaar or ABHA data is used; only sandbox test identities. |
| FR-F10-01 | After sign-off and with `whatsapp` consent, generate a plain-language Gujarati summary: what the doctor found, medicines with timing, warning signs, follow-up. |
| FR-F10-02 | The Gujarati text is generated from the **signed** record only and shown to the doctor for approval before sending. |
| FR-F10-03 | Send through the WhatsApp Cloud API with an approved Gujarati (`gu`) utility template; the exact message sent is stored. |
| FR-F10-04 | Never send before sign-off. Use test numbers only during the project. |
| FR-F12-01 | Upload acted audio with gold labels (transcript, facts, question path, prescription). |
| FR-F12-02 | Run the same case through three pipelines: rules-only, LLM-only, hybrid. |
| FR-F12-03 | Compute and display the metrics in §14; export CSV for the paper. |
| FR-F12-04 | Store engine versions and prompts for every run (reproducibility). |
| FR-F13-01 | A single documented REST contract (§9.4) using the **real** ClinicOS endpoints: read patient and visit history; after VaaniEHR sign-off, write the visit with the doctor's own token (create, autosave, complete). Allergies come from VaaniEHR, not ClinicOS. |
| FR-F13-02 | VaaniEHR runs standalone with a mock ClinicOS adapter that **mirrors the verified ClinicOS response shapes** (e.g. lookup returns HTTP 200 `{found:false}`, `/me` includes `status`). Contract tests run against it. |
| FR-F13-03 | `ClinicOSTokenAuth` validates the user's ClinicOS bearer token via `GET /api/auth/me`, caches the result briefly, and rejects any user whose `status` is not `approved` (ClinicOS `/me` and login do not check status). The ClinicOS `JWT_SECRET` is never shared. |
| FR-F13-04 | Every ClinicOS write is preceded by a VaaniEHR sign-off check and followed by a VaaniEHR audit entry. Completing a ClinicOS visit also marks its token `served` and recalculates the queue; the integration must expect and test this side effect. |

### 2.3 Pages PG-01..PG-20 (PRD §4)

| ID | Page | Route | Roles | Purpose | Key components | Pri |
|---|---|---|---|---|---|---|
| PG-01 | Login | `/login` | all | Authenticate via the configured `AuthProvider` (dev provider now; ClinicOS token in Phase 12) | Email/password, role redirect (no OTP at login in ClinicOS) | P0 |
| PG-02 | Doctor dashboard | `/doctor` | doctor | Today's tokens, drafts awaiting sign-off, quick start | Token list, "Start consultation", draft counter | P0 |
| PG-03 | Patient lookup / register | `/patients` | staff, admin | Phone lookup, quick-create | Phone box, patient card, allergy chips | P0 |
| PG-04 | ABHA verification | `/patients/:id/abha` | staff, admin | Verify or link ABHA (sandbox) | ABHA number/address input, OTP step, status badge | P1 |
| PG-05 | Consent capture | `/consult/:sessionId/consent` | staff, doctor | Record consent for audio, AI processing, WhatsApp | Gujarati/English notice, toggles, e-signature or tick + timestamp, withdraw link | P0 |
| PG-06 | **Consultation workspace** | `/consult/:sessionId` | doctor | The core screen | Record bar + waveform, live transcript, facts panel, question panel, red-flag banner, patient history sidebar | P0 |
| PG-07 | Diagnosis review | `/consult/:sessionId/diagnosis` (also a panel in PG-06) | doctor | Top-3 shortlist with guideline citations | Candidate list, evidence chips, STW node link, "not listed" free entry | P0 |
| PG-08 | Prescription builder | `/consult/:sessionId/rx` (also a panel) | doctor | Choose and edit medicines | NLEM autocomplete (generic-first), dose/frequency/duration, template loader, inline safety alerts | P0 |
| PG-09 | Review and sign-off | `/consult/:sessionId/sign` | doctor | Final review; diff of AI vs doctor edits; sign | Side-by-side diff, unresolved-alert list, sign button | P0 |
| PG-10 | Visit record / FHIR viewer | `/visits/:id` | doctor, admin, researcher | See signed record and bundle | Structured view, FHIR JSON tab, validator result | P0 |
| PG-11 | Patient summary + WhatsApp log | `/visits/:id/summary` | doctor, staff | Preview and send Gujarati summary | Gujarati preview, send status, delivery log | P1 |
| PG-12 | Medicine master admin | `/admin/medicines` | admin | CRUD medicines, SNOMED codes, brands | Table, import CSV, source column | P0 |
| PG-13 | Prescription template admin | `/admin/templates` | admin, doctor | Create/edit templates | Template builder, visibility (personal/clinic) | P1 |
| PG-14 | Guideline pathway admin | `/admin/pathways` | admin | View/edit versioned STW decision trees | Graph/table editor, JSON import, version diff, clinical-reviewer sign-off field | P1 |
| PG-15 | Safety rules admin | `/admin/safety` | admin | Max-dose, allergy-class, interaction tables | Rule tables with source citation, test button | P1 |
| PG-16 | Audit log | `/admin/audit` | admin, researcher | Immutable action history | Filters, CSV export, hash-chain status | P1 |
| PG-17 | Evaluation console | `/research/eval` | researcher, admin | Upload acted audio and gold labels, run baselines, view metrics | Dataset upload, run config (rules-only / LLM-only / hybrid), metrics dashboard, error browser | P1 |
| PG-18 | Settings and About | `/settings` | all | Language, API status, intended-use statement, licences/SBOM | Intended-use text, third-party licence list | P1 |
| PG-19 | Error pages | `/404`, `/500` | all | — | — | P0 |
| PG-20 | Consent withdrawal / data erasure request | `/privacy/request` | staff, admin | Handle DPDP-style requests for acted participants | Request form, status | P2 |

### 2.4 Non-functional requirements (PRD §10)

| ID | Category | Requirement | Target |
|---|---|---|---|
| NFR-PERF-01 | Latency | First partial transcript after speech starts | ≤ 3 s (95th percentile) [Assumption] |
| NFR-PERF-02 | Latency | Next-question suggestion after a confirmed fact | ≤ 1.5 s (rules) / ≤ 4 s (with LLM phrasing) |
| NFR-PERF-03 | Latency | Safety re-check after prescription edit | ≤ 500 ms |
| NFR-PERF-04 | Latency | FHIR build + validate | ≤ 10 s |
| NFR-SEC-01 | Auth | Every endpoint and socket connection authenticated through `AuthProvider` and RBAC-enforced. Standalone mode: VaaniEHR-signed short-lived access token (about 1 h), no refresh token. Integrated mode: ClinicOS token validated via `/api/auth/me`; `JWT_SECRET` never shared | 100% |
| NFR-SEC-02 | Transport | TLS everywhere | TLS 1.2+ (1.3 preferred) |
| NFR-SEC-03 | At rest | Audio and PHI encrypted at rest | AES-256 |
| NFR-SEC-04 | Secrets | No keys in code; env/secret manager | Enforced in CI (secret scan) |
| NFR-SEC-05 | LLM safety | Treat transcript text as untrusted: schema-constrained output, no tool access, strip instructions; test OWASP LLM Top 10 items (prompt injection, sensitive info disclosure, improper output handling, excessive agency) | Test report |
| NFR-SEC-06 | Web | OWASP ASVS L1 checklist (L2 where time allows); STRIDE threat model | Document in SRS |
| NFR-PRIV-01 | Retention | Audio deleted after evaluation window | Default 90 days [Assumption] |
| NFR-PRIV-02 | Data | Acted/simulated data only; real-data guard | Banner + config flag |
| NFR-PRIV-03 | Third parties | LLM and ASR vendors configured for no training on data | Record in SBOM |
| NFR-REL-01 | Integrity | Audit log append-only, hash-chained | Verified by a script |
| NFR-REL-02 | Degradation | If ASR or LLM is down, doctor can type notes and continue | Manual path always available |
| NFR-REL-03 | Safety | If safety engine fails, prescription cannot be signed | Fail closed |
| NFR-UX-01 | Accessibility | WCAG 2.1 AA on core pages | Audit report |
| NFR-UX-02 | i18n | UI strings and patient text in English + Gujarati; Hindi labels where feasible | i18next |
| NFR-UX-03 | Device | Laptop-first; tablet usable | Responsive |
| NFR-MAINT-01 | Quality | Unit tests (Jest, PyTest); API tests; CI on every push | Coverage target 70% core modules [Assumption] |
| NFR-MAINT-02 | Traceability | Every FR has at least one test | Traceability matrix |
| NFR-COMP-01 | Standards | FHIR R4 4.0.1; NRCeS IG 6.5.0; SNOMED CT under NRCeS affiliate licence | Validator in CI |
| NFR-COMP-02 | Supply chain | SBOM listing every dependency, model, dataset and licence | Generated in CI |

### 2.5 Metrics M-01..M-17 (PRD §14.1)

| # | Metric | Definition | Target | Measured by |
|---|---|---|---|---|
| M-01 | ASR WER / CER | Word/character error rate on Gujarati–Hindi–English code-switched clips; report per engine, per language, per speaker role | Report vs Vistaar general-domain Gujarati range (17.8–33.2% WER) | jiwer on gold transcripts |
| M-02 | Medicine-name accuracy | % of spoken medicine mentions transcribed and normalised to the correct NLEM generic | ≥ 90% with keyterm biasing | Scripted checks |
| M-03 | Fact extraction P/R/F1 | Against gold facts, negation-aware | ≥ 0.85 F1 (negation F1 reported separately) | Eval console |
| M-04 | Hallucination rate | % extracted facts with no supporting transcript span | ≤ 2% | Span check (FR-F3-03) |
| M-05 | Pathway top-1 / top-3 accuracy | Correct condition in first / top three | ≥ 65% / ≥ 85% | Gold differentials |
| M-06 | Questions to reach top-3 | Median number of questions asked before target confidence | ≤ 6 | Question log |
| M-07 | Hybrid gain | Hybrid vs rules-only and vs LLM-only on M-05 and M-06 | Hybrid best or equal-best on both | Ablation table |
| M-08 | Red-flag recall | % red-flag cases correctly stopped | 100% on seeded set | Seeded suite |
| M-09 | Safety recall | % seeded unsafe prescriptions flagged | 100% (target); every miss is a bug | ≥ 50-case suite |
| M-10 | Safety precision | % raised alerts judged appropriate by the clinician reviewer | Report (no hard target) | Reviewer sheet |
| M-11 | FHIR validity | % signed visits that validate with 0 errors against NRCeS IG 6.5.0 | 100% | Validator in CI |
| M-12 | Time to signed record | Seconds from end of consultation to sign | Lower than manual-typing baseline on the same cases | Timed trials |
| M-13 | Doctor usability | System Usability Scale (SUS) and NASA-TLX from 5–10 doctor testers | SUS ≥ 70 [Assumption] | Questionnaire |
| M-14 | Suggestion acceptance | % suggestions accepted/edited/rejected, and whether showing the guideline source raises appropriate acceptance | Report | Logs |
| M-15 | ABHA sandbox | Verify flow succeeds on sandbox test identities | Works end to end | Demo script |
| M-16 | WhatsApp summary | Doctor-approved Gujarati summaries delivered to test numbers | ≥ 95% delivered | Delivery logs |
| M-17 | Benchmark release | Dataset card, scripts, licence and consent forms published | Done by viva | Checklist |

### 2.6 Goals, risks, open decisions (PRD §1.4, §16)
**Goals (§1.4)**

| ID | Goal | How we will know |
|---|---|---|
| G1 | Reduce the doctor's documentation effort per visit | Time-to-signed-record vs. a manual-typing baseline (§14) |
| G2 | Never let an unsafe suggestion pass silently | 100% of seeded unsafe test cases are flagged; 0 unsafe items signed without an override reason |
| G3 | Produce a valid government-format record for every signed visit | 100% of signed visits pass the HL7 validator against NRCeS IG 6.5.0 with 0 errors |
| G4 | Prove the guided-question idea works | Hybrid engine beats rules-only and LLM-only baselines on top-3 accuracy and questions asked |
| G5 | Publish a reusable benchmark | Dataset card + evaluation scripts released; paper draft ready for the viva |
| G6 | Be integration-ready | One documented REST contract that ClinicOS can call without schema changes beyond those listed in §8.4 |

**Risks (§16.1)**

| ID | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | ABDM sandbox access delayed or V3 endpoints unstable | High | Medium | Apply week 1; M1 only; keep M2 stretch; use Postman collection and recorded responses |
| R2 | Gujarati medical ASR much worse than expected | Medium | High | Report honestly (that is a finding); keyterm biasing; engine comparison; allow doctor transcript edits |
| R3 | LLM hallucination or prompt injection from transcript text | Medium | High | Schema-constrained output, span-grounding, no tool access, tests for OWASP LLM items |
| R4 | Clinical content errors in pathways/rules | Medium | High | Clinician review, cite sources per row, regression suite, "research prototype" labelling |
| R5 | Licence conflict (DDInter, Parrotlet-e, SNOMED, scraped brand data) | Medium | Medium | SBOM; keep non-commercial; swap sources before any commercialisation |
| R6 | Competitor (Eka) adds question suggestions | Medium | Medium | Claim method + benchmark, not "first" |
| R7 | Scope creep (ClinicOS features, extra conditions) | High | High | Fixed 5-condition scope; cut order in §15 |
| R8 | Ethics approval slow | Medium | High | Start week 1; fall back to TTS-generated audio from scripts |
| R9 | Real-data leakage to third-party APIs | Low | Very high | Acted data only; banner; config guard; vendor no-training settings |
| R10 | API cost overruns | Low | Low | Budget cap; cache; batch evaluation runs |
| R11 | Vendor/model change mid-project (new model version) | Medium | Medium | Pin versions used in evaluation; store engine version per segment |

**Open decisions (§16.2) - PRD-D1..PRD-D7**

| ID | Decision | Options | Recommendation |
|---|---|---|---|
| D1 | Database | **Closed.** ClinicOS is MySQL (code-verified). VaaniEHR uses its own PostgreSQL 16 + pgvector (ADR-D1) | — |
| D2 | Real ClinicOS build status | **Closed.** See §3.5 (ADR-D2) | — |
| D3 | Final five conditions | From STW volumes | Choose with the faculty guide and the clinician reviewer |
| D4 | LLM provider | Hosted API vs local model | Hosted API with no-training setting |
| D5 | Patient pre-visit questionnaire | In v1 or stretch | Stretch |
| D6 | Dataset licence | CC-BY vs more restricted | CC-BY if actors consent |
| D7 | Paper venue | Health-informatics workshop / COMPASS / INDICON / arXiv first | Decide by Review-II |

## 3. Conflicts and gaps

### 3.0 Changes from PRD v1.0 to v1.1 by requirement ID (script: `scripts/prd_id_diff.py`)

| ID family | v1.0 | v1.1 | Added | Removed | Reworded |
|---|---|---|---|---|---|
| F (feature headings) | 15 | 15 | - | - | - |
| FR (functional requirements) | 59 | 61 | FR-F13-03, FR-F13-04 | - | FR-F13-01, FR-F13-02, FR-F2-01, FR-F7-03 |
| PG (pages) | 20 | 20 | - | - | PG-01 |
| NFR (non-functional) | 23 | 23 | - | - | NFR-SEC-01 |
| M (metrics) | 17 | 17 | - | - | - |
| G (goals) | 6 | 6 | - | - | - |
| R (risks) | 11 | 11 | - | - | - |
| PRD-D (open decisions) | 7 | 7 | - | - | D1, D2 |

### 3.1 ClinicOS-related contradictions: status of `PRD_ERRATA.md` under v1.1

`PRD_ERRATA.md` has 29 rows: **26 applied in PRD v1.1**, 1 needing no change, **2 partly covered / not yet covered**.

- **Row 28**: **PARTLY covered** - data model applied (§3.5, §8.3: no age, dob may be null); **NOT covered**: FR-F6-03(5) and §7.2 still say only 'Age < 18' with no rule for unknown age
- **Row 29**: **PARTLY covered** - exposure documented (§9.4 'Read history'); **NOT covered**: no adapter rule to drop/ignore ClinicOS `notes` or to never write VaaniEHR content into it

### 3.2 Conflicts between the VaaniEHR documents themselves

| # | Conflict | Where | Status under PRD v1.1 / handling |
|---|---|---|---|
| C1 | NLEM count 384 vs 386 | FR-F5-01; dossier §4 | **Open** (v1.1 keeps "use 384 and note it"). The import must report the number actually extracted |
| C2 | EkaScribe and Gujarati | PRD §1.3/§1.7 "supports Gujarati"; dossier Key Finding 1 says it does not | **Open** (v1.1 App. F lists it). Do not state either claim as fact until checked |
| C3 | Benchmark size vs ASR budget (about 150 cases in §7.3 vs "300 consultations" in §3.4 and dossier) | §7.3, §3.4 | **Open** (v1.1 App. F). Confirm the intended number |
| C4 | Hours: 300-340 stated, §15 table sums to about 350 | §3.4, §15 | Acknowledged in v1.1 (App. F #5) |
| C5 | "M1/M2" used for modules and for ABDM milestones | PRD module tags vs dossier / F14 | **Open** (naming only): write "module M2" vs "ABDM M2"; metrics are "M-01" |
| C6 | Example ID `FR-M3-02` in the header | v1.0 header | **Resolved** in v1.1 (`FR-F4-02`) |
| C7 | PRD-D vs ADR-D numbering | PRD §16.2 | Handled: v1.1 §16.2 lists the ADRs; this repo writes PRD-D#/ADR-D# |
| C8 | PRD-D3..D7 still open (final five conditions, LLM provider, questionnaire, dataset licence, paper venue); PRD-D1, PRD-D2 closed | PRD §16.2 | **Open** except D1/D2 |
| C9 | "JWT with refresh" vs ClinicOS has no refresh | NFR-SEC-01 | **Resolved** in v1.1 (AuthProvider; no refresh in standalone mode) |
| C10 | OWASP LLM Top 10 edition (2025 vs 2026 list) and ASVS level (L1 vs L2) | NFR-SEC-05/06 vs dossier | **Open**; decide before Phase 12 |
| C11 | Safety test-suite size: PRD >= 50, plan "30+" | §7.2/M-09 vs plan 7.1 | **Resolved** in the PRD (v1.1 App. F: floor 50); the plan text is still wrong (see `PHASES.md`) |
| C12 | Plan Phase 2 copies ClinicOS columns and "JWT claims identical to ClinicOS" | Phase Plan 2.1 | **Open in the plan** (ADR-D4/D11 and PRD v1.1 supersede); see `PHASES.md` |
| C13 | Plan assumes sibling folders and `Documents/` | Phase Plan 0.1 | Real layout in `AGENTS.md` |
| C14 | Dossier says ClinicOS audit is hash-chained | Dossier (a) | **Open in the dossier**; PRD v1.1 states ClinicOS audit is append-only by convention only |
| C15 | `Researchdoc.pdf` vs markdown dossier | PDF | Printout without Sources; use the `.md` |
| C16 | Plan Phase 0 says DECISIONS D1/D2 "OPEN" | Phase Plan 0.3 | Resolved (ADR-D1, ADR-D2) |

### 3.3 Items the PRD itself marks [Assumption] or [Unverified] (PRD v1.1 line numbers)
- l.19: - **[Assumption]** = a decision or number proposed by this PRD that you must confirm.
- l.20: - **[Unverified]** = reported by a secondary source and not yet confirmed first-hand. Re-check before presenting it as fact.
- l.159: - [Assumption] Candidate set: acute fever (undifferentiated), acute respiratory infection/cough, acute gastroenteritis, hypertension follow-up, urinary tract infection (uncomplicated). **Final list must be chosen from conditions t...
- l.183: - Solo developer, about 20 hours/week for about 16 weeks (**about 300–350 hours**; the earlier "ClinicOS reuse saves about 60 hours" estimate is **[Unverified]**, because the audit found much of the assumed reuse — consent, doctor...
- l.268: *Acceptance:* A 2-minute acted clip produces a first partial transcript within 3 seconds [Assumption] and a final transcript within 10 seconds of stopping.
- l.374: Link signed visits to the patient's ABHA as care contexts. Only attempted after F9 and F8 are stable; some V3 HIP-initiated endpoints were reported as returning 403 in community tests **[Unverified]**.
- l.494: **Parameters [Assumption]:** `k = 3`, `N_max = 8`, `τ_abstain` tuned on development cases, never on test cases.
- l.509: | Duplicate class | Two active items share ATC/therapeutic class | Class from medicine master (ATC licence terms: **[Unverified]**) | 🟠 |
- l.520: | Size | 100 consultations for final evaluation (plus up to 50 for development); about 3–10 minutes each; roughly 50 audio hours at most **[Assumption]** |
- l.526: | Release | Dataset card, consent forms, licence (CC-BY suggested **[Assumption]**), evaluation scripts |
- l.647: | NFR-PERF-01 | Latency | First partial transcript after speech starts | ≤ 3 s (95th percentile) [Assumption] |
- l.657: | NFR-PRIV-01 | Retention | Audio deleted after evaluation window | Default 90 days [Assumption] |
- l.666: | NFR-MAINT-01 | Quality | Unit tests (Jest, PyTest); API tests; CI on every push | Coverage target 70% core modules [Assumption] |
- l.715: > Licence and activity notes come from the research dossier and search snippets. **Re-check each licence on the repository or model card before adopting it.** Items marked [Unverified] were not confirmed first-hand.
- l.746: | pyannote-audio | Diarization alternative | https://github.com/pyannote/pyannote-audio | MIT code; pretrained pipelines may need terms acceptance [Unverified] |
- l.795: | HL7 FHIR validator / core | CI validation | https://github.com/hapifhir/org.hl7.fhir.core | Apache-2.0 [Unverified] |
- l.796: | HAPI FHIR JPA starter | Optional test server | https://github.com/hapifhir/hapi-fhir-jpaserver-starter | Apache-2.0 [Unverified] |
- l.818: | jiwer | WER/CER | https://github.com/jitsi/jiwer [Unverified] |
- l.841: | Prescribing rules | Generic-first by design; do not assert the current legal status of NMC generic-prescribing rules | **[Unverified]** |
- l.850: > Targets below are **proposed hypotheses [Assumption]**, not published benchmarks. Freeze test cases before tuning; tune only on the development set.
- l.868: | M-13 | Doctor usability | System Usability Scale (SUS) and NASA-TLX from 5–10 doctor testers | SUS ≥ 70 [Assumption] | Questionnaire |

### 3.4 Gaps (needed but missing or not yet supplied)
- Final five conditions and the clinician reviewer (PRD §3.1, A3, PRD-D3). Nothing clinical can be encoded without them.
- NLEM 2022 PDF in `data/medicines/raw/`; SNOMED/CDCI release files (licence pending); DDInter export; National Formulary pages / product labels for dose limits.
- ABDM sandbox credentials, Sarvam key, LLM key (+ no-training setting), WhatsApp test number and approved Gujarati template, ethics/faculty approval (PRD §16.3).
- Gujarati wording review by a native speaker (consent notice, UI strings, summary template).
- SRS (companion to the PRD) does not exist yet (Phase 13). No ERD/OpenAPI/diagrams yet (PRD §15 Review-I).
- ICMR STW reuse terms are not stated (PRD §12.4).
- Safety-rule behaviour for **unknown age** and the **ClinicOS `notes` adapter rule** are not in the PRD yet (errata rows 28 and 29).

## 4. Clinical content I must not invent

Everything below needs a cited source supplied by the owner or reviewer. Until then: placeholder `TODO(source)` plus an entry in `OPEN_CLINICAL_ITEMS.md`. Structure, validators and tests (using obviously fake content) are mine to build.

| # | Content | Where the PRD / plan needs it |
|---|---|---|
| 1 | The five conditions and each pathway's question nodes, answer options, edges, `info_weight`, `red_flag_if`, terminal labels and `first_line` drugs (from ICMR STWs) | PRD §3.1, F4, §7.1; Phase 6 |
| 2 | Red-flag lists and emergency/out-of-scope patterns per condition (the PRD's "chest pain with sweating" and pregnancy examples are illustrative only) | F4, F6, §6.2, §7.2 |
| 3 | Question wording in Gujarati, Hindi and English (`ask.en/gu/hi`) and Gujarati/Hindi medical terms | §7.1 pathway sketch, F4, UI strings |
| 4 | Medicine master rows (NLEM 2022): generic name, strength, dose form, route, category; any row the PDF import cannot read cleanly | F5, §8.2; Phase 3 |
| 5 | SNOMED CT / CDCI codes for medicines, findings, vitals, conditions; ATC codes; ICD-10 codes | F3, F5, F8, §8.3 |
| 6 | Max daily doses, "usual" dose thresholds, adult dose ranges (cite National Formulary or label per row) | F6, §7.2, App. A |
| 7 | Allergy classes and cross-reactivity pairs | F6, §7.2 |
| 8 | Drug-drug interaction pairs and severities, therapeutic-duplication classes (DDInter export, non-commercial licence) | F6, §7.2 |
| 9 | "Missing info" rules (renal/hepatic adjustment) and age/pregnancy/lactation thresholds | §7.2 |
| 10 | Frequency code list and daily multipliers (OD/BD/TDS/QID/SOS), Gujarati labels | Phase 3 template builder, safety dose arithmetic |
| 11 | LOINC/SNOMED codes for vitals; FHIR profile specifics: required elements, value sets, profile URLs, IG package hash, ABDM endpoint paths, RSA key handling | F8, F9, §8.3, Phase 9 |
| 12 | Gujarati patient-summary wording: findings, medicine timing, warning signs, follow-up | F10, App. B |
| 13 | Consent notice legal text (audio, AI processing, WhatsApp) and DPDP wording; regulatory class statements | F1, §13 |
| 14 | Acted-consultation scripts, gold transcripts, expected questions/differentials/prescriptions | §7.3, Phase 11 |
| 15 | Seed data: fake patients' allergy lists and medicine names must be clearly fake; demo prescriptions use fake drugs ("Drug-A") | Phase 2, 7 |
| 16 | UI copy that reads as medical advice (refer/urgent banner, "not enough information") | §6.2, F4, F6 |
| 17 | Entity/concept list for Parrotlet-e linking (internal concept IDs until SNOMED licence arrives) | F3, Phase 5 |
