# PATHWAYS.md - pathway files, the question engine and how to test them (Phase 6A)

**There is no clinical content in this repository.** The only pathways are fake toy ones. Real pathways come from the owner (ICMR Standard Treatment Workflows) and a clinician reviewer (OCI-019). The engine suggests questions and candidate conditions to the doctor; it never names a diagnosis, a medicine or a treatment.

## A pathway file (`*.pathway.json`)
```json
{
  "id": "toy_condition_a", "version": 1, "status": "test",
  "title": {"en": "...", "gu": "...", "hi": "..."},
  "source": {"doc": "document name", "page": 12, "reviewed_by": "", "reviewed_on": ""},
  "start": "q1",
  "red_flag_compatible_slots": ["toy_symptom_1"],
  "nodes": [
    {"id": "q1", "type": "question", "slot": "toy_symptom_1", "answer": "boolean", "info_weight": 5,
     "ask": {"en": "...", "gu": "...", "hi": "..."}, "reason": {"en": "...", "gu": "...", "hi": "..."},
     "red_flag_if": {"op": "eq", "value": true},
     "edges": [{"if": {"op": "eq", "value": true}, "to": "q2"}]},
    {"id": "t1", "type": "terminal", "label": {"en": "...", "gu": "...", "hi": "..."}}
  ],
  "rules": [{"id": "r1", "slot": "toy_symptom_1", "if": {"op": "eq", "value": true}, "weight": 3}]
}
```
- `answer`: `boolean`, `number` or `choice` (with `choices`). Operators: `eq ne gt gte lt lte in` (`gt..lte` only for numbers, `in` takes a list).
- `status`: `test` (fake content, loads only with the explicit test flag), `draft` (never loads), `active` (needs `source.reviewed_by` and `source.reviewed_on`).
- Every node must be reachable from `start`; every rule's slot must be asked by a question node; every `ask`, `reason`, `title` and terminal `label` needs en, gu and hi text; English text may not contain diagnosis, confirmation, medicine or treatment wording.
- File name `<anything>.pathway.json`, any sub-folder. `pathways.lock.json` (made by the lock command) pins the hash of each active version.

## Commands
```bash
npm run pathways:validate -- packages/rules/fixtures/pathways --allow-test   # exit 1 on any problem
npm run pathways:cases -- packages/rules/fixtures/pathways packages/rules/fixtures/cases
npm run pathways:lock -- seed/pathways                                       # records active versions; never edits an entry
```
`npm run check` runs the first two on the toy fixtures.

## Regression case files (`fixtures/cases/<name>.cases.json`)
```json
{"description": "...", "cases": [
  {"name": "readable name", "slots": {"toy_symptom_1": true}, "asked": ["toy_condition_a/q1"],
   "dismissed": [], "snoozed": [],
   "expect": {"outcome": "QUESTION", "node": "toy_condition_a/q2", "top": "toy_condition_a", "min_score": 0.5, "max_score": 1}}
]}
```
`slots` are the CONFIRMED slot values; node keys are `pathwayId/nodeId`; `expect.outcome` is QUESTION, RED_FLAG, ABSTAIN or COMPLETE; `node`, `top`, `min_score`, `max_score` are optional. Each toy pathway has at least five hand-written cases; a test fails if a toy pathway has no case file.

## The engine in one paragraph
Red flags first (a slot whose value matches a node's `red_flag_if` gives RED_FLAG whatever else is true). Then, unless the cap (asked + dismissed, default 8) is reached, the next question is the askable, not-yet-known slot with the highest total `info_weight` (red-flag questions first once a compatible symptom is present; ties broken by node weight, pathway id, node id). A node is askable only through an edge from an answered node. When nothing is left: ABSTAIN if no candidate reaches the threshold, otherwise COMPLETE. Candidates are scored by the weight of met rules minus a penalty for known unmet rules, with the rules met (evidence for) and unmet (evidence against) listed, each tied to its question node and its source.

## Facts to slots
`packages/rules/fixtures/pathways/_toy/slot-map.json` maps toy concept ids to slots. Only confirmed, certain facts with a mapped concept id set a slot; a negated fact means "absent"; two disagreeing confirmed facts leave the slot unknown. Real concept ids wait for the reviewed word list (OCI-017).

## Phase 6B additions
- Per node: `source_quote` (exact sentence), `page`, optional `reviewed_by`, optional `concept_id` (questions), `refer` (terminals). An ACTIVE pathway needs `source_quote`, `page`, a reviewer and the `refer` flag on every node it has; test pathways are exempt.
- Authoring commands, folders and the review steps: `docs/PATHWAY_AUTHORING.md`. Where files live: `seed/pathways/` (active, tracked, locked), `data/pathways/drafts/` (drafts, git-ignored), `packages/rules/fixtures/pathways/_toy/` (fake, tests).
- `npm run pathway:lint`, `pathway:new`, `pathway:version`, `pathways:coverage` exist beside `pathways:validate`, `:lock`, `:cases`.

## Phase 6C: the doctor-side screens (UI)
- **Where:** the consult screen (`/consult/:sessionId`), doctor only. A red-flag notice at the top, then below the facts: **Suggested questions** and **Candidate conditions**. Both hold the line "Suggestions are aids; the doctor decides." and, while any loaded pathway is not active, "Test pathway - not clinical".
- **Questions:** the next suggested question (language select: en, gu, hi), why it is suggested, the slot, `Asked`, `Dismiss`, `Snooze`. A red flag shows a notice (alert, icon plus words) until `Acknowledge` is pressed. "Not enough information, no suggestion." and "No further questions from the pathway." are the other two outcomes.
- **Candidates:** up to three, each with supporting and opposing facts (the confirmed facts that set the slots), its source document and page, `Select as working condition` and `Undo`, plus a "not listed" note. No score, percentage or confidence is shown.
- **Consent withdrawn:** the panels explain in plain words, offer nothing, and show the doctor's kept decisions (working condition, acknowledged red flags) read only, from `GET /sessions/:id/pathway-record`.
- **API additions:** `GET /sessions/:id/pathway-record`, `POST /sessions/:id/candidates/select/undo`; evidence carries `factId`; answers carry `notActive`, `pathwayTitle`, `pathwayStatus`.
- **Words:** "candidates" and "working condition"; the screens never say diagnosis, prescribe or treat (a web test enforces it).

## Concept links feed the engine (remaining Phase 5 items)
A slot is filled from a fact only when the fact is **confirmed** and its **concept link is confirmed by the doctor** (not stale, not just suggested). The slot map maps internal concept ids (from the concept list) to slots. A fact edited after its link was confirmed has a stale link and counts for nothing until the doctor confirms again.
