// Dependencies handed to every route handler. Built once in server.ts (and by tests).
import type { ConceptCatalog } from './concepts/catalog.js';
import type { PathwayCatalog } from './pathways/catalog.js';
import type pg from 'pg';
import type { DevAuthProvider } from './auth/DevAuthProvider.js';
import type { AuthProvider } from './auth/types.js';
import type { ClinicOSAdapter, DevLoginSource } from './clinicos/ClinicOSAdapter.js';
import type { Config } from './config/env.js';
import type { NoticeStore } from './consent/notices.js';
import type { VisitRepository } from './visits/repository.js';
import type { SafetyChecks } from './visits/safety.js';
import type { FhirValidator } from './fhir/validator.js';
import type { WhatsAppProvider } from './whatsapp/provider.js';

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
  /** the unreviewed draft concept list for suggestions (remaining Phase 5 items) */
  concepts: ConceptCatalog;
  /** where signed visit records live (standalone Postgres now; ClinicOS in Phase 12) */
  visits: VisitRepository;
  /** the safety engine's place (Phase 7); today "not configured" */
  safety: SafetyChecks;
  /** checks FHIR bundles against the ABDM IG (HL7 validator server); not configured = not validated */
  fhirValidator: FhirValidator;
  /** sends the approved Gujarati summary: the mock by default, real WhatsApp only when every flag is set (ADR-D41) */
  whatsapp: WhatsAppProvider;
}
