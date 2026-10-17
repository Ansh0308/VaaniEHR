"""Prints the usage table: `python -m app.usage_report [YYYY-MM]`. Shows seconds and INR per engine, nothing else."""

import sys

from app.config import load_settings
from app.usage import UsageLog


def main(argv: list[str]) -> int:
    settings = load_settings()
    log = UsageLog(settings.usage_log_path)
    month = argv[0] if argv else log.month_key()
    table = log.summary(month)
    print(f"Usage for {month} (UTC)")
    if not table:
        print("  no requests")
    for engine, row in sorted(table.items()):
        print(
            f"  {engine:<20} {int(row['requests']):>4} requests  {row['audio_seconds'] / 60:>8.1f} min audio"
            f"  {row['billed_seconds'] / 60:>8.1f} min billed  INR {row['inr']:>9.2f}"
        )
    used = log.paid_seconds_this_month() / 60
    print(f"  paid audio this month: {used:.1f} of {settings.monthly_cap_minutes:.0f} min cap")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
