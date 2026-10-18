# ASR.md - the speech service (apps/asr-py), Phase 4A

Vendor facts: `docs/vendor-notes.md`. Decisions: ADR-D25 (transport) and ADR-D26 (consent token, storage, spend caps) in `docs/DECISIONS.md`.

## Keys and secrets (never printed, never committed)
- `npm run setup:env` creates `apps/asr-py/.env` values: `INTERNAL_SERVICE_SECRET` (the same value is written to `apps/api-node/.env`) and `AUDIO_MASTER_KEY` (asr-py only). It also MOVES `SARVAM_API_KEY` and `HF_TOKEN` from the api-node file to the asr-py file and removes them from the api-node file (least privilege).
- **If `AUDIO_MASTER_KEY` is lost, stored audio cannot be recovered. Back it up with the same care as a password.** Changing it makes older files unreadable. (Planned: a key id in each file header so a new key can be added later.)
- `INTERNAL_SERVICE_SECRET` can be rotated by running setup with the old lines removed in both files; tokens are short-lived, so nothing is lost.

## Sarvam terms: what the pages say (read 2026-10-17; unclear points are for the owner to settle with Sarvam)
Pages: https://www.sarvam.ai/terms-of-service (v2.0, 29 Jul 2026; the text was cut off in the fetch, so section 17 is a summary), https://www.sarvam.ai/privacy-policy, https://www.sarvam.ai/trust-center, https://docs.sarvam.ai/api/platform/data-retention, https://docs.sarvam.ai/api/platform/faq. The EULA and the DPA text were not read (the DPA is "request only").
- **Training on customer inputs: the default is unclear.** The Privacy Policy heading says "Opt-In" but its text says content is used unless you opt out. The docs FAQ says an Owner can switch the "Model training" toggle off (Settings > Organisation > General) and does not state the default. The Trust Center says data is never used to train models for OTHER customers, which is not "never trains". **Treat training as ON until the toggle is switched off and Sarvam confirms in writing that 0-day retention also excludes training.**
- **Retention:** docs say retention is indefinite until an Owner sets a period; "0 days" is available for Model APIs (Settings > Workspace > Data retention, Owner only, not retroactive). The Privacy Policy says 30 days after last access: the two conflict; the docs are the operative behaviour. Usage and API logs are kept 1 year.
- **Where:** India is the primary location (Azure Central India), but the Privacy Policy allows transfers to the US and EU and the Terms say data may be transferred; India-only for API audio is not guaranteed in writing.
- **Health data:** the Privacy Policy says Sarvam does not knowingly collect sensitive data (health is listed); there is no HIPAA or BAA language and no public sub-processor list. A DPA exists on request. No page bans medical use of the API, but the Terms (10.1) bar medical advice or high-stakes automated decisions without qualified human review: documentation by a doctor who reviews is consistent with that; this is not a legal opinion.
- **Before ANY clip of another person is sent to Sarvam (owner decision, 2026-10-17):** the owner (1) switches model training off and sets 0-day retention in the Sarvam dashboard, (2) asks Sarvam to confirm in writing the five points in OWNER_ACTIONS, and (3) has ethics approval and the actor's audio-release. Until then only the owner's own voice may be used, and the code enforces a `SARVAM_ALLOW_THIRD_PARTY_AUDIO=true` switch that defaults to false (`app/own_voice.py`, tested).

## Not adopted
- **Indic-Transcribe** (huggingface.co/bodhan-ai/indic-transcribe-core, 25 languages) is named on the IndicConformer model card as the recommended newer model. Not read, not adopted: a possible future baseline.

## Engines and how to run them
- **mock** (tests, demos; `ASR_ENABLE_MOCK=true`), **sarvam** (needs `SARVAM_API_KEY`; live audio is refused unless `SARVAM_ALLOW_THIRD_PARTY_AUDIO=true`; owner's own-voice files in `audio/own/` pass through the manifest check), **indicconformer** and **faster-whisper** (local, CPU, container only; no keyterms; finals only).
- **Local models run in the container only.** IndicConformer executes code from its model repository (`trust_remote_code`), allowed only for the exact commit pinned in `app/asr/models.py` and refused outside the container (`ASR_IN_CONTAINER=1` or `/.dockerenv`). Build by hand, never in CI: `docker build -f apps/asr-py/Dockerfile.models -t vaaniehr/asr-models:local .` The model files are not in the image.
- **Download on request:** `python -m app.models_cli list`; `python -m app.models_cli download indicconformer --dir D:\models\indicconformer` prints the file count and size and checks free disk first (1.5 x size + 1 GB); nothing is downloaded without `--yes`. Sizes at pin time: IndicConformer about 2.6 GB (gated: accept the terms with the account that owns `HF_TOKEN`), faster-whisper small about 0.5 GB, medium about 1.5 GB. IndicConformer's repository also holds ONNX files; the card does not say how they are used.
- **Silence trimming (FR-F2-02):** for streaming engines (Sarvam, mock) `VadGate` drops silence before the engine, which also cuts billed seconds, and maps segment times back to the original recording. Local engines cut utterances with the same VAD themselves. If Silero is not installed (`requirements-vad.txt`) nothing is trimmed (more audio is sent, never less).
- **Confidence:** Sarvam none (never faked); IndicConformer none; faster-whisper `exp(avg_logprob)`, a model score and not a calibrated probability.

## Keyterms, the smoke test and the usage report
- **Keyterm list:** `data/asr/keyterms.txt` (private), one term per line, at most 50 terms of 64 characters. `python -m app.keyterm_starter` writes a STARTER list by a fixed rule: the first word of each NLEM generic name, at least 4 letters and only letters, ranked by how many generic names start with it (ties alphabetically), top 50, no other filtering. The file says UNREVIEWED and OCI-015 asks a clinician to review it. Sending drug names to Sarvam is not republishing the NLEM.
- **Smoke test (manual, never in CI or tests):** `python -m app.smoke run --engine sarvam --file audio/own/clip01.wav --reference audio/own/clip01.txt [--both]` prints a DRY RUN (seconds, estimated INR, whether the own-voice rule passes) and sends nothing; add `--yes-spend` to run. At most 300 s per run, the monthly cap is checked first, `--both` runs with and without keyterms. Output is numbers only (segments, seconds, billed seconds, INR, keyterms applied, time to first result, WER with its substituted/missing/extra counts); the transcript goes to `data/asr/smoke/`.
- **Own voice:** put the file in `audio/own/`, then run `python -m app.smoke own-list audio/own/clip01.wav --i-confirm-this-is-my-own-voice`. That command is YOUR statement that only you speak in the file; it records the file's SHA-256 in `audio/own/manifest.json`. Nobody else may run it for you.
- **Usage report:** `python -m app.usage_report [YYYY-MM]` lists requests, audio minutes, billed minutes and INR per engine, and the paid minutes used against the monthly cap.

## First smoke results (2026-10-18, owner's own 62.6 s clip, 94 reference words; numbers only, one clip proves little)
| Engine | Seconds / cost | WER | Output script |
| --- | --- | --- | --- |
| Sarvam saaras:v4 codemix, no keyterms | 62.6 s billed, INR 0.52 | 42.6% (35 sub, 4 missing, 1 extra) | Gujarati script 57%, Latin 43% |
| Sarvam, 50 unreviewed keyterms | 62.6 s billed, INR 0.52 | 43.6% (36 sub, 4 missing, 1 extra) | Gujarati 58%, Latin 42% |
| faster-whisper small int8 (CPU), `gu` | 62.6 s, free, took 368 s | 74.5% (61 sub, 5 missing, 4 extra) | Devanagari 76%, Latin 24%, no Gujarati script |
- The reference writes the Hindi parts in Devanagari and English words such as "doctor" in Gujarati script; Sarvam writes Hindi in Gujarati script and "doctor" in Latin. Many of its "errors" are script choices, not misheard words, so WER here mixes two things. Real word mistakes seen: બેસો to બેઠો, ગળામાં to ગલામાં, પણ છે to પંચે.
- The keyterm list changed the score by +1 word (noise). No claim about keyterms follows from one clip.
- WER bug found and fixed on the way: the first tokenizer split Gujarati words at vowel signs (150 "words" instead of 94). Scores above use the fixed tokenizer on the saved outputs.
- Sarvam's event format worked as parsed (partials and finals with `text`, `session.end` billed seconds); first result after 0.5-0.7 s.

## Sarvam modes on clip01, script-aware scoring (2026-10-18, no keyterms unless stated; 62.6 s, INR 0.52 per run; one clip)
Reference script share: Gujarati 47.8%, Devanagari 23.9%, Latin 28.4%. Script-aware WER maps Devanagari onto Gujarati by Unicode offset (same word, other script = match); Latin is never mapped, and Latin-versus-Indic substitutions are counted separately.
| Mode | Strict WER | Script-aware WER | Latin-vs-Indic mismatches | Output script G / D / L (%) |
| --- | --- | --- | --- | --- |
| codemix (default) | 42.6 | 25.5 | 10 | 57 / 0 / 43 |
| codemix + 50 unreviewed keyterms | 43.6 | 25.5 | 10 | 58 / 0 / 42 |
| transcribe | 64.9 | 46.8 | 20 | 100 / 0 / 0 |
| verbatim | 63.8 | 44.7 | 23 | 100 / 0 / 0 |
| translit | 77.7 | 77.7 | 69 | 0 / 0 / 100 |
| faster-whisper small (for reference) | 74.5 | 64.9 | 8 | 0 / 76 / 24 |
- `translate` was not run: it outputs English only, so it cannot match this reference.
- On this clip `codemix` is the only mode that keeps English words in Latin (42% of its letters) and has the lowest scores. No mode writes Hindi in Devanagari: codemix, transcribe and verbatim put all Indic text in Gujarati script (Devanagari 0%), translit writes everything in Latin. So none of them reproduces the reference's three-script convention; after script mapping codemix is closest. Keyterms made no difference to the script-aware score.

