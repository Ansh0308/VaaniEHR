# seed/pathways - the REAL guideline pathways (ADR-D18, ADR-D35)

Tracked, sourced, clinician-reviewed pathways live here and nowhere else. **There are none yet**; the only pathways in the repository are fake toy ones for tests (`packages/rules/fixtures/pathways/_toy/`).

- **Only `status: active` files belong here.** Every node carries `source_quote` (the exact sentence), `page` and a reviewer; the pathway's `source` block names the document and the clinician (`reviewed_by`, `reviewed_on`). `npm run pathways:validate -- seed/pathways` (part of `npm run check`) fails otherwise.
- **Immutable once locked.** `npm run pathways:lock -- seed/pathways` records the content hash in `pathways.lock.json`. A locked version is never edited: `npm run pathway:version -- <file>` writes the next version as a draft.
- **Drafts are not committed.** Work on drafts in `data/pathways/drafts/` (git-ignored), lint them with `npm run pathway:lint -- data/pathways/drafts`, and move a finished, signed-off file here as a new `active` version.
- **No clinical value may be invented.** Anything unknown stays `TODO(source)` and is listed in `docs/OPEN_CLINICAL_ITEMS.md`. No treatment content (Phase 7).
- Slot map (`slot-map.json`, with a `source` note) maps internal concept ids to slots; real concept ids wait for the reviewed word list (OCI-017).

Workflow: `docs/PATHWAY_AUTHORING.md`. Format: `docs/PATHWAYS.md`.
