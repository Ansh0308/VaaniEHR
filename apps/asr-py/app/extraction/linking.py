"""Entity linking of extracted fact values to the owner's concept word list (Phase 5A Run 2, docs/ENTITY_LINKING.md).

The word list is the owner's DRAFT (data/concepts/concepts_draft.txt: English / Gujarati / Hindi columns, " / " between
synonyms). `convert` turns it into data/concepts/concepts.json (git-ignored). EVERY concept is "unreviewed", has an
internal id (c001, c002, ...) and a NULL snomed_id: no code system id is invented here (OCI-017).

Matching is lexical first, then fuzzy, on text that is Unicode NFC, case-folded, with punctuation removed and spaces
collapsed (Gujarati, Devanagari and Latin are all handled as space-separated words):
  exact      the whole value equals a surface form
  contained  a surface form occurs as a run of whole words inside the value (longest form wins)
  fuzzy      a run of words of the same length as a form is >= 0.85 similar (forms of 4+ characters only)
Two different concepts with the same best score make the answer "ambiguous": no link is made. A link is a SUGGESTION for
the doctor's screen, never a decision, and the concept stays unreviewed until a clinician signs the list.

  python -m app.extraction.linking convert [--draft F] [--out F]
  python -m app.extraction.linking check   [--concepts F] [--gold-md F]   (precision against the gold facts)
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path

from app.config import REPO_ROOT

CONCEPTS_DIR = REPO_ROOT / "data" / "concepts"
FUZZY_MIN = 0.85
FUZZY_MIN_CHARS = 4
LINKABLE_TYPES = {"symptom"}  # the owner's list holds symptoms; other fact types are not linked


def norm(text: str) -> str:
    """NFC, case-folded, punctuation (not combining marks) replaced by a space, whitespace collapsed."""
    text = unicodedata.normalize("NFC", text).casefold()
    kept = []
    for ch in text:
        category = unicodedata.category(ch)
        kept.append(
            " " if category.startswith(("P", "S", "C")) else ch
        )  # marks (M*) and letters stay
    return " ".join("".join(kept).split())


@dataclass(frozen=True)
class Concept:
    id: str
    labels: dict[str, list[str]]  # language -> surface forms
    review_status: str = "unreviewed"
    snomed_id: str | None = None

    def forms(self) -> list[tuple[str, str]]:
        return [(lang, form) for lang, forms in self.labels.items() for form in forms]


@dataclass(frozen=True)
class Link:
    concept_id: str
    form: str
    method: str  # exact | contained | fuzzy
    score: float
    review_status: str


def _split_forms(cell: str) -> list[str]:
    """'cold (runny nose)' keeps the whole text and adds the part outside and the part inside the brackets."""
    forms: list[str] = []
    for part in cell.split("/"):
        part = part.strip()
        if not part:
            continue
        forms.append(part)
        outside = re.sub(r"\([^)]*\)", " ", part).strip()
        inside = re.findall(r"\(([^)]*)\)", part)
        forms += [x.strip() for x in [outside, *inside] if x.strip() and x.strip() != part]
    return list(dict.fromkeys(forms))


def convert_draft(draft: str) -> dict[str, object]:
    rows = [ln for ln in draft.splitlines() if ln.strip()]
    header = [h.strip().lower() for h in rows[0].split("\t")]
    langs = {"english": "en", "gujarati": "gu", "hindi": "hi"}
    if [h for h in header if h not in langs]:
        raise ValueError(
            "the first row must name the columns English, Gujarati, Hindi (tab separated)"
        )
    concepts = []
    for number, row in enumerate(rows[1:], start=1):
        cells = row.split("\t")
        labels = {
            langs[h]: _split_forms(c) for h, c in zip(header, cells, strict=False) if c.strip()
        }
        concepts.append(
            {
                "id": f"c{number:03d}",
                "labels": labels,
                "review_status": "unreviewed",
                "snomed_id": None,
            }
        )
    return {
        "version": 1,
        "source": "owner draft word list (concepts_draft.txt), not clinician reviewed",
        "concepts": concepts,
    }


def load_concepts(path: Path) -> list[Concept]:
    data = json.loads(path.read_text(encoding="utf-8"))
    out = []
    for c in data["concepts"]:
        status = c.get("review_status", "unreviewed")
        if status not in ("unreviewed", "reviewed"):
            raise ValueError(f"concept {c.get('id')}: review_status must be unreviewed or reviewed")
        if c.get("snomed_id") is not None and status != "reviewed":
            raise ValueError(
                f"concept {c.get('id')}: a snomed_id is only allowed on a reviewed concept"
            )
        out.append(
            Concept(
                c["id"], {k: list(v) for k, v in c["labels"].items()}, status, c.get("snomed_id")
            )
        )
    return out


class Linker:
    def __init__(self, concepts: list[Concept]) -> None:
        self.concepts = {c.id: c for c in concepts}
        self._forms: list[
            tuple[str, str, list[str]]
        ] = []  # concept id, original form, normalised words
        for c in concepts:
            for _, form in c.forms():
                words = norm(form).split()
                if words:
                    self._forms.append((c.id, form, words))

    def link(self, fact_type: str, value: str) -> Link | None:
        if fact_type not in LINKABLE_TYPES:
            return None
        words = norm(value).split()
        if not words:
            return None
        best: dict[
            str, tuple[float, int, str, str]
        ] = {}  # concept -> (score, length, method, form)
        for cid, form, fwords in self._forms:
            hit = self._match(words, fwords)
            if hit is None:
                continue
            method, score = hit
            rank = (
                score + (1.0 if method == "exact" else 0.5 if method == "contained" else 0.0),
                len(" ".join(fwords)),
                method,
                form,
            )
            if cid not in best or rank[:2] > best[cid][:2]:
                best[cid] = rank
        if not best:
            return None
        ranked = sorted(best.items(), key=lambda kv: kv[1][:2], reverse=True)
        if len(ranked) > 1 and ranked[0][1][:2] == ranked[1][1][:2]:
            return None  # ambiguous
        cid, (_, _, method, form) = ranked[0]
        score = 1.0 if method != "fuzzy" else round(self._score(words, form), 3)
        return Link(cid, form, method, score, self.concepts[cid].review_status)

    @staticmethod
    def _score(words: list[str], form: str) -> float:
        fw = norm(form).split()
        k = len(fw)
        return max(
            (
                SequenceMatcher(None, " ".join(words[i : i + k]), " ".join(fw)).ratio()
                for i in range(max(1, len(words) - k + 1))
            ),
            default=0.0,
        )

    @staticmethod
    def _match(words: list[str], fwords: list[str]) -> tuple[str, float] | None:
        k = len(fwords)
        if words == fwords:
            return "exact", 1.0
        for i in range(len(words) - k + 1):
            if words[i : i + k] == fwords:
                return "contained", 1.0
        target = " ".join(fwords)
        if len(target) < FUZZY_MIN_CHARS:
            return None
        best = max(
            (
                SequenceMatcher(None, " ".join(words[i : i + k]), target).ratio()
                for i in range(max(1, len(words) - k + 1))
            ),
            default=0.0,
        )
        return ("fuzzy", best) if best >= FUZZY_MIN else None


# ------------------------------------------------------------------ CLI
def _base_value(value: str) -> str:
    return norm(re.sub(r"\([^)]*\)", " ", value))


def precision_check(linker: Linker, gold_md: Path) -> dict[str, int]:
    """For each gold SYMPTOM, link its evidence quote (the words actually said) and compare with the gold value.

    correct = linked to the concept whose English form equals the gold value (qualifiers in brackets ignored);
    wrong = linked to another concept; unlinked = no link (not counted against precision)."""
    from app.eval_extraction import parse_gold_md  # noqa: PLC0415

    by_en = {norm(f): cid for cid, c in linker.concepts.items() for f in c.labels.get("en", [])}
    counts = {
        "gold_symptoms": 0,
        "linked": 0,
        "correct": 0,
        "wrong": 0,
        "unlinked": 0,
        "gold_value_not_in_list": 0,
    }
    for facts in parse_gold_md(gold_md.read_text(encoding="utf-8")).values():
        for g in facts:
            if g.type != "symptom":
                continue
            counts["gold_symptoms"] += 1
            expected = by_en.get(_base_value(g.value))
            link = linker.link("symptom", g.quote)
            if expected is None:
                counts["gold_value_not_in_list"] += 1
            if link is None:
                counts["unlinked"] += 1
            else:
                counts["linked"] += 1
                counts["correct" if link.concept_id == expected else "wrong"] += 1
    return counts


def main(argv: list[str], out=print) -> int:  # noqa: ANN001
    parser = argparse.ArgumentParser(prog="python -m app.extraction.linking")
    sub = parser.add_subparsers(dest="cmd", required=True)
    conv = sub.add_parser("convert")
    conv.add_argument("--draft", default=str(CONCEPTS_DIR / "concepts_draft.txt"))
    conv.add_argument("--out", default=str(CONCEPTS_DIR / "concepts.json"))
    chk = sub.add_parser("check")
    chk.add_argument("--concepts", default=str(CONCEPTS_DIR / "concepts.json"))
    chk.add_argument(
        "--gold-md", default=str(REPO_ROOT / "audio" / "own" / "READ_ALOUD_AND_GOLD.md")
    )
    args = parser.parse_args(argv)
    if args.cmd == "convert":
        data = convert_draft(Path(args.draft).read_text(encoding="utf-8"))
        Path(args.out).write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
        out(f"{len(data['concepts'])} concepts written (all unreviewed, snomed_id NULL)")  # type: ignore[arg-type]
        return 0
    linker = Linker(load_concepts(Path(args.concepts)))
    for key, value in precision_check(linker, Path(args.gold_md)).items():
        out(f"{key}: {value}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
