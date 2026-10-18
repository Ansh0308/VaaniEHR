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

## 8. The first real-model evaluation (Phase 5A Run 2)
Setup is in OWNER_ACTIONS (provider switch, simulated-text list). `--yes-run` is required to send anything; only synthetic fixtures and clip texts listed as simulated are ever sent. The command reports per fact type precision, recall and F1, NEGATION F1 separately, the ungrounded count, and the invalid-JSON count; the usage log records requests used.
Candidate models checked on the OpenRouter public list on 2026-10-18 (no key needed): `nvidia/nemotron-3.5-super-vl:free` (listed, context 1,000,000, supports `response_format` and structured outputs, free) and `xingchen-agi/xing4.0-29b-a4b:free` (listed, context 262,144, supports `response_format` and structured outputs, free). Free listings can change or disappear; the run records the model id and date.
### 8.1 Results: `nvidia/nemotron-3.5-super-vl:free`, run 2026-10-18, prompt `extract_v1`
13 cases (3 synthetic fixtures + clip02-clip11, text only), 53 gold facts, temperature 0, no prompt tuning. Aggregate numbers only; no text.
The three pipelines share ONE model reply per case (same prompt, so the cache answers the other two); they differ only in how the reply is checked afterwards. 13 distinct model replies; 18 HTTP requests were made (5 were retried attempts after an error; the status of each retry is not logged). Invalid JSON / schema failures: 0 in every pipeline.

| type | plain P / R / F1 | constrained P / R / F1 | grounded P / R / F1 |
| --- | --- | --- | --- |
| symptom | 0.97 / 0.97 / 0.97 | 0.97 / 0.97 / 0.97 | 0.97 / 0.97 / 0.97 |
| duration | 0.82 / 1.00 / 0.90 | 0.82 / 1.00 / 0.90 | 0.90 / 1.00 / 0.95 |
| severity | 0.20 / 1.00 / 0.33 | 0.20 / 1.00 / 0.33 | 0.20 / 1.00 / 0.33 |
| vital | 1.00 / 1.00 / 1.00 | 1.00 / 1.00 / 1.00 | 1.00 / 1.00 / 1.00 |
| allergy | 1.00 / 1.00 / 1.00 | 1.00 / 1.00 / 1.00 | 1.00 / 1.00 / 1.00 |
| past_condition | 0.50 / 0.50 / 0.50 | 0.50 / 0.50 / 0.50 | 1.00 / 0.50 / 0.67 |
| current_medicine | 1.00 / 1.00 / 1.00 | 1.00 / 1.00 / 1.00 | 1.00 / 1.00 / 1.00 |
| OVERALL (micro) | 0.86 / 0.96 / 0.91 | 0.86 / 0.96 / 0.91 | 0.89 / 0.96 / 0.93 |
| NEGATION | 1.00 / 1.00 / 1.00 (12 negated facts) | same | same |

Ungrounded facts dropped: plain 0, constrained 0, grounded 2 (of 59 predicted). The model predicted 5 severity facts against 1 gold severity fact, so severity precision is low (the gold labels may under-label severity; not checked).
**Reading.** (1) This is one free model, one prompt version and 13 small, acted or synthetic cases with first-draft gold labels: it says nothing general about the model, the method or real consultations. (2) On these cases symptoms and negation were extracted well, grounding removed 2 unsupported facts and raised precision a little, and severity was over-produced. (3) Numbers from 53 gold facts move a lot with one fact; do not compare them with other work.

### 8.2 `xingchen-agi/xing4.0-29b-a4b:free`: no result
2026-10-18: the endpoint answered HTTP 429 ("temporarily rate-limited upstream") on every attempt in two tries (3 and then 5 retries with backoff, concurrency 1), so no evaluation was possible. Retry later, or add the owner's own provider key to OpenRouter for separate limits. No table.
