"""Evaluation over a folder of own-voice clips: `python -m app.eval --engine sarvam [--dir audio/own] [--yes-spend]`.

Each `name.wav` needs a reference `name.txt`; an optional `name.lang` holds a BCP-47 tag (default gu-IN). The default is a
DRY RUN: clip count, seconds, estimated cost and the own-voice verdict per clip; nothing is sent. A real run needs
--yes-spend, sends at most 300 s of each clip, checks the monthly cap for the whole run first, and (for Sarvam) sends
only clips listed as the owner's own voice in audio/own/manifest.json.

Per clip and in total: strict WER, script-aware WER (Devanagari mapped to Gujarati, Latin never mapped), the count of
Latin-versus-Indic substitutions, script share, seconds and cost. The aggregate WER is total errors over total
reference words, not an average of averages. Results go to data/asr/eval/ (git-ignored). Only AGGREGATE numbers may be
copied into docs; transcripts and per-clip text never are.
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import json
import sys
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from app.asr.types import BYTES_PER_MS
from app.config import REPO_ROOT, Settings, load_settings
from app.own_voice import OWN_DIR, ThirdPartyAudioRefused, verify_own_voice
from app.smoke import EngineFactory, _run_once, default_engine, load_wav_16k_mono
from app.usage import PAID_ENGINES, CapExceeded, SpendGuard, UsageLog
from app.wer import script_share, wer_report

DEFAULT_LANGUAGE = "gu-IN"


@dataclass
class Clip:
    wav: Path
    reference: Path
    language: str

    @property
    def name(self) -> str:
        return self.wav.stem


def find_clips(folder: Path) -> tuple[list[Clip], list[str]]:
    """(clips that have a reference, names of wav files without one)."""
    clips, missing = [], []
    for wav in sorted(folder.glob("*.wav")):
        reference = wav.with_suffix(".txt")
        if not reference.exists():
            missing.append(wav.name)
            continue
        tag = wav.with_suffix(".lang")
        language = tag.read_text(encoding="utf-8").strip() if tag.exists() else DEFAULT_LANGUAGE
        clips.append(Clip(wav, reference, language or DEFAULT_LANGUAGE))
    return clips, missing


def run(
    args: argparse.Namespace,
    settings: Settings,
    factory: EngineFactory = default_engine,
    out: Callable[[str], None] = print,
    own_dir: Path = OWN_DIR,
) -> int:
    folder = Path(args.dir)
    clips, missing = find_clips(folder)
    if not clips:
        out(f"no clips: put name.wav and name.txt pairs in {folder}")
        return 2
    cap = settings.smoke_max_seconds
    loaded = [(c, *load_wav_16k_mono(c.wav, cap)) for c in clips]
    sent = [len(pcm) / (BYTES_PER_MS * 1000) for _, pcm, _ in loaded]
    usage = UsageLog(settings.usage_log_path)
    spend = SpendGuard(usage, settings.monthly_cap_minutes, settings.smoke_max_seconds)
    paid = args.engine in PAID_ENGINES
    estimate = usage.cost_inr(args.engine, sum(sent))
    refused: list[str] = []
    if paid and not settings.allow_third_party_audio:
        for clip in clips:
            try:
                verify_own_voice(clip.wav, own_dir)
            except ThirdPartyAudioRefused:
                refused.append(clip.name)
    out(
        f"{len(clips)} clips with a reference in {folder} ({len(missing)} wav without a .txt skipped)"
    )
    out(
        f"engine {args.engine}, mode {args.mode}; {sum(sent):.1f} s of audio to send (each clip capped at {cap:.0f} s)"
    )
    out(
        f"estimated cost INR {estimate:.2f}; paid audio left this month {spend.remaining_paid_seconds() / 60:.1f} min"
    )
    if paid:
        out(f"own-voice rule: {len(clips) - len(refused)} pass, {len(refused)} refused")
    if not args.yes_spend:
        out("DRY RUN: nothing was sent. Add --yes-spend to run it.")
        return 0
    if refused:
        out(
            f"refused: {len(refused)} clip(s) are not listed as the owner's own voice: {', '.join(refused)}"
        )
        return 3
    try:
        spend.check(args.engine, sum(sent), "stream")
    except CapExceeded as exc:
        out(f"refused: {exc}")
        return 3

    rows: list[dict[str, object]] = []
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S")
    target = settings.data_dir / "eval" / f"{stamp}-{args.engine}-{args.mode}"
    (target / "hyp").mkdir(parents=True, exist_ok=True)
    totals = {
        "ref": 0,
        "s": 0,
        "d": 0,
        "i": 0,
        "as": 0,
        "ad": 0,
        "ai": 0,
        "mismatch": 0,
        "sec": 0.0,
        "inr": 0.0,
    }
    for (clip, pcm, _duration), seconds in zip(loaded, sent, strict=True):
        engine = factory(args.engine, settings, spend, True, [], mode=args.mode)
        try:
            segments, _first, _took = asyncio.run(_run_once(engine, pcm, clip.language, []))
        except Exception as exc:  # noqa: BLE001 - the kind of failure only, never content
            out(f"{clip.name}: failed ({type(exc).__name__})")
            return 1
        text = " ".join(s.text for s in segments)
        billed = engine.report.billed_seconds
        charged = billed if billed is not None else engine.report.audio_seconds or seconds
        cost = usage.cost_inr(engine.name, charged)
        usage.add(
            request_id=str(uuid.uuid4()),
            purpose="smoke",
            engine=engine.name,
            engine_version=engine.version,
            audio_seconds=engine.report.audio_seconds or seconds,
            billed_seconds=billed,
        )
        reference = clip.reference.read_text(encoding="utf-8")
        strict, aware = wer_report(reference, text)
        share = script_share(text)
        (target / "hyp" / f"{clip.name}.txt").write_text(text, encoding="utf-8")
        rows.append(
            {
                "clip": clip.name, "language": clip.language, "reference_words": strict.reference_words,
                "strict_wer_pct": round(strict.wer * 100, 1), "aware_wer_pct": round(aware.wer * 100, 1),
                "latin_indic_mismatches": aware.latin_indic_mismatches, "seconds": round(seconds, 1),
                "cost_inr": round(cost, 2), "gujarati_pct": share["gujarati"],
                "devanagari_pct": share["devanagari"], "latin_pct": share["latin"],
            }
        )  # fmt: skip
        totals["ref"] += strict.reference_words
        totals["s"] += strict.errors
        totals["as"] += aware.errors
        totals["mismatch"] += aware.latin_indic_mismatches
        totals["sec"] += seconds
        totals["inr"] += cost
        out(
            f"{clip.name}: strict {strict.wer * 100:.1f}%, script-aware {aware.wer * 100:.1f}%, INR {cost:.2f}"
        )
    with (target / "results.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    ref = totals["ref"] or 1
    aggregate = (
        f"| engine | mode | clips | ref words | strict WER | script-aware WER | Latin-vs-Indic | seconds | INR |\n"
        f"| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n"
        f"| {args.engine} | {args.mode} | {len(rows)} | {totals['ref']} | {100 * totals['s'] / ref:.1f}% | "
        f"{100 * totals['as'] / ref:.1f}% | {totals['mismatch']} | {totals['sec']:.0f} | {totals['inr']:.2f} |\n"
    )
    (target / "results.md").write_text(aggregate, encoding="utf-8")
    (target / "meta.json").write_text(
        json.dumps({"engine": args.engine, "mode": args.mode, "clips": len(rows)})
    )
    out(aggregate.rstrip())
    out(f"details (private): {target}")
    return 0


def main(argv: list[str], factory: EngineFactory = default_engine) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.eval")
    parser.add_argument("--engine", required=True)
    parser.add_argument("--dir", default=str(REPO_ROOT / "audio" / "own"))
    parser.add_argument("--mode", default="codemix", help="Sarvam mode (default codemix)")
    parser.add_argument("--yes-spend", action="store_true")
    args = parser.parse_args(argv)
    return run(args, load_settings(), factory)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
