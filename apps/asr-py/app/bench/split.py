"""Frozen dev/test split and the no-tuning-on-test rule (Phase 11A, ADR-D43).

  python -m app.bench.split freeze [--cases data/bench/cases] [--out data/bench/split.json] [--test-fraction 0.3] [--models a,b]
  python -m app.bench.split check  [--cases data/bench/cases] [--split-file data/bench/split.json] [--models a,b]

`freeze` assigns each case to dev or test by a hash of its id and records the
SHA-256 of the test cases and a snapshot of everything that counts as tuning: the prompt hashes, the models and engines in use,
and the thresholds. It never overwrites an existing split file. `check` (and the runner, before any evaluation that includes a
test case) compares the current state with that snapshot and lists every difference; any difference refuses the test run:
- a test case was removed or edited, or a case added after the freeze (it is in neither set until the owner re-freezes under a new file),
- a prompt was edited since the freeze,
- a model or engine that was not in the frozen list is in use,
- a threshold changed.
With about 11 cases the split is a PROTOCOL DEMONSTRATION, not a result: the test set is too small to say anything.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import UTC, datetime
from pathlib import Path

from app.bench.dataset import DATA_ROOT, dataset_hash, load_cases
from app.eval_extraction import OVERLAP
from app.extraction.pipelines import prompt_hash_of

SPLIT_VERSION = 1
SEED = "vaanibench-split-v1"
VARIANTS = ("plain", "constrained", "grounded")
SPLIT_FILE = DATA_ROOT / "split.json"


def assign(ids: list[str], test_fraction: float = 0.3, seed: str = SEED) -> dict[str, list[str]]:
    """Deterministic: ids ordered by sha256(seed + id); the first ceil(fraction x n) (at least 1 when n >= 2) are test."""
    ordered = sorted(ids, key=lambda i: hashlib.sha256(f"{seed}:{i}".encode()).hexdigest())
    n_test = 0 if len(ordered) < 2 else max(1, round(len(ordered) * test_fraction))
    return {"test": sorted(ordered[:n_test]), "dev": sorted(ordered[n_test:])}


def tuning_state(models: list[str], thresholds: dict | None = None) -> dict:
    """Everything that counts as tuning. `thresholds` carries the question-engine parameters when the runner knows them."""
    return {
        "prompts": {v: prompt_hash_of(v) for v in VARIANTS},
        "models": sorted(set(models)),
        "thresholds": {"fact_overlap": OVERLAP, **(thresholds or {})},
    }


def freeze(
    cases: list[dict],
    state: dict,
    test_fraction: float = 0.3,
    seed: str = SEED,
    now: datetime | None = None,
) -> dict:
    real = [c for c in cases if not c.get("synthetic")]
    parts = assign([c["id"] for c in real], test_fraction, seed)
    by_id = {c["id"]: c for c in real}
    return {
        "version": SPLIT_VERSION,
        "seed": seed,
        "rule": "id order by sha256(seed:id); the first round(n x fraction) are test",
        "test_fraction": test_fraction,
        "frozen_at": (now or datetime.now(UTC)).isoformat(timespec="seconds"),
        "dev": parts["dev"],
        "test": parts["test"],
        "test_hash": dataset_hash([by_id[i] for i in parts["test"]]),
        "state": state,
        "note": "protocol demonstration: with about 11 cases this split is not a result",
    }


def split_hash(split: dict) -> str:
    return hashlib.sha256(json.dumps(split, sort_keys=True).encode("utf-8")).hexdigest()


def check_frozen(split: dict, cases: list[dict], state: dict) -> list[str]:
    """Reasons the test set must not be evaluated now (empty = clean)."""
    reasons: list[str] = []
    by_id = {c["id"]: c for c in cases}
    missing = [i for i in split["test"] if i not in by_id]
    if missing:
        reasons.append(f"test case(s) missing or removed: {', '.join(missing)}")
    else:
        if dataset_hash([by_id[i] for i in split["test"]]) != split["test_hash"]:
            reasons.append("a test case was edited since the freeze (its content hash changed)")
    unassigned = sorted(
        set(by_id)
        - set(split["dev"])
        - set(split["test"])
        - {c["id"] for c in cases if c.get("synthetic")}
    )
    if unassigned:
        reasons.append(
            f"case(s) added after the freeze are in neither set: {', '.join(unassigned)}"
        )
    frozen = split["state"]
    for variant, h in state["prompts"].items():
        if frozen["prompts"].get(variant) != h:
            reasons.append(
                f"the '{variant}' prompt was edited since the freeze (prompt hash changed)"
            )
    new_models = sorted(set(state["models"]) - set(frozen["models"]))
    if new_models:
        reasons.append(f"model or engine not in the frozen list: {', '.join(new_models)}")
    for key, value in state["thresholds"].items():
        if key in frozen["thresholds"] and frozen["thresholds"][key] != value:
            reasons.append(f"threshold '{key}' changed ({frozen['thresholds'][key]} -> {value})")
    for key in frozen["thresholds"]:
        if key not in state["thresholds"]:
            reasons.append(f"threshold '{key}' is no longer reported (cannot show it is unchanged)")
    return reasons


def load_split(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def main(argv: list[str], out=print) -> int:  # noqa: ANN001
    ap = argparse.ArgumentParser(prog="bench:split")
    sub = ap.add_subparsers(dest="command", required=True)
    for name in ("freeze", "check"):
        p = sub.add_parser(name)
        p.add_argument("--cases", type=Path, default=DATA_ROOT / "cases")
        p.add_argument("--models", default="mock-model,mock")
        p.add_argument("--split-file", "--out", dest="split_file", type=Path, default=SPLIT_FILE)
        p.add_argument("--test-fraction", type=float, default=0.3)
    args = ap.parse_args(argv)
    cases = load_cases(args.cases)
    state = tuning_state([m for m in args.models.split(",") if m])
    if args.command == "freeze":
        if args.split_file.exists():
            out(f"refused: {args.split_file} already exists. A frozen split is never overwritten.")
            return 2
        split = freeze(cases, state, args.test_fraction)
        args.split_file.parent.mkdir(parents=True, exist_ok=True)
        args.split_file.write_text(
            json.dumps(split, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
        out(
            f"frozen: {len(split['dev'])} dev, {len(split['test'])} test; test hash {split['test_hash'][:12]}"
        )
        out("this is a protocol demonstration, not a result")
        return 0
    reasons = check_frozen(load_split(args.split_file), cases, state)
    for r in reasons:
        out(f"TUNING DETECTED: {r}")
    out("clean" if not reasons else "the test set must not be evaluated")
    return 1 if reasons else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
