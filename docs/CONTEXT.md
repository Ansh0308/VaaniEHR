# CONTEXT.md - VaaniEHR in one read (re-read at every session start)

Updated 2026-10-14. Sources: `DOCUMENTS/VaaniEHR_PRD.md` (**PRD v1.1**, ADR-D15; requirements; v1.0 archived), `CLINICOS_AUDIT.md` + `CLINICOS_INTEGRATION_FACTS.md` (what ClinicOS really is), `DECISIONS.md` (ADR-D1..D16, settled), `PHASES.md`. PRD v1.1 already reflects the audit; `PRD_ERRATA.md` records which v1.0 statements it fixed (rows 28-29 still open); ClinicOS facts follow the code, VaaniEHR scope follows the PRD (ADR-D5).

## What VaaniEHR is
A web module (final-year B.Tech capstone, Marwadi University, course 01CT2801) for a **general-medicine OPD doctor**. It listens to a consultation in Gujarati/Hindi/English (code-switched), turns speech into **structured facts** (with negation and transcript evidence), shows **guideline-grounded follow-up questions** (ICMR STW pathways; rules choose, LLM only maps and phrases), suggests **essential medicines (NLEM)** with **fail-closed safety checks**, and only after **doctor sign-off** builds an **ABDM-ready FHIR R4 record** (NRCeS IG 6.5.0, validated) and a **doctor-approved Gujarati WhatsApp summary**. It also ships a research evaluation console and the acted benchmark "VaaniBench-Gu".

## What it is NOT
Not a diagnosis tool (it proposes a ranked shortlist, never "diagnoses"); not for real patients, children, pregnancy or emergencies (red flag => refer/stop, no prescription); no own ASR/translation/interaction database; not billing, appointments, queue management, telemedicine, lab integration or offline mode; not clinical software of any kind.

## Intended-use statement (PRD §1.6)
VaaniEHR is a **research prototype** that helps a registered medical practitioner record a general-medicine OPD consultation and consider guideline-based follow-up questions and essential-medicine options. It **informs** clinical management; it does not diagnose, treat, or replace clinical judgement. Every clinical output requires review and sign-off by the practitioner. It is used **only with acted or simulated consultations** and is not approved for use with real patients. (Class reading under CDSCO guidance is ours, not a ruling.)

## Architecture in 10 lines
1. **Own PostgreSQL 16 + pgvector** database for VaaniEHR (ADR-D1); ClinicOS stays MySQL/Sequelize; no shared database, no cross-DB joins.
2. VaaniEHR is a **separate service**; it talks to ClinicOS **over REST only** (ADR-D3), never touching its DB. ClinicOS ids (`patients.id`, `users.id`, `visits.id`, UUID strings) are stored as plain references.
3. `apps/web` React + Vite + Tailwind; `apps/api-node` Express + Socket.IO (auth, sessions, sign-off, FHIR, WhatsApp, audit); `apps/asr-py` FastAPI (VAD, ASR adapters, extraction, summary); `packages/rules` (pathway + safety engines); Docker Compose; GitHub Actions CI.
4. **`AuthProvider` interface** (ADR-D4): standalone phases use a seeded **dev provider**; Phase 12 adds `ClinicOSTokenAuth`, which validates the user's ClinicOS bearer token via `GET /api/auth/me` with a short cache and checks `status === 'approved'` (needs an approved ClinicOS rate-limit change first, ADR-D12). The ClinicOS `JWT_SECRET` is never shared. Standalone dev tokens: own ~1 h token, VaaniEHR-only secret, `{ sub, role, clinicId, devUser:true }`, no refresh.
5. **VaaniEHR sockets authenticate at handshake**; no PHI over ClinicOS sockets (ADR-D10). ClinicOS sockets have no auth.
6. VaaniEHR **owns** patient clinical profile (allergies), doctor profile (registration no., HPR id), consent events, and draft/signed state (ADR-D11). ClinicOS has none of these.
7. A `VisitRepository` interface hides where signed visits go (own tables now, ClinicOS adapter in Phase 12, written with the doctor's own token after sign-off).
8. LLMs: schema-constrained output, span-grounded facts, **no tools**, transcript treated as untrusted; the **safety engine fails closed**; audit log append-only and hash-chained.
9. Mock ClinicOS adapter mirrors the verified real response shapes (e.g. lookup returns 200 `{found:false}`).
10. Windows dev machine: all scripts Node/Python, PowerShell commands documented (ADR-D9).

## Phases (details and exit criteria in `PHASES.md`)
0 Orientation (this) | 1 Foundation + design system | 2 Identity, patients, consent, audit | 3 Medicine master + templates | 4 Audio + ASR | 5 Fact extraction | 6 Pathways + guided questions | 7 Suggestions + safety | 8 Workspace + sign-off | 9 FHIR + ABHA sandbox | 10 Gujarati WhatsApp summary | 11 Evaluation + benchmark | 12 ClinicOS integration + hardening | 13 Docs, demo, paper, viva.
ClinicOS is read-only until the owner types **"Phase 12 integration approved"**.

## Hard rules (full text in `AGENTS.md`)
1. Acted/simulated data only; keep the "research prototype - simulated data" banner. 2. Nothing is a final record before doctor sign-off. 3. **Never invent clinical content**: use `TODO(source)` + `docs/OPEN_CLINICAL_ITEMS.md`. 4. LLM output is untrusted. 5. No secrets in code/commits; `.env` + `.env.example`; pin versions. 6. Every dependency/model/dataset + licence in `docs/SBOM.md`. 7. Prefer reuse; no features outside the PRD. 8. Small commits `<phase>: <what> [FR-ids]`; cite F/FR/NFR IDs.

## Where things stand
Phase 0 is done (owner answers recorded as ADR-D12..D14); Phase 1.1 (foundation) is accepted; Phase 1.2 (design system, ADR-D19, `docs/DESIGN.md`, `/design` page) is built and awaiting owner review: audit, facts, decisions, errata, doc index and this file exist. Still open: PRD-D3 (final five conditions), PRD-D4 (LLM provider), PRD-D5..D7; clinician reviewer, ethics approval and licences/accounts (PRD §16.3) are the owner's. See `DOC_INDEX.md` §3 for document conflicts and §4 for clinical content that must not be invented.
