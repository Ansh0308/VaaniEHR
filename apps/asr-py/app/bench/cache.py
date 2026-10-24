"""Content-addressed cache for the benchmark runner (Phase 11A, ADR-D43).

A stage result (a transcript, a set of extracted facts, a question-engine simulation) is stored under a key made from everything
that could change it: the stage name, the engine or model id, its version, the prompt hash, the input hash and the parameters.
Rerunning with the same inputs therefore costs nothing and gives the same numbers; changing any of them is a cache miss.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path


def digest(value: object) -> str:
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


class Cache:
    def __init__(self, folder: Path) -> None:
        self.folder = folder
        self.hits = 0
        self.misses = 0

    def key(self, stage: str, **parts: object) -> str:
        return digest({"stage": stage, **parts})

    def _path(self, key: str) -> Path:
        return self.folder / key[:2] / f"{key}.json"

    def has(self, key: str) -> bool:
        return self._path(key).exists()

    def get(self, key: str) -> dict | None:
        path = self._path(key)
        if not path.exists():
            self.misses += 1
            return None
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            self.misses += 1
            return None
        self.hits += 1
        return value

    def put(self, key: str, value: dict) -> None:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value, ensure_ascii=False, sort_keys=True), encoding="utf-8")
