// Hash chain for the audit log (NFR-REL-01). Each row stores prev_hash (the previous row's row_hash) and
// row_hash = SHA-256(canonical JSON of the row's fields, including prev_hash). Changing, deleting or re-ordering any
// row breaks every hash after it, and verifyChain() reports the first broken row.
import { createHash } from 'node:crypto';
import { canonicalJson } from './canonical.js';

export const GENESIS_HASH = '0'.repeat(64);

/** The fields that are hashed. Timestamps are ISO-8601 UTC with milliseconds. */
export interface AuditRecord {
  seq: number;
  ts: string;
  actorUserId: string | null;
  actorRole: string | null;
  clinicId: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  sessionId: string | null;
  ip: string | null;
  requestId: string | null;
  meta: Record<string, unknown>;
  prevHash: string;
}

export interface ChainRow extends AuditRecord {
  rowHash: string;
}

export function computeRowHash(record: AuditRecord): string {
  return createHash('sha256').update(canonicalJson(record)).digest('hex');
}

export type VerifyResult =
  | { ok: true; count: number; headSeq: number | null; headHash: string }
  | {
      ok: false;
      count: number;
      firstBrokenSeq: number;
      reason: 'seq_gap' | 'prev_hash_mismatch' | 'row_hash_mismatch';
    };

/**
 * Incremental verifier: feed rows in seq order with push(); the first broken row is returned immediately.
 * The first row must be seq 1 with the genesis prev_hash.
 * Note: deleting the LAST rows leaves a valid shorter chain; compare headSeq/headHash with a copy recorded elsewhere
 * (verify-audit-chain accepts --expect-head / --expect-count for that).
 */
export class ChainVerifier {
  private expectedSeq = 1;
  private expectedPrev = GENESIS_HASH;
  private count = 0;

  /** Returns a failure for the first broken row, or null if this row is fine. */
  push(row: ChainRow): Extract<VerifyResult, { ok: false }> | null {
    this.count += 1;
    const broken = (reason: 'seq_gap' | 'prev_hash_mismatch' | 'row_hash_mismatch') => ({
      ok: false as const,
      count: this.count,
      firstBrokenSeq: row.seq,
      reason,
    });
    if (row.seq !== this.expectedSeq) return broken('seq_gap');
    if (row.prevHash !== this.expectedPrev) return broken('prev_hash_mismatch');
    const { rowHash, ...record } = row;
    if (computeRowHash(record) !== rowHash) return broken('row_hash_mismatch');
    this.expectedSeq += 1;
    this.expectedPrev = rowHash;
    return null;
  }

  finish(): Extract<VerifyResult, { ok: true }> {
    return {
      ok: true,
      count: this.count,
      headSeq: this.count === 0 ? null : this.expectedSeq - 1,
      headHash: this.expectedPrev,
    };
  }
}

export function verifyChain(rows: Iterable<ChainRow>): VerifyResult {
  const verifier = new ChainVerifier();
  for (const row of rows) {
    const failure = verifier.push(row);
    if (failure) return failure;
  }
  return verifier.finish();
}
