"""Converts the owner's own-voice clips (audio/own) into VaaniBench-Gu cases (Phase 11A, ADR-D43).

  python -m app.bench.convert [--src audio/own] [--out data/bench] [--copy-audio]

clip01 has audio and a reference text but no gold facts. clip02..clip11 are acted dialogues in READ_ALOUD_AND_GOLD.md: the
speaker-labelled lines (D doctor, P patient, M mother = attendant) become the segments, and the fact tables become the gold facts
(a DRAFT written with a model; a native Gujarati/Hindi speaker still has to check the wording - `needs_native_review`). Nothing
clinical is invented: the condition label, the expected questions, the candidates and the prescription are left empty (null / [])
because the owner has not annotated them. All cases are one speaker playing every role. Audio is copied only with --copy-audio.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import sys
import wave
from pathlib import Path

from app.bench.dataset import DATA_ROOT, validate_case
from app.config import REPO_ROOT
from app.eval_extraction import parse_gold_md
from app.wer import script_share

ROLE = {"D": "doctor", "P": "patient", "M": "attendant"}
SRC = REPO_ROOT / "audio" / "own"
LANG_HINT = re.compile(r"^##\s+(clip\d+)\s*(?:\((.*)\))?", re.M)


def seg_lang(text: str) -> str:
    share = script_share(text)
    g, d, la = share.get("gujarati", 0.0), share.get("devanagari", 0.0), share.get("latin", 0.0)
    top = max(g, d, la)
    if top == 0:
        return "en"
    if sum(1 for v in (g, d, la) if v >= 25) > 1:
        return "mixed"
    return "gu" if g == top else "hi" if d == top else "en"


def dialogue(markdown: str) -> dict[str, list[tuple[str, str]]]:
    out: dict[str, list[tuple[str, str]]] = {}
    current = None
    for line in markdown.splitlines():
        m = re.match(r"^##\s+(clip\d+)", line)
        if m:
            current = m.group(1)
            out[current] = []
        elif current and re.match(r"^[DPM]: ", line):
            out[current].append((line[0], line[3:].strip()))
    return out


def wav_info(path: Path) -> tuple[float | None, str]:
    sha = hashlib.sha256(path.read_bytes()).hexdigest()
    try:
        with wave.open(str(path), "rb") as w:
            return round(w.getnframes() / w.getframerate(), 2), sha
    except (wave.Error, EOFError):
        return None, sha


def build_case(
    clip: str,
    lines: list[str],
    roles: list[str] | None,
    gold: list,
    audio: dict,
    language_note: str,
) -> dict:
    speaker_ids = {"doctor": "s1", "patient": "s2", "attendant": "s3", "other": "s1"}
    used = sorted({r for r in roles or ["other"]}, key=lambda r: speaker_ids[r])
    segments = []
    for i, text in enumerate(lines):
        role = roles[i] if roles else "other"
        segments.append(
            {"idx": i, "speaker": speaker_ids[role], "text": text, "lang": seg_lang(text)}
        )
    langs = sorted({s["lang"] for s in segments} - {"mixed"}) or ["gu"]
    facts = []
    for g in gold:
        seg = next((i for i, t in enumerate(lines) if g.quote in t), None)
        facts.append(
            {
                "type": g.type,
                "value": g.value,
                "negated": g.negated,
                "uncertain": g.uncertain,
                "evidence_quote": g.quote,
                "segment": seg,
            }
        )
    return {
        "schema_version": "1",
        "id": clip,
        "synthetic": False,
        "acted": True,
        "audio": audio,
        "speakers": [
            {"id": speaker_ids[r], "role": r, "gender": "unknown", "actor_id": "A01"} for r in used
        ],
        "language_tags": langs,
        "transcript": {"segments": segments},
        "gold_facts": facts,
        "medicine_mentions": [],
        "expected_questions": [],
        "expected_candidates": [],
        "expected_prescription": [],
        "condition_label": None,
        "out_of_scope": False,
        "red_flag": False,
        "annotation": {
            "annotator": "A1",
            "double_annotated": False,
            "status": "draft",
            "needs_native_review": True,
        },
        "notes": f"Converted from audio/own ({language_note or 'read-aloud'}). One speaker (the owner) plays every role. "
        "Gold facts are a first draft: review before use.",
    }


def convert(src: Path, out: Path, copy_audio: bool = False) -> tuple[list[dict], list[str]]:
    gold_md = src / "READ_ALOUD_AND_GOLD.md"
    markdown = gold_md.read_text(encoding="utf-8") if gold_md.exists() else ""
    gold = parse_gold_md(markdown)
    dia = dialogue(markdown)
    notes = dict(LANG_HINT.findall(markdown))
    cases: list[dict] = []
    problems: list[str] = []
    for txt in sorted(src.glob("clip*.txt")):
        clip = txt.stem
        lines = [ln for ln in txt.read_text(encoding="utf-8").splitlines() if ln.strip()]
        roles = None
        if clip in dia and len(dia[clip]) == len(lines):
            roles = [ROLE[label] for label, _ in dia[clip]]
        elif clip in dia:
            problems.append(
                f"note {clip}: {len(dia[clip])} labelled lines but {len(lines)} text lines; roles skipped"
            )
        audio = {"file": None, "sha256": None, "duration_s": None, "noise_level": "unknown"}
        wav = src / f"{clip}.wav"
        if wav.exists():
            duration, sha = wav_info(wav)
            audio.update({"sha256": sha, "duration_s": duration})
            if copy_audio:
                (out / "audio").mkdir(parents=True, exist_ok=True)
                shutil.copyfile(wav, out / "audio" / wav.name)
                audio["file"] = f"audio/{wav.name}"
        case = build_case(clip, lines, roles, gold.get(clip, []), audio, notes.get(clip, ""))
        report = validate_case(case, out if copy_audio else None)
        problems += report.errors
        cases.append(case)
    return cases, problems


def main(argv: list[str], out=print) -> int:  # noqa: ANN001
    ap = argparse.ArgumentParser(prog="bench:convert")
    ap.add_argument("--src", type=Path, default=SRC)
    ap.add_argument("--out", type=Path, default=DATA_ROOT)
    ap.add_argument("--copy-audio", action="store_true")
    args = ap.parse_args(argv)
    cases, problems = convert(args.src, args.out, args.copy_audio)
    (args.out / "cases").mkdir(parents=True, exist_ok=True)
    for case in cases:
        (args.out / "cases" / f"{case['id']}.json").write_text(
            json.dumps(case, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
    out(f"{len(cases)} case(s) written to {args.out / 'cases'}")
    for p in problems:
        out(f"problem: {p}")
    return 1 if any(not p.startswith("note ") for p in problems) else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
