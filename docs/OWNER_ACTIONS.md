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

## Phase 5A (2026-10-18)
- **Language-model key (not needed for Run 1, which uses the mock).** Put `LLM_BASE_URL`, `LLM_MODEL` and `LLM_API_KEY` only in your private `apps/asr-py/.env` (placeholders are in `.env.example`; never paste a key in chat or a tracked file). Candidate free development models on OpenRouter: `nvidia/nemotron-3.5-super-vl:free` and `xingchen-agi/xing4.0-29b-a4b:free`. **Free endpoints may log prompts and may train on them: simulated data only.** The real provider also refuses to run until you set `LLM_ALLOW_REAL_DATA=true`, which you should do only after reading the endpoint's terms.
- **Written no-training confirmation** from whichever provider is used for anything beyond simulated test text (NFR-PRIV-03): record the date and the reply in this file.
- **Concept word list** (OCI-017) and **red-flag list** (OCI-018): a clinician, with a Gujarati and a Hindi speaker, writes or reviews them. Not needed until entity linking.
- **Gold labels:** the ten acted cases in `audio/own/READ_ALOUD_AND_GOLD.md` are a first draft; a native Gujarati speaker and a Hindi speaker should check the wording and the labels before the numbers are trusted (`docs/EXTRACTION_EVAL_GUIDE.md`).
- **Phase 5A Run 2 (owner steps).** (1) In `apps/asr-py/.env` set `LLM_PROVIDER=openai_compatible` (the other `LLM_*` values are there; `LLM_ALLOW_REAL_DATA` stays `false`: the evaluation does not need it). (2) Declare which clip texts are made-up: `npm run list:simulated-text -- clip02.txt clip03.txt clip04.txt clip05.txt clip06.txt clip07.txt clip08.txt clip09.txt clip10.txt clip11.txt --i-confirm-these-are-simulated-text`. (3) Look at the plan, then run: `npm run eval:extraction -- --fixtures apps/asr-py/tests/fixtures/extraction --pipeline all` (shows the plan only), add `--yes-run` to send (about 39 requests).
- **OpenRouter data policy.** On OpenRouter, free-model providers may log and train on prompts unless your account privacy settings forbid it. Check your account's data/privacy settings, save the provider's terms link and the date you read them in this file, and send only simulated text until a written no-training confirmation exists (NFR-PRIV-03). Link and date: `TODO(owner)`.
- **Parrotlet-e (optional, later).** Accept the model terms on the Hugging Face page of `ekacare/parrotlet-e` (licence CC-BY-SA-4.0) if you want it tried as an embedding linker; until then it cannot be read or loaded.
- **Phase 5B (facts panel).** The web build reads `VITE_ASR_HTTP_URL` (default `http://localhost:8000`, the speech service over HTTP). With `LLM_PROVIDER=openai_compatible` and `LLM_ALLOW_REAL_DATA=false` the Extract button refuses and nothing is sent; set `LLM_PROVIDER=mock` for the labelled test-mode sample extraction. Do not set `LLM_ALLOW_REAL_DATA=true` for real patients until the provider's written no-training confirmation is on file.

## Phase 6A (2026-10-19)
- **Real pathways are yours to transcribe.** Pick the conditions with your clinician reviewer, download the matching ICMR Standard Treatment Workflow PDFs (keep them outside git, or note the document and page in each pathway's `source` block), and write one `<condition>.pathway.json` per condition in `data/pathways/drafts/` (git-ignored) using the format in `docs/PATHWAYS.md` and the workflow in `docs/PATHWAY_AUTHORING.md`. Do not paste a PDF's text into the repository. Use `status: draft` while writing, then run `npm run pathway:lint -- data/pathways/drafts`.
- **A clinician must review every pathway** and you then fill in `source.reviewed_by` and `source.reviewed_on`, change `status` to `active`, move the file to `seed/pathways/` (tracked), run `npm run pathways:lock -- seed/pathways` and commit the lock file with it. An active version is never edited; a change is a new `version`. See OCI-019, OCI-020, OCI-021.
- **Running the API with pathways.** The API reads `seed/pathways` by default; set `PATHWAYS_DIR` for another folder. For a demo with the fake toy pathways only, set `PATHWAYS_ALLOW_TEST=true` and `PATHWAYS_DIR=packages/rules/fixtures/pathways` in `apps/api-node/.env`; never do this with real patients, and it is refused in production.
- **Concept ids for real facts** (so the engine can use them) wait for the clinician and speaker-reviewed concept word list (OCI-017). Until then the question engine has no input from real consultations.

## Phase 6B (2026-10-21)
- **Authoring workflow.** Read `docs/PATHWAY_AUTHORING.md`: you paste one source passage at a time, the assistant shows source and JSON side by side, every node carries the exact sentence and page, and anything unclear is asked, never guessed. The commands are `npm run pathway:new`, `pathway:lint`, `pathway:version`, `pathways:cases`, `pathways:coverage`, `pathways:lock`.
- **Clinician reviewer and conditions (still yours to decide, OCI-019):** who signs off (full name for `reviewed_by`), which conditions are first, and which ICMR Standard Treatment Workflow PDFs (keep the PDFs outside git; the pathway records document and page).
- **See a pathway in the app:** sign in as a doctor or admin and open "Guideline pathways" (`/admin/pathways`). It is read only and shows "Draft - not clinically reviewed" for anything not active. To see the FAKE toy pathways in a local demo, set `PATHWAYS_DIR=packages/rules/fixtures/pathways` and `PATHWAYS_ALLOW_TEST=true` in `apps/api-node/.env` (refused in production).

## Remaining Phase 5 items (2026-10-21)
- **Concept list review (OCI-017).** The doctor now sees suggestions from your draft list (`data/concepts/concepts_draft.txt`, converted by `python -m app.extraction.linking convert`), each marked "unreviewed list". To make it reviewed: a Gujarati speaker and a Hindi speaker check the words and add the missing spellings and verb forms (the matcher does not stem), and a clinician checks that every concept name means what it should. Only then should anything call the list reviewed. Until then nothing from it is clinical.
- **If the screen says "Concept list not loaded":** run `cd apps/asr-py && python -m app.extraction.linking convert` once (the file is git-ignored, so each computer needs it), or set `CONCEPTS_FILE` in `apps/api-node/.env`.
- **Real pathways need real concept ids.** A pathway slot is filled from a fact only when the doctor has confirmed that fact AND its concept link, so the slot map for each real pathway must name the concept ids of your list (see docs/PATHWAY_AUTHORING.md).
