# ASR_EVAL_GUIDE.md - recording clips and running the speech evaluation

For experiment 1 (PRD 14.3): compare speech engines on Gujarati-Hindi-English conversation. Simulated data only.

## 1. Record the clips
- **How many and how long:** about 20 clips of 30-60 seconds each (the command uses at most the first 300 s of a clip).
- **What to say:** an ACTED consultation between made-up people: greeting, complaint, a few questions and answers, a medicine named with dose and days. Mix Gujarati, Hindi and English the way a clinic conversation does, including some drug names (made-up or generic NLEM names are fine).
- **What NOT to say:** no real names, phone numbers, addresses, illnesses of real people, or anything from a real patient. Use invented names such as "Drug-A" or "Fake Patient".
- **Format:** WAV, any rate (it is converted to 16 kHz mono), quiet room, one microphone. Save as `audio/own/clip01.wav`, `clip02.wav`, ... The `audio/` folder is git-ignored and must stay that way.

## 2. Write the reference text (`clip01.txt` beside the wav)
Type exactly what was said, one running text, no timestamps. Script convention:
- **Gujarati words in Gujarati script**, **Hindi words in Devanagari**, **English words and drug names in Latin** (for example "doctor", "Drug-A").
- Optional: `clip01.lang` with one BCP-47 tag (default `gu-IN`).
- **Known limitation:** Sarvam does not output Hindi in Devanagari in any mode tried (it writes Hindi in Gujarati script). So its strict WER counts those words as wrong. The script-aware WER maps Devanagari to Gujarati by Unicode offset (same word in the other script = match) and never maps Latin; Latin-versus-Indic mismatches are counted separately. Read both numbers.

## 3. Whose voice may be sent to a paid service
- **Your own voice:** list each clip as yours: `python -m app.smoke own-list audio/own/clip01.wav --i-confirm-this-is-my-own-voice` (run from `apps/asr-py`). That is your statement that only you speak in it; the file's SHA-256 is recorded, so editing the file later cancels the listing.
- **Anyone else's voice (actors, colleagues): NOT sent to Sarvam** until ALL of these are done and written down in `docs/OWNER_ACTIONS.md` with the date:
  1. Sarvam dashboard: "Model training" switched off and data retention set to 0 days.
  2. Sarvam's written reply to the five questions in `docs/OWNER_ACTIONS.md` (training default and zero retention, DPA and sub-processors, health data, India-only processing, retention default) is received and recorded.
  3. Faculty/ethics approval for recording actors is granted and each speaker has signed a written consent and audio-release.
  4. The owner then sets `SARVAM_ALLOW_THIRD_PARTY_AUDIO=true` on purpose.
  Local engines (faster-whisper, IndicConformer in its container) send nothing off the machine and are not limited by this rule, but the consent and ethics steps still apply to recording another person.

## 4. Run it
```bash
npm run eval:asr -- --engine sarvam                 # dry run: clip count, seconds, estimated cost, own-voice verdict
npm run eval:asr -- --engine sarvam --yes-spend     # real run (paid): stops first if any clip is not listed as yours
npm run eval:asr -- --engine mock --yes-spend       # free, made-up text: proves the pipeline only
npm run eval:asr -- --engine faster-whisper --yes-spend   # local, after: python -m app.models_cli download whisper-small --yes
```
Options: `--mode` (Sarvam mode, default `codemix`), `--dir` (default `audio/own`). Caps: 300 s per clip and the monthly paid-audio cap (default 300 minutes); the cost is about INR 0.50 per minute of Sarvam audio.

## 5. Reading and sharing the results
- Per clip and aggregate: strict WER, script-aware WER, Latin-versus-Indic mismatches, script share (Gujarati/Devanagari/Latin), seconds, INR. The aggregate WER is total errors over total reference words.
- Files are written to `data/asr/eval/<time>-<engine>-<mode>/` (`results.csv`, `results.md`, `hyp/` with the engine text). The folder is private and git-ignored.
- **Only aggregate numbers may be copied into docs** (`results.md`). Never copy transcripts or per-clip text. Keyterms are off; compare with and without only after the clinician has reviewed the list (OCI-015).
- One person's clips cannot support a general claim: report the number of clips and speakers with every figure.
