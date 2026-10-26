import pg from 'pg';
import { logger, redactMessage } from '../logger.js';

import './types.js';

/**
 * Lazily-connecting pool. No connection is attempted until the first query.
 * The 'error' listener is essential: pg emits it when an idle client's connection drops (e.g. the database
 * restarts). Without a listener Node treats it as an uncaught exception and the whole API process dies.
 */
export function createPool(databaseUrl: string): pg.Pool {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 10,
    connectionTimeoutMillis: 3000,
  });
  pool.on('error', (err) => {
    logger.error('pg_pool_error', { name: err.name, detail: redactMessage(err.message) });
  });
  return pool;
}

/** Readiness probe: resolves if the database answers SELECT 1, rejects otherwise. */
export async function checkDatabase(pool: pg.Pool): Promise<void> {
  await pool.query('SELECT 1');
}
