// Process entry point. Loads validated config (fails fast), checks the data is simulated, wires dependencies, and
// starts HTTP + Socket.IO.
import { createServer } from 'node:http';
import { createApp } from './app.js';
import { ConfigError, loadConfig, type Config } from './config/env.js';
import { createServices } from './bootstrap.js';
import { checkDatabase, createPool } from './db/pool.js';
import { assertAllSimulated, RealDataError } from './db/simulatedGuard.js';
import { logger } from './logger.js';
import { createRealtime } from './realtime/socket.js';

async function main(): Promise<void> {
  let config: Config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  const pool = createPool(config.databaseUrl);
  const services = await createServices(config, pool);

  // ADR-D16: refuse to start if any directory row is not simulated. Skipped only while the database is unreachable
  // (the API still starts so /ready can report it); the check re-runs on the next start.
  try {
    await assertAllSimulated(services.directory);
  } catch (err) {
    if (err instanceof RealDataError) {
      console.error(err.message);
      process.exit(1);
    }
    logger.warn('simulated_guard_skipped', {
      message: err instanceof Error ? err.message : String(err),
    });
  }

  const app = createApp({
    config,
    authProvider: services.auth,
    services,
    checkDb: () => checkDatabase(pool),
  });
  const httpServer = createServer(app);
  const realtime = createRealtime(httpServer, {
    authProvider: services.auth,
    corsOrigin: config.corsOrigin,
  });

  httpServer.on('error', (err: NodeJS.ErrnoException) => {
    // e.g. EADDRINUSE / EACCES: say so plainly and exit instead of an unhandled 'error' event.
    console.error(`Cannot listen on port ${config.port}: ${err.code ?? err.message}`);
    process.exit(1);
  });
  httpServer.listen(config.port, () => {
    logger.info('api_listening', {
      port: config.port,
      authProvider: config.authProvider,
      simulatedDataOnly: config.simulatedDataOnly,
    });
  });

  const shutdown = (signal: string): void => {
    logger.info('shutdown', { signal });
    void realtime.close().then(() => pool.end().finally(() => process.exit(0)));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
