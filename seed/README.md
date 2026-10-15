# seed/ - committed seed content (ADR-D18)

Seed content that **is** tracked in git and published with the repository: the NLEM medicine CSV, pathway JSON, safety-rule tables, golden FHIR examples built from fake visits, and scripts that build or load them.

**Rule: every row or record carries a non-empty `source`** (a citation: document, edition, page). `scripts/check-seed-sources.mjs` enforces it in `npm run check` and CI.

| Path (planned) | What | Notes |
| -------------- | ---- | ----- |
| `seed/medicines/` | NLEM 2022 CSV and loaders | `source` column on every row; no SNOMED/ATC codes until licences are checked |
| `seed/pathways/` | versioned pathway JSON, toy pathways in `_toy/` | root `source` block; clinician-reviewed before `status=active` (Hard Rule 3) |
| `seed/safety/` | dose / allergy / interaction tables | `source`, `reviewed_by`, `reviewed_on` on every row; no DDInter-derived rows until the licence decision (ADR-D17) |
| `seed/fhir/golden/` | golden FHIR bundles from fake visits | fake data only |

**Not here** (git-ignored, private): raw or licensed downloads (NLEM PDF, SNOMED/CDCI release files, DDInter exports), benchmark audio and recordings, anything under `data/` or `audio/`. Allowed file types here: `.csv`, `.json`, `.md`, and scripts (`.mjs`, `.js`, `.ts`, `.py`).

No clinical value may be invented: unknown values stay `TODO(source)` and are listed in `docs/OPEN_CLINICAL_ITEMS.md`.
