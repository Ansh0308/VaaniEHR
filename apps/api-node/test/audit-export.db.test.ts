// Audit log filters (user, action, date range), paging cap, and the CSV export: who may use it, that it is itself an
// audit event, the row cap, ids-only columns, and spreadsheet formula injection.
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendAudit } from '../src/audit/audit.js';
import { EXPORT_MAX_ROWS, MAX_PAGE_SIZE } from '../src/audit/routes.js';
import { withTransaction } from '../src/db/tx.js';
import { bearer, createHarness, SEED_EMAIL, type Harness } from './db/helpers.js';

let h: Harness;
let admin: string;
let researcher: string;
let staff: string;
let doctor: string;
let clinicId: string;

beforeEach(async () => {
  h = await createHarness();
  clinicId = h.seed.clinics[0]?.id as string;
  [admin, researcher, staff, doctor] = await Promise.all([
    h.tokenFor(SEED_EMAIL.admin),
    h.tokenFor(SEED_EMAIL.researcher),
    h.tokenFor(SEED_EMAIL.staff),
    h.tokenFor(SEED_EMAIL.doctor1),
  ]);
  // a bit of mixed activity
  await request(h.app)
    .post('/api/v1/patients/lookup')
    .set(...bearer(staff))
    .send({ phone: '0000000001' });
  await request(h.app)
    .post('/api/v1/sessions')
    .set(...bearer(doctor))
    .send({ patientId: h.seed.patients[0]?.id });
});
afterEach(async () => {
  await h.close();
});

const list = (query: string, token = admin) =>
  request(h.app)
    .get(`/api/v1/audit${query}`)
    .set(...bearer(token));
const exportCsv = (body: object = {}, token = admin) =>
  request(h.app)
    .post('/api/v1/audit/export')
    .set(...bearer(token))
    .send(body)
    .buffer(true)
    .parse((res, cb) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => (data += c));
      res.on('end', () => cb(null, data));
    });
const dbCount = async (sql: string, params: unknown[] = []) =>
  Number((await h.db.owner.query<{ n: number }>(sql, params)).rows[0]?.n);

describe('GET /audit filters', () => {
  it('filters by action', async () => {
    const res = await list('?action=PATIENT_LOOKUP');
    expect(res.status).toBe(200);
    const items = res.body.data.items as Array<{ action: string }>;
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.action === 'PATIENT_LOOKUP')).toBe(true);
  });

  it('filters by user (admin only)', async () => {
    const staffId = h.seed.users.find((u) => u.role === 'staff')?.id as string;
    const res = await list(`?actorUserId=${staffId}`);
    const items = res.body.data.items as Array<{ actorUserId: string }>;
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.actorUserId === staffId)).toBe(true);
  });

  it('a researcher may NOT filter by user (it would un-anonymise the view), but may filter by action and date', async () => {
    const staffId = h.seed.users.find((u) => u.role === 'staff')?.id as string;
    expect((await list(`?actorUserId=${staffId}`, researcher)).status).toBe(403);
    const ok = await list('?action=PATIENT_LOOKUP&from=2020-01-01', researcher);
    expect(ok.status).toBe(200);
    expect(ok.body.data.items.length).toBeGreaterThan(0);
  });

  it('filters by date range: a bare date means the whole UTC day', async () => {
    const today = new Date().toISOString().slice(0, 10);
    expect((await list(`?from=${today}&to=${today}`)).body.data.items.length).toBeGreaterThan(0);
    expect((await list('?from=2020-01-01&to=2020-01-02')).body.data.items).toEqual([]);
    expect((await list('?to=2020-01-01')).body.data.items).toEqual([]);
    const future = (await list('?from=2999-01-01')).body.data.items;
    expect(future).toEqual([]);
  });

  it('accepts full ISO timestamps, and combines filters (AND)', async () => {
    const res = await list(
      `?action=SESSION_CREATED&from=${new Date(Date.now() - 3600_000).toISOString()}&to=${new Date(Date.now() + 3600_000).toISOString()}`,
    );
    expect(res.body.data.items.map((i: { action: string }) => i.action)).toEqual([
      'SESSION_CREATED',
    ]);
    expect((await list('?action=SESSION_CREATED&from=2999-01-01')).body.data.items).toEqual([]);
  });

  it.each([
    ['an unknown action', '?action=DROP_TABLE'],
    ['a malformed user id', '?actorUserId=not-a-uuid'],
    ['a malformed date', '?from=yesterday'],
    ['an impossible date', '?from=2026-13-45'],
    ['from after to', '?from=2026-10-10&to=2026-10-01'],
    ['an unknown filter name', '?ip=127.0.0.1&actorUserId=nope'],
    ['a zero limit', '?limit=0'],
    ['a limit above the cap', `?limit=${MAX_PAGE_SIZE + 1}`],
  ])('rejects %s (400)', async (_label, query) => {
    const res = await list(query);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('ignores filter values it does not know (no way to filter by IP or free text)', async () => {
    const all = (await list('?limit=100')).body.data.items.length;
    const res = await list('?limit=100&ip=127.0.0.1&q=anything');
    expect(res.status).toBe(200);
    expect(res.body.data.items.length).toBe(all);
  });

  it('is always clinic-scoped, whatever the filters say', async () => {
    await withTransaction(h.appPool, (tx) =>
      appendAudit(tx, {
        action: 'LOGOUT',
        actorUserId: h.seed.users.find((u) => u.role === 'staff')?.id as string,
        actorRole: 'staff',
        clinicId: '5eed0000-0000-4000-8000-0000000000b2',
      }),
    );
    const items = (await list('?limit=100')).body.data.items as Array<{ clinicId: string }>;
    expect(items.every((i) => i.clinicId === clinicId)).toBe(true);
    const byUser = (await list(`?actorUserId=${h.seed.users.find((u) => u.role === 'staff')?.id}`))
      .body.data.items;
    expect((byUser as Array<{ clinicId: string }>).every((i) => i.clinicId === clinicId)).toBe(
      true,
    );
  });

  it('pages with a cursor and never returns more than the page cap', async () => {
    for (let i = 0; i < 30; i += 1) {
      await withTransaction(h.appPool, (tx) =>
        appendAudit(tx, { action: 'LOGOUT', clinicId, actorRole: 'staff', meta: { n: i } }),
      );
    }
    const seen = new Set<number>();
    let cursor: number | null = null;
    let pages = 0;
    do {
      const res: request.Response = await list(`?limit=10${cursor ? `&beforeSeq=${cursor}` : ''}`);
      expect(res.body.data.items.length).toBeLessThanOrEqual(10);
      for (const row of res.body.data.items as Array<{ seq: number }>) {
        expect(seen.has(row.seq)).toBe(false);
        seen.add(row.seq);
      }
      cursor = res.body.data.nextBeforeSeq;
      pages += 1;
    } while (cursor && pages < 50);
    expect(seen.size).toBe(
      await dbCount('SELECT count(*)::int AS n FROM audit_log WHERE clinic_id = $1', [clinicId]),
    );
  });
});

describe('POST /audit/export', () => {
  it('admin only: staff, doctor, researcher and anonymous are refused', async () => {
    for (const token of [staff, doctor, researcher])
      expect((await exportCsv({}, token)).status).toBe(403);
    expect((await request(h.app).post('/api/v1/audit/export').send({})).status).toBe(401);
  });

  it('returns a CSV attachment with a header row, identifiers only, newest first', async () => {
    const res = await exportCsv();
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/csv/);
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="audit-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    expect(res.headers['cache-control']).toBe('no-store');
    const lines = (res.body as string).trim().split('\r\n');
    expect(lines[0]).toBe(
      'seq,ts,action,actor_user_id,actor_role,resource_type,resource_id,session_id,request_id,row_hash',
    );
    const seqs = lines.slice(1).map((l) => Number(l.split(',')[0]));
    expect(seqs.length).toBe(Number(res.headers['x-exported-rows']));
    expect(seqs).toEqual([...seqs].sort((a, b) => b - a));
    expect(res.headers['x-export-truncated']).toBe('false');
  });

  it('holds ids only: no IP address, no metadata, no names, no e-mail, no phone, no allergies', async () => {
    const res = await exportCsv();
    const text = res.body as string;
    expect(text).not.toMatch(/(\d{1,3}\.){3}\d{1,3}/); // no IPv4 address anywhere
    expect(text.split('\r\n')[0]).not.toMatch(/\b(ip|meta)\b/); // and no such columns
    expect(text).not.toContain('127.0.0.1');
    expect(text).not.toContain('example.invalid');
    for (const p of h.seed.patients) {
      expect(text).not.toContain(p.name as string);
      expect(text).not.toMatch(new RegExp(String.raw`(?<!\d)${p.phone}(?!\d)`));
      for (const allergy of p.allergies) expect(text).not.toContain(allergy);
    }
  });

  it('applies the same filters as the list', async () => {
    const res = await exportCsv({ action: 'SESSION_CREATED' });
    const rows = (res.body as string).trim().split('\r\n').slice(1);
    expect(rows.length).toBe(1);
    expect(rows[0]).toContain(',SESSION_CREATED,');
    expect((await exportCsv({ action: 'DROP_TABLE' })).status).toBe(400);
    expect((await exportCsv({ from: '2026-10-10', to: '2026-10-01' })).status).toBe(400);
    expect((await exportCsv({ ip: '127.0.0.1' })).status).toBe(200); // unknown keys are ignored, not applied
  });

  it('is itself an audit event, with counts and filter flags but no filter values or personal data', async () => {
    const staffId = h.seed.users.find((u) => u.role === 'staff')?.id as string;
    await exportCsv({ action: 'PATIENT_LOOKUP', actorUserId: staffId, from: '2020-01-01' });
    const row = (await h.db.owner.query("SELECT * FROM audit_log WHERE action = 'AUDIT_EXPORTED'"))
      .rows[0];
    expect(row.actor_role).toBe('admin');
    expect(row.clinic_id).toBe(clinicId);
    expect(row.resource_type).toBe('audit_log');
    expect(row.meta).toEqual({
      rowCount: expect.any(Number),
      truncated: false,
      filteredByAction: 'PATIENT_LOOKUP',
      filteredByUser: true,
      filteredByDate: true,
    });
    expect(JSON.stringify(row.meta)).not.toContain(staffId);
  });

  it('the export of an export: a second export includes the first export event in its rows', async () => {
    await exportCsv();
    const second = await exportCsv({ action: 'AUDIT_EXPORTED' });
    expect((second.body as string).trim().split('\r\n').slice(1).length).toBe(1);
  });

  it('caps the number of rows and says so (headers and audit record)', async () => {
    // fill the log past the cap in one statement, as the owner (bypasses the app, keeps the chain out of this test)
    await h.db.owner.query('ALTER TABLE audit_log DISABLE TRIGGER USER');
    await h.db.owner.query(
      `INSERT INTO audit_log (seq, ts, clinic_id, action, actor_role, meta, prev_hash, row_hash)
       SELECT 100000 + g, now(), $1, 'LOGOUT', 'staff', '{}'::jsonb,
              lpad(to_hex(g), 64, '0'), lpad(to_hex(g + 7000000), 64, 'a')
         FROM generate_series(1, $2::int) AS g`,
      [clinicId, EXPORT_MAX_ROWS + 50],
    );
    await h.db.owner.query('ALTER TABLE audit_log ENABLE TRIGGER USER');
    const res = await exportCsv();
    expect(res.status).toBe(200);
    expect(res.headers['x-export-truncated']).toBe('true');
    expect(Number(res.headers['x-exported-rows'])).toBe(EXPORT_MAX_ROWS);
    expect((res.body as string).trim().split('\r\n').length).toBe(EXPORT_MAX_ROWS + 1);
    const row = (
      await h.db.owner.query(
        "SELECT meta FROM audit_log WHERE action = 'AUDIT_EXPORTED' ORDER BY seq DESC LIMIT 1",
      )
    ).rows[0];
    expect(row.meta).toMatchObject({ rowCount: EXPORT_MAX_ROWS, truncated: true });
  });
});

describe('CSV formula injection (the cells an attacker could influence)', () => {
  const evil = [
    '=HYPERLINK("http://evil.example","x")',
    '+1-555-0100',
    '-2+3',
    '@SUM(A1:A9)',
    "=cmd|' /C calc'!A0",
  ];

  async function plantAndExport() {
    // appendAudit stores whatever strings it is given in these id-like columns, so a hostile value in a past row
    // (for example a resource id taken from an odd request) must still be harmless in the file.
    for (const [i, value] of evil.entries()) {
      await withTransaction(h.appPool, (tx) =>
        appendAudit(tx, {
          action: 'LOGOUT',
          clinicId,
          actorRole: value,
          resourceType: value,
          resourceId: value,
          requestId: `${value}-${i}`,
        }),
      );
    }
    // a tab, a carriage return and a quote/comma combination
    await withTransaction(h.appPool, (tx) =>
      appendAudit(tx, {
        action: 'LOGOUT',
        clinicId,
        resourceId: '\t=2+2',
        resourceType: '\r=3+3',
        actorRole: 'x","=1+1',
      }),
    );
    return (await exportCsv({ action: 'LOGOUT' })).body as string;
  }

  /** Minimal RFC 4180 parser so the test reads cells the way a spreadsheet would. */
  function parse(csv: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < csv.length; i += 1) {
      const ch = csv[i] as string;
      if (quoted) {
        if (ch === '"' && csv[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else if (ch === '"') quoted = false;
        else cell += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') {
        row.push(cell);
        cell = '';
      } else if (ch === '\r' && csv[i + 1] === '\n') {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
        i += 1;
      } else cell += ch;
    }
    return rows;
  }

  it('no cell in the file starts with = + - @ TAB or CR, whatever was stored', async () => {
    const csv = await plantAndExport();
    const rows = parse(csv);
    expect(rows.length).toBeGreaterThan(evil.length);
    for (const row of rows.slice(1)) {
      expect(row.length).toBe(10); // a hostile value never adds or removes a column
      for (const cell of row) expect(/^[=+\-@\t\r]/.test(cell), JSON.stringify(cell)).toBe(false);
    }
  });

  it('hostile text is kept (visible to the reader) but defanged with a leading quote', async () => {
    const rows = parse(await plantAndExport());
    const cells = rows.slice(1).flat();
    for (const value of evil) expect(cells).toContain(`'${value}`);
    expect(cells).toContain("'\t=2+2");
    expect(cells).toContain("'\r=3+3");
  });

  it('a quote-and-comma payload stays inside its single cell', async () => {
    const rows = parse(await plantAndExport());
    const cell = rows
      .slice(1)
      .flat()
      .find((c) => c.includes('=1+1'));
    expect(cell).toBe('x","=1+1');
    for (const row of rows.slice(1)) expect(row.length).toBe(10);
  });

  it('normal values are untouched: ids, timestamps and action names are not prefixed', async () => {
    const rows = parse((await exportCsv()).body as string);
    const first = rows[1] as string[];
    expect(first[1]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(first[2]).toMatch(/^[A-Z_]+$/);
    expect(first.some((c) => c.startsWith("'"))).toBe(false);
  });
});
