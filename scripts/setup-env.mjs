// Creates local .env files from the committed .env.example files, generating random dev secrets.
// Never overwrites an existing .env except to ADD keys introduced later (and, once, to move an existing api-node
// DATABASE_URL from the owner role to the least-privilege role vaani_app: Phase 2A). Never prints secret values.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib.mjs';

const dbPassword = randomBytes(18).toString('hex');
const devSecret = randomBytes(32).toString('hex');
const targets = ['infra', 'apps/api-node', 'apps/web', 'apps/asr-py'];

/** KEY=value lines (comments and blank lines ignored). */
function parseEnv(text) {
  const map = new Map();
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m) map.set(m[1], m[2]);
  }
  return map;
}

const read = (target) => {
  const file = join(ROOT, target, '.env');
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
};

// The runtime role's password must be identical in infra/.env (docker compose) and apps/api-node/.env.
const existingApp =
  parseEnv(read('apps/api-node') ?? '').get('APP_DB_PASSWORD') ??
  parseEnv(read('infra') ?? '').get('APP_DB_PASSWORD');
const appDbPassword =
  existingApp && !existingApp.startsWith('REPLACE_ME')
    ? existingApp
    : randomBytes(18).toString('hex');

function fill(text) {
  return text
    .replaceAll('REPLACE_ME_APP_DB_PASSWORD', appDbPassword)
    .replaceAll('REPLACE_ME_DB_PASSWORD', dbPassword)
    .replaceAll('REPLACE_ME_DEV_AUTH_SECRET', devSecret);
}

for (const target of targets) {
  const example = join(ROOT, target, '.env.example');
  const env = join(ROOT, target, '.env');
  if (!existsSync(example)) continue;

  if (!existsSync(env)) {
    writeFileSync(env, fill(readFileSync(example, 'utf8')), { encoding: 'utf8' });
    console.log(`created ${target}/.env (random dev secrets generated, not shown)`);
    continue;
  }

  // Existing file: keep every current value; append keys that only exist in the example.
  let current = readFileSync(env, 'utf8');
  const have = parseEnv(current);
  const missing = [];
  for (const [key, value] of parseEnv(readFileSync(example, 'utf8'))) {
    if (have.has(key)) continue;
    // Owner connection string: take over the old DATABASE_URL below instead of the example's placeholder.
    if (key === 'MIGRATION_DATABASE_URL' && target === 'apps/api-node') continue;
    missing.push(`${key}=${fill(value)}`);
  }

  if (
    target === 'apps/api-node' &&
    !have.has('MIGRATION_DATABASE_URL') &&
    have.has('DATABASE_URL')
  ) {
    // Phase 2A: the API now connects as vaani_app; the old URL (owner role) becomes the migration URL.
    const oldUrl = have.get('DATABASE_URL');
    const owner = new URL(oldUrl);
    if (owner.username !== 'vaani_app') {
      const app = new URL(oldUrl);
      app.username = 'vaani_app';
      app.password = appDbPassword;
      current = current.replace(/^DATABASE_URL=.*$/m, `DATABASE_URL=${app.toString()}`);
      missing.push(`MIGRATION_DATABASE_URL=${oldUrl}`);
    }
  }

  if (missing.length > 0) {
    const sep = current.endsWith('\n') ? '' : '\n';
    writeFileSync(env, `${current}${sep}${missing.join('\n')}\n`, { encoding: 'utf8' });
    console.log(
      `updated ${target}/.env (added ${missing.length} new setting(s); values not shown)`,
    );
  } else {
    console.log(`kept    ${target}/.env (already up to date)`);
  }
}
