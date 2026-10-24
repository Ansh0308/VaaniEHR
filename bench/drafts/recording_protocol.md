# DRAFT: Recording protocol (VaaniBench-Gu)

> Draft for review. Anything about consent, ethics or law: to be checked by my guide / institution. Nobody except the owner is recorded until the consent form is signed and the guide / institution has approved the plan.

## Targets (PRD 7.3)
100 final consultations plus up to 50 development ones, 3 to 10 minutes each, at least 6 actors (mixed gender and accent), at least 2 acting as doctors, the five pathway conditions plus about 10% out-of-scope and red-flag cases. The pathway conditions are not decided yet (OCI-019), so scripts for real conditions must wait for the clinician.

## Equipment
- Primary: a phone or a USB headset microphone placed 20 to 30 cm from the speaker; record 16-bit mono. Fix the device per session and write it on the log sheet.
- Optional second device (laptop microphone) for a "far field" variant.
- Save as WAV (16 kHz mono is what the tools read); keep the original file untouched, work on copies.
- Headphones for the person not speaking if two actors share a room, to avoid cross-talk (unless cross-talk is the planned noise condition).

## Rooms and noise levels (label every recording)
| Level | Description |
|---|---|
| clean | quiet closed room, fan off |
| low | closed room, fan or distant traffic |
| medium | open window, corridor or waiting-room chatter |
| high | clinic-like background (several people talking), played or real |

Do not record in a real clinic with real patients present.

## Script format
Plain text, one sentence per line, speaker prefix `D:` doctor, `P:` patient, `M:` attendant (the prefix is **not** spoken). Gujarati script for Gujarati, Devanagari for Hindi, Latin for English words and drug names; numbers written the way they are spoken. Scripts are made up, contain no real names or real histories, and are written with a practising doctor (to be arranged; until then the scripts are drafts that need a clinician).

Each script must include some of: negations ("no fever"), corrections ("not X, I meant Y"), uncertainty ("maybe"), medicine names (generic and common brand), numbers and durations, Gujarati-Hindi-English code-switching.

## Per-session procedure
1. Check the consent form is signed; assign the actor code.
2. Fill the log sheet: date, room, noise level, device, actor codes, script ids.
3. Do a 10-second test recording and listen.
4. Record each script from the first line to the last; on a mistake, pause 2 seconds and restart the sentence (the extra take is cut during annotation, not by the actor).
5. Name the file `<case-id>.wav`; add the case JSON from `bench/template.json`; run `npm run bench:validate`.
6. Back up to the project's private storage; never upload to a public place before consent and approval (to be checked by my guide / institution).

## Quality checks
Peak level not clipping; no real name or phone number spoken (if spoken, re-record); duration inside 3 to 10 minutes; transcript written within a week.
