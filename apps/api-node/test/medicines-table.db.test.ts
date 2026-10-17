// What the admin medicine table needs from GET /medicines: filter by category, server-side sort, the categories list,
// and the printed page number next to the PDF page.
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createHarness, SEED_EMAIL, type Harness } from './db/helpers.js';

let h: Harness;
let doctor: string;
let admin: string;
const get = (path: string, token: string) =>
  request(h.app)
    .get(`/api/v1${path}`)
    .set(...bearer(token));
const names = (res: request.Response) =>
  res.body.data.items.map((m: { genericName: string }) => m.genericName);

beforeAll(async () => {
  h = await createHarness();
  doctor = await h.tokenFor(SEED_EMAIL.doctor1);
  admin = await h.tokenFor(SEED_EMAIL.admin);
  const rows: Array<[string, string, string, number, string | null]> = [
    ['Drug-B (FAKE)', 'Tablet', 'Section One > Group A', 12, null],
    ['Drug-A (FAKE)', 'Injection', 'Section One > Group B', 30, '2026-10-01'],
    ['Drug-C (FAKE)', 'Tablet', 'Section Two', 4, null],
    ['Drug-D (FAKE)', 'Capsule', 'Section Two > Group A', 20, null],
  ];
  for (const [name, form, category, page, reviewed] of rows)
    await h.db.owner.query(
      `INSERT INTO medicine_master (generic_name, dose_form, strength, therapeutic_category, source, source_page, reviewed_on, reviewed_by)
       VALUES ($1, $2, '1 mg', $3, 'test fixture', $4, $5, $6)`,
      [name, form, category, page, reviewed, reviewed ? 'Dr Fake Reviewer' : null],
    );
});
afterAll(async () => {
  await h.close();
});

describe('category filter and the categories list', () => {
  it('lists the top-level categories (the section titles) with counts, for every role', async () => {
    const res = await get('/medicines/categories', doctor);
    expect(res.status).toBe(200);
    expect(res.body.data.categories).toEqual([
      { name: 'Section One', count: 2 },
      { name: 'Section Two', count: 2 },
    ]);
  });

  it('keeps one top-level category, including its sub-groups', async () => {
    const res = await get('/medicines?category=Section%20Two&limit=50', admin);
    expect(names(res)).toEqual(['Drug-C (FAKE)', 'Drug-D (FAKE)']);
    expect(res.body.data.total).toBe(2);
    expect(names(await get('/medicines?category=No%20Such%20Section', admin))).toEqual([]);
  });

  it('works together with a search', async () => {
    const res = await get('/medicines?q=drug&category=Section%20One', doctor);
    expect(names(res).sort()).toEqual(['Drug-A (FAKE)', 'Drug-B (FAKE)']);
  });
});

describe('server-side sort of the plain list', () => {
  it('sorts by name, strength-free columns and page, ascending and descending', async () => {
    const order = async (sort: string, dir: string) =>
      names(await get(`/medicines?sort=${sort}&order=${dir}&limit=50`, admin));
    expect(await order('name', 'asc')).toEqual([
      'Drug-A (FAKE)',
      'Drug-B (FAKE)',
      'Drug-C (FAKE)',
      'Drug-D (FAKE)',
    ]);
    expect(await order('name', 'desc')).toEqual([
      'Drug-D (FAKE)',
      'Drug-C (FAKE)',
      'Drug-B (FAKE)',
      'Drug-A (FAKE)',
    ]);
    expect(await order('page', 'asc')).toEqual([
      'Drug-C (FAKE)',
      'Drug-B (FAKE)',
      'Drug-D (FAKE)',
      'Drug-A (FAKE)',
    ]);
    expect(await order('form', 'asc')).toEqual([
      'Drug-D (FAKE)',
      'Drug-A (FAKE)',
      'Drug-B (FAKE)',
      'Drug-C (FAKE)',
    ]);
    expect((await order('category', 'asc'))[0]).toBe('Drug-B (FAKE)'); // "Section One > Group A"
  });

  it('a reviewed row sorts after the unreviewed ones when ascending, and first when descending (nulls last)', async () => {
    const asc = names(await get('/medicines?sort=reviewed&order=asc&limit=50', admin));
    expect(asc[0]).toBe('Drug-A (FAKE)'); // the only reviewed row: a date sorts before "no date" (nulls last)
    const desc = names(await get('/medicines?sort=reviewed&order=desc&limit=50', admin));
    expect(desc[0]).toBe('Drug-A (FAKE)');
  });

  it('refuses a sort key that is not on the list (the key picks a whitelisted expression, never raw SQL)', async () => {
    expect(
      (await get('/medicines?sort=generic_name;drop%20table%20medicine_master', admin)).status,
    ).toBe(400);
    expect((await get('/medicines?order=sideways', admin)).status).toBe(400);
  });
});

describe('the printed page number', () => {
  it('every item shows the PDF page and the printed page, which is one lower', async () => {
    const res = await get('/medicines?sort=page&order=asc&limit=50', doctor);
    for (const m of res.body.data.items)
      expect(m.sourcePagePrinted).toBe(m.sourcePage === null ? null : m.sourcePage - 1);
    expect(res.body.data.items[0]).toMatchObject({ sourcePage: 4, sourcePagePrinted: 3 });
  });
});
