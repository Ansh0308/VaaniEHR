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

// Phase 4A: the signed internal token secret is the SAME value in api-node and asr-py; the audio master key lives only
// in asr-py. Losing AUDIO_MASTER_KEY makes stored audio unrecoverable (docs/ASR.md).
const existingInternal =
  parseEnv(read('apps/api-node') ?? '').get('INTERNAL_SERVICE_SECRET') ??
  parseEnv(read('apps/asr-py') ?? '').get('INTERNAL_SERVICE_SECRET');
const internalSecret =
  existingInternal && !existingInternal.startsWith('REPLACE_ME')
    ? existingInternal
    : randomBytes(32).toString('hex');
const audioMasterKey = randomBytes(32).toString('hex');

function fill(text) {
  return text
    .replaceAll('REPLACE_ME_INTERNAL_SECRET', internalSecret)
    .replaceAll('REPLACE_ME_AUDIO_MASTER_KEY', audioMasterKey)
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

// Least privilege (Phase 4A): vendor keys belong to asr-py only. Move SARVAM_API_KEY and HF_TOKEN from the api-node
// .env to the asr-py .env (never overwriting a value already there) and remove them from the api-node file.
// Nothing is printed except the names that moved.
{
  const from = join(ROOT, 'apps', 'api-node', '.env');
  const to = join(ROOT, 'apps', 'asr-py', '.env');
  if (existsSync(from) && existsSync(to)) {
    const keep = [];
    const moved = [];
    let dest = readFileSync(to, 'utf8');
    const haveDest = parseEnv(dest);
    for (const line of readFileSync(from, 'utf8').split('\n')) {
      const m = /^(SARVAM_API_KEY|HF_TOKEN)=(.*?)\r?$/.exec(line);
      if (!m) {
        keep.push(line);
        continue;
      }
      if (!haveDest.has(m[1]) && m[2] !== '') {
        dest = `${dest}${dest.endsWith('\n') ? '' : '\n'}${m[1]}=${m[2]}\n`;
      }
      moved.push(m[1]);
    }
    if (moved.length > 0) {
      writeFileSync(to, dest, { encoding: 'utf8' });
      writeFileSync(from, keep.join('\n'), { encoding: 'utf8' });
      console.log(
        `moved ${moved.join(', ')} from apps/api-node/.env to apps/asr-py/.env (values not shown)`,
      );
    }
  }
}
