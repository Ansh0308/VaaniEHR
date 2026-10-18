# EXTRACTION_EVAL_GUIDE.md - labelling acted transcripts and scoring fact extraction

Simulated data only. The synthetic fixtures in `apps/asr-py/tests/fixtures/extraction/` are made-up test input, not clinical guidance.

## 1. What is scored
`python -m app.eval_extraction` (or `npm run eval:extraction -- ...`) runs the extraction pipeline on text-only transcripts and compares the facts with your gold labels: precision, recall and F1 per fact type and overall, NEGATION F1 separately, and how many facts were dropped as ungrounded (the hallucination count). Each run records the model id, the run date and the prompt version.

## 2. Transcript files
- `audio/own/clipNN.txt`, UTF-8, one sentence per line, no speaker labels. Each line is one segment (s1, s2, ...).
- Script convention: Gujarati script for Gujarati, Devanagari for Hindi, Latin for English words and drug names. No real names or real patients.

## 3. Gold labels
Either keep the tables in `audio/own/READ_ALOUD_AND_GOLD.md` (a `## clipNN` heading, then rows `| type | value | negated | uncertain | evidence quote |`; the command reads them directly), or write one JSON file per clip in a folder passed with `--gold-dir`:
```json
{"id": "clip02", "facts": [
  {"type": "symptom", "value": "stomach pain", "negated": false, "uncertain": false, "evidence_quote": "પેટમાં દુખાવો"}
]}
```
Types: `symptom`, `duration`, `severity`, `vital`, `allergy`, `past_condition`, `current_medicine`. Leave `red_flag_mention` unused until a clinician supplies the list (OCI-018).

## 4. Span rules
- The evidence quote is copied EXACTLY, character for character, from ONE line. It must appear in exactly one line (the command refuses a gold file where it does not).
- Quote the shortest words that carry the fact ("has fever", not the whole line). For a negated fact include the negation words ("no cough").
- Two facts in one line get two rows with different quotes. Do not join text from two lines.

## 5. Negation and uncertainty rules
- `negated` = the thing is said to be ABSENT ("no fever", "તાવ નથી"). The value is the thing itself ("fever").
- `uncertain` = the speaker is unsure ("maybe", "શાયદ", "કદાચ"). A fact can be both negated and uncertain.
- Doctor questions, doctor actions and guessed causes are not facts. A line with no fact has no row; a clip where nothing is a fact (clip07) has an empty table, and any output there counts as a false positive.

## 6. Matching and numbers
A predicted fact matches a gold fact when the type is the same, they are on the same line and the quotes overlap (one contains the other, or similarity at least 0.6); matching is one-to-one. Negation F1 uses "negated" as the positive class: a match where both are negated is a true positive; a predicted negation with no negated gold fact is a false positive; a negated gold fact that was missed or predicted as present is a false negative.

## 7. Running and sharing
```bash
npm run eval:extraction -- --pipeline all                      # plain, constrained, grounded on audio/own/clip*.txt
npm run eval:extraction -- --fixtures apps/asr-py/tests/fixtures/extraction --texts ""   # the synthetic fixtures
```
Results go to `data/asr/eval-extraction/` (git-ignored). Only aggregate numbers (the table in `results.md`) may be copied into docs; never transcript text. In Run 1 the model is the mock, so real clips score zero: that proves the pipeline, not the quality. Report the number of clips and speakers with every figure.
