// Builds the dependency container used by route handlers (standalone mode: ADR-D4).
import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import { DbBackedAuthProvider } from './auth/DbBackedAuthProvider.js';
import { DevAuthProvider } from './auth/DevAuthProvider.js';
import { makeDummyHash } from './auth/password.js';
import { ClinicOSTokenAuth } from './auth/ClinicOSTokenAuth.js';
import type { AuthProvider } from './auth/types.js';
import { PgMockClinicOSAdapter } from './clinicos/PgMockClinicOSAdapter.js';
import type { Config } from './config/env.js';
import { createNoticeStore } from './consent/notices.js';
import { loadConceptCatalog } from './concepts/catalog.js';
import { loadCatalog } from './pathways/catalog.js';
import type { Services } from './services.js';
import { createWhatsApp } from './whatsapp/provider.js';
import { createFhirValidator } from './fhir/validator.js';
import { PgVisitRepository } from './visits/pgRepository.js';
import { NotConfiguredSafetyChecks } from './visits/safety.js';

export async function createServices(config: Config, pool: pg.Pool): Promise<Services> {
  const directory = new PgMockClinicOSAdapter(pool);
  const notices = createNoticeStore();
  const dummyPasswordHash = await makeDummyHash(config.bcryptCost);
  const pathways = loadCatalog(config);
  const concepts = loadConceptCatalog(config);
  const visits = new PgVisitRepository();
  const safety = new NotConfiguredSafetyChecks();
  const fhirValidator = createFhirValidator(config.fhir.validatorUrl);
  const whatsapp = createWhatsApp({
    WHATSAPP_PROVIDER: config.whatsapp.provider,
    WHATSAPP_ENABLE_REAL: config.whatsapp.enableReal,
    WHATSAPP_ACCESS_TOKEN: config.whatsapp.accessToken,
    WHATSAPP_PHONE_NUMBER_ID: config.whatsapp.phoneNumberId,
    WHATSAPP_API_VERSION: config.whatsapp.apiVersion,
    WHATSAPP_TEST_ALLOWLIST: config.whatsapp.testAllowlist,
  });

  if (config.authProvider === 'dev') {
    // loadConfig guarantees devAuthSecret is present and strong when AUTH_PROVIDER=dev.
    const tokens = new DevAuthProvider(config.devAuthSecret as string, config.devTokenTtlSeconds);
    const auth: AuthProvider = new DbBackedAuthProvider(tokens, pool, directory);
    return {
      config,
      pool,
      directory,
      devLogin: directory,
      tokens,
      auth,
      notices,
      lockoutKey: `lockout:${config.devAuthSecret as string}`,
      dummyPasswordHash,
      pathways,
      concepts,
      visits,
      safety,
      fhirValidator,
      whatsapp,
    };
  }
  // Phase 12 stub: every call throws NOT_IMPLEMENTED. Password login does not exist in this mode.
  return {
    config,
    pool,
    directory,
    devLogin: null,
    tokens: null,
    auth: new ClinicOSTokenAuth(),
    notices,
    lockoutKey: randomBytes(32).toString('hex'), // password login does not exist in this mode
    dummyPasswordHash,
    pathways,
    concepts,
    visits,
    safety,
    fhirValidator,
    whatsapp,
  };
}
