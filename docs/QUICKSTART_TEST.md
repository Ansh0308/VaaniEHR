# Quick start verification record

**Status: Unverified on a fresh machine (recorded 2026-10-29)**

---

## 1. Purpose and verification boundary

The repository README outlines a 30-minute quick start procedure for setting up VaaniEHR from scratch on Windows 11 with PowerShell. This document records the verification status of that onboarding process.

> [!IMPORTANT]
> A complete, independent fresh-clone execution by an external party on a clean development machine has **not yet been verified**. To avoid mutating active local databases, Docker volumes, or development state during maintenance sessions, a full automated clone-and-seed cycle was not performed in this workspace.
>
> Any claim that a clean clone has been fully validated end-to-end is **unverified** until confirmed by an independent tester following the steps below.

---

## 2. Component verification status (in current repository)

While the full automated clone on a clean machine remains unverified, individual prerequisite subsystems and automated guards have been verified in the active repository:

| Step / Subsystem | Command | Actual status in repository |
|---|---|---|
| Dependency guards | `node scripts/check-no-data-files.mjs` | Verified (no data/audio tracked) |
| Documentation index | `node scripts/check-docs-index.mjs` | Verified (all docs indexed in `docs/README.md`) |
| Seed source tracking | `node scripts/check-seed-sources.mjs` | Verified (all committed seed rows carry source metadata) |
| Traceability matrix | `node scripts/trace.mjs` | Verified (all 104 requirements mapped; fails closed on missing Implemented code/tests) |
| Unit verification | `npm run check:unit` | Verified (runs lint, typecheck, static guards, and unit tests without Docker) |
| Clean-clone execution | `git clone ...` on a fresh host | **Unverified** (outstanding reviewer/owner action) |

---

## 3. Protocol for independent fresh-clone testing

An independent reviewer or examiner should execute the following steps in an isolated environment to validate the quick start:

### Prerequisites
- Windows 11 with PowerShell (cross-platform Node/Python scripts should work on Linux/macOS, but Windows is the primary target).
- Node.js `20.19` or newer with npm `10+`.
- Python `3.11` (specifically `3.11.x`; verified via `py -3.11 --version`).
- Docker Desktop running (verified via `docker info`).
- Google Chrome (only required for optional `npm run e2e` and `npm run a11y`).

### Execution steps

1. **Clone into a fresh directory:**
   ```powershell
   git clone https://github.com/Ansh0308/VaaniEHR.git VaaniEHR-clean
   cd VaaniEHR-clean
   ```

2. **Install dependencies:**
   ```powershell
   npm install
   npm run py:setup
   ```
   *Expected:* npm workspaces install cleanly; Python virtual environment is created at `apps/asr-py/.venv` with pinned dependencies.

3. **Initialize environment configuration:**
   ```powershell
   npm run setup:env
   ```
   *Expected:* Creates local `.env` files with random dev secrets. Fails closed if secrets are already present; never prints secrets.

4. **Start database and run migrations:**
   ```powershell
   npm run db:up
   npm run db:migrate
   npm run seed:dev
   ```
   *Expected:* PostgreSQL 16 container starts on port 5433; migrations 0001 through 0019 apply without errors; seed script writes fake clinic, 5 users, and 15 patients. Passwords saved to `data/dev-credentials.json` (git-ignored).

5. **Run test and guard suite:**
   ```powershell
   npm run check
   ```
   *Expected:* Linting, typechecking, database tests, Python tests (pytest), and repository guards pass.

6. **Launch services (demo mode):**
   ```powershell
   Add-Content apps\api-node\.env "PATHWAYS_ALLOW_TEST=true"
   Add-Content apps\api-node\.env "PATHWAYS_DIR=$PWD\packages\rules\fixtures\pathways"
   Add-Content apps\api-node\.env "PATHWAYS_SLOT_MAP=$PWD\packages\rules\fixtures\pathways\_toy\slot-map.json"
   Add-Content apps\asr-py\.env "ASR_ENABLE_MOCK=true"

   # In separate terminals:
   npm run dev:api
   npm run dev:asr
   npm run dev:web
   ```
   *Expected:* Web UI accessible at `http://localhost:5173`; login works with fake dev credentials; simulated data banner is visible.

---

## 4. Verification gaps and owner next steps

1. **External tester run:** Have a team member or examiner perform the above protocol on an independent machine without pre-installed caches.
2. **Timing measurement:** Record actual wall-clock duration for dependencies download, docker image pull, and test execution.
3. **Platform verification:** Record explicit results if tested on Linux or macOS.
4. **Log capture:** Record any friction points, path issues, or missing prerequisites observed during the run into this file.
