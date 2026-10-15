// Express application factory. Dependencies are injected so tests need no network.
import cors from 'cors';
import express, { Router, type Express } from 'express';
import helmet from 'helmet';
import type { AuthProvider } from './auth/types.js';
import type { Config } from './config/env.js';
import { errors } from './http/errors.js';
import { errorHandler, notFoundHandler } from './http/errorHandler.js';
import { requestId } from './http/requestId.js';
import { ok } from './http/respond.js';
import { mountRoutes } from './http/routeRegistry.js';
import { allRoutes, API_PREFIX } from './routes/index.js';
import type { Services } from './services.js';

export interface AppDeps {
  config: Config;
  /** Used by sockets and tests that need only token checks (no database). */
  authProvider: AuthProvider;
  /** Resolves if the database is reachable. */
  checkDb: () => Promise<void>;
  /** When present, the /api/v1 routes are mounted. Unit tests that need no database omit it. */
  services?: Services;
  /** Extra routers (used by tests to exercise middleware). */
  extend?: (app: Express) => void;
}

export function createApp(deps: AppDeps): Express {
  const { config, checkDb } = deps;
  const app = express();

  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');
  app.use(requestId);
  app.use(helmet());
  app.use(
    cors({
      origin: config.corsOrigin,
      // the browser may read these on the CSV export response
      exposedHeaders: ['Content-Disposition', 'X-Exported-Rows', 'X-Export-Truncated'],
    }),
  );
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

  if (deps.services) {
    const v1 = Router();
    mountRoutes(v1, allRoutes(config), deps.services);
    app.use(API_PREFIX, v1);
  }

  deps.extend?.(app);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
