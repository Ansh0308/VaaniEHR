// Dependencies handed to every route handler. Built once in server.ts (and by tests).
import type { PathwayCatalog } from './pathways/catalog.js';
import type pg from 'pg';
import type { DevAuthProvider } from './auth/DevAuthProvider.js';
import type { AuthProvider } from './auth/types.js';
import type { ClinicOSAdapter, DevLoginSource } from './clinicos/ClinicOSAdapter.js';
import type { Config } from './config/env.js';
import type { NoticeStore } from './consent/notices.js';

export interface Services {
  config: Config;
  pool: pg.Pool;
  /** Reads and writes ClinicOS-owned data. The ONLY path to the mock_clinicos_* tables (ADR-D20). */
  directory: ClinicOSAdapter;
  /** Standalone password login source (null when AUTH_PROVIDER=clinicos). */
  devLogin: DevLoginSource | null;
  /** Issues tokens (null when AUTH_PROVIDER=clinicos). */
  tokens: DevAuthProvider | null;
  /** Verifies tokens on every request (token + revocation + user status). */
  auth: AuthProvider;
  notices: NoticeStore;
  /** Server-side key for the non-reversible e-mail reference used by the login lockout table. */
  lockoutKey: string;
  /** bcrypt hash used to equalise timing when the e-mail is unknown. */
  dummyPasswordHash: string;
  /** pathways, slot map and engine parameters (Phase 6A); loaded once at start-up */
  pathways: PathwayCatalog;
}
