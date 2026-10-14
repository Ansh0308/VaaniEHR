# DOC_INDEX.md - documents in `VaaniEHR/DOCUMENTS` (Phase 0.3)

**Generated** by `npm run docs:index` (`scripts/build_doc_index.py`, template `docs/templates/DOC_INDEX.template.md`). Sections 2 and 3.0-3.1/3.3 are extracted by script from `DOCUMENTS/VaaniEHR_PRD.md` (**PRD v1.1**, ADR-D15), so requirement text is exact. Edit the template, not this file.
Numbering: the PRD's own open decisions are **PRD-D1..PRD-D7** (§16.2); our architecture decisions are **ADR-D1..ADR-D16** (`DECISIONS.md`).

## 1. Files

| File | What it is | Key facts relied on | Version / date |
|---|---|---|---|
| `VaaniEHR_PRD.md` | **The PRD, v1.1 - source of truth (ADR-D15).** 18 sections + Appendix F changelog | Voice-assisted, guideline-grounded, ABDM-ready consultation module for a general-medicine OPD; research prototype, acted/simulated data only, not for clinical use (§1.6). ClinicOS facts are code-verified (§3.5, §9.4); VaaniEHR has its own PostgreSQL 16 + pgvector and talks to ClinicOS over REST only; `AuthProvider` seam; VaaniEHR-owned side tables (§8.2). Stack §11, build-vs-reuse §12, delivery plan §15, build brief §17 | v1.1, 14 Oct 2026, reconciled with the code audit; status "Phase 0 complete; building" |
| `archive/VaaniEHR_PRD_v1.0.md` (+ `.docx`) | Superseded PRD v1.0 | Kept for traceability; `PRD_ERRATA.md` rows refer to its line numbers | v1.0, 14 Oct 2026 |
| `VaaniEHR_Phase_Plan_and_AI_Prompts.md` (+ `.docx`) | Phase-wise build plan (Phases 0-13) with prompts, recovery prompts, checklists | Phase map, goals, exit criteria (copied to `PHASES.md`). **Not updated for v1.1/ADRs**: where it conflicts, ADRs and the PRD win | v1.0, 14 Oct 2026 |
| `compass_artifact_wf-34413097-...text_markdown.md` | Research dossier, SRS inputs and an early PRD (Build-vs-Reuse edition), 84 sources | Build only M3, M4, benchmark; reuse the rest; licence traps; regulatory framing; accounts to apply for. Not updated for the ClinicOS audit | dossier dated 14 Oct 2026 |
| `Researchdoc.pdf` | 14-page "Print to PDF" of the dossier | **No text layer** (image-only); pages 1 and 14 viewed and match; ends at "Caveats", no Sources list; pages 2-13 not viewed. Use the `.md` | 2026-10-14 |

Other docs already in `docs/`: `AGENTS.md` (repo root), `CONTEXT.md`, `PHASES.md`, `DECISIONS.md`, `SKILLS.md`, `CLINICOS_AUDIT.md`, `CLINICOS_INTEGRATION_FACTS.md`, `PRD_ERRATA.md`, `SBOM.md` (generated), `OPEN_CLINICAL_ITEMS.md`. The five ClinicOS documents stay in `AWT-Project/Documents` (ClinicOS is read-only).

## 2. Requirements digest (copied exactly from PRD v1.1)

### 2.1 Features F1-F15 (priority from each heading; summary table is PRD §5.1)

{{F_HEADINGS}}

PRD §5.1 priority summary:
- **P0**: F1 consent, F2 ASR, F3 extraction, F4 guided questions, F5 medicine DB, F6 suggestions + safety, F7 sign-off + audit, F8 FHIR
- **P1**: F9 ABHA, F10 WhatsApp, F11 templates UI, F12 evaluation console, F13 ClinicOS link
- **P2**: F14 care-context linking, F15 PDF, patient pre-visit questionnaire, offline mode

(PRD F-numbers are VaaniEHR's. ClinicOS documents use their own F1-F25 with different meanings, e.g. ClinicOS F5 = one-tap controls. Always write "VaaniEHR F5" or "FR-F5-xx".)

### 2.2 Functional requirements FR-*

{{FR_ROWS}}

### 2.3 Pages PG-01..PG-20 (PRD §4)

{{PG_TABLE}}

### 2.4 Non-functional requirements (PRD §10)

{{NFR_TABLE}}

### 2.5 Metrics M-01..M-17 (PRD §14.1)

{{M_TABLE}}

### 2.6 Goals, risks, open decisions (PRD §1.4, §16)
{{G_TABLE}}

{{R_TABLE}}

{{D_TABLE}}

## 3. Conflicts and gaps

### 3.0 Changes from PRD v1.0 to v1.1 by requirement ID (script: `scripts/prd_id_diff.py`)

{{ID_DIFF}}

### 3.1 ClinicOS-related contradictions: status of `PRD_ERRATA.md` under v1.1

{{ERRATA_STATUS}}

### 3.2 Conflicts between the VaaniEHR documents themselves

| # | Conflict | Where | Status under PRD v1.1 / handling |
|---|---|---|---|
| C1 | NLEM count 384 vs 386 | FR-F5-01; dossier §4 | **Open** (v1.1 keeps "use 384 and note it"). The import must report the number actually extracted |
| C2 | EkaScribe and Gujarati | PRD §1.3/§1.7 "supports Gujarati"; dossier Key Finding 1 says it does not | **Open** (v1.1 App. F lists it). Do not state either claim as fact until checked |
| C3 | Benchmark size vs ASR budget (about 150 cases in §7.3 vs "300 consultations" in §3.4 and dossier) | §7.3, §3.4 | **Open** (v1.1 App. F). Confirm the intended number |
| C4 | Hours: 300-340 stated, §15 table sums to about 350 | §3.4, §15 | Acknowledged in v1.1 (App. F #5) |
| C5 | "M1/M2" used for modules and for ABDM milestones | PRD module tags vs dossier / F14 | **Open** (naming only): write "module M2" vs "ABDM M2"; metrics are "M-01" |
| C6 | Example ID `FR-M3-02` in the header | v1.0 header | **Resolved** in v1.1 (`FR-F4-02`) |
| C7 | PRD-D vs ADR-D numbering | PRD §16.2 | Handled: v1.1 §16.2 lists the ADRs; this repo writes PRD-D#/ADR-D# |
| C8 | PRD-D3..D7 still open (final five conditions, LLM provider, questionnaire, dataset licence, paper venue); PRD-D1, PRD-D2 closed | PRD §16.2 | **Open** except D1/D2 |
| C9 | "JWT with refresh" vs ClinicOS has no refresh | NFR-SEC-01 | **Resolved** in v1.1 (AuthProvider; no refresh in standalone mode) |
| C10 | OWASP LLM Top 10 edition (2025 vs 2026 list) and ASVS level (L1 vs L2) | NFR-SEC-05/06 vs dossier | **Open**; decide before Phase 12 |
| C11 | Safety test-suite size: PRD >= 50, plan "30+" | §7.2/M-09 vs plan 7.1 | **Resolved** in the PRD (v1.1 App. F: floor 50); the plan text is still wrong (see `PHASES.md`) |
| C12 | Plan Phase 2 copies ClinicOS columns and "JWT claims identical to ClinicOS" | Phase Plan 2.1 | **Open in the plan** (ADR-D4/D11 and PRD v1.1 supersede); see `PHASES.md` |
| C13 | Plan assumes sibling folders and `Documents/` | Phase Plan 0.1 | Real layout in `AGENTS.md` |
| C14 | Dossier says ClinicOS audit is hash-chained | Dossier (a) | **Open in the dossier**; PRD v1.1 states ClinicOS audit is append-only by convention only |
| C15 | `Researchdoc.pdf` vs markdown dossier | PDF | Printout without Sources; use the `.md` |
| C16 | Plan Phase 0 says DECISIONS D1/D2 "OPEN" | Phase Plan 0.3 | Resolved (ADR-D1, ADR-D2) |

### 3.3 Items the PRD itself marks [Assumption] or [Unverified] (PRD v1.1 line numbers)
{{TAGGED}}

### 3.4 Gaps (needed but missing or not yet supplied)
- Final five conditions and the clinician reviewer (PRD §3.1, A3, PRD-D3). Nothing clinical can be encoded without them.
- NLEM 2022 PDF in `data/medicines/raw/`; SNOMED/CDCI release files (licence pending); DDInter export; National Formulary pages / product labels for dose limits.
- ABDM sandbox credentials, Sarvam key, LLM key (+ no-training setting), WhatsApp test number and approved Gujarati template, ethics/faculty approval (PRD §16.3).
- Gujarati wording review by a native speaker (consent notice, UI strings, summary template).
- SRS (companion to the PRD) does not exist yet (Phase 13). No ERD/OpenAPI/diagrams yet (PRD §15 Review-I).
- ICMR STW reuse terms are not stated (PRD §12.4).
- Safety-rule behaviour for **unknown age** and the **ClinicOS `notes` adapter rule** are not in the PRD yet (errata rows 28 and 29).

## 4. Clinical content I must not invent

Everything below needs a cited source supplied by the owner or reviewer. Until then: placeholder `TODO(source)` plus an entry in `OPEN_CLINICAL_ITEMS.md`. Structure, validators and tests (using obviously fake content) are mine to build.

| # | Content | Where the PRD / plan needs it |
|---|---|---|
| 1 | The five conditions and each pathway's question nodes, answer options, edges, `info_weight`, `red_flag_if`, terminal labels and `first_line` drugs (from ICMR STWs) | PRD §3.1, F4, §7.1; Phase 6 |
| 2 | Red-flag lists and emergency/out-of-scope patterns per condition (the PRD's "chest pain with sweating" and pregnancy examples are illustrative only) | F4, F6, §6.2, §7.2 |
| 3 | Question wording in Gujarati, Hindi and English (`ask.en/gu/hi`) and Gujarati/Hindi medical terms | §7.1 pathway sketch, F4, UI strings |
| 4 | Medicine master rows (NLEM 2022): generic name, strength, dose form, route, category; any row the PDF import cannot read cleanly | F5, §8.2; Phase 3 |
| 5 | SNOMED CT / CDCI codes for medicines, findings, vitals, conditions; ATC codes; ICD-10 codes | F3, F5, F8, §8.3 |
| 6 | Max daily doses, "usual" dose thresholds, adult dose ranges (cite National Formulary or label per row) | F6, §7.2, App. A |
| 7 | Allergy classes and cross-reactivity pairs | F6, §7.2 |
| 8 | Drug-drug interaction pairs and severities, therapeutic-duplication classes (DDInter export, non-commercial licence) | F6, §7.2 |
| 9 | "Missing info" rules (renal/hepatic adjustment) and age/pregnancy/lactation thresholds | §7.2 |
| 10 | Frequency code list and daily multipliers (OD/BD/TDS/QID/SOS), Gujarati labels | Phase 3 template builder, safety dose arithmetic |
| 11 | LOINC/SNOMED codes for vitals; FHIR profile specifics: required elements, value sets, profile URLs, IG package hash, ABDM endpoint paths, RSA key handling | F8, F9, §8.3, Phase 9 |
| 12 | Gujarati patient-summary wording: findings, medicine timing, warning signs, follow-up | F10, App. B |
| 13 | Consent notice legal text (audio, AI processing, WhatsApp) and DPDP wording; regulatory class statements | F1, §13 |
| 14 | Acted-consultation scripts, gold transcripts, expected questions/differentials/prescriptions | §7.3, Phase 11 |
| 15 | Seed data: fake patients' allergy lists and medicine names must be clearly fake; demo prescriptions use fake drugs ("Drug-A") | Phase 2, 7 |
| 16 | UI copy that reads as medical advice (refer/urgent banner, "not enough information") | §6.2, F4, F6 |
| 17 | Entity/concept list for Parrotlet-e linking (internal concept IDs until SNOMED licence arrives) | F3, Phase 5 |
