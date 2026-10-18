"""Manual smoke test of one speech engine on one short file. NOT used by tests or CI.

  python -m app.smoke run --engine sarvam --file audio/own/clip01.wav --reference audio/own/clip01.txt [--both] [--yes-spend]
  python -m app.smoke own-list audio/own/clip01.wav --i-confirm-this-is-my-own-voice

Default is a DRY RUN: it prints what would be sent (seconds, engine, keyterms, estimated INR, whether the own-voice rule
passes) and sends nothing. Nothing runs without --yes-spend. At most 300 seconds per run (the first N seconds of the
file); `--both` runs with and without the keyterm list (twice the audio, twice the cost). The monthly cap is checked
first. Results are printed as numbers only and the transcript is saved under data/asr/smoke/ (private).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
import uuid
import wave
from collections.abc import AsyncIterator, Callable
from datetime import UTC, datetime
from pathlib import Path

import numpy as np

from app.asr.engine import ASREngine
from app.asr.types import BYTES_PER_MS, SAMPLE_RATE, Segment
from app.config import REPO_ROOT, Settings, load_settings
from app.keyterms import KeytermError, load_keyterms
from app.own_voice import OWN_DIR, ThirdPartyAudioRefused, sha256_of, verify_own_voice
from app.usage import PAID_ENGINES, CapExceeded, SpendGuard, UsageLog
from app.wer import script_share, wer_report

CHUNK_MS = 250
EngineFactory = Callable[..., ASREngine]


def load_wav_16k_mono(path: Path, max_seconds: float) -> tuple[bytes, float]:
    """(16 kHz mono 16-bit PCM of the first `max_seconds`, full duration in seconds). PCM WAV only."""
    with wave.open(str(path), "rb") as wav:
        if wav.getsampwidth() != 2:
            raise ValueError("only 16-bit PCM WAV files are supported")
        rate, channels, frames = wav.getframerate(), wav.getnchannels(), wav.getnframes()
        take = min(frames, int(max_seconds * rate))
        raw = (
            np.frombuffer(wav.readframes(take), dtype="<i2")
            .reshape(-1, channels)
            .astype(np.float32)
        )
    mono = raw.mean(axis=1)
    if rate != SAMPLE_RATE:  # plain linear resampling: fine for a smoke test, not for evaluation
        target = int(len(mono) * SAMPLE_RATE / rate)
        mono = np.interp(np.linspace(0, len(mono) - 1, target), np.arange(len(mono)), mono)
    return np.clip(mono, -32768, 32767).astype("<i2").tobytes(), frames / rate


def default_engine(
    name: str,
    settings: Settings,
    spend: SpendGuard,
    verified: bool,
    _terms: list[str],
    mode: str = "codemix",
) -> ASREngine:
    if name == "mock":
        from app.asr.mock import DEMO_SCRIPT, MockEngine  # noqa: PLC0415

        return MockEngine(DEMO_SCRIPT)
    if name == "sarvam":
        if settings.sarvam_api_key is None:
            raise SystemExit("SARVAM_API_KEY is not set in apps/asr-py/.env")
        from app.asr.sarvam import SarvamEngine  # noqa: PLC0415

        return SarvamEngine(
            settings.sarvam_api_key.get_secret_value(),
            spend=spend,
            allow_third_party=settings.allow_third_party_audio,
            own_voice_verified=verified,
            purpose="smoke",
            run_cap_seconds=settings.smoke_max_seconds,
            mode=mode,
        )
    from app.vad import EnergyBackend, SileroBackend  # noqa: PLC0415

    try:
        SileroBackend()
        backend: Callable = SileroBackend
    except RuntimeError:
        backend = EnergyBackend
    if name == "indicconformer":
        from app.asr.indicconformer import IndicConformerEngine  # noqa: PLC0415

        return IndicConformerEngine(vad_backend=backend)
    if name == "faster-whisper":
        from app.asr.fasterwhisper import FasterWhisperEngine  # noqa: PLC0415

        return FasterWhisperEngine(vad_backend=backend)
    raise SystemExit(f"unknown engine '{name}' (mock, sarvam, indicconformer, faster-whisper)")


async def _chunks(pcm: bytes) -> AsyncIterator[bytes]:
    size = CHUNK_MS * BYTES_PER_MS
    for i in range(0, len(pcm), size):
        yield pcm[i : i + size]


async def _run_once(
    engine: ASREngine, pcm: bytes, language: str, terms: list[str]
) -> tuple[list[Segment], float | None, float]:
    started, first_partial = time.monotonic(), None
    segments: list[Segment] = []
    async for segment in engine.transcribe_stream(_chunks(pcm), language, terms):
        if first_partial is None:
            first_partial = time.monotonic() - started
        if segment.kind == "final":
            segments.append(segment)
    return segments, first_partial, time.monotonic() - started


def own_list(file: Path, confirmed: bool, own_dir: Path = OWN_DIR) -> int:
    if not confirmed:
        print(
            "add --i-confirm-this-is-my-own-voice: this is the owner's statement that only the owner speaks in it"
        )
        return 2
    if own_dir.resolve() not in file.resolve().parents:
        print("the file must be inside audio/own/")
        return 2
    manifest = own_dir / "manifest.json"
    data = json.loads(manifest.read_text(encoding="utf-8")) if manifest.exists() else {"files": {}}
    data.setdefault("files", {})[file.name] = {"voice": "owner", "sha256": sha256_of(file)}
    manifest.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    print(f"listed {file.name} as the owner's own voice")
    return 0


def run_command(
    args: argparse.Namespace,
    settings: Settings,
    factory: EngineFactory = default_engine,
    out: Callable[[str], None] = print,
) -> int:
    file = Path(args.file)
    seconds_wanted = args.seconds or settings.smoke_max_seconds
    if seconds_wanted > settings.smoke_max_seconds:
        out(
            f"refused: {seconds_wanted:.0f} s is over the {settings.smoke_max_seconds:.0f} s per-run cap"
        )
        return 2
    pcm, duration = load_wav_16k_mono(file, seconds_wanted)
    sent_s = len(pcm) / (BYTES_PER_MS * 1000)
    try:
        terms = load_keyterms(Path(args.keyterms))
    except KeytermError as exc:
        out(f"keyterm list problem: {exc}")
        return 2
    variants = (
        [("with keyterms", terms), ("without keyterms", [])]
        if args.both
        else (
            [("with keyterms", terms)]
            if terms and not args.no_keyterms
            else [("without keyterms", [])]
        )
    )
    usage = UsageLog(settings.usage_log_path)
    spend = SpendGuard(usage, settings.monthly_cap_minutes, settings.smoke_max_seconds)
    paid = args.engine in PAID_ENGINES
    rate = usage.cost_inr(args.engine, 3600)
    total_s = sent_s * len(variants)
    estimate = usage.cost_inr(args.engine, total_s)
    verdict = "n/a (nothing leaves this machine)"
    verified = True
    if paid and not settings.allow_third_party_audio:
        try:
            verify_own_voice(file, OWN_DIR)
            verdict = "passes (listed as the owner's own voice, unchanged)"
        except ThirdPartyAudioRefused as exc:
            verdict, verified = f"REFUSED: {exc}", False
    elif paid:
        verdict = "switch SARVAM_ALLOW_THIRD_PARTY_AUDIO=true is on"
    out(f"file {file.name}: {duration:.1f} s long, first {sent_s:.1f} s would be used")
    out(
        f"engine {args.engine}; runs: {', '.join(v for v, _ in variants)} ({len(terms)} keyterms in the list)"
    )
    out(
        f"audio to send: {total_s:.1f} s; rate {rate:.0f} INR/hour; estimated cost INR {estimate:.2f}"
    )
    out(f"own-voice rule: {verdict}")
    out(f"paid audio left this month: {spend.remaining_paid_seconds() / 60:.1f} min")
    if not args.yes_spend:
        out("DRY RUN: nothing was sent. Add --yes-spend to run it.")
        return 0
    if not verified:
        return 3
    try:
        spend.check(args.engine, total_s, "smoke")
    except CapExceeded as exc:
        out(f"refused: {exc}")
        return 3
    reference = Path(args.reference).read_text(encoding="utf-8") if args.reference else None
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S")
    for label, variant_terms in variants:
        engine = factory(args.engine, settings, spend, verified, variant_terms, mode=args.mode)
        try:
            segments, first, took = asyncio.run(
                _run_once(engine, pcm, args.language, variant_terms)
            )
        except Exception as exc:  # noqa: BLE001 - report the kind of failure only
            out(f"{label}: failed ({type(exc).__name__}: {str(exc)[:120]})")
            return 1
        usage.add(
            request_id=str(uuid.uuid4()),
            purpose="smoke",
            engine=engine.name,
            engine_version=engine.version,
            audio_seconds=engine.report.audio_seconds or sent_s,
            billed_seconds=engine.report.billed_seconds,
            keyterms_requested=engine.report.keyterms_requested,
            keyterms_applied=engine.report.keyterms_applied,
        )
        text = " ".join(s.text for s in segments)
        billed = engine.report.billed_seconds
        line = (
            f"{label}: {len(segments)} segments, sent {engine.report.audio_seconds:.1f} s"
            f"{'' if billed is None else f', billed {billed:.1f} s'}, cost INR "
            f"{usage.cost_inr(engine.name, billed if billed is not None else engine.report.audio_seconds):.2f}, "
            f"keyterms applied {engine.report.keyterms_applied}/{engine.report.keyterms_requested}, "
            f"first result after {first:.1f} s, took {took:.1f} s"
            if first is not None
            else f"{label}: no output"
        )
        out(line)
        if reference is not None:
            strict, aware = wer_report(reference, text)
            out(
                f"  strict WER {strict.wer * 100:.1f}% = ({strict.substitutions} substituted + {strict.deletions} "
                f"missing + {strict.insertions} extra) / {strict.reference_words} reference words"
            )
            out(
                f"  script-aware WER {aware.wer * 100:.1f}% (Devanagari mapped to Gujarati); "
                f"Latin-vs-Indic mismatches {aware.latin_indic_mismatches}; output script {script_share(text)}"
            )
        folder = settings.data_dir / "smoke"
        folder.mkdir(parents=True, exist_ok=True)
        slug = "kt" if variant_terms else "nokt"
        (folder / f"{stamp}-{engine.name}-{args.mode}-{slug}.json").write_text(
            json.dumps(
                {"engine": engine.name, "version": engine.version, "mode": args.mode, "text": text},
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
    return 0


def main(argv: list[str], factory: EngineFactory = default_engine) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.smoke")
    sub = parser.add_subparsers(dest="command", required=True)
    run = sub.add_parser("run")
    run.add_argument("--engine", required=True)
    run.add_argument("--file", required=True)
    run.add_argument("--reference")
    run.add_argument("--keyterms", default=str(REPO_ROOT / "data" / "asr" / "keyterms.txt"))
    run.add_argument("--language", default="gu-IN")
    run.add_argument("--seconds", type=float)
    run.add_argument("--mode", default="codemix", help="Sarvam mode (default codemix)")
    run.add_argument("--both", action="store_true")
    run.add_argument("--no-keyterms", action="store_true")
    run.add_argument("--yes-spend", action="store_true")
    own = sub.add_parser("own-list")
    own.add_argument("file")
    own.add_argument("--i-confirm-this-is-my-own-voice", action="store_true")
    args = parser.parse_args(argv)
    if args.command == "own-list":
        return own_list(Path(args.file), args.i_confirm_this_is_my_own_voice)
    os.environ.setdefault("PYTHONUTF8", "1")
    return run_command(args, load_settings(), factory)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
