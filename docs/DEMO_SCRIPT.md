# DEMO_SCRIPT.md - 5-minute viva demo (mock engine, toy pathway, simulated data)

Everything on screen is **simulated**: fake patients, a fake speech engine that "hears" two made-up lines, a **toy** pathway ("Test pathway - not clinical"), and fake medicines. Say this in the first ten seconds. The safety engine (Phase 7) does not exist; the screens say so.

## Before the demo (not part of the five minutes)
1. `npm run db:up`, `npm run db:migrate`, `npm run seed:dev` (fake data; passwords go to `data\dev-credentials.json`, never shown on screen).
2. Fake pathways and word list, in `apps\api-node\.env` (toy files only, allowed because this is a demo): `PATHWAYS_ALLOW_TEST=true`, `PATHWAYS_DIR=<repo>\packages\rules\fixtures\pathways`, `PATHWAYS_SLOT_MAP=<repo>\packages\rules\fixtures\pathways\_toy\slot-map.json`.
3. In `apps\asr-py\.env`: `ASR_ENABLE_MOCK=true`. Three terminals: `npm run dev:api`, `npm run dev:asr`, `npm run dev:web`. Open http://localhost:5173.
4. One medicine must exist for the search (the demo database has none until the licensed NLEM import is run): either run `npm run import:nlem` or add a fake row in the admin page (Medicine master -> **Add medicine**) named **Drug-A (FAKE)**, strength 500 mg, form Tablet, source "demo".
5. Sign in once as **admin** in a second window to be ready for the audit step. Keep Chrome allowed to use the microphone (the mock engine ignores the audio).

## The five minutes

| Time | Do (exact clicks) | Say |
|---|---|---|
| 0:00 | Sign in as the **doctor** (keyboard: Tab to the e-mail field, type, Tab, type, Enter). Land on "Doctor dashboard". | "VaaniEHR is a research prototype of a voice-assisted, guideline-grounded consultation module. All data here is simulated. Nothing you will see is clinical advice." |
| 0:25 | In **Start a session**, type `0000000001`, press **Start session**. | "The doctor starts a session for a registered patient. The patient's data comes from the clinic system through an adapter." |
| 0:40 | On the consent page tick **Audio recording** and **AI processing**, choose who confirmed it, press **Save consent**. | "Consent comes first. Without both consents the record button stays off, the server refuses the speech token, and withdrawal later deletes the unconfirmed draft and the audio." |
| 1:00 | Open the consultation (**Open the consultation screen**). Press **Start recording**, wait 4 s, press **Stop**. | "The mock engine returns two made-up lines, in Gujarati and English. A real engine, Sarvam, plugs in the same way. The text is a draft until I confirm it." |
| 1:35 | Press **Extract facts** (label: "Test mode - sample extraction"). Press **Confirm** on each fact; reject one. | "Facts are only suggestions, in 'heard' state, with the sentence they came from. Test mode means no language model is used. Nothing is a fact until I confirm it." |
| 2:00 | Scroll to **Suggested questions**: show the toy question and the label "Test pathway - not clinical". Press **Asked**. In **Candidate conditions** press **Working condition not listed**, type a short note, **Save note**. | "The pathway engine only suggests questions and candidates, never a diagnosis. This pathway is a toy; real pathways wait for a clinician reviewer. I decide the working condition myself." |
| 2:35 | Click the **Prescription** tab. Type `drug` in the medicine search, pick **Drug-A (FAKE)**, choose frequency **Twice daily (BD)**, duration `5 days`, **Add medicine**. | "Medicines come from the national essential medicines list, generic name first, with the source page. Free text is possible but flagged 'Not in master list'. Nothing here suggests or checks a dose." |
| 3:00 | Press **Review and sign**. Point at the checklist, the diff, the yellow box "Safety checks are not configured". | "The server decides what blocks signing. Left is what the engine proposed, right is what I will sign; where the engine proposed nothing it says doctor-entered. The safety engine is not built, so I must say so explicitly." |
| 3:25 | Tick **Safety checks were not run**, type your password, press **Sign visit** (all by keyboard: Space, Tab, type, Tab, Enter). | "Signing needs my password again and the acknowledgement. The server stores an exact snapshot and its SHA-256 hash, and the record is locked in the application and in the database." |
| 3:50 | **Open the visit record**: point at the 'Safety checks were not run' box, the hash, then the **FHIR** tab: the bundle as JSON, the validator's verdict and its messages (say honestly if the validator is not running: 'Not validated', download off). | "The signed record is read only. The safety flag is part of it forever." |
| 4:05 | **Amend this visit**: change the duration to `3 days`, write a reason, tick the acknowledgement, password, **Save amendment**. Open the record: show version 2 and the history. | "A signed visit is never edited. An amendment needs a reason, adds version 2 and keeps version 1 exactly." |
| 4:30 | In the other window (admin) open **Audit log**: show VISIT_SIGNED and VISIT_AMENDED; point at "Chain verified" (press **Verify again** to re-run it). | "Every step is in an append-only, hash-chained audit log: ids and counts only, never clinical text." |
| 4:50 | Stop. Take questions. | See below. |

## If something goes wrong on stage
- **Microphone blocked / speech service down:** the screen says so in plain words ("Speech recognition is not available right now"). Say: "This is the designed failure mode: I can add facts by hand and continue." Then use **Add a fact by hand**.
- **Fact service down:** same, "You can still add facts by hand".
- **Sign button off:** read the checklist, press **Fix this** next to the item. The server is the authority; the button is only a convenience.

## Questions you will be asked

**"Is this safe for real patients?"** - No. "This is a research prototype on simulated data. It is not a medical device and it has not been used with real patients or approved by an ethics committee. The safety engine - allergy, dose, duplicate and interaction checks and red-flag handling - is not built yet; it waits for rules with sources supplied and reviewed by a clinician. Until then the system does not pretend: every signed record carries 'Safety checks were not run', the doctor must acknowledge it, and a safety engine that fails blocks signing instead of passing silently."

**"What does the AI actually decide?"** - "Nothing. It proposes facts and questions. The doctor confirms every fact, chooses the working condition, writes the prescription and signs. The server re-checks every rule; the screen cannot override it."

**"Where does clinical content come from?"** - "Only from cited sources. The medicine list is the NLEM 2022 import with page numbers. Pathways and safety rules are empty until a clinician reviews them; today's pathway is a labelled toy."

**"What if the language model lies?"** - "Facts without an exact supporting sentence are dropped and counted; the doctor still confirms each one; the output is validated against a strict schema and treated as untrusted text."

**"What happens to the data if the patient withdraws consent?"** - "Audio and unconfirmed draft text are deleted. What the doctor confirmed, and a signed visit, is the doctor's own record and is kept (open item OCI-016 for the clinician and the data-protection contact)."

**"Can a signed record be changed?"** - "Only by an amendment with a reason, which adds a version. The database refuses edits and deletes by the application role, and an automated test breaks each guard on purpose to prove the checks notice."

**"What is not done?"** - "Suggestions and the safety engine (Phase 7), the FHIR bundle and validator (Phase 9), ABHA, the WhatsApp summary, the evaluation console, and the real ClinicOS integration. Real pathways, a clinician reviewer and ethics approval are outside the code."
