# seed/dev - acted/simulated development data (Phase 2A)

Everything here is FAKE (`source: FAKE_FOR_TEST`). No real people, phone numbers or allergies.

- `clinic.json`, `users.json`: 1 clinic, 1 admin, 2 doctors, 1 staff, 1 researcher. **No passwords are stored here**; `npm run seed:dev` generates random ones into the git-ignored `data/dev-credentials.json`.
- `patients.json`: 15 patients with Gujarati names (spelling not yet reviewed by a Gujarati speaker), 10-digit non-dialable phone numbers (`0000000001`...), and allergy lists with obviously fake labels (`Drug-A (FAKE)`). Real allergens come in Phase 7 with the clinician reviewer.
- Two patients have no date of birth, like ClinicOS quick-create allows.
- The researcher is a role in the stand-in user table only; in Phase 12 it maps from `doctor_profile.researcher_flag` (ADR-D20).
