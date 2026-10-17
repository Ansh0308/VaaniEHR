"""Cost and usage log (owner request): seconds of audio per engine per request, an INR estimate, and spend caps.

One JSON line per request in an append-only file under data/ (git-ignored). A line holds ids, engine, seconds and
money only: never audio, never transcript text, never a patient name. Months are UTC calendar months.
"""

from __future__ import annotations

import json
import os
import threading
from collections import defaultdict
from collections.abc import Callable, Mapping
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path

#: Engines that cost money per second. Everything else runs locally and costs nothing.
PAID_ENGINES = frozenset({"sarvam", "sarvam-diarization"})

#: INR per hour of audio, billed per second. Source: docs/vendor-notes.md (Sarvam pricing page, 2026-10-17).
DEFAULT_RATES_INR_PER_HOUR: Mapping[str, float] = {"sarvam": 30.0, "sarvam-diarization": 45.0}


class CapExceeded(Exception):
    """A spend cap would be passed. The message says which cap; the request is refused before any audio is sent."""


@dataclass(frozen=True)
class UsageRecord:
    ts: str
    request_id: str
    #: "stream" | "smoke" | "batch" ; session ids are random UUIDs, never names
    purpose: str
    session_id: str | None
    engine: str
    engine_version: str
    audio_seconds: float
    #: what the vendor says it billed (Sarvam session.end audio_duration_s); None for local engines
    billed_seconds: float | None
    estimated_cost_inr: float
    keyterms_requested: int = 0
    keyterms_applied: int = 0


class UsageLog:
    def __init__(
        self,
        path: Path,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
        rates: Mapping[str, float] = DEFAULT_RATES_INR_PER_HOUR,
    ) -> None:
        self.path = path
        self._clock = clock
        self._rates = dict(rates)
        self._lock = threading.Lock()

    def cost_inr(self, engine: str, seconds: float) -> float:
        return round(seconds * self._rates.get(engine, 0.0) / 3600.0, 4)

    def add(
        self,
        *,
        request_id: str,
        purpose: str,
        engine: str,
        engine_version: str,
        audio_seconds: float,
        billed_seconds: float | None = None,
        session_id: str | None = None,
        keyterms_requested: int = 0,
        keyterms_applied: int = 0,
    ) -> UsageRecord:
        # money follows what the vendor billed when it says so, else the audio we sent
        charged = billed_seconds if billed_seconds is not None else audio_seconds
        record = UsageRecord(
            ts=self._clock().isoformat(timespec="seconds"),
            request_id=request_id,
            purpose=purpose,
            session_id=session_id,
            engine=engine,
            engine_version=engine_version,
            audio_seconds=round(audio_seconds, 3),
            billed_seconds=None if billed_seconds is None else round(billed_seconds, 3),
            estimated_cost_inr=self.cost_inr(engine, charged),
            keyterms_requested=keyterms_requested,
            keyterms_applied=keyterms_applied,
        )
        with self._lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            fd = os.open(self.path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
            with os.fdopen(fd, "a", encoding="utf-8") as handle:
                handle.write(json.dumps(asdict(record), ensure_ascii=False) + "\n")
        return record

    def records(self) -> list[UsageRecord]:
        if not self.path.exists():
            return []
        rows: list[UsageRecord] = []
        for line in self.path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                rows.append(UsageRecord(**json.loads(line)))
        return rows

    def month_key(self) -> str:
        return self._clock().strftime("%Y-%m")

    def paid_seconds_this_month(self) -> float:
        month = self.month_key()
        return sum(
            (r.billed_seconds if r.billed_seconds is not None else r.audio_seconds)
            for r in self.records()
            if r.engine in PAID_ENGINES and r.ts.startswith(month)
        )

    def summary(self, month: str | None = None) -> dict[str, dict[str, float]]:
        """Per engine: requests, audio seconds, billed seconds, INR estimate for a month (default: this one)."""
        wanted = month or self.month_key()
        table: dict[str, dict[str, float]] = defaultdict(
            lambda: {"requests": 0.0, "audio_seconds": 0.0, "billed_seconds": 0.0, "inr": 0.0}
        )
        for r in self.records():
            if not r.ts.startswith(wanted):
                continue
            row = table[r.engine]
            row["requests"] += 1
            row["audio_seconds"] += r.audio_seconds
            row["billed_seconds"] += r.billed_seconds or 0.0
            row["inr"] += r.estimated_cost_inr
        return {k: {m: round(v, 3) for m, v in row.items()} for k, row in table.items()}


class SpendGuard:
    """Refuses paid requests that would pass the monthly cap, and smoke runs that pass the per-run cap."""

    def __init__(self, log: UsageLog, monthly_cap_minutes: float, smoke_max_seconds: float) -> None:
        self._log = log
        self._monthly_seconds = monthly_cap_minutes * 60.0
        self._smoke_max = smoke_max_seconds

    def check(self, engine: str, seconds: float, purpose: str = "stream") -> None:
        if purpose == "smoke" and seconds > self._smoke_max:
            raise CapExceeded(
                f"smoke run of {seconds:.0f} s is over the {self._smoke_max:.0f} s cap"
            )
        if engine not in PAID_ENGINES:
            return
        used = self._log.paid_seconds_this_month()
        if used + seconds > self._monthly_seconds:
            raise CapExceeded(
                f"monthly paid-audio cap of {self._monthly_seconds / 60:.0f} min would be passed "
                f"({used / 60:.1f} min used)"
            )

    def remaining_paid_seconds(self) -> float:
        return max(0.0, self._monthly_seconds - self._log.paid_seconds_this_month())
