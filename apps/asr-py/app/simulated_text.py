"""The simulated-text rule for hosted language models (owner decision, Phase 5A Run 2).

A hosted or free model endpoint may log prompts, so the evaluation may send ONLY text the owner has declared simulated:
  - a clip text inside audio/own/ listed in audio/own/simulated_text_manifest.json with the SHA-256 of the file as it is
    now (editing the file breaks the match), or
  - a synthetic fixture (tests/fixtures/extraction, "synthetic": true), which the repository itself holds.
Manifest: {"files": {"clip02.txt": {"simulated": true, "sha256": "<hex>"}}}

  python -m app.simulated_text list clip02.txt clip03.txt ... --i-confirm-these-are-simulated-text
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from app.config import REPO_ROOT
from app.own_voice import sha256_of

OWN_DIR = REPO_ROOT / "audio" / "own"
MANIFEST = "simulated_text_manifest.json"


class NotSimulatedRefused(Exception):
    """Text that is not declared simulated was about to go to a hosted language model."""


def verify_simulated_text(path: Path, own_dir: Path = OWN_DIR) -> None:
    try:
        resolved, root = path.resolve(), own_dir.resolve()
    except OSError as exc:
        raise NotSimulatedRefused(f"cannot read {path.name}") from exc
    if root not in resolved.parents:
        raise NotSimulatedRefused(f"{path.name} is not inside audio/own/")
    manifest = own_dir / MANIFEST
    if not manifest.exists():
        raise NotSimulatedRefused(f"audio/own/{MANIFEST} is missing: list {path.name} there")
    try:
        files = json.loads(manifest.read_text(encoding="utf-8")).get("files", {})
    except ValueError as exc:
        raise NotSimulatedRefused(f"audio/own/{MANIFEST} is not valid JSON") from exc
    entry = files.get(path.name)
    if not isinstance(entry, dict) or entry.get("simulated") is not True:
        raise NotSimulatedRefused(f'{path.name} is not listed in {MANIFEST} with "simulated": true')
    if entry.get("sha256") != sha256_of(path):
        raise NotSimulatedRefused(f"{path.name} changed after it was listed; list it again")


def list_files(names: list[str], own_dir: Path = OWN_DIR) -> dict[str, dict[str, object]]:
    manifest = own_dir / MANIFEST
    files: dict[str, dict[str, object]] = {}
    if manifest.exists():
        files = json.loads(manifest.read_text(encoding="utf-8")).get("files", {})
    for name in names:
        path = own_dir / name
        if path.suffix != ".txt" or not path.is_file():
            raise NotSimulatedRefused(f"{name} is not a .txt file inside audio/own/")
        files[name] = {"simulated": True, "sha256": sha256_of(path)}
    manifest.write_text(json.dumps({"files": files}, indent=2), encoding="utf-8")
    return files


def main(argv: list[str], out=print) -> int:  # noqa: ANN001
    parser = argparse.ArgumentParser(prog="python -m app.simulated_text")
    sub = parser.add_subparsers(dest="cmd", required=True)
    listing = sub.add_parser("list", help="declare clip texts as simulated (made-up, acted) text")
    listing.add_argument("names", nargs="+")
    listing.add_argument("--i-confirm-these-are-simulated-text", action="store_true")
    args = parser.parse_args(argv)
    if not args.i_confirm_these_are_simulated_text:
        out(
            "add --i-confirm-these-are-simulated-text: they must be made-up text, never a real patient's"
        )
        return 2
    try:
        files = list_files(args.names)
    except NotSimulatedRefused as exc:
        out(str(exc))
        return 2
    out(f"{len(files)} text file(s) listed in audio/own/{MANIFEST}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
