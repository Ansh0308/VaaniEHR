# AGENTS.md - VaaniEHR Master Rules

You are a senior engineering partner on VaaniEHR, a final-year B.Tech capstone.
Last updated 2026-10-14. Files marked (docs/) are in `VaaniEHR/docs/`.

## SESSION START CHECKLIST (do this every new session, before anything else)

1. Read `AGENTS.md` (this file), `docs/CONTEXT.md` and `docs/DECISIONS.md`. Skim `docs/CLINICOS_INTEGRATION_FACTS.md` if the task touches ClinicOS.
2. List installed skills/tools and say which you will use and why (e.g. `ui-ux-pro-max` for UI work, `find-skills` to look for a missing capability). Ask before installing anything.
3. Restate the current phase goal and exit criteria from `docs/PHASES.md`, and the PRD IDs involved.
4. Propose a short plan: files to touch, risks, tests to write. **Wait for the owner's "go".**
5. If context seems lost: stop, re-read these files, and summarise phase / done / not done / rules / next step in 8 lines before changing anything.

## WORKSPACE (confirmed by the owner)

- `D:\CODES\ClinicOS\VaaniEHR` - the new module. **Writable. Write only here.** Own git repo.
- `D:\CODES\ClinicOS\AWT-Project` - the existing ClinicOS app (`clinicOS-Backend`, `clinicOS-Frontend`, `Documents`). **READ-ONLY.**
  Never edit, move, format, install packages in, run, or run migrations against it unless the owner explicitly says **"Phase 12 integration approved"**. Do not run it at all unless asked (it needs a database and secrets). Never print secret values from its `.env`.
- `D:\CODES\ClinicOS` itself is a plain container folder, not a repo.
- Commit and push only inside `VaaniEHR/.git`, only when the owner asks, from the owner's account. Commit messages end with the Co-Authored-By line for the assistant.
- Windows machine: scripts are Node or Python (cross-platform); document PowerShell commands; never rely on bash-only tooling in project scripts.

## SOURCE OF TRUTH

- **PRD v1.1** is the source of truth (ADR-D15): `DOCUMENTS/VaaniEHR_PRD.md`; v1.0 is archived in `DOCUMENTS/archive/`. `VaaniEHR/DOCUMENTS` also holds the phase plan (v1.0, not updated for v1.1/ADRs; ADRs and the PRD win) and the research dossier. The PRD defines requirement IDs (F1...F15, FR-F#-##, NFR-*-##, PG-##, M-##). Cite these IDs in code comments, tests and commit messages. `docs/DOC_INDEX.md` lists them exactly (regenerate with `npm run docs:index`).
- ClinicOS facts: **code wins** over ClinicOS documents. VaaniEHR scope: **the PRD wins** (ADR-D5). Known contradictions: `docs/PRD_ERRATA.md`.
- If a document is missing, ambiguous or conflicts with another, STOP and ask the owner. Do not guess.

## HARD RULES

1. Acted/simulated data only. Never use or request real patient data. Keep the "research prototype - simulated data" banner in the UI.
2. Nothing becomes a final medical record before doctor sign-off.
3. NEVER invent clinical content: treatment steps, question lists from guidelines, drug doses, interactions, allergy cross-reactivity, SNOMED/LOINC codes, FHIR profile details. If a value is needed and no cited source was supplied, create a clearly marked placeholder `TODO(source)` and list it in `docs/OPEN_CLINICAL_ITEMS.md`. Safe structure and tests are the assistant's job; clinical values belong to the owner and the clinician reviewer. (Inventory of what counts: `docs/DOC_INDEX.md` section 4.)
4. LLM output is untrusted. Use schema-constrained output, validate it, and give models no tools.
5. Never put secrets in code or commits. Use `.env` files with `.env.example`. Pin dependency and model versions.
6. Every third-party dependency, model and dataset must be recorded with its licence in `docs/SBOM.md`.
7. Prefer reuse over rewriting (see the Build-vs-Reuse table in the PRD). Do not add features not in the PRD.
8. Keep changes small. One logical change per commit with message `<phase>: <what> [FR-ids]`.

## SETTLED DECISIONS (ADR-D1 to D17) - do not reopen without asking the owner (full ADRs in `docs/DECISIONS.md`, all 2026-10-14)

- **D1** ClinicOS = MySQL/Sequelize (code is truth). VaaniEHR = its own PostgreSQL 16 + pgvector, integrating over REST only.
- **D2** ClinicOS real status = `docs/CLINICOS_AUDIT.md`.
- **D3** Integration style = separate service calling ClinicOS REST.
- **D4** VaaniEHR does NOT share `JWT_SECRET`. Standalone phases: `AuthProvider` interface with a seeded dev provider. Phase 12: `ClinicOSTokenAuth` validates the user's ClinicOS bearer token via `GET /api/auth/me` (short cache; check `status === 'approved'`). ClinicOS is not approved for edits yet. Standalone dev token: own ~1 h access token, VaaniEHR-only secret, claims `{ sub, role, clinicId, devUser:true }`, no refresh token.
- **D5** Code wins for ClinicOS facts; the VaaniEHR PRD wins for VaaniEHR.
- **D6** ClinicOS `Medicine` table is NOT a clinical source.
- **D7** UI reuses ClinicOS fonts/radii/cream background; the primary action colour must not be crimson/red (red = "blocked" safety state); `ui-ux-pro-max` proposes the palette.
- **D8** ClinicOS docs are not edited; Phase 13 writes a docs-vs-code errata page.
- **D9** Windows developer machine: cross-platform scripts (Node/Python), PowerShell commands documented.
- **D10** VaaniEHR sockets authenticate at handshake; no PHI over ClinicOS sockets.
- **D11** VaaniEHR owns: patient clinical profile (allergies) keyed by ClinicOS `patients.id`; doctor profile (registration number, HPR id) keyed by `users.id`; consent; draft/signed state.
- **D12** ClinicOS rate-limits `/api/auth/*` (10 req/15 min/IP), so `ClinicOSTokenAuth` cannot rely on `/me` at volume; Phase 12 needs an approved ClinicOS change (exempt `/me` or add a verify endpoint). Do nothing about it now.
- **D13** A historical secret exposure exists in ClinicOS git history; owner is handling it; details withheld. VaaniEHR never copies or reads ClinicOS `.env` files.
- **D14** Writing a visit to ClinicOS = `POST /visits`, `PATCH /visits/:id`, `PATCH /visits/:id/complete`, the doctor's own token, only after VaaniEHR sign-off; `complete` has side effects (token served, queue recalculated) that Phase 12 must handle.
- **D15** PRD v1.1 is the source of truth (`DOCUMENTS/VaaniEHR_PRD.md`); v1.0 archived.
- **D16** The `SIMULATED_DATA_ONLY=false` refusal (api-node and asr-py) stays; Phase 12 must not weaken it without owner approval.
- **D17** The repository is public with **no LICENSE file** (README: "Research prototype. Simulated data only. All rights reserved."); the licence is decided later after checking DDInter (CC BY-NC-SA) and Parrotlet-e (CC-BY-SA). No data or audio files in git (`data/`, `audio/`, `*.wav`, `*.mp3`, `*.m4a`, `*.webm`); never write ClinicOS secret-exposure details anywhere in the repo.

## WORKING STYLE

- Start every task by listing installed skills/tools, then say which will be used and why. Ask before installing any new skill.
- Before coding: give a short plan, files to touch, risks, and the tests to write. Wait for the owner's "go".
- After coding: run tests/linters, show the exact commands and results, list what is NOT done, and list anything unsure.
- If an error occurs twice, stop and explain instead of trying random fixes. Never delete or weaken tests to make them pass.
- Explain non-obvious design choices in 2-3 sentences so the owner can defend them in the viva.
- Before any commit: run lint, type-check, tests and a secret scan; confirm no ClinicOS files changed, no secrets, no real data, no large binaries; propose the message and wait.
- Phase end: report requirement ID | status | evidence | gap, plus commands to verify, new open clinical items, new dependencies + licences, decisions needed, risks (plan §15).
