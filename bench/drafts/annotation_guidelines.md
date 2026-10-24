# DRAFT: Annotation guidelines (VaaniBench-Gu)

> Draft for review by a clinician and a native Gujarati/Hindi speaker. Nothing here is clinical advice. The rules below are the ones already used for the first 11 cases (audio/own/READ_ALOUD_AND_GOLD.md), written down so a second annotator labels the same way.

## Transcript
- Verbatim, what was said, including hesitations only when they carry meaning. Gujarati script for Gujarati, Devanagari for Hindi, Latin for English words and drug names. Numbers are written the way they were spoken (words stay words).
- One segment per sentence; each segment has a speaker (doctor, patient, attendant).
- Code-switching: write each word in the script of its language; tag the segment `gu`, `hi`, `en`, or `mixed` when more than one language carries the sentence.
- Do not correct the speaker's grammar or pronunciation.

## Gold facts
A fact is something the **patient or attendant states**, or a measurement the doctor states. Doctor questions and doctor actions ("I will check your abdomen") are not facts. Causes ("maybe because of the rain") are not a fact type, so no fact is expected for them.

Types: symptom, duration, severity, vital, allergy, past_condition, current_medicine, red_flag_mention (left unused until a clinician supplies the red-flag list; chest pain and breathlessness are labelled as symptoms).

**Evidence quote:** exact characters copied from ONE segment (the validator checks this). Keep it short but unique.

**Negation:** `negated = true` when the speaker says the thing is absent ("no fever", "ના, ઝાડા નથી થયા"). The fact is still recorded, with negated true.

**Uncertainty:** `uncertain = true` when the speaker is unsure ("maybe", "I think", "not sure how many days"). A negated and uncertain fact has both flags.

**Severity-qualifier rule (adopted):** qualifiers such as થોડી / થોડું / थोड़ा ("a little", mild) and explicit grades ("6 out of 10") are SEPARATE `severity` facts. They are not folded into the symptom's value.

**Corrections:** "not X, I meant Y": record Y only; X is not a fact (record X as negated only if the speaker clearly says X is absent).

**Numbers and durations:** one `duration` fact per duration, with the symptom it belongs to in the value ("2 days (stomach pain)").

**Medicines:** a `current_medicine` fact for a medicine the patient says they take; put spoken form and the intended generic into `medicine_mentions`. If unsure of the generic, leave `generic` as the spoken form and mark the case for review rather than guessing.

## Expected questions, candidates, prescription, condition
Leave empty (`[]` / `null`) unless a **clinician** has supplied them. Never fill them in from general knowledge.

## Double annotation (10% of cases)
A second annotator fills `bench/template-facts.csv` without seeing the first one's labels. Agreement is computed with Cohen's kappa on the labels (present / negated / uncertain / both) of the facts both marked, plus the share of facts only one marked (`app.bench.metrics.agreement`). Disagreements are discussed and the case is marked `reviewed`.

## Status
`draft` until a second person has checked it; `needs_native_review` stays true until a native speaker has read the Gujarati or Hindi.
