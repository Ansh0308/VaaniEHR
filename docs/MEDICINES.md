# MEDICINES.md - the medicine master (Phase 3A)

How the medicine list gets into the database, what is deliberately empty, and what to do with the rows the importer would not trust. Decisions are in `DECISIONS.md` (ADR-D23). Simulated-data and "never invent clinical content" rules apply: nothing here is a prescribing recommendation.

## What exists
- `medicine_master`: one row per **formulation** (generic name + dose form + strength + route). Every row names its `source` and `source_page`.
- `medicine_brand` (optional children), `medicine_translit_gu` (Gujarati search spellings, empty until reviewed), `med_template` and `med_template_item` (tables only; the template API and UI come with F11).
- API: `GET /api/v1/medicines?q=` and `GET /api/v1/medicines/:id` (every signed-in role); admin-only writes. See `apps/api-node/openapi.json`.

## Commands
```powershell
npm run db:up
npm run db:migrate                  # creates the tables and the pg_trgm extension
npm run import:nlem                 # PDF -> CSV files + review sheet -> medicine_master, prints the report
npm run import:nlem -- --dry-run    # everything except the database
npm run import:nlem -- --retire-stale   # also retire rows an earlier run created that this run no longer produces
npm run medicines:codes -- file.csv            # licensed SNOMED / ATC codes (dry run; add --apply)
npm run medicines:translit -- file.csv         # Gujarati-reviewed search list (dry run; add --apply)
```
The PDF is expected at `data\medicines\raw\nlem2022.pdf`. Running the importer twice is safe: the second run inserts nothing, updates nothing, and its diff against the first is empty.

## Files the importer writes (all in `data\medicines\`, git-ignored, never committed)
| File | What it holds |
|---|---|
| `nlem2022.csv` | One line per formulation row that was loaded. `snomed_code`, `atc_code`, `route`, `reviewed_on`, `reviewed_by` are empty. |
| `nlem2022.review.csv` | Rows that need a person to look: `HELD (not loaded)` or `loaded with a note`, the reason codes, and the text exactly as extracted. |
| `nlem2022.rejected.csv` | Text that could not be placed (margin notes, wrapped headings, lines beside no item number). |
| `nlem2022.generics.csv` | Every distinct generic name with the item numbers it is listed under. |
| `nlem2022.report.txt` | The report the command prints. `nlem2022.prev.csv` is the previous run, for the diff. |

## How a row is read
The PDF writes each row's cells together (number, name, level, forms) before the next number, so the importer takes everything between two item numbers as one row. A second, independent method (geometry: each cell is vertically centred on its number) cross-checks it, and a row on which the two disagree is held. Wrapped form lines are joined back only on strict cues. Rows that are in the database but no longer in the import are reported, and `--retire-stale` retires them (rows are never deleted).

## Reading the report
Each count is a different thing: numbered lines (with the category headings among them), medicine entries, formulation lines (one per dose form and strength), formulation **rows** after merging repeats (this is what is loaded), distinct generic names, rejected text, and flagged rows. It also explains why the entries reduce to fewer distinct names (NLEM lists a medicine again under every category it belongs to), reconciles the names with the publication's own numbered alphabetical list (1 to 384), lists every name that differs on either side, and quotes the committee report's contradictory totals with page numbers.

## Review reasons
- **Held (not loaded):** `AMBIGUOUS_ROW` (text could not be matched to one item number, or a line near it could not be placed), `NO_FORM_LINES`, `UNPARSED_FORM_LINE` (for example "a) ... b) ..." sub-lists), `CONTINUED_FROM_PREVIOUS_PAGE` and `CONTINUES_ON_NEXT_PAGE` (a row split across pages).
- **Loaded with a note:** `NO_STRENGTH_STATED`, `NO_FORM_OR_STRENGTH` ("As licensed for ..."), `MULTI_LEVEL` (a row carries two levels; each form line takes the nearest), `UNUSUAL_LAYOUT` (the text sits off-centre or has a large gap inside it; both methods still agreed), `LEVELS_DIFFER_ON_REPEAT`, `NO_LEVEL`, `ODD_LEVEL`.

A held row is not lost: check it against the PDF and add it through `POST /api/v1/medicines` as an admin, with a `source` such as "NLEM 2022 p. 27 (checked by hand)". It starts as not reviewed.

## Checking the extraction by hand
- `npm run medicines:inspect -- held` prints each held row with the PDF's own cells (column, height on the page, text) next to the importer's reading. Nothing is guessed; what it cannot split is said so.
- `npm run medicines:inspect -- sample --n 20 --seed 3 --docs docs/NLEM_SPOTCHECK.md` prints a seeded random sample of loaded rows with the PDF cells beside each, and writes only page numbers and item numbers to `docs/NLEM_SPOTCHECK.md` for the owner's pass / fail record.
- **Manual transcriptions:** `data/medicines/nlem2022.overrides.csv` (private; read by the importer only if it exists, never created by a script). Each row needs its item number, PDF page and a note that says "manually transcribed, confirmed by owner". Every item number that has override rows has ALL of its parsed rows replaced by them. Route, codes and review columns are refused. The file stays private because it holds NLEM text and the reuse terms are unchecked (ADR-D18).

## What is deliberately empty
- `route`: the NLEM does not state one; the prescribing doctor chooses it (OPEN_CLINICAL_ITEMS OCI-001).
- `snomed_code`, `atc_code`: until a licensed release is loaded with `medicines:codes` (every row needs a licence note).
- `reviewed_on`, `reviewed_by`: until a clinician reviews. The database refuses to let the API role set them, and any edit to an identifying or source field clears them.

## Search
Generic names always rank above brand names: exact, starts with, a word starts with, contains, then a similar spelling (pg_trgm); brand names follow. Case does not matter; `%` and `_` are plain characters. A Gujarati query is expanded through `medicine_translit_gu`, which is empty until a Gujarati reviewer approves a list; search works in English without it.

## Not done in 3A
Template API and UI (F11), brand data (no source with clear terms yet), SNOMED/ATC codes, drug interaction and dose rules, a medicine admin page, and clinician review.
