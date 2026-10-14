// Express application factory. Dependencies are injected so tests need no database or network.
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { createAuthRouter } from './auth/routes.js';
import type { DevAuthProvider } from './auth/DevAuthProvider.js';
import type { AuthProvider } from './auth/types.js';
import type { Config } from './config/env.js';
import { errors } from './http/errors.js';
import { errorHandler, notFoundHandler } from './http/errorHandler.js';
import { requestId } from './http/requestId.js';
import { ok } from './http/respond.js';

export interface AppDeps {
  config: Config;
  authProvider: AuthProvider;
  /** Only when AUTH_PROVIDER=dev; enables POST /auth/dev-login. */
  devProvider?: DevAuthProvider;
  /** Resolves if the database is reachable. */
  checkDb: () => Promise<void>;
  /** Extra routers (used by tests to exercise middleware). */
  extend?: (app: Express) => void;
}

export function createApp(deps: AppDeps): Express {
  const { config, authProvider, devProvider, checkDb } = deps;
  const app = express();

  app.disable('x-powered-by');
  app.use(requestId);
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json({ limit: '100kb' }));

  // Liveness: the process is up. No dependencies are touched.
  app.get('/health', (_req, res) => {
    ok(res, { status: 'ok', service: 'api-node' });
  });

  // Readiness: dependencies (database) are reachable.
  app.get('/ready', async (_req, _res, next) => {
    try {
      await checkDb();
    } catch {
      next(errors.notReady('Database is not reachable'));
      return;
    }
    ok(_res, { status: 'ready', checks: { database: 'up' } });
  });

  // Public, non-sensitive flags for the web app (banner). Never put secrets or PHI here.
  app.get('/config/public', (_req, res) => {
    ok(res, { simulatedDataOnly: config.simulatedDataOnly, authProvider: config.authProvider });
  });

  app.use(createAuthRouter({ provider: authProvider, ...(devProvider ? { devProvider } : {}) }));

  deps.extend?.(app);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
