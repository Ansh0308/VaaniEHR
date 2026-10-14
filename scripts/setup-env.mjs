// Creates local .env files from the committed .env.example files, generating random dev secrets.
// Never overwrites an existing .env. Never prints secret values.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib.mjs';

const dbPassword = randomBytes(18).toString('hex');
const devSecret = randomBytes(32).toString('hex');
const targets = ['infra', 'apps/api-node', 'apps/web', 'apps/asr-py'];

for (const target of targets) {
  const example = join(ROOT, target, '.env.example');
  const env = join(ROOT, target, '.env');
  if (!existsSync(example)) continue;
  if (existsSync(env)) {
    console.log(`kept    ${target}/.env (already exists)`);
    continue;
  }
  const text = readFileSync(example, 'utf8')
    .replaceAll('REPLACE_ME_DB_PASSWORD', dbPassword)
    .replaceAll('REPLACE_ME_DEV_AUTH_SECRET', devSecret);
  writeFileSync(env, text, { encoding: 'utf8' });
  console.log(`created ${target}/.env (random dev secrets generated, not shown)`);
}
