// Re-computes the whole audit hash chain and reports the FIRST broken row (NFR-REL-01).
// Run via `npm run verify:audit` (reads DATABASE_URL: the app role only needs SELECT).
//   --expect-head <hash>   fail if the newest row_hash differs (detects deleted trailing rows)
//   --expect-count <n>     fail if the row count differs
// Exit codes: 0 chain intact, 1 chain broken or expectation not met, 2 usage / connection problem.
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import '../db/types.js';
import { readChainRows } from './audit.js';
import { ChainVerifier, type VerifyResult } from './chain.js';

export async function verifyDatabaseChain(db: Pick<pg.Pool, 'query'>): Promise<VerifyResult> {
  const verifier = new ChainVerifier();
  let after = 0;
  for (;;) {
    const page = await readChainRows(db, after, 2000);
    for (const row of page) {
      const failure = verifier.push(row);
      if (failure) return failure;
    }
    const last = page[page.length - 1];
    if (!last || page.length < 2000) return verifier.finish();
    after = last.seq;
  }
}

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<number> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set (run npm run setup:env).');
    return 2;
  }
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    const result = await verifyDatabaseChain(pool);
    if (!result.ok) {
      console.error(
        `AUDIT CHAIN BROKEN at seq ${result.firstBrokenSeq} (${result.reason}); checked ${result.count} row(s).`,
      );
      return 1;
    }
    const expectHead = argValue('--expect-head');
    const expectCount = argValue('--expect-count');
    if (expectHead !== undefined && expectHead !== result.headHash) {
      console.error(
        'AUDIT CHAIN: head hash differs from --expect-head (rows may have been removed).',
      );
      return 1;
    }
    if (expectCount !== undefined && Number(expectCount) !== result.count) {
      console.error(`AUDIT CHAIN: ${result.count} row(s), expected ${expectCount}.`);
      return 1;
    }
    console.log(`audit chain OK: ${result.count} row(s), head seq ${result.headSeq ?? '-'}`);
    console.log(`head hash: ${result.headHash}`);
    return 0;
  } catch (err) {
    console.error(
      `could not read the audit log: ${err instanceof Error ? err.message : String(err)}`,
    );
    return 2;
  } finally {
    await pool.end();
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().then((code) => process.exit(code));
}
