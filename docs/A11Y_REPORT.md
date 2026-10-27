# Accessibility report (Phase 12B Run 2, ADR-D45)

**What this report claims.** The app was *tested against WCAG 2.1 AA with automated checks plus a keyboard walkthrough* (the automated rules also include the WCAG 2.2 AA rule set and axe best practices). **It does not claim WCAG conformance.** Automated tools find roughly a third of accessibility problems; the rest needs a person using a screen reader and a keyboard. That manual test (NVDA) has **not** been done: it is the owner's step (see "What the manual test needs").

## 1. Method

| Check | How | Where | What it covers |
|---|---|---|---|
| Every route, in a real browser | axe-core 4.14.0 (tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`, `best-practice`), colour contrast ON, run by Playwright (playwright-core 1.64.1, system Chrome) | `npm run e2e`, block "every route, both languages, desktop and phone width" in `scripts/e2e.mjs`; helper `scripts/browser-lib.mjs` | each route at **1280 px and 375 px**, in **English and Gujarati**, signed in as the role that may open it (doctor, staff, admin, and signed out for the public pages). **Any** axe violation fails the run, not only serious and critical ones |
| Touch targets | every button, link, input, select, textarea, tab, switch and combobox must be at least 44 x 44 CSS px (a radio or checkbox counts through its label) | same scan (`scanPage`) | the 44 px rule on every route and on the new screens |
| Sideways scrolling | the page may not scroll horizontally at 375 px | `scan()` in `e2e.mjs` | reflow at phone width |
| Keyboard pass | Tab through each English desktop route: report a control with no visible focus indicator, a keyboard trap, or almost nothing reachable | `keyboardAudit()` in `e2e.mjs`; the e2e signs in with the keyboard only | Tab order, focus visible (WCAG 2.4.7), no trap (2.1.2) |
| Pages in jsdom | axe on every page in English and Gujarati (colour contrast and landmarks off there, because jsdom has no layout) | `apps/web/src/pages/pages.a11y.test.tsx` (28 cases, each in English and Gujarati) | structure, names, roles, labels, heading order |
| Dynamic regions and focus | structural tests of roles, live regions, error-summary focus, dialog focus, route-change focus | `apps/web/src/a11y.live-regions.test.tsx` | see section 4 |
| Colour tokens | contrast ratios of every text and background pair of the design tokens | `apps/web/src/design/tokens.contrast.test.ts` | contrast by design, in addition to the browser check |
| Design specimen | `npm run a11y` (CI job "a11y") scans `/design` and the Phase 3B pages | `scripts/a11y.mjs` | the design system itself |

## 2. Results per route

All routes below passed the browser sweep (axe, 44 px, no sideways scrolling) at 1280 px and 375 px in English and Gujarati, and the English keyboard pass, in the final run of `npm run e2e`. "Stops" is how many Tab presses landed on distinct controls out of the controls found; a lower number is expected where a radio group, tab list or combobox is one Tab stop operated with the arrow keys.

| Route | Who | Keyboard pass (stops / controls) |
|---|---|---|
| `/login` | everyone | 5 / 5 |
| `/404`, `/403`, `/500` | everyone | 1 / 1 each |
| `/design` | everyone | 56 / 58 |
| `/doctor` | doctor | 17 / 17 |
| `/consult/:id` (workspace) | doctor | 25 / 28 |
| `/consult/:id/sign`, `/record`, `/amend`, `/summary` | doctor | 14 / 14, 11 / 11, 11 / 11, 12 / 12 |
| `/consult/:id/consent` | doctor, staff | 17 / 19 (doctor), 15 / 17 (staff) |
| `/patients/:id/abha` | doctor, staff | 14 / 18, 12 / 16 |
| `/admin/fhir`, `/admin/fhir/:id` | doctor, admin | 11 / 11, 12 / 12 |
| `/admin/pathways` | doctor, admin | 11 / 11, 16 / 16 |
| `/admin/templates`, `/admin/templates/new` | doctor, admin | 16 / 16, 15 / 16 |
| `/settings` | all | 15 / 15 (doctor) |
| unknown route (placeholder page) | doctor | 11 / 11 |
| `/patients` | staff, admin | 12 / 12, 19 / 19 |
| `/privacy/requests` (new, PG-20) | staff, admin | 15 / 15, 22 / 22 |
| `/admin/audit` | admin | 50 / 73 |
| `/admin/medicines` | admin | 47 / 31 |

The "controls" figure is a heuristic count of visible interactive elements, so it can be above or below the stops (hidden-until-hover actions, dynamic rows, grouped controls). The check fails only when almost nothing is reachable, when a control is reached without a visible focus ring, or when focus gets trapped.

## 3. Findings and fixes (this run)

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | `/404`, `/403` and `/500` opened on their own had no `<main>` landmark and their content was outside any landmark (axe `landmark-one-main`, `region`) | moderate | **fixed** (`StandaloneMain` in `pages/ErrorPages.tsx`, wired in `App.tsx`) |
| 2 | After a route change in the single-page app the page title stayed "VaaniEHR (research prototype)" and keyboard focus was left on a link that no longer exists (WCAG 2.4.2, 2.4.3) | moderate | **fixed** (`shell/AppShell.tsx`: the title follows the page heading; focus moves to the main region after a route change, not on first load; tested in `a11y.live-regions.test.tsx`) |
| 3 | The date fields on the audit page (day, month and year are parts inside one field) showed no focus ring from the app's own style in Chrome | low | **fixed** (`index.css`: a ring on `:focus-within` for date and time inputs) |
| 4 | The test harness measured colour contrast while table rows were still fading in, and read the focus ring while it was still easing in | test only | **fixed in the harness** (`browser-lib.mjs` waits for the rows; the keyboard pass turns transitions off while it measures) |

Earlier phases already fixed heading order, 44 px targets, Gujarati line height and reduced motion (docs/DESIGN.md).

## 4. Dynamic regions and focus (what is announced, and where focus goes)

| Part | Role and behaviour | Evidence |
|---|---|---|
| Live transcript | the list has `aria-live="off"`: new words are **not** read out one by one (that would flood a screen reader). The recording bar carries a polite status (`role="status"`, screen-reader-only) and errors use `role="alert"` | `a11y.live-regions.test.tsx`; `components/clinical/RecordBar.tsx` |
| Red-flag banner | `role="alert"` (assertive), words plus icon, stays until Acknowledge | `a11y.live-regions.test.tsx`; `RedFlagBanner.tsx` |
| Toasts | one named region, `aria-live="polite"`, `aria-relevant="additions"`; only a blocked toast is `role="alert"`; safety toasts stay until dismissed | `a11y.live-regions.test.tsx`; `components/ui/Toast.tsx` |
| Banners | a live banner of kind blocked is an alert, other live banners are polite status, static banners announce nothing | `a11y.live-regions.test.tsx` |
| Facts panel refresh | a polite screen-reader-only status sentence announces changes; the chips keep their focus | `FactsPanel.tsx`; e2e |
| Forms | a failed submit shows an error summary (`role="alert"`) that takes focus, with links that move focus to each field | `a11y.live-regions.test.tsx`; e2e ("the error summary takes focus") |
| Dialogs | focus moves in, stays in, Escape closes, focus returns to the opener | `a11y.live-regions.test.tsx` |
| Loading | skeletons are `role="status"` with `aria-busy` | `components/ui/Feedback.tsx` |
| Route change | title follows the heading; focus moves to the main region | finding 2 |

## 5. Colour contrast and the 44 px rule on the new screens

The new screens of this phase (`/privacy/requests`, including its dialogs, and the earlier ABHA page) pass the browser sweep with colour contrast on and the 44 px check on, at both widths and in both languages. Status is always written as text next to an icon, never colour alone.

## 6. Remaining items

| # | Item | Severity | Note |
|---|---|---|---|
| R1 | No screen-reader test (NVDA, VoiceOver, TalkBack) has been done | **high until done** for any claim about screen-reader use | the owner's step, below |
| R2 | The Gujarati strings are unreviewed, and how a screen reader's Gujarati voice reads them is unknown | medium | NOTICE_REVIEW.md; test with an NVDA Gujarati voice if one is installed |
| R3 | The live transcript is deliberately silent for words; a screen-reader user is told about state changes but not each new word | medium (design decision) | check with NVDA whether this helps or hides too much |
| R4 | The full journey (sign in, patient, consent, record, facts, question, prescription, sign, record page, WhatsApp approval) is keyboard-driven only at sign-in and in the Tab pass; the middle steps use mouse clicks in `e2e.mjs` | low | do it by hand once, with the keyboard only (section 7) |
| R5 | Not tested: 400% zoom beyond the 375 px width check, user text-spacing overrides (WCAG 1.4.12), forced-colours mode, pointer gestures, captions (there is no media) | low | manual |
| R6 | Reduced motion is checked on the login page only (no animation under `prefers-reduced-motion`) | low | extend the check to the other pages if animations are added |
| R7 | The keyboard pass is a heuristic (see section 2) | low | |

## 7. What the manual test (NVDA) needs from the owner

1. **Set up:** install NVDA (free, nvaccess.org), use Chrome, sign in with a seeded fake account. Test once in English and once with the language set to Gujarati. Keep the speech viewer open (NVDA menu, Tools, Speech Viewer) so you can copy what was read.
2. **Journey to walk with the keyboard only (no mouse):** sign in, patients (find by phone), consent (record the three scopes), record (start, stop), facts (confirm one, reject one, add one), pathway question and candidate, prescription (add a medicine), sign (password), the record page, the WhatsApp approval page, an erasure request (staff records it, admin completes it).
3. **Listen for:** every control has a sensible name (not "button" or "edit 1"); headings give the page structure (H key); landmarks (D key) are main, navigation and banner; a status change is announced (saving, consent withdrawn, signed); an error is announced and focus is on the error summary; after opening a page you are at the start of the content, not at the top of the menu; dialogs say their title and trap focus; tables read the column headers; the red-flag banner is announced immediately; Gujarati text is read in Gujarati and English drug names in English.
4. **Write down** for each problem: the page, what you did, what NVDA said, what you expected. Send the list; each item becomes a fix with a test.
