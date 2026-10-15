// Hash chain maths (NFR-REL-01) without a database: canonical JSON, hashing, and detection of every kind of tampering.
import { describe, expect, it } from 'vitest';
import { assertSafeMeta } from '../src/audit/audit.js';
import { canonicalJson } from '../src/audit/canonical.js';
import {
  computeRowHash,
  GENESIS_HASH,
  verifyChain,
  type AuditRecord,
  type ChainRow,
} from '../src/audit/chain.js';

function buildChain(n: number): ChainRow[] {
  const rows: ChainRow[] = [];
  let prev = GENESIS_HASH;
  for (let seq = 1; seq <= n; seq += 1) {
    const record: AuditRecord = {
      seq,
      ts: new Date(Date.UTC(2026, 9, 15, 10, 0, seq)).toISOString(),
      actorUserId: seq % 2 ? '5eed0000-0000-4000-8000-000000000012' : null,
      actorRole: seq % 2 ? 'doctor' : null,
      clinicId: '5eed0000-0000-4000-8000-000000000001',
      action: 'CONSENT_GRANTED',
      resourceType: 'consent',
      resourceId: `res-${seq}`,
      sessionId: null,
      ip: '127.0.0.1',
      requestId: `req-${seq}`,
      meta: { scope: 'audio', n: seq },
      prevHash: prev,
    };
    const rowHash = computeRowHash(record);
    rows.push({ ...record, rowHash });
    prev = rowHash;
  }
  return rows;
}

describe('canonicalJson', () => {
  it('sorts keys at every depth and drops undefined', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { y: 1, x: 2 }], c: undefined } })).toBe(
      '{"a":{"d":[3,{"x":2,"y":1}]},"b":1}',
    );
  });
  it('gives the same string whatever the insertion order', () => {
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });
  it('keeps null (a real value) but rejects NaN, Infinity and unsupported types', () => {
    expect(canonicalJson({ a: null })).toBe('{"a":null}');
    expect(() => canonicalJson({ a: Number.NaN })).toThrow();
    expect(() => canonicalJson({ a: Number.POSITIVE_INFINITY })).toThrow();
    expect(() => canonicalJson({ a: () => 1 })).toThrow();
    expect(() => canonicalJson({ a: 10n })).toThrow();
  });
});

describe('verifyChain', () => {
  it('accepts an intact chain and reports its head', () => {
    const rows = buildChain(5);
    const result = verifyChain(rows);
    expect(result).toEqual({ ok: true, count: 5, headSeq: 5, headHash: rows[4]?.rowHash });
  });

  it('accepts an empty log', () => {
    expect(verifyChain([])).toEqual({
      ok: true,
      count: 0,
      headSeq: null,
      headHash: GENESIS_HASH,
    });
  });

  it('detects an edited field and names that row', () => {
    const rows = buildChain(6);
    rows[2] = { ...(rows[2] as ChainRow), action: 'CONSENT_WITHDRAWN' };
    expect(verifyChain(rows)).toMatchObject({
      ok: false,
      firstBrokenSeq: 3,
      reason: 'row_hash_mismatch',
    });
  });

  it('detects edited metadata', () => {
    const rows = buildChain(4);
    rows[1] = { ...(rows[1] as ChainRow), meta: { scope: 'whatsapp', n: 2 } };
    expect(verifyChain(rows)).toMatchObject({ ok: false, firstBrokenSeq: 2 });
  });

  it('detects a deleted middle row (sequence gap) at the row after it', () => {
    const rows = buildChain(6);
    rows.splice(2, 1);
    expect(verifyChain(rows)).toMatchObject({ ok: false, firstBrokenSeq: 4, reason: 'seq_gap' });
  });

  it('detects a deleted first row', () => {
    const rows = buildChain(3);
    rows.shift();
    expect(verifyChain(rows)).toMatchObject({ ok: false, firstBrokenSeq: 2, reason: 'seq_gap' });
  });

  it('detects re-ordered rows', () => {
    const rows = buildChain(4);
    const swapped = [rows[0], rows[2], rows[1], rows[3]] as ChainRow[];
    expect(verifyChain(swapped)).toMatchObject({ ok: false, firstBrokenSeq: 3, reason: 'seq_gap' });
  });

  it('detects a rewritten prev_hash and a forged row_hash', () => {
    const rows = buildChain(4);
    const forgedPrev = rows.map((r) => ({ ...r }));
    forgedPrev[2] = { ...(forgedPrev[2] as ChainRow), prevHash: 'a'.repeat(64) };
    expect(verifyChain(forgedPrev)).toMatchObject({
      ok: false,
      firstBrokenSeq: 3,
      reason: 'prev_hash_mismatch',
    });

    const forgedHash = rows.map((r) => ({ ...r }));
    forgedHash[1] = { ...(forgedHash[1] as ChainRow), rowHash: 'b'.repeat(64) };
    expect(verifyChain(forgedHash)).toMatchObject({
      ok: false,
      firstBrokenSeq: 2,
      reason: 'row_hash_mismatch',
    });
  });

  it('a first row that does not start from the genesis hash is rejected', () => {
    const rows = buildChain(2);
    rows[0] = { ...(rows[0] as ChainRow), prevHash: 'c'.repeat(64) };
    expect(verifyChain(rows)).toMatchObject({ ok: false, firstBrokenSeq: 1 });
  });

  it('known limit: removing the LAST rows leaves a valid shorter chain (use --expect-head to catch it)', () => {
    const rows = buildChain(5);
    const full = verifyChain(rows);
    const truncated = verifyChain(rows.slice(0, 3));
    expect(truncated.ok).toBe(true);
    if (full.ok && truncated.ok) expect(truncated.headHash).not.toBe(full.headHash);
  });
});

describe('assertSafeMeta (no personal data in the audit log)', () => {
  it.each([
    'phone',
    'email',
    'password',
    'accessToken',
    'patientName',
    'dob',
    'allergies',
    'address',
  ])('rejects the key %s', (key) => {
    expect(() => assertSafeMeta({ [key]: 'x' })).toThrow(/personal data/);
  });
  it('allows ids, counts and scopes', () => {
    expect(() =>
      assertSafeMeta({
        scope: 'audio',
        count: 2,
        found: true,
        noticeVersion: '0.1',
        patientId: 'x',
      }),
    ).not.toThrow();
  });
});
