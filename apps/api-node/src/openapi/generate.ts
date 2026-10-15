// `npm run openapi` writes apps/api-node/openapi.json; `npm run openapi:check` fails if the committed file is stale.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadConfig } from '../config/env.js';
import { allRoutes } from '../routes/index.js';
import { buildOpenApi, serialiseOpenApi } from './build.js';

export const OPENAPI_FILE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'openapi.json',
);

/** Config values only feed rate limiter settings, which do not appear in the document. */
export function currentOpenApiText(): string {
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://u:p@localhost:5433/x',
    AUTH_PROVIDER: 'dev',
    DEV_AUTH_SECRET: 'openapi-generation-only-secret-0123456789abcdef',
  });
  return serialiseOpenApi(buildOpenApi(allRoutes(config)));
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const text = currentOpenApiText();
  if (process.argv.includes('--check')) {
    const committed = readFileSync(OPENAPI_FILE, 'utf8');
    if (committed !== text) {
      console.error('apps/api-node/openapi.json is stale. Run: npm run openapi');
      process.exit(1);
    }
    console.log('openapi.json is up to date');
  } else {
    writeFileSync(OPENAPI_FILE, text, { encoding: 'utf8' });
    console.log(`wrote ${OPENAPI_FILE}`);
  }
}
