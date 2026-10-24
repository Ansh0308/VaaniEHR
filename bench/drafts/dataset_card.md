# DRAFT: Dataset card, VaaniBench-Gu

> Draft. Licence, consent, privacy and release statements: to be checked by my guide / institution. This card describes the plan and today's state, not a published dataset.

## Summary
An acted Gujarati-Hindi-English doctor-patient conversation benchmark for evaluating speech recognition, fact extraction, and question-suggestion tools in a research prototype. All conversations are made up and acted. **No real patient data.**

## Current state (honest)
- 11 cases, one speaker (the project owner) playing every role, mostly text; one has audio. Numbers computed from it demonstrate the evaluation protocol; they are not results.
- Target: 100 final plus up to 50 development consultations, at least 6 actors, at least 2 as doctors.

## Contents
Per case: audio (when available), speaker roles, gold transcript (Gujarati/Devanagari/Latin script by language), language tags, gold facts with negation and uncertainty and evidence quotes, noise level, and (when a clinician supplies them) expected questions, candidates, prescription and condition. Format: `bench/README.md`, `bench/schema.json`.

## Collection
Scripts written by the project team with a practising doctor (to be arranged). Actors sign a consent and audio release (`consent_and_audio_release_form.md`). Recordings follow `recording_protocol.md`. Annotation follows `annotation_guidelines.md`; 10% are double-annotated and agreement is reported.

## Intended use
Comparing tools for transcription and extraction of Gujarati-led consultations; studying how recognition errors (drug names, negations) propagate. **Not** for training or validating a clinical decision tool, and not for any use on real patients.

## Limitations
Acted speech differs from real consultations (pace, vocabulary, emotion); few speakers; one region's accents at best; gold labels are human and imperfect; the Gujarati/Hindi wording of the first cases is a draft that needs native review; pathway-related labels use fake toy pathways until a clinician supplies real ones.

## Licence
Suggested in the project plan: CC-BY 4.0 for the data, a permissive licence for the scripts. **To be checked by my guide / institution** (including whether voice recordings may be released at all).

## Privacy and ethics
Actors give written consent and an audio release. Names are kept only on the signed forms, separate from the recordings; recordings carry pseudonymous actor codes. Applicable data-protection and ethics requirements: to be checked by my guide / institution.

## Maintenance and contact
[owner name and contact, to be filled]. Versioning: the dataset hash recorded in every run manifest identifies exactly which data a result used.

## Citation
[to be filled after the paper exists]
