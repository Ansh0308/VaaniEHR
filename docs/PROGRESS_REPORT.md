# PROGRESS_REPORT.md - what is done and what is left (PRD v1.1)

Written 2026-10-22 from the PRD (`DOCUMENTS/VaaniEHR_PRD.md`), the phase plan, the open-item lists and the last full check (web 401, api-node 659, packages/rules 57, asr-py 190; browser end-to-end run 38 steps). Phase 8 Run 1 (below the line at the end) was added after this report.

## Where we stand
- **Phases 0-5 are built:** orientation, foundation and design system, identity/consent/audit, medicine master and templates, speech recognition, fact extraction.
- **Phase 6 (guided questions) is built but has no real content:** the engine, authoring tools, viewer and the doctor's panels all work, on fake toy pathways only.
- **Phases 7-13 were not started** when this report was written: safety engine, prescription builder and sign-off, FHIR, ABHA, WhatsApp, evaluation console, ClinicOS integration, viva pack.
- **PRD "never cut" features:** F1 consent is done. F4 is only partly done: the machinery is built but no real pathway exists. F6 safety, F7 sign-off and F8 FHIR were not started.

## By feature

| Feature | Status | Detail |
|---|---|---|
| **F1 Consent gate** (P0) | Done | FR-F1-01 to 05 are met. Recording stays off without both consents. The notice is versioned in English and Gujarati, withdrawal stops recording and deletes the audio, every consent event is logged. The Gujarati wording is a placeholder and needs a native reviewer. |
| **F2 Speech recognition** (P0) | Mostly done | Live transcript with Sarvam, Silero VAD trimming, 50 keyterms, editable segments with the original kept. Plain authenticated WebSocket, not Socket.IO. faster-whisper was run; the IndicConformer adapter exists but the model was never run. Diarization is built, with doctor confirmation. No confidence value is stored, because Sarvam gives none. |
| **F3 Fact extraction** (P0) | Mostly done | Schema-strict extraction with negated and uncertain flags and an evidence span per fact; ungrounded facts are dropped and counted. The doctor can add, edit, confirm and reject. Entity linking uses the owner's unreviewed 31-concept list and the doctor confirms every link. Parrotlet-e was skipped (gated model); SNOMED ids stay empty (no licence). |
| **F4 Guided questions** (P0) | Machinery done, content missing | Pathway format and validator, versioned and locked loader, question engine (red flag first, cap of 8, abstain), authoring commands, read-only viewer, and the doctor's question, red-flag and candidate panels. Toy pathways only; no real pathway. The language model for phrasing (FR-F4-05) is not built. |
| **F5 Medicines and templates** (P0/P1) | Done, review pending | NLEM 2022 imported (388 distinct names against the official 384; the difference is documented), generic-first, source on every row. Admin page and templates work. Clinician review, SNOMED/ATC codes, route and the Gujarati name list are empty or unreviewed. |
| **F6 Suggestions and safety** (P0) | Not started | No suggestion generator; no allergy, dose, duplicate or interaction checks; no red-flag medicine suppression. |
| **F7 Sign-off and audit** (P0) | Audit done, sign-off not started | Append-only hash-chained audit log, verify script, CSV export and the audit page are done. Sign-off page, diff, immutability and amendments were missing. |
| **F8 FHIR builder/validator** (P0) | Not started | No bundle builder, no validator, no golden examples. |
| **F9 ABHA** (P1) | Not started | ABDM sandbox access not applied for. |
| **F10 WhatsApp Gujarati summary** (P1) | Not started | |
| **F12 Evaluation console** (P1) | Partly done | Command-line tools for speech error rate and extraction scoring, including a three-way comparison. No console page; no end-to-end three-pipeline run. |
| **F13 ClinicOS integration** (P1) | Standalone only | A mock adapter mirrors the real response shapes. Real integration (Phase 12) not started. |
| **F14 / F15** (P2) | Not started | |

## Pages (PRD section 4)
- **Built:** PG-01 login, PG-02 doctor dashboard (queue is a labelled placeholder), PG-03 patients, PG-05 consent, PG-06 consultation workspace, PG-12 medicines, PG-13 templates, PG-14 pathways (read-only), PG-16 audit, PG-18 settings, PG-19 error pages.
- **PG-07:** its content lives inside PG-06 as the candidates panel; no separate route.
- **Not built when written:** PG-04 ABHA, PG-08 prescription builder, PG-09 sign-off, PG-10 visit/FHIR viewer, PG-11 summary and WhatsApp log, PG-15 safety rules, PG-17 evaluation console, PG-20 erasure requests.

## Non-functional requirements
- **Met:** role-based access with clinic isolation tests; audio encrypted at rest (AES-256-GCM); secret scanning in CI; the LLM safety gate and injection tests; 90-day audio retention; permanent simulated-data banner; audit chain verification; English and Gujarati; responsive layout; software bill of materials with a licence guard; accessibility checks in CI and the browser run.
- **Not done:** TLS (local only), database encryption at rest, the OWASP ASVS checklist and STRIDE threat model, a formal WCAG audit report, a requirement-to-test traceability matrix, the FHIR validator in CI, Hindi UI labels.
- **Not formally measured:** the latency targets and the 70% coverage target.
- **Not applicable yet:** the safety engine failing closed.

## Metrics (M-01 to M-17)
- **First small numbers, not meaningful:** M-01/M-02 speech error rate on one clip; M-03 on 13 acted or synthetic cases with one free model, the grounded pipeline reached an overall F1 of 0.96 and negation F1 of 1.0; M-04 2 of 59 predicted facts dropped as ungrounded (about 3.4% against the 2% target).
- **Not started:** M-05 to M-17 (they need real pathways, the safety engine, FHIR, ABHA, WhatsApp, usability trials, the benchmark release).

## Blockers outside the code
The owner file still shows "not started" for: a clinician reviewer (hard block for real pathways and the safety rules); ethics or faculty approval for recording other people; the SNOMED licence, ABDM sandbox access, the WhatsApp test number and template; a Gujarati reviewer. The LLM provider decision (PRD-D4) is open: only free models on simulated text have been used and real data stays blocked. Sarvam's no-training and zero-retention settings and the OpenRouter data-policy check are owner steps not yet recorded. Documents not started: SRS, diagrams, threat model, paper, demo script, viva pack.

## What to do next
- A step that needs no outside input: the prescription builder (PG-08) and the sign-off and visit-record pages (PG-09, PG-10). The FHIR builder against the public NRCeS package can start with SNOMED codes left empty.
- The safety engine (F6) needs sourced rule tables from the owner and clinician review.
- Start now because they take days or weeks: the clinician reviewer, ethics approval, and the ABDM, SNOMED and WhatsApp applications.
