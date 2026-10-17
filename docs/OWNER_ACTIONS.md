# Owner actions

Things only the owner can arrange (people, approvals, licences, accounts). The assistant checks this file at the start of every phase and warns the owner if the next phase is blocked by an item that is not done (see `AGENTS.md`, session checklist).

**Status values:** `not started`, `applied` (asked, waiting), `done` (usable), `downloaded` (file is here). Update the status and the date (YYYY-MM-DD) whenever something changes.

| Item | Needed before (phase) | Status | Date applied |
| --- | --- | --- | --- |
| Clinician reviewer (a doctor who signs off clinical content) | Phase 3 (`reviewed_on` on medicine rows); hard block for Phase 6 | not started | - |
| Ethics / faculty approval (acted consultations, audio recording, benchmark) | Phase 4 | not started | - |
| SNOMED CT licence (MLDS, India national member) | Phase 9 (codes stay empty until then) | not started | - |
| ABDM sandbox access | Phase 9 | not started | - |
| Sarvam API key | Phase 4 | done (in apps/asr-py/.env) | 2026-10-17 |
| LLM account + spend cap (provider is PRD-D4, still open) | Phase 5 | not started | - |
| WhatsApp test number + Gujarati message template (template approval takes days: apply during Phase 8) | Phase 10 | not started | - |
| Gujarati reviewer (a Gujarati speaker, also for the consent notice and UI text) | Phase 2 (consent notice); again before Phase 10 | not started | - |
| NLEM PDF location: `data/medicines/raw/` (private, git-ignored) | Phase 3 | downloaded | 2026-10-15 |
| NLEM reuse terms: check the terms of the NLEM publication (CDSCO). If reuse is allowed, track the extracted CSV in `seed/` with attribution | Phase 3 follow-up (before the medicine data is published) | not started | - |
| Gujarati reviewer approves the machine-drafted medicine-name list (`data/medicines/translit-gu.draft.csv`), then `npm run medicines:translit` loads it | before Gujarati medicine search is switched on | not started | - |

## Notes

- **NLEM PDF:** `data/medicines/raw/nlem2022.pdf` and `reportnlem2022.pdf` (moved there from `DOCUMENTS/` on 2026-10-15). The folder is git-ignored, so they are never committed (ADR-D18).
- **Credentials:** the assistant never asks for secrets in chat and never writes them to a tracked file. When a phase needs a key (Sarvam, LLM provider, WhatsApp, ABDM), the assistant will ask you first, then you put the value in your own git-ignored `.env`.
- **Phase 3A (medicine master) is built and waits for your review.** Nothing blocks it. The clinician reviewer is still "not started", so every medicine row has `reviewed_on` empty (a hard block for Phase 6, not for 3A). The Gujarati reviewer is needed before Gujarati medicine search is enabled and, as before, for the consent notice and UI text, which are placeholders until a speaker has read them.
- **Phase 3B** (templates API and UI, F11) is built. From you: a Gujarati reviewer for the frequency labels (OCI-013), a clinician's view on the frequency list (OCI-014), and a yes or no on the permission table in ADR-D24 (doctor and admin only).
- Legal wording of the consent notice is the owner's and the institution's, not the assistant's.

## Please check (2026-10-17)
- **`MIGRATION_DATABASE_URL` in `apps/api-node/.env` was found truncated** (only 2 characters) while running the Phase 3B end-to-end test. What cut it is unknown. It was rebuilt from the database owner settings in `infra/.env` (same host, port and database; no value was printed or committed). Please open the file and confirm the line looks right. The tests and `npm run db:migrate` work with the rebuilt value.
- **The end-to-end test no longer writes to your development database.** It creates `vaaniehr_e2e_<random>`, migrates and seeds it, keeps its fake logins in a temp file, and drops both in a `finally` block. The leftover fake rows from earlier runs (Drug-E2E medicines and E2E templates) were removed from the development database; the 829 active NLEM rows were checked with a checksum before and after and are unchanged. Audit entries from those runs stay (the audit log is append-only), as do the fake patients and sessions from earlier Phase 2B runs.

## Phase 4A (2026-10-17)
- **Sarvam API key:** done (moved to `apps/asr-py/.env`; never printed). **Hugging Face token:** present. For IndicConformer you must also open https://huggingface.co/ai4bharat/indic-conformer-600m-multilingual while signed in to the SAME account and accept the conditions. For pyannote (only if you switch it on) accept the conditions of `pyannote/segmentation-3.0` and `pyannote/speaker-diarization-3.1`.
- **Before any recording of another person goes to Sarvam** (owner rule, 2026-10-17): in the Sarvam dashboard switch "Model training" OFF (Settings > Organisation > General, Owner only) and set data retention to 0 days (Settings > Workspace > Data retention); ask Sarvam (support@sarvam.ai or their data protection contact) to confirm in writing (1) the training default and that 0-day retention also excludes training, (2) a copy of the DPA and the sub-processor list, (3) their position on health data (their Privacy Policy says they do not knowingly collect it), (4) India-only processing of API audio, (5) which retention default is right (the docs say indefinite, the Privacy Policy says 30 days). Ethics approval and the actor's audio-release are also needed. Until then the code refuses third-party audio (`SARVAM_ALLOW_THIRD_PARTY_AUDIO` stays false).
- **Back up `AUDIO_MASTER_KEY`** (in `apps/asr-py/.env`). If it is lost, stored recordings cannot be recovered.
- **Choose the keyterm list** (up to 50 drug names) in a private file; a starter list can be generated by a documented rule and is marked unreviewed.
