// Regression: a dropped database connection must not crash the API process (found by the Docker smoke test).
import { describe, expect, it } from 'vitest';
import { checkDatabase, createPool } from '../src/db/pool.js';

describe('database pool', () => {
  it('survives an idle-client error event instead of crashing the process', async () => {
    const pool = createPool('postgres://vaani:test-password@127.0.0.1:1/none');
    expect(() =>
      pool.emit('error', new Error('terminating connection due to administrator command')),
    ).not.toThrow();
    await pool.end();
  });

  it('readiness check rejects (does not hang) when the database is unreachable', async () => {
    const pool = createPool('postgres://vaani:test-password@127.0.0.1:1/none');
    await expect(checkDatabase(pool)).rejects.toBeDefined();
    await pool.end();
  });
});
