import type pg from 'pg';

/** The one query shape the app uses. A Pool, a PoolClient and a Tx all satisfy it. */
export interface Queryable {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<pg.QueryResult<R>>;
}

/** A client inside an open transaction. Only withTransaction() hands one out. */
export interface Tx extends Queryable {
  readonly inTransaction: true;
}

/** Runs fn inside BEGIN/COMMIT; rolls back and rethrows on any error. */
export async function withTransaction<T>(pool: pg.Pool, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  const tx: Tx = {
    inTransaction: true,
    query: (text, values) => client.query(text, values as unknown[]),
  };
  try {
    await client.query('BEGIN');
    const result = await fn(tx);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* the original error is the one that matters */
    }
    throw err;
  } finally {
    client.release();
  }
}
