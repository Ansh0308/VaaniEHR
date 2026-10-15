# Owner actions

Things only the owner can arrange (people, approvals, licences, accounts). The assistant checks this file at the start of every phase and warns the owner if the next phase is blocked by an item that is not done (see `AGENTS.md`, session checklist).

**Status values:** `not started`, `applied` (asked, waiting), `done` (usable), `downloaded` (file is here). Update the status and the date (YYYY-MM-DD) whenever something changes.

| Item | Needed before (phase) | Status | Date applied |
| --- | --- | --- | --- |
| Clinician reviewer (a doctor who signs off clinical content) | Phase 3 (`reviewed_on` on medicine rows); hard block for Phase 6 | not started | - |
| Ethics / faculty approval (acted consultations, audio recording, benchmark) | Phase 4 | not started | - |
| SNOMED CT licence (MLDS, India national member) | Phase 9 (codes stay empty until then) | not started | - |
| ABDM sandbox access | Phase 9 | not started | - |
| Sarvam API key | Phase 4 | not started | - |
| LLM account + spend cap (provider is PRD-D4, still open) | Phase 5 | not started | - |
| WhatsApp test number + Gujarati message template (template approval takes days: apply during Phase 8) | Phase 10 | not started | - |
| Gujarati reviewer (a Gujarati speaker, also for the consent notice and UI text) | Phase 2 (consent notice); again before Phase 10 | not started | - |
| NLEM PDF location: `data/medicines/raw/` (private, git-ignored) | Phase 3 | downloaded | 2026-10-15 |

## Notes

- **NLEM PDF:** `data/medicines/raw/nlem2022.pdf` and `reportnlem2022.pdf` (moved there from `DOCUMENTS/` on 2026-10-15). The folder is git-ignored, so they are never committed (ADR-D18).
- **Credentials:** the assistant never asks for secrets in chat and never writes them to a tracked file. When a phase needs a key (Sarvam, LLM provider, WhatsApp, ABDM), the assistant will ask you first, then you put the value in your own git-ignored `.env`.
- **Phase 2 is the next phase.** Open blocker for it: the Gujarati reviewer (the consent notice has Gujarati text). Phase 2 can start with a placeholder notice, as in Phase 1.2, but nothing is final until the reviewer has read it.
- Legal wording of the consent notice is the owner's and the institution's, not the assistant's.
