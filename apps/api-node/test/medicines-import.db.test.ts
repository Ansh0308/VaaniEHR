// Import into a real PostgreSQL: idempotency, the unique key with NULL route, the review guard trigger, privileges, the
// audit entry written through the same chain code as the API, and the licensed-code loader.
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyCodes, parseCodesCsv } from '../src/medicines/codes.js';
import { applyTranslit, parseTranslitCsv } from '../src/medicines/translit.js';
import { diffRuns, medicinesToCsv } from '../src/medicines/nlemFiles.js';
import { loadNlemRows } from '../src/medicines/nlemLoad.js';
import { parseNlem } from '../src/medicines/nlemParser.js';
import { bearer, createHarness, SEED_EMAIL, type Harness } from './db/helpers.js';
import { sampleDocument } from './nlemFixtures.js';

let h: Harness;
const parsed = () => parseNlem(sampleDocument(), { nlemYear: 2022 });
const counts = {
  numberedEntries: 3,
  formulationRows: 4,
  distinctGenerics: 3,
  rejectedItems: 0,
  heldForReview: 0,
};
const q = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  (await h.db.owner.query<T>(sql, params)).rows;
const count = async () =>
  Number((await q<{ n: string }>('SELECT count(*) AS n FROM medicine_master'))[0]?.n);

beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.close();
});

describe('pg_trgm and the schema', () => {
  it('pg_trgm exists (created by the migration in this Postgres image)', async () => {
    expect((await q('SELECT 1 FROM pg_extension WHERE extname = $1', ['pg_trgm'])).length).toBe(1);
  });
  it('a NULL route cannot create a duplicate: the same generic, form and strength twice is refused, any case', async () => {
    await q(
      `INSERT INTO medicine_master (generic_name, dose_form, strength, source) VALUES ('Drug-U','Tablet','1 mg','t')`,
    );
    await expect(
      q(
        `INSERT INTO medicine_master (generic_name, dose_form, strength, source) VALUES ('DRUG-U','Tablet','1 mg','t')`,
      ),
    ).rejects.toMatchObject({ code: '23505' });
    // a different route is a different formulation
    await q(
      `INSERT INTO medicine_master (generic_name, dose_form, strength, route, source) VALUES ('Drug-U','Tablet','1 mg','oral','t')`,
    );
    await q(`DELETE FROM medicine_master WHERE generic_name ILIKE 'drug-u'`);
  });
  it('every medicine row must name its source', async () => {
    await expect(
      q(`INSERT INTO medicine_master (generic_name, source) VALUES ('Drug-V', '  ')`),
    ).rejects.toThrow();
  });
});

describe('importing', () => {
  it('first import inserts every row; the second adds 0 rows, changes 0 rows and the diff is empty', async () => {
    const rows = parsed().rows;
    const first = await loadNlemRows(h.db.owner, rows, counts);
    expect(first).toMatchObject({ inserted: rows.length, updated: 0, unchanged: 0, stale: [] });
    const before = await count();

    // run it again from a fresh parse, as a second `npm run import:nlem` would
    const second = await loadNlemRows(h.db.owner, parsed().rows, counts);
    expect(second).toMatchObject({ inserted: 0, updated: 0, unchanged: rows.length, stale: [] });
    expect(await count()).toBe(before);
    expect(diffRuns(medicinesToCsv(rows), medicinesToCsv(parsed().rows))).toEqual({
      added: [],
      removed: [],
      changed: [],
    });
  });

  it('imported rows have no route, no codes and no review, and say where they came from', async () => {
    const all = await q<Record<string, unknown>>(
      `SELECT * FROM medicine_master WHERE source LIKE 'NLEM 2022%'`,
    );
    expect(all.length).toBeGreaterThan(0);
    for (const r of all) {
      expect(r.route).toBeNull();
      expect(r.snomed_code).toBeNull();
      expect(r.atc_code).toBeNull();
      expect(r.reviewed_on).toBeNull();
      expect(r.reviewed_by).toBeNull();
      expect(r.source_page).toBe(2);
      expect(r.nlem_year).toBe(2022);
    }
  });

  it('writes an audit entry with counts only (no PDF text, no names) through the audit chain, and the chain stays valid', async () => {
    const entries = await q<{ meta: Record<string, unknown>; action: string }>(
      `SELECT action, meta FROM audit_log WHERE action = 'MEDICINE_IMPORTED' ORDER BY seq`,
    );
    expect(entries).toHaveLength(2);
    for (const e of entries) {
      expect(Object.values(e.meta).every((v) => typeof v === 'number')).toBe(true);
      expect(JSON.stringify(e.meta)).not.toMatch(/Drug|Tablet|Injection|NLEM/);
    }
    const admin = await h.tokenFor(SEED_EMAIL.admin);
    const verify = await request(h.app)
      .get('/api/v1/audit/verify')
      .set(...bearer(admin));
    expect(verify.body.data.ok).toBe(true);
  });

  it('a changed value is an update, and it clears a review (the row needs a new review)', async () => {
    await q(
      `UPDATE medicine_master SET reviewed_on = '2026-10-01', reviewed_by = 'Dr Fake Reviewer' WHERE generic_name = 'Drug-A'`,
    );
    const rows = parsed().rows.map((r) =>
      r.genericName === 'Drug-A' ? { ...r, therapeuticCategory: 'Moved Group' } : r,
    );
    const result = await loadNlemRows(h.db.owner, rows, counts);
    expect(result.updated).toBe(2); // both Drug-A formulations
    const [row] = await q<{ reviewed_on: unknown; reviewed_by: unknown }>(
      `SELECT reviewed_on, reviewed_by FROM medicine_master WHERE generic_name = 'Drug-A' LIMIT 1`,
    );
    expect(row?.reviewed_on).toBeNull();
    expect(row?.reviewed_by).toBeNull();
    await loadNlemRows(h.db.owner, parsed().rows, counts); // put it back
  });

  it('a retired row stays retired after a re-import', async () => {
    await q(`UPDATE medicine_master SET retired_at = now() WHERE generic_name = 'Drug-B'`);
    await loadNlemRows(h.db.owner, parsed().rows, counts);
    const [row] = await q<{ retired_at: unknown }>(
      `SELECT retired_at FROM medicine_master WHERE generic_name = 'Drug-B'`,
    );
    expect(row?.retired_at).not.toBeNull();
    await q(`UPDATE medicine_master SET retired_at = NULL WHERE generic_name = 'Drug-B'`);
  });
});

describe('rows an earlier run created that this run no longer produces (stale rows)', () => {
  it('are reported, never deleted, retired only on request, and never touch admin-added rows', async () => {
    await q(
      `INSERT INTO medicine_master (generic_name, source) VALUES ('Drug-Admin (FAKE)', 'added by an admin')`,
    );
    // the new run no longer produces Drug-C
    const fewer = parsed().rows.filter((r) => r.genericName !== 'Drug-C');
    const report = await loadNlemRows(h.db.owner, fewer, counts);
    expect(report.stale).toEqual(['Drug-C']);
    expect(report.retiredStale).toBe(0);
    expect(
      (
        await q(
          `SELECT 1 FROM medicine_master WHERE generic_name = 'Drug-C' AND retired_at IS NULL`,
        )
      ).length,
    ).toBe(1);

    const retired = await loadNlemRows(h.db.owner, fewer, counts, { retireStale: true });
    expect(retired.retiredStale).toBe(1);
    expect(
      (
        await q(
          `SELECT 1 FROM medicine_master WHERE generic_name = 'Drug-C' AND retired_at IS NOT NULL`,
        )
      ).length,
    ).toBe(1);
    expect(
      (
        await q(
          `SELECT 1 FROM medicine_master WHERE generic_name = 'Drug-Admin (FAKE)' AND retired_at IS NULL`,
        )
      ).length,
    ).toBe(1);
    const [audit] = await q<{ meta: Record<string, unknown> }>(
      `SELECT meta FROM audit_log WHERE action = 'MEDICINE_IMPORTED' ORDER BY seq DESC LIMIT 1`,
    );
    expect(audit?.meta).toMatchObject({ staleRows: 1, retiredStale: 1 });
    expect(Object.values(audit?.meta ?? {}).every((v) => typeof v === 'number')).toBe(true);

    // a later full import brings Drug-C's row back into the import; it stays retired until someone restores it
    await loadNlemRows(h.db.owner, parsed().rows, counts);
    expect(
      (
        await q(
          `SELECT 1 FROM medicine_master WHERE generic_name = 'Drug-C' AND retired_at IS NOT NULL`,
        )
      ).length,
    ).toBe(1);
    await q(`UPDATE medicine_master SET retired_at = NULL WHERE generic_name = 'Drug-C'`);
    await q(`DELETE FROM medicine_master WHERE generic_name = 'Drug-Admin (FAKE)'`);
  });
});

describe('the runtime role cannot set a review or delete', () => {
  it('an insert by the API role always comes out unreviewed', async () => {
    await h.appPool.query(
      `INSERT INTO medicine_master (generic_name, source, reviewed_on, reviewed_by) VALUES ('Drug-W', 't', '2026-01-01', 'Dr Fake')`,
    );
    const [row] = await q<{ reviewed_on: unknown; reviewed_by: unknown }>(
      `SELECT reviewed_on, reviewed_by FROM medicine_master WHERE generic_name = 'Drug-W'`,
    );
    expect(row?.reviewed_on).toBeNull();
    expect(row?.reviewed_by).toBeNull();
  });

  it('an update by the API role keeps the old review if only unrelated fields change, and cannot erase or forge one', async () => {
    await q(
      `UPDATE medicine_master SET reviewed_on = '2026-10-01', reviewed_by = 'Dr Fake Reviewer' WHERE generic_name = 'Drug-W'`,
    );
    // tries to forge a different reviewer and to blank the date, without touching any material field
    await h.appPool.query(
      `UPDATE medicine_master SET reviewed_by = 'Dr Forged', retired_at = retired_at WHERE generic_name = 'Drug-W'`,
    );
    let [row] = await q<{ reviewed_on: Date | null; reviewed_by: string | null }>(
      `SELECT reviewed_on, reviewed_by FROM medicine_master WHERE generic_name = 'Drug-W'`,
    );
    expect(row?.reviewed_by).toBe('Dr Fake Reviewer');
    await h.appPool.query(
      `UPDATE medicine_master SET reviewed_on = NULL, reviewed_by = NULL WHERE generic_name = 'Drug-W'`,
    );
    [row] = await q<{ reviewed_on: Date | null; reviewed_by: string | null }>(
      `SELECT reviewed_on, reviewed_by FROM medicine_master WHERE generic_name = 'Drug-W'`,
    );
    expect(row?.reviewed_by).toBe('Dr Fake Reviewer'); // not erased by the API role
    // a material edit clears it
    await h.appPool.query(
      `UPDATE medicine_master SET strength = '5 mg' WHERE generic_name = 'Drug-W'`,
    );
    [row] = await q<{ reviewed_on: Date | null; reviewed_by: string | null }>(
      `SELECT reviewed_on, reviewed_by FROM medicine_master WHERE generic_name = 'Drug-W'`,
    );
    expect(row?.reviewed_on).toBeNull();
    expect(row?.reviewed_by).toBeNull();
  });

  it('has no DELETE privilege on medicines or brands, and cannot touch the Gujarati table or templates', async () => {
    await expect(
      h.appPool.query(`DELETE FROM medicine_master WHERE generic_name = 'Drug-W'`),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(h.appPool.query(`DELETE FROM medicine_brand`)).rejects.toMatchObject({
      code: '42501',
    });
    await expect(
      h.appPool.query(
        `INSERT INTO medicine_translit_gu (gu_text, latin_text, source, reviewed_by, reviewed_on) VALUES ('ક','k','t','x','2026-01-01')`,
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(h.appPool.query('SELECT 1 FROM med_template')).rejects.toMatchObject({
      code: '42501',
    });
  });
});

describe('loading licensed codes', () => {
  const file = (body: string) =>
    parseCodesCsv(`generic_name,dose_form,strength,snomed_code,atc_code,licence_note\r\n${body}`);

  it('a dry run changes nothing and writes no audit entry', async () => {
    const auditBefore = (await q<{ n: string }>(`SELECT count(*) AS n FROM audit_log`))[0]?.n;
    const result = await applyCodes(
      h.db.owner,
      file('Drug-A,,,,N02BE01,test licence\r\n').rows,
      false,
    );
    expect(result.matchedRows).toBe(1);
    expect(result.updatedMedicines).toBe(2);
    expect((await q(`SELECT 1 FROM medicine_master WHERE atc_code IS NOT NULL`)).length).toBe(0);
    expect((await q<{ n: string }>(`SELECT count(*) AS n FROM audit_log`))[0]?.n).toBe(auditBefore);
  });

  it('applying maps the code to every formulation of the generic, keeps the review, and audits counts only', async () => {
    await q(
      `UPDATE medicine_master SET reviewed_on = '2026-10-01', reviewed_by = 'Dr Fake Reviewer' WHERE generic_name = 'Drug-B'`,
    );
    const result = await applyCodes(
      h.db.owner,
      file(
        'Drug-A,,,,N02BE01,test licence\r\nDrug-B,,,99999999,,test licence\r\nNo-Such-Drug,,,,N02BE01,test licence\r\n',
      ).rows,
      true,
    );
    expect(result).toMatchObject({ matchedRows: 2, unmatchedRows: 1, updatedMedicines: 3 });
    expect(
      (
        await q(
          `SELECT 1 FROM medicine_master WHERE generic_name = 'Drug-A' AND atc_code = 'N02BE01'`,
        )
      ).length,
    ).toBe(2);
    const [b] = await q<{ reviewed_by: string | null; snomed_code: string | null }>(
      `SELECT reviewed_by, snomed_code FROM medicine_master WHERE generic_name = 'Drug-B'`,
    );
    expect(b).toMatchObject({ reviewed_by: 'Dr Fake Reviewer', snomed_code: '99999999' });
    const [audit] = await q<{ meta: Record<string, unknown> }>(
      `SELECT meta FROM audit_log WHERE action = 'MEDICINE_CODES_LOADED'`,
    );
    expect(Object.values(audit?.meta ?? {}).every((v) => typeof v === 'number')).toBe(true);
  });

  it('a row that names a dose form or strength must match exactly one formulation', async () => {
    const ambiguous = await applyCodes(
      h.db.owner,
      file('Drug-A,,5 mg/mL,,N02BE01,test licence\r\n').rows,
      true,
    );
    expect(ambiguous.matchedRows).toBe(1); // exactly one Drug-A formulation has this strength
    const none = await applyCodes(
      h.db.owner,
      file('Drug-A,Tablet,999 mg,,N02BE01,test licence\r\n').rows,
      true,
    );
    expect(none.unmatchedRows).toBe(1);
  });
});

describe('loading an approved Gujarati list', () => {
  const approved = parseTranslitCsv(
    'gu_text,latin_text,source,reviewed_by,reviewed_on\r\nડ્રગ,Drug-A,test list,Fake Reviewer,2026-10-01\r\n',
  ).rows;
  it('a dry run writes nothing; applying inserts the rows and audits counts only; the API then finds the generic', async () => {
    expect((await applyTranslit(h.db.owner, approved, false)).inserted).toBe(1);
    expect((await q('SELECT 1 FROM medicine_translit_gu')).length).toBe(0);
    expect(await applyTranslit(h.db.owner, approved, true)).toEqual({
      inserted: 1,
      alreadyThere: 0,
    });
    expect(await applyTranslit(h.db.owner, approved, true)).toEqual({
      inserted: 0,
      alreadyThere: 1,
    });
    const [audit] = await q<{ meta: Record<string, unknown> }>(
      `SELECT meta FROM audit_log WHERE action = 'MEDICINE_TRANSLIT_LOADED' ORDER BY seq LIMIT 1`,
    );
    expect(Object.values(audit?.meta ?? {}).every((v) => typeof v === 'number')).toBe(true);
    const token = await h.tokenFor(SEED_EMAIL.doctor1);
    const res = await request(h.app)
      .get(`/api/v1/medicines?q=${encodeURIComponent('ડ્રગ')}`)
      .set(...bearer(token));
    expect(res.body.data.items.map((m: { genericName: string }) => m.genericName)).toContain(
      'Drug-A',
    );
  });
});
