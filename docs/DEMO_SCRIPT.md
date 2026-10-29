# Viva demo script — simulated prototype only

Say this first: **“VaaniEHR is a simulated-data research prototype, not for real patients or clinical use. Every external integration shown is clearly identified as a mock, fixture, or unverified configuration.”**

Use only the README's local fake-data setup. Do not enter patient data, real ABHA identities, credentials, or a real WhatsApp number.

| Step | Show | Evidence and precise claim |
|---|---|---|
| 1. Login and consent | Development login, simulated-data banner, consent screen | Standalone prototype behavior with local fake data; not ClinicOS authentication. |
| 2. Transcript and facts | Mock speech path, extraction draft, confirm/reject controls | Mock/sample extraction and doctor-review controls. It is not proof of live ASR accuracy or clinical fact validity. |
| 3. Guided questions | The labelled toy pathway and candidate panel | Real question-engine mechanics on non-clinical toy content. It does not diagnose and has no clinician-approved pathway. |
| 4. Prescription draft | Add a clearly fake medicine such as `Drug-A (FAKE)` | Prescription-entry mechanics only. No medicine recommendation, dose calculation, interaction check, or safety decision is demonstrated. |
| 5. Sign-off and audit | Review/sign page, safety-not-configured acknowledgement, record version, audit chain | Prototype sign-off, immutable snapshot/amendment, and audit-chain behavior. The acknowledgement explicitly means Phase 7 safety checks were not run. |
| 6. FHIR tab | Generated bundle and its validator state | Bundle generation exists. If a local validator is configured, its result applies to this generated fixture-like local record; otherwise show “Not validated.” Do not claim government submission, complete NRCeS conformance, or ABDM interoperability. |
| 7. ABHA page (optional) | Mode notice and mock identity flow | The default is a mock with fake identities. Do not call it an ABHA verification. Sandbox support is credential-gated and unverified. |
| 8. Gujarati summary (optional) | Preview, doctor approval, and send log | The default sender is a mock: it records a log and sends no message. No Meta account, approved template, or delivery evidence exists. Gujarati wording remains unreviewed. |
| 9. Evaluation evidence (optional) | `docs/EVALUATION_PLAN.md` and benchmark tools | Tooling and small acted/synthetic fixtures exist. Results are protocol demonstrations, not a clinical evaluation or published benchmark. |

## Questions to answer directly

**Is it safe for real patients?** No. It is restricted to simulated/acted data. Phase 7 clinical safety is not implemented; the project does not claim medical safety.

**Is ABHA/WhatsApp/FHIR live?** No. ABHA and WhatsApp default to mocks. FHIR is generated and checked against local golden fixtures when the validator is configured; no external endpoint is demonstrated.

**What clinical content is real?** None of the committed pathways or safety rules are clinical. The pathways are toys; Phase 7 has metadata/locking preparation only. Clinical content needs cited sources and clinician approval.

**What has been verified?** Code and automated tests verify specific prototype behavior. They do not verify clinical suitability, external credentials, regulatory compliance, user acceptance, or research claims.
