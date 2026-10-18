"""Manual model download: `python -m app.models_cli list` or `python -m app.models_cli download <name> [--yes]`.

Nothing is downloaded without --yes. Before downloading it prints the file count and total size taken from the
Hugging Face metadata API for the PINNED revision, and checks free disk space (needs 1.5 x the size plus 1 GB).
CI and tests never call this. The token (HF_TOKEN) is read from the environment and never printed.
"""

from __future__ import annotations

import json
import os
import shutil
import sys
import urllib.request
from collections.abc import Callable
from pathlib import Path

from app.asr.models import ALL_PINNED, PinnedModel
from app.config import REPO_ROOT

GB = 1_000_000_000


def fetch_size_bytes(model: PinnedModel) -> tuple[int, int]:
    """(file count, total bytes) of the pinned revision, from the metadata API (no weights are downloaded)."""
    token = os.environ.get("HF_TOKEN")
    request = urllib.request.Request(  # noqa: S310 - fixed https host
        f"https://huggingface.co/api/models/{model.repo}/revision/{model.revision}?blobs=true",
        headers={"Authorization": f"Bearer {token}"} if token else {},
    )
    with urllib.request.urlopen(request, timeout=30) as response:  # noqa: S310
        files = json.load(response).get("siblings", [])
    return len(files), sum(int(f.get("size") or 0) for f in files)


def snapshot(
    model: PinnedModel, target: Path
) -> None:  # pragma: no cover - needs huggingface_hub and a network
    from huggingface_hub import snapshot_download  # noqa: PLC0415

    snapshot_download(
        model.repo, revision=model.revision, local_dir=str(target), token=os.environ.get("HF_TOKEN")
    )


def main(
    argv: list[str],
    *,
    fetch: Callable[[PinnedModel], tuple[int, int]] = fetch_size_bytes,
    download: Callable[[PinnedModel, Path], None] = snapshot,
    free_bytes: Callable[[Path], int] = lambda p: shutil.disk_usage(p).free,
    out: Callable[[str], None] = print,
) -> int:
    if not argv or argv[0] == "list":
        for name, m in ALL_PINNED.items():
            out(
                f"{name:<18} {m.repo} @ {m.revision[:12]}  ~{m.approx_mb} MB{'  (gated: accept the terms)' if m.gated else ''}"
            )
        return 0
    if argv[0] != "download" or len(argv) < 2 or argv[1] not in ALL_PINNED:
        out(f"usage: list | download <{'|'.join(ALL_PINNED)}> [--yes] [--dir PATH]")
        return 2
    model = ALL_PINNED[argv[1]]
    target = (
        Path(argv[argv.index("--dir") + 1])
        if "--dir" in argv
        else REPO_ROOT / "data" / "models" / argv[1]
    )
    try:
        count, size = fetch(model)
    except Exception as exc:  # noqa: BLE001
        out(f"could not read the size from Hugging Face ({type(exc).__name__}); nothing downloaded")
        return 1
    probe = target if target.exists() else target.parent if target.parent.exists() else Path(".")
    free = free_bytes(probe)
    need = int(size * 1.5) + GB
    out(f"{model.repo} @ {model.revision[:12]}: {count} files, {size / 1e6:.0f} MB")
    out(f"free disk at {probe}: {free / GB:.1f} GB; needed: {need / GB:.1f} GB")
    if free < need:
        out("not enough free disk space; nothing downloaded")
        return 1
    if "--yes" not in argv:
        out("dry run: add --yes to download")
        return 0
    target.mkdir(parents=True, exist_ok=True)
    download(model, target)
    out(f"downloaded to {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
