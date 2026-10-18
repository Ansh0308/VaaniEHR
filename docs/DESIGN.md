# VaaniEHR design system (Phase 1.2)

Option A, **Ink and Cream**, in the ClinicOS family. Light theme only. Source: `apps/web/src/design/tokens.css`. Live specimen: the `/design` page. Requirements: NFR-UX-01, NFR-UX-02, NFR-COMP-02.

## Principles

1. **Colour means safety, nothing else.** The primary action is ink (neutral). Colour appears only in the five safety states below (ADR-D7).
2. **Never colour alone.** Every state has an icon, a text label and a shape (dashed outline for "heard").
3. **The doctor decides.** AI content is marked "AI suggested"; heard facts are marked "unconfirmed" until confirmed; blocked items need a typed reason (8+ characters) to override and the reason is logged by the caller.
4. **Gujarati is a first-class script**, not a fallback (see below).
5. **Quiet and flat.** Radii 8/12/16, no pill buttons, no uppercase, no letter-spacing, soft shadows only on cards and overlays.

## Tokens (three layers)

| Layer | Where | Rule |
| --- | --- | --- |
| 1 `--palette-*` | `tokens.css` | raw values, never used by components |
| 2 semantic (`--surface-*`, `--text-*`, `--action-*`, `--state-*`) | `:root` | a future dark theme overrides only this layer |
| 3 `@theme inline` | `tokens.css` | Tailwind utilities (`bg-card`, `text-ink`, `bg-blocked-bg`, ...) |

| Role | Value |
| --- | --- |
| Page / card | `#FDFAF4` / `#FFFFFF`, border `#E0D4B5` |
| Ink (text, primary action) | `#1C0910`, `#3C1C28`, `#5C3040`, muted `#8A6070` |
| clear (green) | fg `#14532D`, bg `#DCFCE7`, accent `#15803D` |
| acknowledge (amber) | fg `#7C2D12`, bg `#FEF3C7`, accent `#B45309` |
| blocked (red) | fg `#7F1D1D`, bg `#FEE2E2`, accent `#B91C1C` |
| unconfirmed "heard" (grey, dashed, ear icon) | fg `#3F3F46`, bg `#F4F4F5`, outline `#71717A` |
| AI suggested (blue, sparkles icon) | fg `#1E3A8A`, bg `#DBEAFE`, accent `#1D4ED8` |

Type: DM Sans (body), Fredoka (page titles only), Noto Sans Gujarati in **every** stack. Scale 13 to 30px. Touch target minimum `--target-min` = 44px.

## Components

`components/ui`: Button, IconButton, StateBadge, Badge, Chip, Input, TextArea, Select, Combobox, Tabs, Modal, Drawer, Toast, Banner, Table, EmptyState, Skeleton, Stepper, Tooltip, DiffViewer, Switch.
`components/clinical` (stubs, fake data): RecordBar, TranscriptPane, FactChip, QuestionCard, AlertCard, DiagnosisCandidate, MedicineRow, ConsentPanel.
`shell`: AppShell (skip link, permanent simulated-data banner, role-based navigation, language toggle).

## Accessibility decisions

- **Contrast is a test, not a promise.** `tokens.contrast.test.ts` reads the real `tokens.css`, resolves `var()` chains and enforces WCAG AA (4.5:1 text, 3:1 non-text) on explicit pairs; a coverage test fails if a text, state or action token is in no pair. Runs in `npm run check` and CI.
- **Browser check:** `npm run a11y` (CI job `a11y`) builds the app, opens `/design` in system Chrome via `playwright-core` and runs axe (WCAG 2.2 AA + best practice, colour contrast on), the 44px target measure, a 375px no-horizontal-scroll check and a reduced-motion check, in English and Gujarati. Not part of `npm run check` because it needs a browser.
- **jsdom tests** cover keyboard behaviour: Tabs roving tabindex, Modal/Drawer focus trap + Esc + focus restore + `inert` background, Combobox (ARIA 1.2), toast live regions (blocked uses `role="alert"`), table sorting, override-reason gate, consent gating of recording.
- Reduced motion removes animation and smooth scrolling. The DiffViewer needs no colour (minus/plus icons, strike-through, bold).
- Known manual item: axe lists the Switch ("label-content-name-mismatch") as *needs review*, not a violation. The visible On/Off word is hidden from assistive tech on purpose because `aria-checked` already says it.

## Gujarati

- `:lang(gu)` forces `text-transform: none`, `letter-spacing: normal`, `font-style: normal`, `font-synthesis: none`, and scales line-height by 1.15 so vowel signs are not clipped. `lang="en"` islands keep their own style. A guard test bans `uppercase`, `tracking-*` and `italic` classes.
- Fonts are self-hosted (`@fontsource-variable`, OFL-1.1) with unicode-range, so Gujarati loads only when needed and no request goes to Google.
- i18n: `common`, `shell`, `design`, `clinical` namespaces; a parity test keeps English and Gujarati keys and placeholders identical; an AST test fails on hard-coded UI text.
- **All Gujarati text is placeholder and needs review by a Gujarati speaker** (a visible "needs review" marker is shown on `/design`). Clinical wording must be reviewed by the clinician as well (OPEN_CLINICAL_ITEMS).

## Phase 2B pages (login, dashboard, patients, consent, audit, settings, errors)
- **Authority:** this document and the approved Ink and Cream system. The `ui-ux-pro-max` skill was used only for layout, form, table and accessibility ideas; it changed no palette, font, theme or safety colour.
- **Used from the skill:** (1) after a failed submit, a **focusable error summary** at the top of the form that links to each field, with the inline errors kept (`ErrorSummary`); (2) errors announced with `role="alert"`; (3) **loading, then success or error feedback** on every submit; (4) tables that scroll inside a labelled, focusable region and helpful empty states with an action.
- **Safety colours on the new pages:** allergies use the "acknowledge" (amber) panel with an icon and heading; consent on record is "clear", consent missing and recording off is "blocked", the placeholder notice wording is flagged "acknowledge"; the queue placeholder is neutral. Always icon + text.
- **Found by running a real browser, fixed:** a landmark whose name repeated its table's name (`landmark-unique`); icon buttons shrinking below 44px in flex rows (`shrink-0`); radio and checkbox targets are measured by their label, which is the thing that is clicked; accessible names must contain the visible text (WCAG 2.5.3, so "Copy link for X", not "Copy the consent link for X"); screen-reader-only text positioned inside a wide table made the whole page scroll sideways at 375px (the table's scroll region is now a positioning context).
- **Layouts:** every page is one column of titled sections that works at 375px; tables scroll inside their own region instead of the page.

## Phase 3B pages (medicine master, template list, template builder)
- **Authority:** this document and Ink and Cream. `ui-ux-pro-max` supplied only layout and accessibility ideas (ARIA combobox semantics, a button alternative to drag-and-drop, tables inside a scroll region, an empty state with an action, a confirm step before retire, a focusable error summary). No palette, font or safety colour changed.
- **MedicineCombobox:** WAI-ARIA combobox (focus stays in the input, `aria-activedescendant`, polite result count). It starts at 2 characters, waits 250 ms after the last key, drops answers that arrive late, and never offers a retired medicine. Each option shows the generic name first, strength and dose form beside it, the brand name lighter underneath, and "NLEM 2022 - not clinically reviewed" until `reviewed_on` is set. Targets are 44px. The same component serves English and Gujarati.
- **PG-12 Medicine master (admin):** server-side sortable columns (`aria-sort`), category filter, "show retired" switch, search, "Load more". Source is shown as "PDF p. 27, printed 26". Badges: Not reviewed (dashed), Reviewed <date>, Retired. Add / edit in a dialog; editing a reviewed row warns that saving clears the review; retire asks first; restore is one click. No CSV upload, and the page says why. While a new sort or filter loads, the old rows stay so the sort button keeps keyboard focus.
- **PG-13 Template list and builder (doctor, admin):** the list shows who can use each template, owner, count and the actions the API allows (`canEdit`). The builder has name, a personal / clinic-wide choice (radio group, disabled for people who are not the owner), ordered medicine lines, a preview, and "Load template". **Reordering uses Move up / Move down buttons**, which work by keyboard and touch; after a move, focus stays on the button just used (or its twin at the end of the list) and a polite message says the new position. Remove returns focus to "Add medicine". A retired medicine in a saved template is flagged on its line and in the loaded view; nothing is dropped. A template you may not edit opens read-only with a preview.
- **Gujarati:** all new text has Gujarati placeholders; the page shows the "needs review" mark in Gujarati. Frequency labels are placeholders too.
- **Found by the real-browser scan, fixed:** a narrow Gujarati column header made the sort button 43px wide (now `min-w-11`).

## Phase 4B consultation screen (RecordBar, TranscriptPane)
- **RecordBar:** state in words with an icon (the recording state uses a filled circle and the word "Recording", never colour alone), an elapsed timer, Start/Stop at 44px or more, a live region for state changes, `role="alert"` for errors, the consent state inside the bar (missing consents named, link to the consent screen), and a "Next speaker is" radio group (Unknown / Doctor / Patient).
- **TranscriptPane:** a permanent dashed "Draft — doctor must review" label; each segment shows speaker (icon + word), time, a language badge, the text with the right `lang`, and a per-segment speaker radio group (44px targets) and an Edit button that opens an inline text area. Partial text is grey (no italics: Gujarati has none) with "Listening: this text may change." and approximate time; final text is full-strength. Edited segments get an "Edited" badge and a details block with the engine's original text.
- **Left out on purpose:** confidence figures or underlines (none exist for Sarvam), transliteration, a Pause control.

## Premium polish (ADR-D22)
- Same palette, fonts and light theme. New tokens: `--shadow-lift`, `--shadow-press`, `--motion-slow`, `--ease-out-expo`. New utilities in `index.css`: `.bg-aurora`, `.glass`, `.lift`, `.press`, `.shimmer`, `.row-hover`, `.field-focus`, `.float-slow`.
- Motion components live in `components/motion/motion.tsx` (`MotionRoot`, `Reveal`, `Stagger`/`StaggerItem`, `CountUp`, `PageTransition`). The login hero and the waveform are `aria-hidden` decoration with no text.
- Reduced motion removes all of it. Nothing safety-relevant animates after it appears.

## Deliberate differences from ClinicOS

- No crimson primary: crimson-like hues would read as "blocked". Ink is the action colour.
- Fredoka only for page titles; ClinicOS uses it more widely. Its fonts have no Gujarati, so Noto Sans Gujarati is an explicit fallback.
- Buttons are not pill-shaped; no uppercase or tracking (both harm Gujarati).
- Dark theme is out of scope for 1.2 (the token layers are ready for it).
