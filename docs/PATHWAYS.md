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
npm run pathways:lock -- data/pathways                                       # records active versions; never edits an entry
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
