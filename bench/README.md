# VaaniBench-Gu: dataset specification (Phase 11A, ADR-D43)

An acted Gujarati-Hindi-English consultation benchmark (PRD 7.3). **Acted data only: no real patient is ever in it.** Today it has 11 text cases from one speaker (the owner) and one tiny synthetic fixture folder; the target is 100 final plus up to 50 development consultations from at least 6 actors (see `docs/OWNER_ACTIONS.md`).

## Where things live

| What | Where | Tracked in git |
|---|---|---|
| This spec, the schema, the templates, the synthetic fixtures | `bench/` | yes |
| The real cases (converted from the owner's clips) and audio | `data/bench/` | **no** (`data/` is git-ignored) |
| Draft consent, protocol, guidelines, dataset card | `bench/drafts/` | yes (drafts, to be checked) |
| Frozen split file | `data/bench/split.json` | no (a sample is in `bench/fixtures/`) |
| Results | `results/` | no (one sample is tracked in `bench/sample-results/`) |

## One case = one JSON file

`data/bench/cases/<id>.json`, described by `bench/schema.json` (start from `bench/template.json`). Audio goes to `data/bench/audio/<id>.wav` (16 kHz mono); `audio.file` is the path relative to `data/bench/`, or `null` for a text-only case.

| Field | Meaning |
|---|---|
| `audio` | file, SHA-256, duration, `noise_level` (clean, low, medium, high, unknown) |
| `speakers` | id, role (doctor, patient, attendant, other), gender, pseudonymous `actor_id` |
| `language_tags`, segment `lang` | gu, hi, en, mixed |
| `transcript.segments` | the **gold transcript**: verbatim, Gujarati script for Gujarati, Devanagari for Hindi, Latin for English words and drug names; optional romanisation and timings |
| `gold_facts` | type, value, `negated`, `uncertain`, `evidence_quote` (copied exactly from one segment), segment index |
| `medicine_mentions` | spoken form and the generic it normalises to (M-02) |
| `expected_questions`, `expected_candidates`, `expected_prescription`, `condition_label` | the question path, the differential, the prescription, the condition; empty or `null` = not annotated |
| `out_of_scope`, `red_flag` | PRD 7.3 mix (10% out of scope and red flag) |
| `pathway_set`, `oracle_slots` | only for the toy question-engine comparison: the answers a simulated patient gives (fake pathways only) |
| `annotation` | annotator, double-annotated flag, status |

## Commands (repository root)

```bash
npm run bench:validate                  # data/bench/cases plus bench/fixtures; exit 1 on any error
npm run bench:validate -- --dir bench/fixtures
npm run bench:convert                   # audio/own (the 11 clips and their gold) into data/bench/
```

The validator checks the schema, that every evidence quote is a verbatim piece of one segment, that speaker ids and segment indexes are consistent, that fact types are the extraction types, that no phone number or e-mail address is in any text, and warns when a `gu` segment has almost no Gujarati letters.

## Annotation template

`bench/template.json` (one case) and `bench/template-facts.csv` (one row per gold fact: `case_id,type,value,negated,uncertain,evidence_quote,segment`). The CSV is what a second annotator fills for the double-annotated subset; `app.bench.metrics` computes Cohen's kappa from two such files.

## What this dataset is not

Not clinical guidance, not a validated medical dataset, not real speech from patients. The first 11 cases are one speaker playing both roles, so the numbers they give demonstrate the protocol; they are not results.
