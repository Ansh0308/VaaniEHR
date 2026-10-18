# ENTITY_LINKING.md - linking extracted symptoms to the concept word list (Phase 5A Run 2)

Status: DRAFT word list from the owner, NOT clinician reviewed (OCI-017). Links are suggestions for the doctor; nothing is stored yet.

## Files
- `data/concepts/concepts_draft.txt` (owner's table, tab separated: `English`, `Gujarati`, `Hindi`; ` / ` separates synonyms). Git-ignored.
- `data/concepts/concepts.json` (made by `python -m app.extraction.linking convert`). Git-ignored. Format:
  `{"version":1,"source":"...","concepts":[{"id":"c001","labels":{"en":[..],"gu":[..],"hi":[..]},"review_status":"unreviewed","snomed_id":null}]}`
- `id` is an internal id (`c001`...), stable only while the draft rows keep their order. `snomed_id` stays null; the loader refuses one on an unreviewed concept. `review_status` becomes `reviewed` only when a clinician signs the list.
- A bracket in a cell (for example `cold (runny nose)`) gives three surface forms: the whole text, the part outside and the part inside.

## Matching (app/extraction/linking.py)
Text is Unicode NFC, case-folded, punctuation replaced by a space (letters and combining marks are kept), whitespace collapsed. Then: exact (whole value equals a form), contained (a form occurs as whole words inside the value; longest wins), fuzzy (same-length word run with ratio 0.85 or more; forms of 4+ characters). Two different concepts at the same best score give no link. Only `symptom` facts are linked.

## Precision check (`python -m app.extraction.linking check`)
Each gold symptom's EVIDENCE QUOTE (the words said, any script) is linked and compared with the gold value (English, bracket qualifiers ignored). Draft list and the ten acted cases, 2026-10-18, not tuned to the gold:
| gold symptoms | linked | correct | wrong | unlinked |
|---|---|---|---|---|
| 27 | 22 | 21 | 1 | 5 |
Precision of the linked ones 21/22; coverage 21/27. These are small, acted cases and a draft list: they are not a general accuracy. Known misses: spellings and verb forms not in the list (the matcher does not stem), a phrase that is not on the list (burning in stomach), and one wrong link where "felt like vomiting" (nausea) contains the word "vomiting". The wrong link is the reason links stay suggestions the doctor sees and confirms.

## Optional embedding linker
Parrotlet-e was checked and NOT added (gated model, terms not accepted, card unreadable; see ADR-D32).
