// /api/v1/medicines against a real database: search ranking (generic first), Gujarati expansion, admin writes and their
// audit rows, the rules about review fields and codes, retire-never-delete, and response time on a full-size list.
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createHarness, SEED_EMAIL, type Harness } from './db/helpers.js';

let h: Harness;
let admin: string;
let doctor: string;
let researcher: string;
const q = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  (await h.db.owner.query<T>(sql, params)).rows;
const get = (path: string, token: string) =>
  request(h.app)
    .get(`/api/v1${path}`)
    .set(...bearer(token));
const send = (method: 'post' | 'patch', path: string, token: string, body: object = {}) =>
  request(h.app)
    [method](`/api/v1${path}`)
    .set(...bearer(token))
    .send(body);
const names = (res: request.Response) =>
  res.body.data.items.map((m: { genericName: string }) => m.genericName);
const idOf = async (name: string) =>
  (await q<{ id: string }>('SELECT id FROM medicine_master WHERE generic_name = $1', [name]))[0]
    ?.id as string;

beforeAll(async () => {
  h = await createHarness();
  admin = await h.tokenFor(SEED_EMAIL.admin);
  doctor = await h.tokenFor(SEED_EMAIL.doctor1);
  researcher = await h.tokenFor(SEED_EMAIL.researcher);
  const insert = (name: string, form: string, strength: string) =>
    q(
      `INSERT INTO medicine_master (generic_name, dose_form, strength, source, source_page) VALUES ($1,$2,$3,'test fixture',1)`,
      [name, form, strength],
    );
  await insert('Paracetamol', 'Tablet', '500 mg');
  await insert('Paracetamol', 'Injection', '10 mg/mL');
  await insert('Parafoo (FAKE)', 'Tablet', '1 mg');
  await insert('Xpara (FAKE)', 'Tablet', '2 mg');
  await insert('Drug-D (FAKE)', 'Tablet', '3 mg');
  await insert('Drug-E (FAKE)', 'Tablet', '4 mg');
  await insert('Bad_Percent (FAKE)', 'Tablet', '5 mg');
  const brand = (medicine: string, name: string) =>
    q(
      `INSERT INTO medicine_brand (medicine_id, brand_name, source) SELECT id, $2, 'test fixture' FROM medicine_master WHERE generic_name = $1`,
      [medicine, name],
    );
  await brand('Drug-D (FAKE)', 'Parabrand');
  await brand('Drug-E (FAKE)', 'Para');
});
afterAll(async () => {
  await h.close();
});

describe('search', () => {
  it('ranks generic names above brand names: exact, then prefix, then contained, then brand exact, then brand prefix', async () => {
    const res = await get('/medicines?q=para', researcher);
    expect(res.status).toBe(200);
    expect(names(res)).toEqual([
      'Paracetamol', // generic, starts with it (alphabetical among equals)
      'Paracetamol',
      'Parafoo (FAKE)',
      'Xpara (FAKE)', // generic, contains it
      'Drug-E (FAKE)', // brand "Para" (exact)
      'Drug-D (FAKE)', // brand "Parabrand" (starts with it)
    ]);
    const matched = res.body.data.items.map((m: { matchedOn: string }) => m.matchedOn);
    expect(matched).toEqual(['generic', 'generic', 'generic', 'generic', 'brand', 'brand']);
  });

  it('puts an exact generic name first and ignores case', async () => {
    for (const query of ['paracetamol', 'PARACETAMOL', '  Paracetamol ']) {
      const res = await get(`/medicines?q=${encodeURIComponent(query)}`, doctor);
      expect(names(res).slice(0, 2)).toEqual(['Paracetamol', 'Paracetamol']);
    }
  });

  it('a generic match beats a brand match even when the brand matches exactly', async () => {
    await q(
      `INSERT INTO medicine_brand (medicine_id, brand_name, source) SELECT id, 'Xpara', 'test fixture' FROM medicine_master WHERE generic_name = 'Drug-D (FAKE)'`,
    );
    const res = await get('/medicines?q=xpara', doctor);
    expect(names(res)[0]).toBe('Xpara (FAKE)'); // generic "contains" (700) beats brand exact (400)
    expect(names(res)).toContain('Drug-D (FAKE)');
  });

  it('finds a brand name and says so', async () => {
    const res = await get('/medicines?q=parabrand', doctor);
    expect(names(res)[0]).toBe('Drug-D (FAKE)'); // the exact brand first; a similar brand ("Para") may follow
    expect(res.body.data.items[0].matchedOn).toBe('brand');
    expect(res.body.data.items[0].brands.map((b: { brandName: string }) => b.brandName)).toContain(
      'Parabrand',
    );
  });

  it('forgives a typo (trigram) and treats % and _ as plain characters', async () => {
    expect(names(await get('/medicines?q=paracetmol', doctor))).toContain('Paracetamol');
    expect(names(await get(`/medicines?q=${encodeURIComponent('%')}`, doctor))).toEqual([]);
    expect(names(await get(`/medicines?q=${encodeURIComponent('Bad_Percent')}`, doctor))).toEqual([
      'Bad_Percent (FAKE)',
    ]);
    expect(
      names(await get(`/medicines?q=${encodeURIComponent('Bad_P_rcent')}`, doctor)),
    ).not.toContain('Paracetamol');
  });

  it('every item carries its source, source page, review status and brands', async () => {
    const res = await get('/medicines?limit=50', doctor);
    expect(res.body.data.items.length).toBeGreaterThan(0);
    for (const m of res.body.data.items) {
      expect(m.source).toBeTruthy();
      expect(m).toHaveProperty('sourcePage');
      expect(m.reviewStatus).toBe('not_reviewed');
      expect(Array.isArray(m.brands)).toBe(true);
      expect(m.snomedCode).toBeNull();
    }
  });

  it('without q it is an alphabetical, paged list with a total', async () => {
    const page1 = await get('/medicines?limit=2', doctor);
    const page2 = await get('/medicines?limit=2&offset=2', doctor);
    expect(page1.body.data).toMatchObject({ limit: 2, offset: 0 });
    expect(page1.body.data.total).toBeGreaterThanOrEqual(7);
    expect(names(page1)).not.toEqual(names(page2));
    expect([...names(page1), ...names(page2)]).toEqual(
      [...names(page1), ...names(page2)]
        .slice()
        .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())),
    );
  });

  it('refuses a silly page size and a query that is too long', async () => {
    expect((await get('/medicines?limit=500', doctor)).status).toBe(400);
    expect((await get(`/medicines?q=${'a'.repeat(81)}`, doctor)).status).toBe(400);
  });

  it('GET /medicines/:id returns one medicine, 404 for an unknown id, 400 for a bad id', async () => {
    const id = await idOf('Parafoo (FAKE)');
    expect((await get(`/medicines/${id}`, doctor)).body.data).toMatchObject({
      id,
      genericName: 'Parafoo (FAKE)',
      source: 'test fixture',
    });
    expect((await get('/medicines/00000000-0000-4000-8000-000000000000', doctor)).status).toBe(404);
    expect((await get('/medicines/not-an-id', doctor)).status).toBe(400);
  });
});

describe('Gujarati queries (search must work without the mapping; the mapping table is empty until a reviewer approves a list)', () => {
  it('the mapping table is empty and a Latin query works', async () => {
    expect((await q('SELECT 1 FROM medicine_translit_gu')).length).toBe(0);
    expect(names(await get('/medicines?q=paracetamol', doctor))).toContain('Paracetamol');
    expect(names(await get(`/medicines?q=${encodeURIComponent('પેરાસીટામોલ')}`, doctor))).toEqual(
      [],
    );
  });

  it('with an approved mapping a Gujarati query, even a partial one, finds the generic', async () => {
    await q(
      `INSERT INTO medicine_translit_gu (gu_text, latin_text, source, reviewed_by, reviewed_on) VALUES ('પેરાસીટામોલ','paracetamol','test fixture','Fake Reviewer','2026-10-01')`,
    );
    expect(
      names(await get(`/medicines?q=${encodeURIComponent('પેરાસીટામોલ')}`, doctor)).slice(0, 2),
    ).toEqual(['Paracetamol', 'Paracetamol']);
    expect(names(await get(`/medicines?q=${encodeURIComponent('પેરા')}`, doctor))).toContain(
      'Paracetamol',
    );
    await q('DELETE FROM medicine_translit_gu');
  });
});

describe('admin writes and their audit entries', () => {
  const auditOf = async (action: string) =>
    q<{ meta: Record<string, unknown>; resource_id: string; actor_role: string }>(
      `SELECT meta, resource_id, actor_role FROM audit_log WHERE action = $1 ORDER BY seq`,
      [action],
    );

  it('create: source is required, the row starts unreviewed, a duplicate is a 409, and the audit row has no values', async () => {
    expect(
      (await send('post', '/medicines', admin, { genericName: 'Qzx-Unique (FAKE)' })).status,
    ).toBe(400); // no source
    const created = await send('post', '/medicines', admin, {
      genericName: 'Qzx-Unique (FAKE)',
      strength: '7 mg',
      doseForm: 'Tablet',
      source: 'Added by admin from a leaflet',
    });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      source: 'Added by admin from a leaflet',
      reviewStatus: 'not_reviewed',
      retired: false,
    });
    expect(
      (
        await send('post', '/medicines', admin, {
          genericName: 'QZX-UNIQUE (fake)',
          strength: '7 mg',
          doseForm: 'Tablet',
          source: 'again',
        })
      ).status,
    ).toBe(409);
    const [entry] = await auditOf('MEDICINE_CREATED');
    expect(entry).toMatchObject({ resource_id: created.body.data.id, actor_role: 'admin' });
    expect(JSON.stringify(entry?.meta)).not.toContain('Qzx');
  });

  it('update: audits the names of changed fields only, and clears a review', async () => {
    const id = await idOf('Qzx-Unique (FAKE)');
    await q(
      `UPDATE medicine_master SET reviewed_on = '2026-10-01', reviewed_by = 'Dr Fake Reviewer' WHERE id = $1`,
      [id],
    );
    expect((await get(`/medicines/${id}`, doctor)).body.data.reviewStatus).toBe('reviewed');
    const patched = await send('patch', `/medicines/${id}`, admin, { strength: '8 mg' });
    expect(patched.status).toBe(200);
    expect(patched.body.data).toMatchObject({
      strength: '8 mg',
      reviewStatus: 'not_reviewed',
      reviewedOn: null,
      reviewedBy: null,
    });
    const entries = await auditOf('MEDICINE_UPDATED');
    expect(entries.at(-1)?.meta).toEqual({ changedFields: ['strength'] });
    expect(JSON.stringify(entries)).not.toContain('8 mg');
  });

  it('NO endpoint can set reviewed_on, reviewed_by, a SNOMED code or an ATC code (strict bodies), on create or update', async () => {
    const id = await idOf('Qzx-Unique (FAKE)');
    for (const body of [
      { reviewedOn: '2026-10-01' },
      { reviewedBy: 'Dr Forged' },
      { snomedCode: '12345678' },
      { atcCode: 'N02BE01' },
      { reviewed_on: '2026-10-01' },
    ]) {
      expect(
        (await send('patch', `/medicines/${id}`, admin, body)).status,
        JSON.stringify(body),
      ).toBe(400);
      expect(
        (
          await send('post', '/medicines', admin, {
            genericName: 'Drug-X (FAKE)',
            source: 's',
            ...body,
          })
        ).status,
      ).toBe(400);
    }
    expect((await send('patch', `/medicines/${id}`, admin, {})).status).toBe(400); // nothing to change
    const [row] = await q<{ snomed_code: string | null; atc_code: string | null }>(
      'SELECT snomed_code, atc_code FROM medicine_master WHERE id = $1',
      [id],
    );
    expect(row).toEqual({ snomed_code: null, atc_code: null });
    expect(
      (await q(`SELECT 1 FROM medicine_master WHERE generic_name = 'Drug-X (FAKE)'`)).length,
    ).toBe(0);
  });

  it('retire hides it from search, never deletes it, keeps the review, and restore brings it back', async () => {
    const id = await idOf('Qzx-Unique (FAKE)');
    await q(
      `UPDATE medicine_master SET reviewed_on = '2026-10-01', reviewed_by = 'Dr Fake Reviewer' WHERE id = $1`,
      [id],
    );
    const retired = await send('post', `/medicines/${id}/retire`, admin);
    expect(retired.body.data).toMatchObject({ retired: true, reviewStatus: 'reviewed' }); // retiring is not an edit
    expect(names(await get('/medicines?q=qzx', doctor))).toEqual([]);
    expect((await get('/medicines?q=qzx&includeRetired=true', doctor)).status).toBe(403); // only admins may ask
    expect(names(await get('/medicines?q=qzx&includeRetired=true', admin))).toEqual([
      'Qzx-Unique (FAKE)',
    ]);
    expect((await get(`/medicines/${id}`, doctor)).status).toBe(200); // still readable by id (old records point at it)
    expect((await send('post', `/medicines/${id}/restore`, admin)).body.data.retired).toBe(false);
    expect(names(await get('/medicines?q=qzx', doctor))).toEqual(['Qzx-Unique (FAKE)']);
    expect((await q(`SELECT 1 FROM medicine_master WHERE id = $1`, [id])).length).toBe(1);
    expect((await auditOf('MEDICINE_RETIRED')).length).toBe(1);
    expect((await auditOf('MEDICINE_RESTORED')).length).toBe(1);
  });

  it('brands: added with a source, found by search, retired and gone from search, audited', async () => {
    const id = await idOf('Qzx-Unique (FAKE)');
    expect(
      (await send('post', `/medicines/${id}/brands`, admin, { brandName: 'Qzxbrand' })).status,
    ).toBe(400); // source required
    const added = await send('post', `/medicines/${id}/brands`, admin, {
      brandName: 'Qzxbrand',
      manufacturer: 'Fake Pharma',
      source: 'leaflet',
    });
    expect(added.status).toBe(201);
    const brandId = added.body.data.brands[0].id as string;
    expect(names(await get('/medicines?q=qzxbrand', doctor))).toEqual(['Qzx-Unique (FAKE)']);
    expect(
      (
        await send('post', `/medicines/${id}/brands`, admin, {
          brandName: 'QZXBRAND',
          source: 'dup',
        })
      ).status,
    ).toBe(409);
    const gone = await send('post', `/medicines/${id}/brands/${brandId}/retire`, admin);
    expect(gone.body.data.brands).toEqual([]);
    expect(names(await get('/medicines?q=qzxbrand', doctor))).toEqual([]);
    expect((await auditOf('MEDICINE_BRAND_ADDED')).length).toBe(1);
    expect((await auditOf('MEDICINE_BRAND_RETIRED')).length).toBe(1);
    expect(
      (
        await send(
          'post',
          `/medicines/${await idOf('Parafoo (FAKE)')}/brands/${brandId}/retire`,
          admin,
        )
      ).status,
    ).toBe(404); // wrong medicine
  });

  it('a doctor, staff member or researcher cannot write, and a refused write leaves no audit row', async () => {
    const staff = await h.tokenFor(SEED_EMAIL.staff); // logging in is itself audited, so count after it
    const before = (await q<{ n: string }>('SELECT count(*) AS n FROM audit_log'))[0]?.n;
    for (const token of [doctor, staff, researcher])
      expect(
        (await send('post', '/medicines', token, { genericName: 'Drug-Y (FAKE)', source: 's' }))
          .status,
      ).toBe(403);
    expect((await q<{ n: string }>('SELECT count(*) AS n FROM audit_log'))[0]?.n).toBe(before);
  });
});

describe('response time on a full-size list (under 200 ms)', () => {
  it('lists and searches ~900 medicines in well under 200 ms (median of 7 requests)', async () => {
    await q(
      `INSERT INTO medicine_master (generic_name, dose_form, strength, source, source_page)
       SELECT 'Synthetic-' || lpad(g::text, 4, '0') || ' (FAKE)', 'Tablet', (g % 50 + 1)::text || ' mg', 'perf fixture', 1
         FROM generate_series(1, 900) g`,
    );
    const total = Number(
      (await q<{ n: string }>('SELECT count(*) AS n FROM medicine_master'))[0]?.n,
    );
    expect(total).toBeGreaterThanOrEqual(900);
    const median = async (path: string) => {
      await get(path, doctor); // warm the connection and the plan
      const times: number[] = [];
      for (let i = 0; i < 7; i += 1) {
        const t0 = performance.now();
        const res = await get(path, doctor);
        times.push(performance.now() - t0);
        expect(res.status).toBe(200);
      }
      return times.sort((a, b) => a - b)[3] as number;
    };
    expect(await median('/medicines?limit=50')).toBeLessThan(200);
    expect(await median('/medicines?q=synth&limit=50')).toBeLessThan(200);
    expect(await median('/medicines?q=sinthetic-0042&limit=50')).toBeLessThan(200); // trigram path
    expect(await median('/medicines?q=para&limit=50')).toBeLessThan(200);
  });
});
