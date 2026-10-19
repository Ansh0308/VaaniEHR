"""Usage log and monthly spend cap for language-model calls, mirroring the ASR usage log (app/usage.py).

One JSON line per extraction run in data/asr/llm-usage.jsonl (git-ignored): ids, provider, MODEL ID, RUN DATE, prompt
version and hash, token counts, an estimate of the cost and the counts of what the pipeline kept and dropped. Never the
transcript, the prompt text, a fact or a key. The monthly caps (UTC month) are checked BEFORE a call; the mock costs
nothing and does not count towards them. Rates are per million tokens and configurable; the default for every rate is 0
(free models), so the token cap is the one that matters then.
"""

from __future__ import annotations

import json
import os
import threading
from collections.abc import Callable
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path

from app.usage import CapExceeded


@dataclass(frozen=True)
class LlmUsageRecord:
    ts: str
    run_date: str
    run_id: str
    purpose: str  # "extract" | "eval"
    pipeline: str
    provider: str
    model: str
    prompt_version: str
    prompt_hash: str
    input_tokens: int
    output_tokens: int
    estimated_cost_inr: float
    paid: bool
    facts_kept: int
    dropped_ungrounded: int
    dropped_invalid: int
    schema_failures: int
    session_id: str | None = None
    requests: int = 0


class LlmUsageLog:
    def __init__(
        self,
        path: Path,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
        input_inr_per_million: float = 0.0,
        output_inr_per_million: float = 0.0,
    ) -> None:
        self.path = path
        self._clock = clock
        self._in, self._out = input_inr_per_million, output_inr_per_million
        self._lock = threading.Lock()

    def cost_inr(self, input_tokens: int, output_tokens: int) -> float:
        return round(input_tokens * self._in / 1e6 + output_tokens * self._out / 1e6, 4)

    def add(self, **fields: object) -> LlmUsageRecord:
        now = self._clock()
        record = LlmUsageRecord(
            ts=now.isoformat(timespec="seconds"), run_date=now.date().isoformat(), **fields
        )  # type: ignore[arg-type]
        with self._lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            fd = os.open(self.path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
            with os.fdopen(fd, "a", encoding="utf-8") as handle:
                handle.write(json.dumps(asdict(record), ensure_ascii=False) + "\n")
        return record

    def records(self) -> list[LlmUsageRecord]:
        if not self.path.exists():
            return []
        return [
            LlmUsageRecord(**json.loads(line))
            for line in self.path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]

    def month_requests(self) -> int:
        month = self._clock().strftime("%Y-%m")
        return sum(r.requests for r in self.records() if r.paid and r.ts.startswith(month))

    def month_totals(self) -> tuple[int, float]:
        """(tokens, INR) used by PAID providers this UTC month."""
        month = self._clock().strftime("%Y-%m")
        # a row with no request was answered from the local cache: it spent no tokens and no money
        rows = [r for r in self.records() if r.paid and r.requests > 0 and r.ts.startswith(month)]
        return sum(r.input_tokens + r.output_tokens for r in rows), sum(
            r.estimated_cost_inr for r in rows
        )


class LlmSpendGuard:
    def __init__(
        self,
        log: LlmUsageLog,
        monthly_cap_inr: float,
        monthly_cap_tokens: int,
        monthly_cap_requests: int = 1000,
    ) -> None:
        self._log, self._inr, self._tokens = log, monthly_cap_inr, monthly_cap_tokens
        self._requests = monthly_cap_requests

    def check(self, paid: bool, estimated_input_tokens: int, requests: int = 1) -> None:
        if not paid:
            return
        if self._log.month_requests() + requests > self._requests:
            raise CapExceeded(
                f"the monthly language-model request cap of {self._requests} would be passed"
            )
        tokens, inr = self._log.month_totals()
        if tokens + estimated_input_tokens > self._tokens:
            raise CapExceeded(
                f"the monthly language-model token cap of {self._tokens} would be passed ({tokens} used)"
            )
        if inr >= self._inr:
            raise CapExceeded(
                f"the monthly language-model cost cap of INR {self._inr:.0f} is used up"
            )
