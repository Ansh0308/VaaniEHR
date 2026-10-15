// Sets the password of the runtime database role `vaani_app` (created, without a password, by migration 0005).
// Done here instead of in a migration because node-pg-migrate echoes SQL to the console and the password would leak.
// Usage (after `npm run db:migrate`): reads MIGRATION_DATABASE_URL and APP_DB_PASSWORD from the environment.
// The password is sent through format('%L') on the server, never printed.
import { pathToFileURL } from 'node:url';
import pg from 'pg';

export const APP_ROLE = 'vaani_app';

export async function setAppRolePassword(ownerUrl: string, password: string): Promise<void> {
  if (password.length < 16) throw new Error('APP_DB_PASSWORD must be at least 16 characters');
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    const q = await client.query<{ sql: string }>(
      `SELECT format('ALTER ROLE ${APP_ROLE} WITH LOGIN PASSWORD %L', $1::text) AS sql`,
      [password],
    );
    await client.query(q.rows[0]?.sql as string);
  } finally {
    await client.end();
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const ownerUrl = process.env.MIGRATION_DATABASE_URL;
  const password = process.env.APP_DB_PASSWORD;
  if (!ownerUrl || !password) {
    console.error(
      'MIGRATION_DATABASE_URL and APP_DB_PASSWORD must be set (run npm run setup:env).',
    );
    process.exit(1);
  }
  setAppRolePassword(ownerUrl, password).then(
    () => console.log(`role ${APP_ROLE}: password set`),
    (err: Error) => {
      console.error(`provisioning failed: ${err.message}`);
      process.exit(1);
    },
  );
}
