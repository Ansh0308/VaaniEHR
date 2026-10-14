import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Express } from 'express';
import { createApp } from '../src/app.js';
import { ClinicOSTokenAuth } from '../src/auth/ClinicOSTokenAuth.js';
import { DevAuthProvider } from '../src/auth/DevAuthProvider.js';
import { loadConfig, type Config } from '../src/config/env.js';
import { createRealtime, type Realtime } from '../src/realtime/socket.js';

/** A strong-looking secret that exists only inside tests (not a real secret). */
export const TEST_SECRET = 'unit-test-only-secret-0123456789abcdef-0123456789';

export const baseEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://vaani:test-password@localhost:5433/vaaniehr_test',
  AUTH_PROVIDER: 'dev',
  DEV_AUTH_SECRET: TEST_SECRET,
} as const;

export function testConfig(overrides: Record<string, string | undefined> = {}): Config {
  return loadConfig({ ...baseEnv, ...overrides });
}

export interface TestApp {
  app: Express;
  config: Config;
  dev: DevAuthProvider;
}

export function buildTestApp(
  options: {
    checkDb?: () => Promise<void>;
    extend?: (app: Express, ctx: { dev: DevAuthProvider; config: Config }) => void;
    envOverrides?: Record<string, string | undefined>;
  } = {},
): TestApp {
  const config = testConfig(options.envOverrides);
  const dev = new DevAuthProvider(TEST_SECRET, config.devTokenTtlSeconds);
  const isDev = config.authProvider === 'dev';
  const app = createApp({
    config,
    authProvider: isDev ? dev : new ClinicOSTokenAuth(),
    ...(isDev ? { devProvider: dev } : {}),
    checkDb: options.checkDb ?? (() => Promise.resolve()),
    ...(options.extend ? { extend: (a: Express) => options.extend?.(a, { dev, config }) } : {}),
  });
  return { app, config, dev };
}

export interface RunningServer {
  url: string;
  realtime: Realtime;
  dev: DevAuthProvider;
  close: () => Promise<void>;
}

/** Real HTTP + Socket.IO server on an ephemeral port, for socket tests. */
export async function startTestServer(): Promise<RunningServer> {
  const { app, config, dev } = buildTestApp();
  const httpServer: Server = createServer(app);
  const realtime = createRealtime(httpServer, { authProvider: dev, corsOrigin: config.corsOrigin });
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const { port } = httpServer.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    realtime,
    dev,
    close: async () => {
      await realtime.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}
