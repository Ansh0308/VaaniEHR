# PATHWAY_AUTHORING.md - from a source passage to a signed-off pathway (Phase 6B)

**No assistant, script or tool writes clinical content.** Every step of a real pathway is copied from a source document by the project owner and checked by a named clinician. Where the source is unclear the answer is a question to the owner or the clinician, never a guess. Real pathways live in `seed/pathways/` (ADR-D18, ADR-D35); drafts in `data/pathways/drafts/` (git-ignored). Treatment content (first-line options) is Phase 7 and is not part of a pathway file.

## 1. The workflow
1. **Start a draft.** `npm run pathway:new -- data/pathways/drafts <id> --doc "ICMR STW - <volume and title>"` writes an empty draft (status `draft`, version 1, every mandatory field, no nodes).
2. **Paste one passage** from the source into the chat with the assistant (or work alone). Say the document and the page.
3. **Side by side.** The assistant shows two columns: the passage split into sentences on the left, and the proposed JSON nodes on the right. Each node points at the sentence it comes from. The assistant adds nothing that is not in a sentence.
4. **Every node carries its sentence.** Copy the exact sentence into `source_quote` (character for character, in the source language) and the page into `page`. If a node needs two sentences, make two nodes or quote both. A node with no sentence behind it is not allowed.
5. **Ambiguity is asked, never guessed.** The assistant stops and asks the owner when: a threshold has no unit or no number; "and"/"or" could join conditions in two ways; a term could be a symptom or a sign; the passage names a danger sign without saying what to do; a sentence depends on a table or figure that was not pasted; the wording differs between two passages. The question and the answer are written into the pull request description, not into the pathway.
6. **Localized text.** `ask` and `reason` in English, Gujarati and Hindi are written for the doctor to read aloud. They are translations of the quoted sentence's meaning only; a Gujarati speaker and a Hindi speaker review them (OCI-017 for the word list). Nothing in them may diagnose, confirm a condition, name a medicine or a treatment (the validator blocks the English wording).
7. **Scoring rules** (`rules`) say which answers count for the condition and how much (`weight`). Weights come from the clinician's judgement and are written down with the reason in the review notes; they are not read off the source.
8. **Lint until clean.** `npm run pathway:lint -- data/pathways/drafts` lists what is missing (errors fail, warnings do not). Fix errors first.
9. **Cases.** Copy `packages/rules/templates/pathway-cases.template.json` to `<id>.cases.json`, and with the clinician write the expected outcome of each case FROM THE SOURCE. Run `npm run pathways:cases` and `npm run pathways:coverage`; every node and edge should be exercised.
10. **Review and sign-off** (section 2).
11. **Make it active.** Fill `source.reviewed_by` and `source.reviewed_on`, set `status` to `active`, move the file into `seed/pathways/`, run `npm run pathways:validate -- seed/pathways` then `npm run pathways:lock -- seed/pathways`, and commit (`npm run check` re-validates and requires the lock).
12. **Changing it later** is never an edit: `npm run pathway:version -- seed/pathways/<file>` writes the next version as a draft with the sign-off cleared; repeat from step 2 for what changed.

## 2. Review and sign-off
1. The owner prepares a review pack: the source pages, the viewer page for the draft (`/admin/pathways`, which shows the banner "Draft - not clinically reviewed"), the lint output, the case file and the coverage report.
2. The clinician goes through the checklist below on every node. A single "no" sends the pathway back.
3. The clinician's full name goes into `source.reviewed_by` and the date of the review into `source.reviewed_on` (YYYY-MM-DD) and nowhere else is a name needed. The sign-off is recorded by committing the active file; the lock hash then fixes exactly what was reviewed.
4. If the clinician wants any change after sign-off, it is a new version and a new review.

## 3. Checklist for the clinician (per node)
- [ ] The quoted sentence is exactly the source's sentence, and the page is right.
- [ ] The question, in all three languages, asks what the sentence says and nothing more.
- [ ] The answer type fits (yes/no, number, or a list of choices) and the choices are complete.
- [ ] Each edge matches the source (the condition, the direction, no missing branch).
- [ ] A red-flag condition exists exactly where the source names a danger sign, and nowhere else.
- [ ] Each terminal says "refer" or "do not refer" as the source does. (Treatment is not recorded here.)
- [ ] The scoring weights are reasonable for the condition, and the reason is in the review notes.
- [ ] No wording diagnoses, confirms or prescribes. The pathway only helps the doctor decide what to ask next.
- [ ] Every case in the case file is what the source would give; the coverage report shows no unexercised node or edge.
- [ ] I am willing to be named in `reviewed_by`.

## 4. What the owner does when something is unclear
Write the question down, ask the clinician or the source's authors, and put the answer with its source (page, person, date) in the review notes. If it cannot be answered, leave the node out and list it in `docs/OPEN_CLINICAL_ITEMS.md` as `TODO(source)`.
