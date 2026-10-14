"""Build docs/DOC_INDEX.md from the PRD (Python, cross-platform; ADR-D9).

Run: npm run docs:index     (or: python scripts/build_doc_index.py)
Reads  DOCUMENTS/VaaniEHR_PRD.md (PRD v1.1), DOCUMENTS/archive/VaaniEHR_PRD_v1.0.md, docs/PRD_ERRATA.md,
       docs/templates/DOC_INDEX.template.md
Writes docs/DOC_INDEX.md. Requirement tables are copied from the PRD text, never retyped.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))

import prd_id_diff  # noqa: E402  (same folder)

PRD = ROOT / "DOCUMENTS" / "VaaniEHR_PRD.md"
PRD_OLD = ROOT / "DOCUMENTS" / "archive" / "VaaniEHR_PRD_v1.0.md"
ERRATA = ROOT / "docs" / "PRD_ERRATA.md"
TEMPLATE = ROOT / "docs" / "templates" / "DOC_INDEX.template.md"
OUT = ROOT / "docs" / "DOC_INDEX.md"

lines = PRD.read_text(encoding="utf-8").splitlines()


def table(header_prefix: str) -> str:
    for i, line in enumerate(lines):
        if line.startswith(header_prefix):
            j = i
            while j < len(lines) and lines[j].startswith("|"):
                j += 1
            return "\n".join(lines[i:j])
    sys.exit(f"table not found in PRD: {header_prefix}")


def id_diff_markdown() -> str:
    if not PRD_OLD.exists():
        return "_Archived v1.0 not found; comparison skipped._"
    old, new = prd_id_diff.extract(PRD_OLD), prd_id_diff.extract(PRD)
    rows = ["| ID family | v1.0 | v1.1 | Added | Removed | Reworded |", "|---|---|---|---|---|---|"]
    for family in prd_id_diff.FAMILIES:
        o, n = old[family], new[family]
        added = sorted(set(n) - set(o))
        removed = sorted(set(o) - set(n))
        reworded = sorted(i for i in set(o) & set(n) if o[i] != n[i])
        rows.append(
            f"| {family} | {len(o)} | {len(n)} | {', '.join(added) or '-'} | "
            f"{', '.join(removed) or '-'} | {', '.join(reworded) or '-'} |"
        )
    return "\n".join(rows)


def errata_status_markdown() -> str:
    text = ERRATA.read_text(encoding="utf-8")
    applied = partly = no_change = 0
    open_rows: list[str] = []
    for line in text.splitlines():
        m = re.match(r"^\| (\d+) \|", line)
        if not m or not line.rstrip().endswith("|"):
            continue
        last = line.rstrip().rstrip("|").rsplit("|", 1)[-1].strip()
        if last.startswith("applied in PRD v1.1"):
            applied += 1
        elif last.startswith("no change needed"):
            no_change += 1
        elif "PARTLY" in last or "NOT covered" in last:
            partly += 1
            open_rows.append(f"- **Row {m.group(1)}**: {last}")
        elif "|" in line and last:
            open_rows.append(f"- **Row {m.group(1)}**: {last}")
    summary = (
        f"`PRD_ERRATA.md` has {applied + partly + no_change} rows: **{applied} applied in PRD v1.1**, "
        f"{no_change} needing no change, **{partly} partly covered / not yet covered**."
    )
    return summary + ("\n\n" + "\n".join(open_rows) if open_rows else "")


def tagged() -> str:
    out = []
    for n, line in enumerate(lines, 1):
        if "[Assumption]" in line or "[Unverified]" in line:
            text = re.sub(r"\s+", " ", line).strip()
            out.append(f"- l.{n}: {text[:230]}{'...' if len(text) > 230 else ''}")
    return "\n".join(out)


f_headings = "\n".join("- " + ln.lstrip("# ").strip() for ln in lines if re.match(r"### F\d+ ", ln))
fr_rows = ["| ID | Requirement |", "|---|---|"] + [
    ln for ln in lines if re.match(r"\| FR-F\d+-\d+ \|", ln)
]

fills = {
    "F_HEADINGS": f_headings,
    "FR_ROWS": "\n".join(fr_rows),
    "PG_TABLE": table("| ID | Page | Route"),
    "NFR_TABLE": table("| ID | Category | Requirement | Target |"),
    "M_TABLE": table("| # | Metric | Definition | Target | Measured by |"),
    "G_TABLE": "**Goals (§1.4)**\n\n" + table("| ID | Goal | How we will know |"),
    "R_TABLE": "**Risks (§16.1)**\n\n" + table("| ID | Risk | Likelihood | Impact | Mitigation |"),
    "D_TABLE": "**Open decisions (§16.2) - PRD-D1..PRD-D7**\n\n"
    + table("| ID | Decision | Options | Recommendation |"),
    "ID_DIFF": id_diff_markdown(),
    "ERRATA_STATUS": errata_status_markdown(),
    "TAGGED": tagged(),
}

text = TEMPLATE.read_text(encoding="utf-8")
for key, value in fills.items():
    text = text.replace("{{" + key + "}}", value)
if "{{" in text:
    sys.exit("unfilled placeholder in template")
OUT.write_text(text, encoding="utf-8", newline="\n")
print(
    f"wrote {OUT.relative_to(ROOT)}: F={len(f_headings.splitlines())} FR={len(fr_rows) - 2} "
    f"PG={fills['PG_TABLE'].count('| PG-')} NFR={fills['NFR_TABLE'].count('| NFR-')} "
    f"M={fills['M_TABLE'].count('| M-')} tagged={len(tagged().splitlines())}"
)
