// Prescription templates against a real database: visibility (personal / clinic-wide), who may edit, the controlled
// frequency codes, retired medicines (flagged on load, never dropped), validation and the audit rows.
// All names are fake ("Drug-A (DEMO)"): there are no pre-made clinical templates anywhere.
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FREQUENCY_CODES } from '../src/templates/frequency.js';
import { bearer, createHarness, SEED_EMAIL, type Harness } from './db/helpers.js';

let h: Harness;
const tokens: Record<'admin' | 'doctor1' | 'doctor2' | 'staff' | 'researcher', string> = {
  admin: '',
  doctor1: '',
  doctor2: '',
  staff: '',
  researcher: '',
};
let medA = '';
let medB = '';
let medRetired = '';

const q = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  (await h.db.owner.query<T>(sql, params)).rows;
type Who = keyof typeof tokens;
const call = (method: 'get' | 'post' | 'put', path: string, who: Who, body?: object) => {
  const r = request(h.app)
    [method](`/api/v1${path}`)
    .set(...bearer(tokens[who]));
  return body ? r.send(body) : r;
};
const item = (medicineId: string, over: Record<string, unknown> = {}) => ({
  medicineId,
  dose: '1 tablet (demo)',
  frequency: 'BD',
  duration: '5 days (demo)',
  instructions: 'After food (demo)',
  ...over,
});
const create = async (
  who: Who,
  visibility: 'personal' | 'clinic',
  name = 'Demo template (FAKE)',
) => {
  const res = await call('post', '/templates', who, {
    name,
    visibility,
    items: [item(medA), item(medB, { frequency: 'SOS', dose: null })],
  });
  expect(res.status).toBe(201);
  return res.body.data as { id: string };
};
const ids = (res: request.Response) => res.body.data.items.map((t: { id: string }) => t.id);

beforeAll(async () => {
  h = await createHarness();
  tokens.admin = await h.tokenFor(SEED_EMAIL.admin);
  tokens.doctor1 = await h.tokenFor(SEED_EMAIL.doctor1);
  tokens.doctor2 = await h.tokenFor(SEED_EMAIL.doctor2);
  tokens.staff = await h.tokenFor(SEED_EMAIL.staff);
  tokens.researcher = await h.tokenFor(SEED_EMAIL.researcher);
  const med = async (name: string) =>
    (
      await q<{ id: string }>(
        `INSERT INTO medicine_master (generic_name, dose_form, strength, source, source_page)
         VALUES ($1, 'Tablet', '10 mg', 'test fixture', 5) RETURNING id`,
        [name],
      )
    )[0]?.id as string;
  medA = await med('Drug-A (DEMO)');
  medB = await med('Drug-B (DEMO)');
  medRetired = await med('Drug-R (DEMO)');
  await q('UPDATE medicine_master SET retired_at = now() WHERE id = $1', [medRetired]);
});
afterAll(async () => {
  await h.close();
});

describe('who may use templates at all (the permission table, flagged in ADR-D24)', () => {
  it('doctors and admins may; staff and researchers may not', async () => {
    for (const who of ['doctor1', 'admin'] as const) {
      expect((await call('get', '/templates', who)).status).toBe(200);
    }
    for (const who of ['staff', 'researcher'] as const) {
      expect((await call('get', '/templates', who)).status).toBe(403);
      expect(
        (
          await call('post', '/templates', who, {
            name: 'x',
            visibility: 'personal',
            items: [item(medA)],
          })
        ).status,
      ).toBe(403);
    }
  });
});

describe('creating a template', () => {
  it('stores the items in order, with frequency as a code, and says who owns it', async () => {
    const res = await call('post', '/templates', 'doctor1', {
      name: '  Demo cold template (FAKE)  ',
      visibility: 'personal',
      items: [item(medB, { frequency: 'TDS' }), item(medA, { frequency: 'OD', instructions: '' })],
    });
    expect(res.status).toBe(201);
    const t = res.body.data;
    expect(t).toMatchObject({
      name: 'Demo cold template (FAKE)',
      visibility: 'personal',
      ownedByMe: true,
      canEdit: true,
      itemCount: 2,
    });
    expect(
      t.items.map((i: { medicine: { genericName: string } }) => i.medicine.genericName),
    ).toEqual(['Drug-B (DEMO)', 'Drug-A (DEMO)']);
    expect(t.items.map((i: { frequency: string }) => i.frequency)).toEqual(['TDS', 'OD']);
    expect(t.items[1].instructions).toBeNull(); // an empty string means "not given"
    expect(t.items[0].medicine).toMatchObject({
      source: 'test fixture',
      sourcePage: 5,
      sourcePagePrinted: 4,
      reviewStatus: 'not_reviewed',
    });
  });

  it('accepts exactly the controlled frequency codes and nothing else, in the API and in the database', async () => {
    for (const code of FREQUENCY_CODES) {
      const r = await call('post', '/templates', 'doctor1', {
        name: `F ${code} (FAKE)`,
        visibility: 'personal',
        items: [item(medA, { frequency: code })],
      });
      expect(r.status, code).toBe(201);
    }
    for (const bad of ['twice a day', 'bd', 'Q8H', '1-0-1', '']) {
      const r = await call('post', '/templates', 'doctor1', {
        name: 'Bad (FAKE)',
        visibility: 'personal',
        items: [item(medA, { frequency: bad })],
      });
      expect(r.status, `"${bad}"`).toBe(400);
    }
    const tpl = await create('doctor1', 'personal', 'For the constraint (FAKE)');
    await expect(
      q(`UPDATE med_template_item SET frequency = 'twice a day' WHERE template_id = $1`, [tpl.id]),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('refuses an empty list, an unknown medicine, a retired medicine, too many items, a blank name and unknown fields', async () => {
    const base = { name: 'Check (FAKE)', visibility: 'personal' as const };
    expect((await call('post', '/templates', 'doctor1', { ...base, items: [] })).status).toBe(400);
    expect(
      (
        await call('post', '/templates', 'doctor1', {
          ...base,
          items: [item('00000000-0000-4000-8000-000000000000')],
        })
      ).status,
    ).toBe(400);
    const retired = await call('post', '/templates', 'doctor1', {
      ...base,
      items: [item(medRetired)],
    });
    expect(retired.status).toBe(400);
    expect(retired.body.error.message).toContain('retired');
    expect(
      (
        await call('post', '/templates', 'doctor1', {
          ...base,
          items: Array.from({ length: 41 }, () => item(medA)),
        })
      ).status,
    ).toBe(400);
    expect(
      (await call('post', '/templates', 'doctor1', { ...base, name: '   ', items: [item(medA)] }))
        .status,
    ).toBe(400);
    expect(
      (
        await call('post', '/templates', 'doctor1', {
          ...base,
          items: [item(medA)],
          ownerId: h.seed.users[0]?.id,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call('post', '/templates', 'doctor1', {
          ...base,
          visibility: 'everyone',
          items: [item(medA)],
        })
      ).status,
    ).toBe(400);
  });
});

describe("visibility: personal is the owner's alone, clinic-wide is the clinic's", () => {
  it('a personal template is invisible to everyone else in the clinic: not listed, and "not found" (not "forbidden") by id', async () => {
    const mine = await create('doctor1', 'personal', 'Private demo (FAKE)');
    for (const who of ['doctor2', 'admin'] as const) {
      expect(ids(await call('get', '/templates', who))).not.toContain(mine.id);
      expect(ids(await call('get', '/templates?scope=all&includeRetired=true', who))).not.toContain(
        mine.id,
      );
      for (const [method, path] of [
        ['get', `/templates/${mine.id}`],
        ['get', `/templates/${mine.id}/load`],
        ['post', `/templates/${mine.id}/retire`],
        ['post', `/templates/${mine.id}/restore`],
      ] as const)
        expect((await call(method, path, who)).status, `${who} ${method} ${path}`).toBe(404);
      expect(
        (
          await call('put', `/templates/${mine.id}`, who, {
            name: 'Hijack',
            visibility: 'clinic',
            items: [item(medA)],
          })
        ).status,
      ).toBe(404);
    }
    expect(ids(await call('get', '/templates', 'doctor1'))).toContain(mine.id);
    expect((await call('get', `/templates/${mine.id}/load`, 'doctor1')).status).toBe(200);
  });

  it('a clinic-wide template is visible to the clinic; only its owner or an admin can edit it; only the owner changes its visibility', async () => {
    const shared = await create('doctor1', 'clinic', 'Shared demo (FAKE)');
    for (const who of ['doctor2', 'admin'] as const) {
      expect(ids(await call('get', '/templates', who))).toContain(shared.id);
      expect((await call('get', `/templates/${shared.id}/load`, who)).status).toBe(200);
    }
    const asDoctor2 = await call('get', `/templates/${shared.id}`, 'doctor2');
    expect(asDoctor2.body.data).toMatchObject({
      visibility: 'clinic',
      ownedByMe: false,
      canEdit: false,
    });
    expect(asDoctor2.body.data.ownerName).toBeTruthy();
    expect((await call('get', `/templates/${shared.id}`, 'admin')).body.data.canEdit).toBe(true);

    const body = (over: object = {}) => ({
      name: 'Edited demo (FAKE)',
      visibility: 'clinic',
      items: [item(medA)],
      ...over,
    });
    expect((await call('put', `/templates/${shared.id}`, 'doctor2', body())).status).toBe(403); // another doctor
    expect((await call('post', `/templates/${shared.id}/retire`, 'doctor2')).status).toBe(403);
    expect((await call('put', `/templates/${shared.id}`, 'admin', body())).status).toBe(200); // an admin may edit clinic-wide
    expect(
      (await call('put', `/templates/${shared.id}`, 'admin', body({ visibility: 'personal' })))
        .status,
    ).toBe(403); // but not hide it from its owner
    expect(
      (await call('put', `/templates/${shared.id}`, 'doctor1', body({ visibility: 'personal' })))
        .status,
    ).toBe(200); // the owner may
    expect(ids(await call('get', '/templates', 'doctor2'))).not.toContain(shared.id); // now personal: gone for the others
  });

  it('the list can be narrowed to mine or clinic-wide, and paged', async () => {
    const mine = await create('doctor2', 'personal', 'Mine only (FAKE)');
    const clinic = await create('doctor2', 'clinic', 'Clinic-wide (FAKE)');
    const onlyMine = await call('get', '/templates?scope=mine', 'doctor2');
    expect(ids(onlyMine)).toContain(mine.id);
    expect(ids(onlyMine)).toContain(clinic.id); // doctor2 owns both
    const onlyClinic = await call('get', '/templates?scope=clinic', 'doctor2');
    expect(ids(onlyClinic)).toContain(clinic.id);
    expect(ids(onlyClinic)).not.toContain(mine.id);
    await create('doctor2', 'clinic', 'Another clinic-wide (FAKE)'); // an admin sees clinic-wide ones only
    const page1 = await call('get', '/templates?limit=1', 'admin');
    expect(page1.body.data).toMatchObject({ limit: 1, offset: 0 });
    expect(page1.body.data.items).toHaveLength(1);
    expect(page1.body.data.total).toBeGreaterThan(1);
  });
});

describe('editing replaces the items and keeps their order', () => {
  it('PUT replaces name, visibility and items; the audit row names the changed fields only', async () => {
    const t = await create('doctor1', 'personal', 'To edit (FAKE)');
    const res = await call('put', `/templates/${t.id}`, 'doctor1', {
      name: 'To edit (FAKE)',
      visibility: 'personal',
      items: [
        item(medB, { frequency: 'QID' }),
        item(medA, { frequency: 'OD' }),
        item(medB, { frequency: 'SOS' }),
      ],
    });
    expect(res.status).toBe(200);
    expect(
      res.body.data.items.map((i: { frequency: string; position: number }) => [
        i.position,
        i.frequency,
      ]),
    ).toEqual([
      [0, 'QID'],
      [1, 'OD'],
      [2, 'SOS'],
    ]);
    const rows = await q<{ meta: Record<string, unknown> }>(
      `SELECT meta FROM audit_log WHERE action = 'TEMPLATE_UPDATED' AND resource_id = $1`,
      [t.id],
    );
    expect(rows.at(-1)?.meta).toEqual({
      changedFields: ['items'],
      itemCount: 3,
      visibility: 'personal',
    });
  });
});

describe('retired medicines: flagged on load, never dropped or substituted', () => {
  it('an item whose medicine is retired later stays in the template and is flagged when the template is loaded', async () => {
    const t = await create('doctor1', 'clinic', 'Will have a retired medicine (FAKE)');
    await q('UPDATE medicine_master SET retired_at = now() WHERE id = $1', [medB]);
    try {
      const loaded = await call('get', `/templates/${t.id}/load`, 'doctor2');
      expect(loaded.status).toBe(200);
      const d = loaded.body.data;
      expect(d.template).toMatchObject({ id: t.id, visibility: 'clinic' });
      expect(d.items).toHaveLength(2); // nothing dropped
      expect(d.items.map((i: { medicine: { id: string } }) => i.medicine.id)).toEqual([medA, medB]); // nothing substituted, order kept
      expect(d.items[0].problem).toBeNull();
      expect(d.items[1]).toMatchObject({ problem: 'MEDICINE_RETIRED', frequency: 'SOS' });
      expect(d.items[1].medicine.retired).toBe(true);
      expect(d.hasRetiredMedicine).toBe(true);
      expect(d.warnings).toEqual([{ position: 1, code: 'MEDICINE_RETIRED', medicineId: medB }]);

      const detail = await call('get', `/templates/${t.id}`, 'doctor1');
      expect(detail.body.data.items[1].medicineRetired).toBe(true);

      // editing the template may keep that item, but may not add another retired medicine
      const keep = [item(medA), item(medB, { frequency: 'SOS' })];
      expect(
        (
          await call('put', `/templates/${t.id}`, 'doctor1', {
            name: 'Still has it (FAKE)',
            visibility: 'clinic',
            items: keep,
          })
        ).status,
      ).toBe(200);
      const add = [...keep, item(medRetired)];
      expect(
        (
          await call('put', `/templates/${t.id}`, 'doctor1', {
            name: 'Still has it (FAKE)',
            visibility: 'clinic',
            items: add,
          })
        ).status,
      ).toBe(400);
    } finally {
      await q('UPDATE medicine_master SET retired_at = NULL WHERE id = $1', [medB]);
    }
  });

  it('a template with no retired medicine loads clean', async () => {
    const t = await create('doctor1', 'personal', 'Clean (FAKE)');
    const d = (await call('get', `/templates/${t.id}/load`, 'doctor1')).body.data;
    expect(d.hasRetiredMedicine).toBe(false);
    expect(d.warnings).toEqual([]);
    expect(d.items.every((i: { problem: unknown }) => i.problem === null)).toBe(true);
    expect(d.items[0]).toMatchObject({
      position: 0,
      dose: '1 tablet (demo)',
      frequency: 'BD',
      duration: '5 days (demo)',
      instructions: 'After food (demo)',
    });
    expect(d.items[0].medicine).toMatchObject({
      genericName: 'Drug-A (DEMO)',
      source: 'test fixture',
    });
  });
});

describe('retiring a template', () => {
  it('hides it from the default list, makes it unloadable (409), and restore brings it back; nothing is deleted', async () => {
    const t = await create('doctor1', 'clinic', 'To retire (FAKE)');
    expect((await call('post', `/templates/${t.id}/retire`, 'doctor1')).body.data.retired).toBe(
      true,
    );
    expect(ids(await call('get', '/templates', 'doctor2'))).not.toContain(t.id);
    expect(ids(await call('get', '/templates?includeRetired=true', 'doctor2'))).toContain(t.id);
    expect((await call('get', `/templates/${t.id}/load`, 'doctor2')).status).toBe(409);
    expect((await call('get', `/templates/${t.id}`, 'doctor2')).body.data.retired).toBe(true);
    expect((await call('post', `/templates/${t.id}/restore`, 'admin')).body.data.retired).toBe(
      false,
    );
    expect((await call('get', `/templates/${t.id}/load`, 'doctor2')).status).toBe(200);
    expect((await q('SELECT 1 FROM med_template WHERE id = $1', [t.id])).length).toBe(1);
    await expect(
      h.appPool.query('DELETE FROM med_template WHERE id = $1', [t.id]),
    ).rejects.toMatchObject({ code: '42501' });
  });
});

describe('audit', () => {
  it('every write is audited with ids, counts, the visibility and field names: never the template text', async () => {
    const t = await create('doctor1', 'personal', 'Secret-looking name (FAKE)');
    await call('put', `/templates/${t.id}`, 'doctor1', {
      name: 'Renamed secret (FAKE)',
      visibility: 'personal',
      items: [item(medA, { dose: 'one and a half (demo)' })],
    });
    await call('post', `/templates/${t.id}/retire`, 'doctor1');
    await call('post', `/templates/${t.id}/restore`, 'doctor1');
    const rows = await q<{
      action: string;
      meta: Record<string, unknown>;
      actor_role: string;
      clinic_id: string;
    }>(
      `SELECT action, meta, actor_role, clinic_id FROM audit_log WHERE resource_type = 'template' AND resource_id = $1 ORDER BY seq`,
      [t.id],
    );
    expect(rows.map((r) => r.action)).toEqual([
      'TEMPLATE_CREATED',
      'TEMPLATE_UPDATED',
      'TEMPLATE_RETIRED',
      'TEMPLATE_RESTORED',
    ]);
    expect(
      rows.every((r) => r.actor_role === 'doctor' && r.clinic_id === h.seed.clinics[0]?.id),
    ).toBe(true);
    const text = JSON.stringify(rows);
    for (const secret of [
      'Secret-looking',
      'Renamed secret',
      'one and a half',
      'After food',
      'Drug-A',
    ])
      expect(text).not.toContain(secret);
    expect(rows[1]?.meta).toMatchObject({ changedFields: ['name', 'items'], itemCount: 1 });
  });

  it('a refused write leaves no audit row', async () => {
    const t = await create('doctor1', 'personal', 'Refused (FAKE)');
    const before = (await q<{ n: string }>('SELECT count(*) AS n FROM audit_log'))[0]?.n;
    await call('put', `/templates/${t.id}`, 'doctor2', {
      name: 'x',
      visibility: 'personal',
      items: [item(medA)],
    }); // 404
    await call('post', '/templates', 'staff', {
      name: 'x',
      visibility: 'personal',
      items: [item(medA)],
    }); // 403
    expect((await q<{ n: string }>('SELECT count(*) AS n FROM audit_log'))[0]?.n).toBe(before);
  });
});
