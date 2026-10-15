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

## Deliberate differences from ClinicOS

- No crimson primary: crimson-like hues would read as "blocked". Ink is the action colour.
- Fredoka only for page titles; ClinicOS uses it more widely. Its fonts have no Gujarati, so Noto Sans Gujarati is an explicit fallback.
- Buttons are not pill-shaped; no uppercase or tracking (both harm Gujarati).
- Dark theme is out of scope for 1.2 (the token layers are ready for it).
