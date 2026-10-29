# CONTEXT.md — VaaniEHR in one read

Updated 2026-10-29 from the PRD v1.1, accepted ADRs, `docs/srs-status.json`, `docs/TRACEABILITY.md`, and repository code/tests. The PRD and accepted ADRs govern when a document conflicts with this summary.

## What VaaniEHR is

VaaniEHR is a final-year B.Tech **research prototype** for a general-medicine OPD workflow. It is permanently restricted to **simulated or acted data**, is not for real patients or clinical use, and makes no medical-device claim. A doctor can work through consent, transcript and fact drafts, toy pathway questions, a prescription draft, sign-off, a FHIR-oriented record, and a Gujarati summary draft.

It does not diagnose or treat. A doctor remains responsible for every confirmed fact, working condition, prescription entry, sign-off, and outbound summary. Never add clinical content without an approved cited source and named clinician review.

## Architecture and current implementation

- `apps/web`: React doctor/staff/admin interface in English and Gujarati. Gujarati copy remains unreviewed.
- `apps/api-node`: Express API, standalone development auth, consent/audit/visit/sign-off/FHIR/ABHA/WhatsApp/privacy services, backed by VaaniEHR's own PostgreSQL database.
- `apps/asr-py`: FastAPI speech/extraction services and benchmark/evaluation tooling.
- `packages/rules`: toy-pathway authoring and question engine. It also has Phase 7 authoring-preparation validation and immutable-lock utilities; these are **not** a runtime safety engine.
- ClinicOS remains untouched and is represented only by interfaces and mocks. Real ClinicOS calls require the separate explicit Phase 12 approval and are not implemented.

The API rejects `SIMULATED_DATA_ONLY=false`. External providers default to mocks. The mock ABHA flow accepts only test identities; the WhatsApp mock records a send log but transmits nothing; the FHIR validator is optional and validates golden fixtures when configured.

## Evidence-backed state

The requirement-level source of truth is `docs/SRS.md` and `docs/TRACEABILITY.md`. The status map distinguishes Implemented, Partial, and Planned; historical result files must not be read as current test evidence.

- Consent, audit-chain infrastructure, draft-to-sign workflow, amendments, FHIR bundle construction, privacy-request workflow, ABHA UI/provider abstraction, Gujarati-summary UI, and benchmark tooling are implemented to varying documented limits.
- FHIR conformance evidence is limited to generated golden/broken fixtures and CI-style checks; it is not proof of external ABDM/NRCeS interoperability.
- ABHA sandbox credentials/access are unresolved. The mock flow is not an ABDM verification.
- WhatsApp's real sender is off pending Meta credentials, a template, allowlisted test numbers, and Gujarati review. A mock log is not delivery evidence.
- The evaluation harness and a small acted/synthetic dataset exist. They are protocol demonstrations, not validated research results or benchmark publication.

## Core gaps and owner dependencies

- **Phase 7 is not implemented.** No clinical suggestion generator or runtime allergy, dose, duplicate-class, interaction, or red-flag safety suite exists. `NotConfiguredSafetyChecks` and the existing sign-off acknowledgement remain unchanged. The proposed five-condition scope and authoring metadata are preparation only; see `docs/SAFETY_RULE_AUTHORING.md` and OCI-022.
- Real pathways remain absent; committed pathways are labelled toy/test content.
- Clinician reviewer, faculty/ethics approval, Gujarati reviewer, SNOMED/licensing decisions, ABDM sandbox credentials, and Meta credentials/template are unresolved owner actions.
- Performance, usability, accessibility with a screen reader, external integration, clinical appropriateness, and research claims have not been externally verified.

## Non-negotiable rules

1. Acted/simulated data only; never place patient data or secrets in Git.
2. Never invent clinical questions, thresholds, medicines, recommendations, interactions, citations, approvals, or licences. Use `TODO(source)` and `docs/OPEN_CLINICAL_ITEMS.md`.
3. Do not connect preparation utilities to runtime safety, prescription, signing, or database behavior without separate approval.
4. Preserve ClinicOS as read-only until the owner explicitly approves Phase 12 integration.
5. Treat LLM/transcript input as untrusted; doctor review and server-side controls remain authoritative.

## Read next

Start with `README.md`, then `SRS.md`, `TRACEABILITY.md`, `PROGRESS_REPORT.md`, `DECISIONS.md`, `OWNER_ACTIONS.md`, and `OPEN_CLINICAL_ITEMS.md`. `DOC_INDEX.md` is the complete document index.
