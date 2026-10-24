# Evaluation plan (Phase 11A, ADR-D43)

Source: PRD v1.1 section 7.3 (VaaniBench-Gu) and section 14 (metrics M-01 to M-17, experiments 14.3). This file says what can be computed **now**, what needs data that does not exist yet, and what needs a clinician or a user study. Tools live in `apps/asr-py/app/bench/` (see `bench/README.md`); the older tools `eval:asr`, `eval:extraction`, `usage:asr` are reused, not replaced.

**Honest scope.** Today the only data is the owner's own voice reading acted text: **11 clips, one speaker, acted, no real patients** (clip01 has audio; clip02 to clip11 are text only in the repository's data). Every number from this data is a protocol demonstration, not a result. Every output table carries that note (N, "one speaker / acted data").

## Metric table

Status codes: **NOW** = computable with code and data that exist; **DATA** = the code exists after this phase but the data does not yet; **CLINICIAN** = needs a clinician reviewer; **STUDY** = needs a user study with people.

| Metric | What | Status | Why / what is missing |
|---|---|---|---|
| M-01 WER / CER | ASR error rates per engine, language, speaker role | **NOW** for the clips that have audio (clip01); **DATA** for the 100-clip set | Scoring is built (script-aware WER; CER added). Needs more audio, more speakers, doctor/patient roles |
| M-02 Medicine-name accuracy | spoken medicine mentions normalised to the right NLEM generic | **NOW** (code + 11 texts) / **DATA** for a meaningful sample | Needs gold medicine mentions in the cases; the NLEM table exists |
| M-03 Fact P/R/F1 + negation F1 | against gold facts | **NOW** (existing `eval:extraction`; 11 cases with gold) | Real-model runs only through the opt-in, capped, simulated-text path |
| M-04 Hallucination rate | ungrounded facts / total | **NOW** | Already counted by the grounding step; now reported as a rate |
| M-05 Pathway top-1 / top-3 | correct condition in first / top three | **NOW on toy pathways only** (labelled as such); real: **CLINICIAN** | No real pathways exist (OCI-019); gold differentials need a clinician |
| M-06 Questions to top-3 | median questions asked | **NOW on toy pathways only** | same |
| M-07 Hybrid gain | hybrid vs rules-only vs LLM-only | **DATA** + not built | The LLM-only and hybrid question engines do not exist; shown as "not built" placeholders |
| M-08 Red-flag recall | red-flag cases stopped | **NOW on toy red-flag cases only** | Real red flags need a clinician's list |
| M-09 Safety recall | seeded unsafe prescriptions flagged | **CLINICIAN** and not built | The safety engine (Phase 7) is not built; the 50-case suite needs clinician-approved rules |
| M-10 Safety precision | alerts judged appropriate | **CLINICIAN** | needs a reviewer sheet and the safety engine |
| M-11 FHIR validity | signed visits validating with 0 errors | **NOW** (validator in CI; the percentage is computed from a CSV of validator results) | Currently golden fixtures only |
| M-12 Time to signed record | seconds from end of consultation to sign | **STUDY** (scoring code is built) | Needs timed trials with doctors, with a manual-typing baseline |
| M-13 SUS and NASA-TLX | usability | **STUDY** (scoring code is built) | Needs 5 to 10 doctor testers |
| M-14 Suggestion acceptance | accepted / edited / rejected | **STUDY** | Needs suggestions (Phase 7) and real use |
| M-15 ABHA sandbox | verify flow works end to end | **DATA** | Mock flow works (ADR-D42); the sandbox is not applied for |
| M-16 WhatsApp delivery | summaries delivered to test numbers | **DATA** | Mock sender only (ADR-D41); needs the Meta account and template |
| M-17 Benchmark release | dataset card, scripts, licence, consent forms | **NOW** drafts only | Drafts in `bench/drafts/`, all legal and ethical text marked "to be checked by my guide / institution" |
| Agreement (7.3) | inter-annotator agreement on 10% double-annotated | **NOW** (Cohen's kappa code) / **DATA** | needs a second annotator |

## Experiments (PRD 14.3)

1. ASR comparison (Sarvam, IndicConformer, faster-whisper; with and without keyterms): runner supports the engines that exist; paid engines need `--yes-run` and the spend caps.
2. Extraction ablation (plain, constrained, grounded): runs now, mock by default.
3. Question-engine ablation: rules-only now (toy pathways); LLM-only and hybrid are placeholders that report "not built".
4. Error propagation (ASR errors into extraction): the runner can feed ASR hypotheses into extraction instead of gold text; needs audio for more clips.
5. Citation effect: **STUDY**.

## Recording targets

See OWNER_ACTIONS: 100 final plus up to 50 development consultations, at least 6 actors, at least 2 doctors-in-role, 10% double-annotated. Today: 11 clips, 1 speaker.
