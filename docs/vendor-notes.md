# vendor-notes.md - cited vendor facts for Phase 4 (read 2026-10-17; do not re-fetch)

"NOT documented" means the page(s) read do not say. Re-check only if a smoke test disagrees.

## Sarvam (docs.sarvam.ai)
- Models: `saaras:v4` default/latest, `saaras:v3` available, `saaras:v3-realtime` is the realtime WebSocket default (`saaras:v4` also accepted there). `mode`: transcribe | translate | verbatim | translit | codemix (v3 and v4). Source: /api/getting-started/models/saaras
- REST `POST https://api.sarvam.ai/speech-to-text` (multipart; header `api-subscription-key`; max 30 s per request; max file size NOT documented). Source: /api-reference/speech-to-text/transcribe and /api/api-guides-tutorials/speech-to-text/rest-api. (The API-reference text says `mode` only for v3; the guides say v3 and v4: unresolved, verify live.)
- Realtime WebSocket `GET /speech-to-text-realtime/ws`: query `language_code` (required, `auto` allowed), `model`, `stream_type` (fast | balanced | simulated; simulated has no partials), `mode`, `endpointing` (vad|manual), `encoding` (linear16 default), `sample_rate` (8000|16000), `threshold` 0.3, `silence_duration_ms` 500, `min_speech_duration_ms` 250, `return_timestamps`, `prompt`, `keyterms` (v4 only). Send `{"event":"audio_input","audio":"<base64>"}`; `{"event":"end"}` to close; `ping` keepalive. Events: session.begin, vad.speech_start/end, transcript.partial, transcript.final (`text`; `language`, `language_confidence` with auto; `start_s`/`end_s` with return_timestamps), session.end (`audio_duration_s` = billed seconds), error (`code`, `is_fatal`, `message`). Close codes 1003 (rate/quota/invalid key), 1008 (inactivity), 1011, 4000 (bad parameter). Source: /api/api-guides-tutorials/speech-to-text/realtime-streaming
- Keyterms: JSON list of strings, up to 50 terms, 64 characters each, `saaras:v4` only, bias but do not guarantee; fixed at connect time on WebSockets; the Python SDK helpers do not expose it (use a raw client). Source: .../speech-to-text/how-to/keyterms
- Gujarati `gu-IN` supported. Whether `codemix` works for Gujarati-English specifically: NOT documented.
- Diarization: Batch API only (`with_diarization`, `num_speakers` 1-20), output `diarized_transcript.entries[]` with `speaker_id` "0"/"1", start/end seconds. Not on REST or streaming. Max 2 h per file, 20 files per job. Source: .../how-to/enable-speaker-diarization and .../batch-api
- Timestamps are chunk-level only; word-level NOT supported. NO per-segment or per-word confidence is documented (only document-level `language_probability`, and `language_confidence` in realtime with auto). So VaaniEHR shows NO confidence for Sarvam (PRD_ERRATA).
- Price (INR, per hour of audio, billed per second): speech to text 30; with diarization 45. New users get 100 INR credit. Source: /api/getting-started/pricing
- Limits (per account): Starter 20 concurrent WebSockets, 60 REST req/min; Pro 100; Business 100/4000. Source: /api/getting-started/ratelimits
- Data retention: set per workspace, 0 days up to 24 months; until an Owner sets it, data is retained indefinitely. Source: /api/platform/data-retention. Training on customer audio: see "Terms check" below.
- SDK: `sarvamai` (PyPI). Not used for streaming (no keyterms); we use a raw WebSocket client.

## IndicConformer 600M (huggingface.co/ai4bharat/indic-conformer-600m-multilingual)
- Licence MIT. Repository GATED (log in and accept conditions). Load with `AutoModel.from_pretrained(..., trust_remote_code=True)` (runs code from the repo: PIN THE REVISION). Call `model(wav, "gu", "ctc"|"rnnt")`, 16 kHz mono. Model card install line pins onnxruntime/onnx 1.20.1.
- NOT documented: CPU speed, file sizes, keyterm support, Gujarati accuracy. The card now recommends "Indic-Transcribe" (huggingface.co/bodhan-ai/indic-transcribe-core, 25 languages): a FUTURE OPTION only; not adopted, not read.
- NeMo source repo github.com/AI4Bharat/IndicConformerASR (MIT) is a different route; not used.

## faster-whisper (github.com/SYSTRAN/faster-whisper)
- MIT. `WhisperModel(size, device="cpu", compute_type="int8")`; `word_timestamps=True`; `vad_filter=True` (Silero). Gujarati code `gu` is a Whisper code but is NOT on the README; Gujarati accuracy NOT documented; hotwords/prompt support NOT verified (treated as unsupported).

## Silero VAD (github.com/snakers4/silero-vad)
- MIT. `pip install silero-vad` (torch is the only required dependency; `[onnx-cpu]` extra optional). `VADIterator(model, threshold=0.5, sampling_rate=16000, min_silence_duration_ms=100, speech_pad_ms=30, neg_threshold=None)`; exactly 512-sample chunks at 16 kHz (256 at 8 kHz); `min_speech_duration_ms` exists only in `get_speech_timestamps` (default 250).

## pyannote (github.com/pyannote/pyannote-audio; huggingface.co/pyannote/speaker-diarization-3.1)
- Code MIT; pretrained pipeline MIT but GATED: accept the conditions of `pyannote/segmentation-3.0` and `pyannote/speaker-diarization-3.1` and use a Hugging Face token. A newer `speaker-diarization-community-1` is also gated. No non-commercial restriction is stated. CPU speed and Indic support NOT documented. Optional telemetry: set `PYANNOTE_METRICS_ENABLED=0`.

## Terms check: Sarvam training on audio and retention
See `docs/ASR.md` section "Sarvam terms" (filled in after the terms pages were read).
