# WHATSAPP_SUBMISSION.md - what the owner submits to Meta and what a Gujarati reviewer checks (Phase 10 Run 1, ADR-D41)

Real sending is **OFF**. The default sender is the mock (`WHATSAPP_PROVIDER=mock`): messages are recorded in the log and sent nowhere. No Meta credential is needed or used by anything in this repository today. This document is the checklist for the day the owner decides to switch on the real sender for a test number.

## 1. Facts taken from Meta's documentation (read 2026-10-24; cite these pages)

| Fact | Page |
|---|---|
| Send a message: `POST https://graph.facebook.com/{Version}/{Phone-Number-ID}/messages`, header `Authorization: Bearer <token>`, `Content-Type: application/json`. The page does not say which API version to use, so `WHATSAPP_API_VERSION` has **no default**: the owner sets it | https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages |
| A template message body: `{"messaging_product":"whatsapp","recipient_type":"individual","to":"<number>","type":"template","template":{"name":"<name>","language":{"code":"<code>"},"components":[{"type":"body","parameters":[{"type":"text","text":"<value>"}, ...]}]}}`; positional values "must appear in the order in which their corresponding placeholders appear" | https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview (the old `.../cloud-api/guides/send-message-templates` page now says "This page has moved" to it) |
| The answer carries `messages[].id` (and `message_status`: accepted, held_for_quality_assessment, paused) | the reference page above |
| Webhook verification: a GET with `hub.mode` (always `subscribe`), `hub.challenge`, `hub.verify_token`; check the token and answer with the `hub.challenge` value | https://developers.facebook.com/docs/graph-api/webhooks/getting-started |
| Payload signature: header `X-Hub-Signature-256` = `sha256=` + SHA-256 HMAC of the payload with the **App Secret**; compare before trusting. The page does not say in words that the raw body bytes are signed; the code signs and checks the raw bytes | same page |
| Respond to every event notification with `200 OK`. Failed deliveries are retried for up to 7 days | same page and https://developers.facebook.com/docs/whatsapp/cloud-api/guides/set-up-webhooks |
| A status update has `statuses[]` with `id`, `status` (sent, delivered, read, failed, played), `timestamp`, `recipient_id`, optional `errors[]` (`code`, `title`, `message`, `error_data.details`) | https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/status |
| An incoming text: `entry[].changes[].value.messages[]` with `from`, `id`, `type: "text"`, `text.body` | https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/components |
| **UTILITY** templates "enable businesses to follow up on user actions or requests"; they must be non-promotional and specific to the user or essential to them. Mixed content (utility plus marketing) is treated as MARKETING. Since 9 April 2025 a template submitted as UTILITY that Meta judges to be MARKETING is approved as MARKETING | https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-categorization |

**Not found on those pages (so not assumed):** rules about line breaks, tabs or runs of spaces inside a template variable, and a length limit for variables of non-authentication templates. The code therefore keeps every variable to one line with single spaces and caps each at 900 characters (the doctor-typed parts at 600). **The owner must confirm both limits in the template editor or with Meta before real sending.**

## 2. What the owner submits (template)

| Field | Value |
|---|---|
| Name | `vaaniehr_visit_summary_gu` |
| Language | Gujarati, code `gu` (exactly as the code sends it) |
| Category | **UTILITY** (a follow-up after the patient's own visit; no promotional wording) |
| Header / footer / buttons | none |
| Body (4 variables, positional) | the text below |
| Sample values for review | one fake example per variable (never a real patient) |

Body, exactly (this is the fixed text in `apps/api-node/src/whatsapp/phrases.ts`, `TEMPLATE_BODY_GU`):

```
તમારી મુલાકાતનો સારાંશ

તારણો: {{1}}

દવાઓ: {{2}}

ચેતવણીનાં ચિહ્નો: {{3}}

ફોલો-અપ: {{4}}
```

English meaning of the body (for the reviewer, `TEMPLATE_BODY_EN`): "Summary of your visit / Findings: {{1}} / Medicines: {{2}} / Warning signs: {{3}} / Follow-up: {{4}}".

What goes into the variables (always one line each):
- `{{1}}` the doctor-confirmed facts, `label: value (flags)` separated by ` | `. The value is the text as signed, passed through unchanged.
- `{{2}}` the medicines, `N. name strength form - dose, frequency phrase, duration, note` separated by ` | `. Name, strength, form, dose, duration and note are copied verbatim from the signed record; only the frequency word comes from the fixed table.
- `{{3}}` and `{{4}}` the warning signs and the follow-up exactly as the doctor typed them (line breaks become spaces). If empty, the fixed phrase "કોઈ નોંધ નથી" (No note).

## 3. Owner checklist before the first real message to a TEST number

1. A Meta business account and a WhatsApp Business phone number with a Cloud API app (not started; `docs/OWNER_ACTIONS.md`).
2. Submit the template above; wait for it to be **approved as UTILITY** (if Meta recategorises it as MARKETING, do not use it without a decision).
3. A Gujarati reviewer has signed off the phrases in section 5 (below).
4. Set in the **private** `apps/api-node/.env` (never in a tracked file, never in chat): `WHATSAPP_PROVIDER=meta`, `WHATSAPP_ENABLE_REAL=true`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_API_VERSION`, `WHATSAPP_TEST_ALLOWLIST` (comma-separated numbers of people who agreed, your own phone first), `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`.
5. Webhook: a public HTTPS address for `GET/POST /api/v1/webhooks/whatsapp` (a tunnel for a test), subscribed to the `messages` field. Verify with the verify token.
6. Test with your own number only; reply `STOP` and check that the WhatsApp consent is withdrawn in the app.
7. Meta's own opt-in and conversation rules for business messages apply; the owner and the institution decide the legal wording (the consent notice text is still a placeholder, OCI items).

The code refuses to send to any number that is not on `WHATSAPP_TEST_ALLOWLIST`, whatever else is set, and a half-configured real sender fails instead of falling back to the mock.

## 4. What a Gujarati reviewer must check

- Every phrase in section 5: spelling, grammar, politeness level, and that a patient in Gujarat understands it. Mark each OK or give the corrected wording (then the table in `phrases.ts` changes and the template is re-submitted).
- The body text as a whole when the variables are filled with the sample values: does the sentence order read naturally?
- Mixed text: a fact value or a medicine name may be English or Gujarati as the doctor typed it; check that the separators (` | ` and ` - `) read acceptably.
- The negation and uncertainty words "નથી" (not present) and "ચોક્કસ નથી" (not certain): is the meaning unambiguous next to a symptom?
- The frequency words (section 5): are they what a pharmacist would say?
- The STOP words in section 5.
- The consent notice Gujarati text and every Gujarati label in the web app are separate open items (`docs/OWNER_ACTIONS.md`).

## 5. The unreviewed Gujarati phrases (all of them, in `apps/api-node/src/whatsapp/phrases.ts`)

A test fails if this list and the table differ. Each one is shown in the app as "Needs Gujarati review".

| Gujarati | English side (used for the back-translation) | Use |
|---|---|---|
| તમારી મુલાકાતનો સારાંશ | Summary of your visit | title |
| તારણો | Findings | heading |
| દવાઓ | Medicines | heading |
| ચેતવણીનાં ચિહ્નો | Warning signs | heading |
| ફોલો-અપ | Follow-up | heading |
| કોઈ નોંધ નથી | No note | an empty field (a variable cannot be empty) |
| નથી | not present | negated fact |
| ચોક્કસ નથી | not certain | uncertain fact |
| લક્ષણ | Symptom | fact label |
| સમયગાળો | Duration | fact label |
| તીવ્રતા | Severity | fact label |
| માપ | Measurement | fact label |
| એલર્જી | Allergy | fact label |
| અગાઉની બીમારી | Past illness | fact label |
| હાલની દવા | Current medicine | fact label |
| દિવસમાં એક વાર | once a day | frequency OD |
| દિવસમાં બે વાર | twice a day | frequency BD |
| દિવસમાં ત્રણ વાર | three times a day | frequency TDS |
| દિવસમાં ચાર વાર | four times a day | frequency QID |
| જરૂર પડે ત્યારે | when needed | frequency SOS |
| બંધ | stop | an opt-out reply (with the English word STOP) |

Not sent to the patient on purpose: a red-flag mention fact (the doctor writes warning signs in their own words instead). The system never writes a warning sign, a follow-up instruction, a diagnosis or advice.
