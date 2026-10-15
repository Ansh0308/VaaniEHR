# The audit chain: what it proves, and how to record its head hash

(ADR-D20, NFR-REL-01, FR-F7-04. The behaviour below is exercised by `apps/api-node/test/verify-cli.db.test.ts`.)

## What it is
Every change the API makes (login, patient lookup, session, consent, ...) writes one row to `audit_log` in the same database transaction. Each row stores `prev_hash` (the previous row's `row_hash`) and its own `row_hash`, a SHA-256 over the row's fields plus `prev_hash`. So the rows form a chain, like links: edit, delete or re-order any row and every hash after it stops matching.

## What the chain proves, and what it cannot
| Tampering | Detected by the chain alone? |
|---|---|
| A row is edited | Yes: that row's hash no longer matches |
| A row in the **middle** or at the **start** is deleted | Yes: the next row's `seq` and `prev_hash` no longer fit |
| Rows are re-ordered or re-numbered | Yes |
| Rows are deleted from the **end** of the log | **No.** What is left is still a perfectly valid, just shorter, chain |

The last case is why you keep a copy of the **head hash** (the newest row's hash) and the **row count** somewhere the database owner cannot quietly change. If someone removes the newest rows, the head hash and count will no longer match your copy.

## Check the chain
```powershell
npm run verify:audit
```
Prints `audit chain OK: <count> row(s), head seq <n>` and `head hash: <64 hex characters>`. If a row was changed or removed from inside the chain it prints `AUDIT CHAIN BROKEN at seq <n> (<reason>)` and exits with code 1.

## Record the head hash and count
Do this at moments that matter: before a demo or supervisor review, at the end of each phase, before and after any database maintenance.
1. Run `npm run verify:audit` and copy the two values it prints (count and head hash).
2. Save them **outside the database machine**, with the date: your private notes, an e-mail to yourself, or a note in your private folder. They are not secret, but they must not live where the same person who could edit the database can also edit them.
3. Later, check against your copy:
```powershell
npm run verify:audit -- --expect-head <head hash you saved> --expect-count <count you saved>
```
It exits `0` only if the chain is intact **and** the values match; it exits `1` and says "rows may have been removed" otherwise.

**Expect a mismatch after normal use.** The log grows with every action, so an old copy no longer matches the current head. Compare only against a recent copy, or record again after real use. A mismatch is a reason to look, not proof of tampering; compare with the activity you know happened since the copy.

## Reading the log through the API
`GET /api/v1/audit` returns only **your clinic's** rows (admin: full rows; researcher: anonymised). `GET /api/v1/audit/verify` (admin) answers only `{ "ok": true }` or the first broken sequence number, because the chain is shared by all clinics and counts or hashes would reveal other clinics' activity. Counts and hashes come from the command above, which only the person running the database can use.

## Limits worth knowing
- Rows with no clinic (the seed run, failed logins for unknown e-mail addresses) are in the chain but not shown by the API.
- Rate-limited login attempts (HTTP 429 from the IP limiter) are not audited, to stop an attacker from flooding the chain.
- The audit rows hold identifiers and counts only, never names, phone numbers, e-mail addresses, allergies or tokens.
