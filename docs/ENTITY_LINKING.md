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

## Concept suggestion in the app (remaining Phase 5 items, ADR-D37)
- The doctor sees up to three suggestions per symptom fact, each labelled "(unreviewed list)", and confirms one, picks another, or says none of these. The system never stores a link by itself. A link is stale when the fact's words change.
- Implementation: `Linker.suggest()` in Python (reference) and `ConceptLinker.suggest()` in `packages/rules/src/linking.ts`, checked against `packages/rules/fixtures/concepts/linker-parity.json`.
- Command for the measurement below: `cd apps/asr-py && python -m app.extraction.linking measure`.

### Measurement over the gold facts (2026-10-21; measured, NOT tuned)
Draft word list (31 concepts, all unreviewed) and the 13 acted or synthetic cases (10 clips and 3 fixtures). 56 gold facts; 30 are symptoms (only symptoms are linked); for 29 of them the right concept is in the list (one gold symptom, "burning in stomach", is not in the draft list).

| Input to the linker | Right concept at rank 1 | Right concept in the top 3 | No suggestion at all |
| --- | --- | --- | --- |
| The words said (the evidence quote, in Gujarati, Hindi or English) | 24 of 29 | 24 of 29 | 4 of 29 |
| The English gold value (the concept's own English name) | 29 of 29 | 29 of 29 | 0 of 29 |

How to read it: the first row is the realistic one (the doctor sees suggestions made from what was said). 24 of 29 had the right concept first; 4 had no suggestion because the wording is not on the list (the matcher does not stem verb forms and cannot join "सिर में दर्द" to "सिर दर्द"); 1 had a wrong first suggestion ("felt like vomiting" suggests vomiting, not nausea). Rank 3 added nothing over rank 1 on these cases. The second row is not a result: the gold value is the concept's own name, so it only shows the plumbing works.
**Caveats, all of them:** the list is the owner's DRAFT and has not been reviewed by a clinician or by Gujarati and Hindi speakers (OCI-017); the gold labels are a first draft; 13 small acted cases and 29 facts are far too few to say anything general; the numbers were not used to change the matcher, the list or the threshold.
