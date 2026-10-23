# FHIR_MAPPING.md - what the FHIR builder writes (Phase 9A, ADR-D40)

Source of truth for the profiles: the official **ABDM FHIR Implementation Guide `ndhm.in` version 6.5.0** (NRCeS, release of 2025-05-08, the current release on https://nrces.in/ndhm/fhir/r4/ confirmed 2026-10-23; package https://nrces.in/ndhm/fhir/r4/package.tgz, SHA-256 `41fa9995...4527d4`, licence CC0-1.0 per its `package.json`). Base standard FHIR R4 (4.0.1). Code: `apps/api-node/src/fhir/builder.ts`. Elements the profiles require that we cannot fill are in `docs/FHIR_GAPS.md`.

Two document bundles are built from each signed visit **version**:

| Bundle | Bundle profile | Composition profile | Built when |
|---|---|---|---|
| Consultation record | `DocumentBundle` | `OPConsultRecord` (type SNOMED `371530004`, fixed by the profile) | always |
| Prescription record | `DocumentBundle` | `PrescriptionRecord` (type SNOMED `440545006`, fixed by the profile) | the version has at least one medicine row |

Rules: **no code is invented.** The only codes written are (1) the SNOMED CT codes the profiles themselves fix (Composition type and section codes), and (2) standard HL7 terminology that the IG's own examples use (`v2-0203#MR`, `v3-ActCode#AMB`, condition/allergy verification and clinical status, observation category `vital-signs`). Symptoms, medicines, vitals, allergies and the working condition are **text only** (`CodeableConcept.text`), which the IG allows. Ids are deterministic UUID v5 (`urn:uuid:`). All dates are Asia/Kolkata with the `+05:30` offset. Identifier systems are our own `https://vaaniehr.invalid/...` namespaces (they say who issued the id; they are not clinical codes).

## Bundle and Composition

| Element we fill | Profile element | Our source |
|---|---|---|
| `Bundle.meta.profile`, `versionId` | DocumentBundle `meta` (1..1), `meta.versionId` (1..1) | fixed URL; visit version number |
| `Bundle.meta.lastUpdated`, `Bundle.timestamp` | `timestamp` (1..1) | `visit_record_version.signed_at` |
| `Bundle.identifier` (system `.../id/bundle`, value uuid5 of visit + kind) | `identifier` (1..1) with `system`, `value` | same value for every version of the same visit |
| `Bundle.type = document` | fixed `document` | - |
| `Composition.meta.profile`, `.meta.tag` | profile; tag only when safety checks were not run | `safety_not_run_acknowledged` |
| `Composition.text` (narrative) | DomainResource narrative | generated; says "Safety checks were not run" / "ran", and amendment version |
| `Composition.identifier` | identifier | uuid5 of visit, kind, version |
| `Composition.status = final` | status (MS) | signed = final |
| `Composition.type` | type (MS), coding fixed | profile |
| `Composition.subject` | subject (1..1, MS) | patient |
| `Composition.encounter` (OP only) | encounter (1..1, MS) | encounter |
| `Composition.date` | date (MS) | signed_at |
| `Composition.author` | author (MS) | signing doctor |
| `Composition.attester` (`legal`, signing time, doctor) | attester (MS) | signing with password re-entry |
| `Composition.title` | title (MS) | "Consultation Report" / "Prescription" |
| `Composition.relatesTo` (`replaces`, target identifier) | base R4 | amendment: previous version's composition identifier |
| `Composition.section` Chief complaints `422843007` | section slice (entry: Condition) | facts of type symptom |
| `Composition.section` Physical examination `425044008` | section slice (entry: Observation) | facts of type vital |
| `Composition.section` Allergies `722446000` | section slice (entry: AllergyIntolerance) | facts of type allergy |
| `Composition.section` Medical history `371529009` | section slice (entry: Condition) | facts of type past_condition; the working condition |
| `Composition.section` Medications `721912009` | section slice (entry: MedicationStatement or MedicationRequest) | facts of type current_medicine; medicine rows |
| `Composition.section` Clinical findings `404684003` | section slice (entry: Observation) | facts of type duration, severity, red_flag_mention |
| `Composition.section` Consultation summary `371530004` (text only) | section slice | only when nothing else was recorded (the profile needs one section) |
| PrescriptionRecord section `440545006` | section (1..1) with `MedicationRequest` entries | medicine rows |

## Resources

| Resource (profile) | Elements we fill | Our source |
|---|---|---|
| Patient (`Patient`) | `identifier` (type v2-0203 `MR`, our patient namespace, value = patient id), `name.text`, `telecom` (phone, `+91` + the 10 digits ClinicOS keeps), `gender`, `birthDate`, narrative | clinic directory (`getPatient`); gender is free text mapped to male/female/other, else `unknown` |
| Practitioner (`Practitioner`) | `identifier` (type **text only**: "VaaniEHR user id (not an HPR id or a licence number)"; our practitioner namespace; value = user id), `name.text`, narrative | clinic directory (`getUser`) |
| Encounter (`Encounter`) | `identifier` (session id), `status = finished`, `class` v3-ActCode `AMB`, `subject`, `period.start/end`, narrative | session `started_at`, `ended_at` (signing time if the session never ended) |
| Condition (`Condition`) - symptom, past condition | `code.text`, `subject`, `recordedDate`, `clinicalStatus = active` (not for a refuted one), `verificationStatus`, narrative | fact value |
| Condition - working condition | `code.text` ("Working condition (doctor's note): ..." or "(pathway id, version n)"), `verificationStatus = provisional`, `clinicalStatus = active`, `subject`, `recordedDate`, narrative | selected candidate |
| Observation (`Observation`) - duration, severity, vital, red-flag mention | `status = final`, `category vital-signs` (vital only), `code.text` (label), `subject`, `effectiveDateTime`, `performer` (doctor), `valueString`, `note` for not present / uncertain, narrative | fact value |
| AllergyIntolerance (`AllergyIntolerance`) | `code.text`, `patient`, `recordedDate`, `recorder`, `clinicalStatus`, `verificationStatus`, narrative | fact of type allergy |
| MedicationStatement (`MedicationStatement`) | `status` (`unknown`; `not-taken` when negated), `medicationCodeableConcept.text`, `subject`, narrative | fact of type current_medicine |
| MedicationRequest (`MedicationRequest`) | `status = active`, `intent = order`, `medicationCodeableConcept.text` ("name strength form"), `subject`, `authoredOn`, `requester`, `dosageInstruction.text` ("dose, frequency code, duration, note"), `note`, narrative | signed medicine row |

## Choices (each is recorded because the IG leaves it open)

- **Negated fact ("not present").** Condition and AllergyIntolerance: `verificationStatus = refuted` (HL7 code) and **no** active `clinicalStatus`. Observation: kept as a normal string observation with a note "Recorded as not present." MedicationStatement: `status = not-taken`. The IG's profiles offer no extension for negation.
- **Uncertain fact.** Condition and AllergyIntolerance: `verificationStatus = unconfirmed`. Observation: a note "Recorded as uncertain."
- **Working condition.** A text-only Condition, `provisional`, naming where it came from (the doctor's note or the pathway id and version). The IG's Encounter diagnosis `use` needs a SNOMED code we do not hold and a clinical judgement we do not make, so it is not used.
- **Medicine "not in master list".** Carried honestly in `MedicationRequest.note`: "Not in master list: this medicine was typed by the doctor and has no source." A master medicine's note gives the source and printed page. No medicine code (SNOMED licence pending, see OWNER_ACTIONS).
- **Frequency codes (OD, BD, ...).** Written as text inside `dosageInstruction.text` only. No `timing` and no code system: the code list is unreviewed (OCI items) and mapping it to a code system is a clinical step.
- **Safety checks not run.** Not a clinical field. Carried as `Composition.meta.tag` of our own system `https://vaaniehr.invalid/fhir/CodeSystem/record-flags` (code `safety-checks-not-run`) and in the narrative. An extension was tried first: the validator reports an unknown extension as an **error**, so it was dropped.
- **Amendments.** A new bundle **version** for the same visit: same `Bundle.identifier`, `meta.versionId` = visit version, a new Composition with `relatesTo replaces` pointing at the previous version's composition identifier. Earlier versions are kept.
- **Narrative.** Every resource carries a short generated narrative (the IG examples do); without it the validator draws a `dom-6` warning per resource.
