# CLINICOS_AUDIT.md - What ClinicOS really is (read-only audit)

Audited 2026-10-14 from `D:\CODES\ClinicOS\AWT-Project` (last commit seen: `32f1cea "Updrade"`). Nothing in ClinicOS was modified, run, or migrated. `.env` files were read for variable **names only**.
Anything not directly seen in code or documents is marked **INFERRED**.

Sources read:
- Documents (docx converted to scratch copies outside ClinicOS): `ClinicOS.docx` (overview/feature list + early PRD), `ClinicOS_Checklist.docx`, `ClinicOS_Data_Dictionary.docx`, `ClinicOS_PRD_v3.docx` (headings, F-list, data model, API, templates, consent, tests read; feature bodies F1-F25 skimmed), `ClinicOS_TechStack.docx`.
- Code: backend `package.json`, `server.js`, `src/**` (config, models, routes, middleware, services; controllers sampled: auth, visit, patient lookup, message, token emit paths), frontend `package.json`, `tailwind.config.js`, `src/App.jsx`, `src/services/api.js`, `AuthContext.jsx`, `useSocket.js`.
- Not read in full: most controller bodies, `analytics.controller.js`, `bill.controller.js`, `clinic.controller.js`, `patientPortal.controller.js`, individual React pages.

---

## 1. Stack facts

| Item | Fact | Evidence |
|---|---|---|
| **Database in use** | **MySQL** (via `mysql2`), not PostgreSQL | `clinicOS-Backend/package.json` (`mysql2`, `sequelize`); `src/config/database.js` (`dialect: 'mysql'`, optional SSL for Aiven); `DEPLOYMENT.md` (Aiven MySQL) |
| ORM | Sequelize 6 (`^6.37.8`). No migrations folder; schema built by `sequelize.sync({ alter: { drop: false } })` on every start | `server.js` |
| Docs vs code | PRD v3, Data Dictionary and Tech-Stack docs say PostgreSQL 16 (JSONB, RLS, tsvector, materialized views). Only the Checklist says MySQL + Sequelize. **The Checklist matches the code; the other three do not.** | docs vs `package.json` |
| Backend | Node + Express **5.2** (docs say Express 4 / Node 20), CommonJS, plain JavaScript (docs say TypeScript). Entry `server.js` | `package.json`, `server.js` |
| Real-time | Socket.IO 4.8, no Redis adapter | `src/services/socket.service.js` |
| Cache / broker | **None.** No Redis, RabbitMQ or SQS in dependencies | `package.json` |
| Auth libs | `jsonwebtoken`, `bcryptjs` (cost 12), email OTP table | `auth.service.js`, `otp.service.js` |
| Rate limit | `express-rate-limit` (global 200/15 min, auth 10/15 min, OTP 5/hr, lookup 30/5 min). No `helmet` (Checklist Phase 12 lists it) | `server.js`, `package.json` |
| PDF | `pdfkit` (docs say Puppeteer) | `utils/pdfGenerator.js` |
| Email | Brevo HTTP API via `fetch`; `resend` also in dependencies. Sender falls back to a hard-coded personal Gmail address when `MAIL_FROM_EMAIL` is unset | `config/mailer.js` |
| WhatsApp / SMS | Code exists: Meta Graph API v18 direct, MSG91. Each falls back to `console.log` when its env keys are absent. `axios` is required by this code but is not in backend `package.json` (it exists only as a transitive dependency; **INFERRED** fragile) | `services/message.service.js` |
| Payments | Razorpay (`razorpay` package, per-clinic keys stored in `clinic_settings`) | `razorpay.service.js`, `clinicSettings.model.js` |
| Frontend | React **19**, Vite 7, **JavaScript (no TypeScript)**, react-router-dom 7, axios, react-hook-form + zod 4, recharts 3, socket.io-client, lucide-react. **No** Zustand, TanStack Query, shadcn/ui, Next.js, PWA plugin, qrcode lib, or test libs | `clinicOS-Frontend/package.json` |
| Frontend state | React Context (`AuthContext`) + local component state; JWT in `localStorage` key `clinicos_token` | `AuthContext.jsx`, `api.js` |
| Styling | Tailwind 3.4 with custom tokens (see section 4). Fonts Fredoka (display) + DM Sans (body) from Google Fonts | `tailwind.config.js`, `index.html` |
| Tests | **None** (no test files, no test script: `"test": "echo \"Error: no test specified\""`) | search for `*.test.*`, `*.spec.*` |
| Docker | **None** (no Dockerfile / compose) | file search |
| Hosting | Render (BE) + Netlify (FE) + Aiven MySQL, per `DEPLOYMENT.md` (docs say Railway/Vercel) | `DEPLOYMENT.md`, `netlify.toml` |
| Configuration | ClinicOS reads its configuration from environment variables (names are in its source); they are not reproduced here | source | |
| Env var names (frontend) | `VITE_RAZORPAY_KEY_ID`; `VITE_API_URL` read in code | `.env`, `api.js` |
| Secrets in git | `clinicOS-Backend/.env` is git-ignored (`.gitignore:25`) | `git check-ignore` |

### Data conventions in the real code
| Question | Answer |
|---|---|
| ID type | UUID v4 string on every model (`DataTypes.UUID`, `UUIDV4`), primary key column named `id` |
| Naming | Model attributes **camelCase** (`clinicId`, `tokenNumber`, `optInMsg`); table names **snake_case plural** (`users`, `message_logs`, `prescription_templates`). Docs use snake_case columns with `<table>_id` PKs (`patient_id`) - **different** from code |
| Timestamps | Sequelize `createdAt` / `updatedAt` (no `deletedAt`, no soft delete) |
| Roles | `patient`, `admin`, `doctor`, `staff` (docs say `receptionist`, `super_admin`) |
| User status | `pending, approved, rejected, suspended` (docs: `is_active` boolean) |
| API envelope | Success: `{ "success": true, "data": {...} }`. Error: `{ "success": false, "error": "message" }` (`utils/apiResponse.js`; 404 and rate-limit responses use the same shape) |
| JWT payload | **Only `{ userId, iat, exp }`**, default HS256, expiry `JWT_EXPIRES_IN` or `7d`. No role, no clinicId, no refresh token (`utils/generateToken.js`) |
| How role/clinic are resolved | `protect` sets `req.userId`; `rbac([...])` loads the user from the DB on every request and sets `req.user = { id, role, status, clinicId }`. Suspended/pending users blocked there (`middleware/rbac.middleware.js`) |
| Doctor identity | **No doctors table.** A doctor is a `users` row with `role='doctor'`; `doctorId` columns reference `users.id`. Doctor fields (`doctorStatus`, `avgConsultMins`) live on `users` |
| Multi-tenancy | `clinicId` column on tenant tables, filtered in controllers from `req.user.clinicId`. No DB-level RLS |

---

## 2. Implemented features (with evidence)

Status key: **Implemented** / **Partially** / **Not started**. "Documented" = appears in the PRD v3 / Checklist.

| Area | Documented | Code status | Evidence and differences |
|---|---|---|---|
| Auth + roles | Yes (email+pw staff, OTP patients, 2FA, refresh tokens, F13/F24) | **Implemented, simpler than docs** | `routes/auth.routes.js`: send-otp, verify-otp, register, login, me, forgot/reset-password. Email OTP (10-min expiry) for **all** roles incl. patients (PRD: phone OTP). Join-request approval for doctor/staff (`JoinRequest` model, `clinic.controller.js`). Login lockout is an in-memory `Map` (lost on restart). **No 2FA, no refresh tokens, no token blocklist** |
| Patient lookup by phone | Yes (F1, E.164, Redis cache) | **Implemented** | `patient.controller.js` `lookupPatient`: strips non-digits, **keeps first 10 digits** (India-only), looks in `patients` by `(phone, clinicId)`, falls back to `users` (role patient) and auto-creates a clinic-linked patient. Returns `{found, patient}`. No cache. Unique index `(phone, clinicId)` |
| Queue / token + sockets | Yes (F2, F5) | **Implemented** | `token.controller.js`, `token.service.js`, `queueEmit.service.js`. Statuses `waiting, now, paused, lab, served, cancelled` (docs: `called, in_consult, on_hold_lab...`). Emergency, pause/resume, undo (`undo.service.js`). Socket rooms `clinic:{id}` and `patient:{id}`; events `queue:updated`, `token:position`, `token:served`, `token:new`, `bills:updated`, `bill:updated` |
| Visit / EHR | Yes (F4; `draft/signed/amended`, attachments, ICD-10, audit diff) | **Partially** | `visit.model.js`, `visit.controller.js`. Fields: `complaint, complaintTags, vitals, diagnosis, notes, prescriptions, testsOrdered, followUpDate, isComplete` (JSON columns). Autosave via `PATCH /api/visits/:id`; `PATCH :id/complete` sets `isComplete` and marks token served; once complete, updates are rejected. **No `signed_at`, no amendment path, no attachments, no audit diff, no versioning**. `prescriptions` JSON has no enforced schema |
| Prescription templates | Yes (F20) | **Implemented** | `prescriptionTemplate.model.js`, routes `/api/rx-templates*`. Uses `isShared` + `usageCount` (docs: `visibility`). Frontend adapter maps `visibility` to `isShared` (`api.js`) |
| Medicine library | **Not in the 19-table data dictionary** | **Implemented (code-only)** | `medicine.model.js`, `/api/medicines`, `MedicineLibrary.jsx`. Per-clinic list with `defaultDose, defaultFrequency, defaultDuration` |
| Consent | Yes (`consent_record` table, per-channel, versioned; F9) | **Partially (minimal)** | Only `patients.optInMsg` boolean, `PATCH /api/patients/:id/opt-in` (staff/admin), audit action `PATIENT_OPTED_OUT`. **No consent_record model**, no per-channel flags, no source/timestamp/policy version (grep for "consent" in backend code: 0 hits) |
| Audit log | Yes (F11; append-only, before/after snapshots) | **Partially** | `auditLog.model.js` (`userId, clinicId, action, resourceType, resourceId, ipAddress, meta`, `updatedAt: false`), `audit.service.js` `logAudit` + 25 action names, `GET /api/admin/audit-logs`, `AuditLogs.jsx`. No before/after snapshot, no sessionId, no DB-level immutability. A second helper `utils/audit.js` (`writeAudit`, uses `entity/entityId` field names that **do not exist on the model**) has no callers (**INFERRED** dead code) |
| Messaging (WhatsApp/SMS/email) | Yes (F3; queue + retry + DLQ + webhooks) | **Partially** | Email via Brevo is the working channel (`config/mailer.js`). WhatsApp + SMS functions exist but only log to console unless keys are set. Several triggers pass `channels: ['email','whatsapp']`. 13 template keys in `config/messageTemplates.js`. Custom templates are looked up with `channel: 'email'` only. **No broker, no retry, no delivery webhooks**; `message_logs.status` is `sent/failed/delivered` only. Opt-out check is the single `optInMsg` flag |
| Message templates editor | Yes (F9) | **Implemented (email)** | `template.routes.js` (`/api/templates`, admin), `TemplateEditor.jsx`, `MessageTemplate` with `version` column; no rollback endpoint seen |
| Billing | Yes (F6, F14) | **Implemented** | `bill.model.js` (`items` JSON, `subtotal, tax, total, paidAmount, status unpaid/partial/paid/cancelled, paymentMethod cash/upi/card/online, discountPercent`), `bill.controller.js`, `pdfGenerator.js`, Razorpay order/verify (staff and patient). No separate `payment` table, no refunds endpoint seen |
| Services catalog | Yes | **Implemented** | `service.model.js`, `/api/services` (admin) |
| Analytics | Yes (F7) | **Implemented** | `analytics.routes.js`: overview, revenue, queue, complaints, doctors; `Analytics.jsx` (recharts). Not read in detail |
| Patient portal | Yes (patient pages) | **Implemented** | `patientPortal.routes.js` (dashboard, token, visits, bills, profile, leave-queue, pay, notifications); pages in `src/pages/patient/` |
| Admin pages | Yes | **Implemented** | `AdminOverview, Analytics, AuditLogs, ClinicSettings, JoinRequests, MedicineLibrary, MessageLogs, ServiceCatalog, TeamManagement, TemplateEditor` |
| Appointments (F8) | Yes | **Not started** | No model, route or page (message templates for appointments exist) |
| Lab orders (F15), referrals (F23), shift log (F22), attachments, QR check-in (F21), kiosk (F18), PWA/offline (F17), multi-clinic (F16), telemedicine (F19), 2FA (F24), global search (F10) | Yes | **Not started** (global search: `GET /api/patients/search` exists - **Partially**) | No models/routes; no `vite-plugin-pwa` / QR packages; `lab` exists only as a token status |

---

## 3. Gaps vs documents

1. **Database**: three docs say PostgreSQL 16 with JSONB, RLS, materialized views, `tsvector`, arrays, `gen_random_uuid()`. Code is MySQL with `JSON` columns and `sync({alter})`. The Data Dictionary (19 tables, soft delete, append-only triggers, E.164 phones, per-channel consent) describes a schema that **does not exist**; the real schema has 15 models (`User, Clinic, ClinicSettings, OtpCode, JoinRequest, Patient, Token, Visit, Bill, MessageLog, AuditLog, Service, PrescriptionTemplate, Medicine, MessageTemplate`).
2. **Missing tables vs dictionary**: `doctor`, `appointment`, `lab_order`, `attachment`, `payment`, `consent_record`, `referral`, `shift_log`.
3. **No soft delete** (`deletedAt`) anywhere; docs require it for clinical records. Medicine and service have delete endpoints (hard or flag - **not verified**).
4. **No tests, no Docker, no CI** although TechStack/Checklist Phase 13 describe them.
5. **Security hardening gaps** vs Checklist Phase 12: no `helmet`; no refresh-token/blocklist; lockout state in memory.
6. **Frontend stack** differs from the TechStack doc (JS not TS, no Zustand/TanStack/shadcn/Next).
7. **Doc inconsistencies among themselves**: role names (`receptionist` vs `staff`), token statuses, `visibility` vs `isShared`, `/api/queues` (PRD) vs `/api/tokens` (code), `GET /api/patients/:id/visits` (Checklist) vs `/api/visits/patients/:id/visits` (code), PRD v3 says Postgres 15+ while TechStack says 16.

---

## 4. Conventions to copy (VaaniEHR should match these to ease integration)

- Response envelope `{ success, data }` / `{ success: false, error }` (HTTP status carries the class of error).
- UUID v4 string ids, field `id`; tenant column `clinicId`; camelCase JSON fields; plural snake_case table names.
- Route style: `router.use(protect)` then per-route `rbac([...roles])`; REST under `/api/<resource>`.
- Roles: `patient | admin | doctor | staff`.
- Audit: call `logAudit({ userId, action, resourceType, resourceId, clinicId, ip })` with `UPPER_SNAKE` action names (`audit.service.js` `ACTIONS`).
- Socket rooms `clinic:{clinicId}` / `patient:{patientId}`, events `domain:verb` (`queue:updated`).
- Frontend: one axios instance in `services/api.js` with grouped API objects (`visitAPI`, `rxAPI`...), `localStorage` key `clinicos_token`, `ProtectedRoute allowedRoles`.
- Design tokens (Tailwind): `crimson` 100-900 (`500 #C43055` primary, `800 #4E0E20` dark CTA, `900 #1C0910` headlines), `cream` 50-400 (`50 #FDFAF4` page bg, `300 #E0D4B5` borders), `text` (`primary #1C0910`, `secondary #3C1C28`, `body #5C3040`, `muted #8A6070`), `accent` (yellow `#F0C030`, peach, teal `#5AB09A`, lavender, sky, coral `#E85060`); fonts `Fredoka` / `DM Sans`; radii `xl 16px, 2xl 24px, 3xl 32px, pill 100px`; shadows `card, nav, btn, hero`; utility classes `.btn-primary .btn-cta .btn-ghost .card .nav-gradient .hero-glow .section-container`. (Note: TechStack doc lists a *different* palette - cream `#F5EFE0`, red `#E04B67`, burgundy... - the code values above are the real ones.)

---

## 5. Risks for integration

1. **JWT carries only `userId`.** A VaaniEHR service cannot trust role/clinic from the token; it must either share `JWT_SECRET` and replicate the DB lookup, or call a ClinicOS endpoint. Sharing the HS256 secret across services is a risk. (Decision for Ansh.)
2. **Database mismatch**: VaaniEHR docs/FHIR plans may assume PostgreSQL/JSONB; ClinicOS is MySQL JSON. Cross-DB joins are not possible; integration is API-level or via a shared id (`patients.id`, `visits.id`, `users.id`).
3. **Visit has no sign-off concept** (`isComplete` only; no `signedAt/signedBy`, no amendment). Hard Rule 2 (nothing final before doctor sign-off) cannot rely on ClinicOS fields; VaaniEHR needs its own draft/sign-off state and ClinicOS must not receive unsigned content.
4. **`visit.prescriptions` is free-form JSON** with no schema or terminology codes; writing VaaniEHR output into it risks shape drift. Patient has **no allergy field**.
5. **Unauthenticated Socket.IO**: any client can emit `join:clinic` / `join:patient` with any id and receive queue/patient events (`socket.service.js` performs no token check). **INFERRED** exposure of queue data to anyone who knows a clinic/patient UUID. Do not push PHI over this channel.
6. **PHI in logs**: dev fallbacks `console.log` the phone number and full message body (`sendWhatsApp`, `sendSMS`); `README`/Checklist say phone numbers must not be logged in full.
7. **No tests, no migrations**: schema changes happen via `sync({alter})` at boot. Any Phase 12 change to ClinicOS models would be applied automatically on next deploy - needs a deliberate process. No safety net for regressions.
8. **Hard-coded fallback sender address** (a personal e-mail address) in `mailer.js`; do not copy it into VaaniEHR. A historical secret exposure exists in ClinicOS git history; owner is handling it; details withheld.
9. **Rate limiting is per-IP in memory**, behind a proxy `req.ip` may be the proxy's address (no `trust proxy` setting seen - **INFERRED**).
10. **Consent is one boolean**; VaaniEHR voice recording/AI processing will need its own consent model; ClinicOS cannot supply per-purpose consent.
11. **Phone normalization is India-only 10-digit**; E.164 in the docs/PRD is not implemented.
12. **Doctor = user row**: a VaaniEHR "doctor" reference must use `users.id`; no registration number or signature field exists.

---

## 6. Questions for Ansh

1. The code is MySQL + Sequelize but PRD v3, Data Dictionary and TechStack say PostgreSQL 16. Confirm **MySQL is the truth** and that VaaniEHR should be designed for it (or tell me if VaaniEHR will use its own Postgres and talk to ClinicOS only over HTTP).
2. Integration style for Phase 12: (a) VaaniEHR as a separate service calling ClinicOS REST, (b) VaaniEHR code added inside ClinicOS, or (c) shared database? This decides the JWT/auth approach.
3. Since the JWT holds only `userId`, how should VaaniEHR authenticate? Share `JWT_SECRET` and look up the user in ClinicOS DB, or add a verify endpoint to ClinicOS (needs "Phase 12 integration approved")?
4. Which document is authoritative for ClinicOS behaviour where docs and code differ (roles `receptionist` vs `staff`, token statuses, endpoint paths)? I assumed **code wins** for ClinicOS facts and PRD wins for VaaniEHR.
5. Is the `Medicine` library (code-only) the intended reuse target for VaaniEHR drug lookup, and are its default dose/frequency/duration values clinically reviewed? (Hard Rule 3: I will not treat them as a clinical source.)
6. (Withheld.) A historical secret exposure exists in ClinicOS git history; owner is handling it; details withheld.
7. Do you want VaaniEHR's UI to reuse ClinicOS Tailwind tokens/fonts exactly (section 4), or a separate look? (`ui-ux-pro-max` would be used either way.)
8. The 8 mismatches in section 3, item 7 are doc-level. Should ClinicOS docs be corrected by you, or should VaaniEHR documents cite only the code-verified facts above?

---

## 7. Not verified / limits of this audit

- Controller bodies other than auth, visit, patient lookup, message service, and queue emit paths were not read line by line (token, bill, analytics, clinic, portal).
- I did not run ClinicOS (no DB or secrets available, per instructions), so runtime behaviour is **INFERRED** from code.
- The docx files were converted by a small script (`docx2md.py` in the session scratchpad); text and tables were extracted, images/diagrams were not.
- PRD v3 feature specs F1-F25 (lines 266-823) were skimmed by headings only; the older overview (`ClinicOS.docx`) was read fully.
