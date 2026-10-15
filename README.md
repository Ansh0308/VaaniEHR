# VaaniEHR

**Research prototype - acted/simulated data only. Not for clinical use.**

**Research prototype. Simulated data only. All rights reserved.** (No licence file: see ADR-D17 in `docs/DECISIONS.md`.)
Voice-assisted, guideline-grounded, ABDM-ready consultation module (B.Tech capstone). Requirements: `DOCUMENTS/VaaniEHR_PRD.md` (PRD v1.1). Project rules: `AGENTS.md`. Orientation: `docs/CONTEXT.md`. Decisions: `docs/DECISIONS.md`.

Status: **Phase 1 foundation** (1.1 accepted; container stack added). No clinical features yet. The design system is Phase 1.2.

## Layout

| Path                | What                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| `apps/web`          | React 18 + Vite + TypeScript + Tailwind 4 (placeholder page with the simulated-data banner only) |
| `apps/api-node`     | Node + Express 5 + TypeScript + Socket.IO: config, auth seam, `/health`, `/ready`, `/vaani` sockets |
| `apps/asr-py`       | FastAPI (Python 3.11): `/health` only                                                            |
| `packages/rules`    | TypeScript stub for the pathway and safety engines (one test, no clinical content)               |
| `infra`             | `docker-compose.yml`: db (PostgreSQL 16 + pgvector), asr-py, api-node, web, all with healthchecks  |
| `scripts`           | Node scripts (cross-platform; no `.sh`/`.bat` allowed)                                           |
| `docs`              | Audit, decisions, SBOM, phases                                                                   |

ClinicOS (`..\AWT-Project`) is **read-only** and is not used or run by anything here.

## Prerequisites (Windows 11)

- Node.js >= 20.19 (developed on Node 24), npm >= 10
- Python 3.11 (`py -3.11 --version`)
- Docker Desktop with the WSL2 engine **running**
- Git

## First-time setup (PowerShell, from the repo root)

```powershell
npm install                 # installs all npm workspaces (exact pinned versions)
npm run py:setup            # creates apps\asr-py\.venv and installs pinned Python packages
npm run setup:env           # creates .env files with random dev secrets (never overwrites; never prints them)
npm run db:up               # starts PostgreSQL 16 + pgvector in Docker (waits until healthy)
npm run db:migrate          # applies migration 0001 (schema_info + vector extension)
```

## Run the whole stack in containers (PowerShell)

Docker Desktop must be running. Images are built from the repo (non-root users, pinned base images, no secrets inside; secrets are read from the git-ignored `.env` files when the containers start).

```powershell
npm run setup:env           # once
npm run stack:up            # builds api-node, web, asr-py images; starts db + all services; waits until healthy; applies migrations
npm run stack:status        # docker compose ps
Start-Process http://localhost:5173        # web
Invoke-RestMethod http://localhost:4000/ready
Invoke-RestMethod http://localhost:8000/health
npm run stack:down          # removes the containers (database volume is kept)
```

Ports (all bound to 127.0.0.1): web 5173, api-node 4000, asr-py 8000, db 5433. Override with `WEB_PORT`, `API_PORT`, `ASR_PORT`, `POSTGRES_PORT` in `infra\.env`.

## Everyday commands

```powershell
npm run check               # lint + typecheck + unit tests (all apps) + repo guards + ruff + pytest
npm run dev:api             # API on http://localhost:4000   (needs db:up for /ready)
npm run dev:web             # web on http://localhost:5173
npm run dev:asr             # asr-py on http://localhost:8000
npm run build               # production builds of web and api-node
npm run db:down             # stop the database container (data kept)
npm run docs:index          # regenerate docs\DOC_INDEX.md from DOCUMENTS\VaaniEHR_PRD.md (PRD v1.1)
npm run db:reset            # DESTROY the local dev database volume, recreate, migrate
npm run sbom                # regenerate docs\SBOM.md (dependencies, licences, skills)
```

Try the API (PowerShell):

```powershell
Invoke-RestMethod http://localhost:4000/health
Invoke-RestMethod http://localhost:4000/ready
$login = Invoke-RestMethod -Method Post -Uri http://localhost:4000/auth/dev-login -ContentType 'application/json' -Body '{"role":"doctor"}'
Invoke-RestMethod http://localhost:4000/auth/whoami -Headers @{ Authorization = "Bearer $($login.data.accessToken)" }
```

## Conventions

- Success: `{ "success": true, "data": ... }`. Error: `{ "success": false, "error": { "code": "...", "message": "..." } }`. camelCase JSON, UUID ids, `X-Request-Id` on every response.
- Config is validated at startup and fails fast; secrets only in git-ignored `.env` files, never in code (`.env.example` lists every variable).
- `SIMULATED_DATA_ONLY` must be `true`; the web app always shows the "research prototype - simulated data" banner.
- Auth: `AuthProvider` interface. `DevAuthProvider` (standalone) issues a ~1 h token signed with a VaaniEHR-only secret, claims `{ sub, role, clinicId, devUser: true }`, no refresh token; `POST /auth/dev-login` exists only when `AUTH_PROVIDER=dev`. `ClinicOSTokenAuth` is a Phase 12 stub that throws `NOT_IMPLEMENTED`.
- Sockets: namespace `/vaani`; connections are authenticated at the handshake; rooms are chosen by the server only.

## Troubleshooting

- `docker compose failed`: start Docker Desktop and wait for the engine (`docker info` must succeed).
- Port 5433 busy: change `POSTGRES_PORT` in `infra\.env` and the port in `DATABASE_URL` in `apps\api-node\.env`.
- `Python 3.11 not found`: install Python 3.11 and re-run `npm run py:setup`.
