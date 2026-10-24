"""VaaniBench-Gu case files: loading and validation (Phase 11A, ADR-D43). Spec: bench/README.md, bench/schema.json.

  python -m app.bench.dataset [--dir data/bench/cases] [--dir bench/fixtures] [--audio-root data/bench]

Exit 1 on any ERROR. The checks cover the schema (required fields, types, enums) and what a schema cannot say: every evidence
quote is a verbatim piece of one segment, speaker ids exist, segment indexes run 0..n-1, fact types are the extraction types,
no phone number or e-mail address is in any text, ids are unique. WARNINGS (never fail): a `gu` segment with almost no Gujarati
letters, an audio file that is named but missing under --audio-root, a case with no gold facts.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path

from app.config import REPO_ROOT
from app.extraction.models import FACT_TYPES
from app.wer import script_share

SCHEMA_VERSION = "1"
BENCH_ROOT = REPO_ROOT / "bench"
DATA_ROOT = REPO_ROOT / "data" / "bench"
NOISE = {"clean", "low", "medium", "high", "unknown"}
ROLES = {"doctor", "patient", "attendant", "other"}
GENDERS = {"female", "male", "other", "unknown"}
LANGS = {"gu", "hi", "en"}
SEG_LANGS = LANGS | {"mixed"}
REQUIRED = (
    "schema_version",
    "id",
    "synthetic",
    "acted",
    "audio",
    "speakers",
    "language_tags",
    "transcript",
    "gold_facts",
)
ALLOWED = set(REQUIRED) | {
    "medicine_mentions",
    "expected_questions",
    "expected_candidates",
    "expected_prescription",
    "condition_label",
    "out_of_scope",
    "red_flag",
    "pathway_set",
    "oracle_slots",
    "annotation",
    "notes",
}
ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{1,40}$")
PHONE_RE = re.compile(r"(?<!\d)(?:\+?91[\s-]?)?[6-9]\d{9}(?!\d)")
EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+")


@dataclass
class Report:
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    cases: int = 0

    def err(self, case: str, message: str) -> None:
        self.errors.append(f"{case}: {message}")

    def warn(self, case: str, message: str) -> None:
        self.warnings.append(f"{case}: {message}")


def _is_str(v: object) -> bool:
    return isinstance(v, str)


def validate_case(
    data: object, audio_root: Path | None = None, report: Report | None = None
) -> Report:
    r = report or Report()
    if not isinstance(data, dict):
        r.err("?", "a case must be a JSON object")
        return r
    cid = str(data.get("id", "?"))
    for key in REQUIRED:
        if key not in data:
            r.err(cid, f"missing field '{key}'")
    for key in data:
        if key not in ALLOWED:
            r.err(cid, f"unknown field '{key}'")
    if data.get("schema_version") != SCHEMA_VERSION:
        r.err(cid, f"schema_version must be '{SCHEMA_VERSION}'")
    if not (_is_str(data.get("id")) and ID_RE.match(data["id"])):
        r.err(cid, "id must be lowercase letters, digits, - or _ (2 to 41 characters)")
    for key in ("synthetic", "acted"):
        if key in data and not isinstance(data[key], bool):
            r.err(cid, f"'{key}' must be true or false")
    _audio(data.get("audio"), cid, audio_root, r)
    speakers = _speakers(data.get("speakers"), cid, r)
    tags = data.get("language_tags")
    if not (isinstance(tags, list) and tags and all(t in LANGS for t in tags)):
        r.err(cid, "language_tags must be a non-empty list of gu, hi, en")
    segments = _segments(data.get("transcript"), cid, speakers, r)
    _facts(data.get("gold_facts"), cid, segments, r)
    _optional(data, cid, r)
    return r


def _audio(a: object, cid: str, audio_root: Path | None, r: Report) -> None:
    if not isinstance(a, dict):
        r.err(cid, "audio must be an object")
        return
    for k in a:
        if k not in {"file", "sha256", "duration_s", "noise_level"}:
            r.err(cid, f"unknown audio field '{k}'")
    if a.get("noise_level") not in NOISE:
        r.err(cid, f"audio.noise_level must be one of {sorted(NOISE)}")
    f = a.get("file")
    if f is not None and not _is_str(f):
        r.err(cid, "audio.file must be a path or null")
    sha = a.get("sha256")
    if sha is not None and not (_is_str(sha) and re.fullmatch(r"[0-9a-f]{64}", sha)):
        r.err(cid, "audio.sha256 must be 64 lowercase hex characters or null")
    d = a.get("duration_s")
    if d is not None and not (isinstance(d, (int, float)) and not isinstance(d, bool) and d >= 0):
        r.err(cid, "audio.duration_s must be a number >= 0 or null")
    if _is_str(f) and audio_root is not None:
        path = (audio_root / f).resolve()
        if audio_root.resolve() not in path.parents:
            r.err(cid, "audio.file must stay inside the dataset folder")
        elif not path.exists():
            r.warn(cid, f"audio file '{f}' is named but not found under {audio_root}")
        elif sha and hashlib.sha256(path.read_bytes()).hexdigest() != sha:
            r.err(cid, "audio.sha256 does not match the file")


def _speakers(s: object, cid: str, r: Report) -> set[str]:
    ids: set[str] = set()
    if not (isinstance(s, list) and s):
        r.err(cid, "speakers must be a non-empty list")
        return ids
    for sp in s:
        if not isinstance(sp, dict) or not _is_str(sp.get("id")):
            r.err(cid, "every speaker needs an id")
            continue
        if sp["id"] in ids:
            r.err(cid, f"duplicate speaker id '{sp['id']}'")
        ids.add(sp["id"])
        if sp.get("role") not in ROLES:
            r.err(cid, f"speaker '{sp['id']}' role must be one of {sorted(ROLES)}")
        if "gender" in sp and sp["gender"] not in GENDERS:
            r.err(cid, f"speaker '{sp['id']}' gender must be one of {sorted(GENDERS)}")
    return ids


def _segments(t: object, cid: str, speakers: set[str], r: Report) -> list[str]:
    texts: list[str] = []
    segs = t.get("segments") if isinstance(t, dict) else None
    if not (isinstance(segs, list) and segs):
        r.err(cid, "transcript.segments must be a non-empty list")
        return texts
    for i, seg in enumerate(segs):
        if not isinstance(seg, dict):
            r.err(cid, f"segment {i} must be an object")
            texts.append("")
            continue
        if seg.get("idx") != i:
            r.err(cid, f"segment {i} has idx {seg.get('idx')!r}; indexes must run 0..n-1 in order")
        if seg.get("speaker") not in speakers:
            r.err(cid, f"segment {i} names an unknown speaker {seg.get('speaker')!r}")
        text = seg.get("text")
        if not (_is_str(text) and text.strip()):
            r.err(cid, f"segment {i} needs non-empty text")
            texts.append("")
            continue
        texts.append(text)
        if seg.get("lang") not in SEG_LANGS:
            r.err(cid, f"segment {i} lang must be one of {sorted(SEG_LANGS)}")
        for key in ("start_ms", "end_ms"):
            v = seg.get(key)
            if v is not None and not (isinstance(v, int) and not isinstance(v, bool) and v >= 0):
                r.err(cid, f"segment {i} {key} must be an integer >= 0 or null")
        if PHONE_RE.search(text) or EMAIL_RE.search(text):
            r.err(
                cid, f"segment {i} looks like it holds a phone number or e-mail address; remove it"
            )
        if seg.get("lang") == "gu" and script_share(text).get("gujarati", 0.0) < 30:
            r.warn(cid, f"segment {i} is tagged gu but has little Gujarati script")
    return texts


def _facts(facts: object, cid: str, texts: list[str], r: Report) -> None:
    if not isinstance(facts, list):
        r.err(cid, "gold_facts must be a list")
        return
    if not facts:
        r.warn(cid, "no gold facts")
    for i, f in enumerate(facts):
        if not isinstance(f, dict):
            r.err(cid, f"fact {i} must be an object")
            continue
        if f.get("type") not in FACT_TYPES:
            r.err(cid, f"fact {i} type {f.get('type')!r} is not one of {list(FACT_TYPES)}")
        if not _is_str(f.get("value")):
            r.err(cid, f"fact {i} needs a value")
        for k in ("negated", "uncertain"):
            if not isinstance(f.get(k), bool):
                r.err(cid, f"fact {i} '{k}' must be true or false")
        quote = f.get("evidence_quote")
        if not (_is_str(quote) and quote):
            r.err(cid, f"fact {i} needs an evidence_quote")
            continue
        seg = f.get("segment")
        if seg is not None:
            if not (isinstance(seg, int) and 0 <= seg < len(texts)):
                r.err(cid, f"fact {i} segment {seg!r} does not exist")
            elif quote not in texts[seg]:
                r.err(cid, f"fact {i} evidence quote is not verbatim in segment {seg}")
        elif not any(quote in t for t in texts):
            r.err(cid, f"fact {i} evidence quote is not verbatim in any segment")


def _optional(d: dict, cid: str, r: Report) -> None:
    for key in (
        "medicine_mentions",
        "expected_questions",
        "expected_candidates",
        "expected_prescription",
    ):
        if key in d and not isinstance(d[key], list):
            r.err(cid, f"'{key}' must be a list")
    for m in d.get("medicine_mentions", []) if isinstance(d.get("medicine_mentions"), list) else []:
        if not (isinstance(m, dict) and _is_str(m.get("spoken")) and _is_str(m.get("generic"))):
            r.err(cid, "every medicine mention needs 'spoken' and 'generic'")
    for key in ("out_of_scope", "red_flag"):
        if key in d and not isinstance(d[key], bool):
            r.err(cid, f"'{key}' must be true or false")
    if d.get("pathway_set") not in (None, "toy"):
        r.err(cid, "pathway_set must be 'toy' or null")
    if d.get("pathway_set") == "toy" and not isinstance(d.get("oracle_slots", {}), dict):
        r.err(cid, "oracle_slots must be an object")
    if d.get("condition_label") is not None and not _is_str(d["condition_label"]):
        r.err(cid, "condition_label must be text or null")


# ------------------------------------------------------------------ folders
def case_files(folder: Path) -> list[Path]:
    return sorted(p for p in folder.glob("*.json") if p.is_file())


def load_cases(folder: Path) -> list[dict]:
    return [json.loads(p.read_text(encoding="utf-8")) for p in case_files(folder)]


def dataset_hash(cases: Iterable[dict]) -> str:
    """SHA-256 over the cases in id order (canonical JSON): identifies exactly which data a run saw."""
    h = hashlib.sha256()
    for c in sorted(cases, key=lambda c: c["id"]):
        h.update(
            json.dumps(c, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
        )
        h.update(b"\n")
    return h.hexdigest()


def validate_folder(folder: Path, audio_root: Path | None = None) -> Report:
    r = Report()
    seen: set[str] = set()
    for path in case_files(folder):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            r.err(path.name, f"cannot read: {exc}")
            continue
        r.cases += 1
        validate_case(data, audio_root, r)
        cid = data.get("id") if isinstance(data, dict) else None
        if cid and path.stem != cid:
            r.err(str(cid), f"file name {path.name} must match the id")
        if cid in seen:
            r.err(str(cid), "duplicate id")
        if cid:
            seen.add(str(cid))
    return r


def main(argv: list[str], out=print) -> int:  # noqa: ANN001
    ap = argparse.ArgumentParser(
        prog="bench:validate", description="Validate VaaniBench-Gu case files."
    )
    ap.add_argument(
        "--dir", action="append", type=Path, help="folder of case JSON files (repeatable)"
    )
    ap.add_argument("--audio-root", type=Path, default=None)
    args = ap.parse_args(argv)
    folders = args.dir or [DATA_ROOT / "cases", BENCH_ROOT / "fixtures"]
    total = Report()
    for folder in folders:
        if not folder.exists():
            out(f"(skipped, not found: {folder})")
            continue
        audio_root = args.audio_root or (DATA_ROOT if folder.parent == DATA_ROOT else None)
        r = validate_folder(folder, audio_root)
        total.errors += r.errors
        total.warnings += r.warnings
        total.cases += r.cases
        out(f"{folder}: {r.cases} case(s), {len(r.errors)} error(s), {len(r.warnings)} warning(s)")
    for line in total.errors:
        out(f"ERROR {line}")
    for line in total.warnings:
        out(f"warning {line}")
    return 1 if total.errors else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
