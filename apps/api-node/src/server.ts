// Process entry point. Loads validated config (fails fast), wires dependencies, starts HTTP + Socket.IO.
import { createServer } from 'node:http';
import { createApp } from './app.js';
import { ClinicOSTokenAuth } from './auth/ClinicOSTokenAuth.js';
import { DevAuthProvider } from './auth/DevAuthProvider.js';
import type { AuthProvider } from './auth/types.js';
import { ConfigError, loadConfig } from './config/env.js';
import { checkDatabase, createPool } from './db/pool.js';
import { logger } from './logger.js';
import { createRealtime } from './realtime/socket.js';

function main(): void {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  let authProvider: AuthProvider;
  let devProvider: DevAuthProvider | undefined;
  if (config.authProvider === 'dev') {
    // loadConfig guarantees devAuthSecret is present and strong when AUTH_PROVIDER=dev.
    devProvider = new DevAuthProvider(config.devAuthSecret as string, config.devTokenTtlSeconds);
    authProvider = devProvider;
  } else {
    authProvider = new ClinicOSTokenAuth(); // Phase 12 stub: every call throws NOT_IMPLEMENTED
  }

  const pool = createPool(config.databaseUrl);
  const app = createApp({
    config,
    authProvider,
    ...(devProvider ? { devProvider } : {}),
    checkDb: () => checkDatabase(pool),
  });
  const httpServer = createServer(app);
  const realtime = createRealtime(httpServer, { authProvider, corsOrigin: config.corsOrigin });

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

main();
