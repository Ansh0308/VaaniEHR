"""Compare requirement IDs between two PRD versions (Python, cross-platform; ADR-D9).

Usage: python scripts/prd_id_diff.py <old.md> <new.md>
Reports, per ID family (F, FR, PG, NFR, M, G, R, PRD-D): added, removed, and reworded IDs.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

FAMILIES: dict[str, re.Pattern[str]] = {
    "F (feature headings)": re.compile(r"^### (F\d+) \S.*$"),
    "FR (functional requirements)": re.compile(r"^\| (FR-F\d+-\d+) \|.*$"),
    "PG (pages)": re.compile(r"^\| (PG-\d+) \|.*$"),
    "NFR (non-functional)": re.compile(r"^\| (NFR-[A-Z]+-\d+) \|.*$"),
    "M (metrics)": re.compile(r"^\| (M-\d+) \|.*$"),
    "G (goals)": re.compile(r"^\| (G\d+) \|.*$"),
    "R (risks)": re.compile(r"^\| (R\d+) \|.*$"),
    "PRD-D (open decisions)": re.compile(r"^\| (D\d+) \| .*\|.*\|.*\|$"),
}


def norm(line: str) -> str:
    return re.sub(r"\s+", " ", line).strip()


def extract(path: Path) -> dict[str, dict[str, str]]:
    lines = path.read_text(encoding="utf-8").splitlines()
    out: dict[str, dict[str, str]] = {name: {} for name in FAMILIES}
    in_decisions = False
    for line in lines:
        if line.startswith("### 16.2"):
            in_decisions = True
        elif line.startswith("## ") or line.startswith("### 16.3"):
            in_decisions = False
        for name, pattern in FAMILIES.items():
            if name.startswith("PRD-D") and not in_decisions:
                continue
            if name.startswith("R ") and in_decisions:
                continue
            match = pattern.match(line)
            if match:
                # Keep the first occurrence of an ID (later duplicates are prose tables).
                out[name].setdefault(match.group(1), norm(line))
    return out


def main(old_path: str, new_path: str) -> int:
    sys.stdout.reconfigure(encoding="utf-8")  # Windows consoles default to cp1252
    old, new = extract(Path(old_path)), extract(Path(new_path))
    any_diff = False
    for family in FAMILIES:
        o, n = old[family], new[family]
        added = sorted(set(n) - set(o))
        removed = sorted(set(o) - set(n))
        reworded = sorted(i for i in set(o) & set(n) if o[i] != n[i])
        print(f"\n== {family}: old={len(o)} new={len(n)}")
        if not (added or removed or reworded):
            print("   identical")
            continue
        any_diff = True
        for label, ids in (("added", added), ("removed", removed), ("reworded", reworded)):
            if ids:
                print(f"   {label}: {', '.join(ids)}")
        for i in reworded:
            print(f"   - {i} OLD: {o[i][:240]}")
            print(f"   - {i} NEW: {n[i][:240]}")
        for i in added:
            print(f"   + {i} NEW: {n[i][:240]}")
    print("\nRESULT:", "differences found" if any_diff else "no differences")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    sys.exit(main(sys.argv[1], sys.argv[2]))
