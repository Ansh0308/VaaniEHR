// GET /api/v1/sessions: "my sessions" for the signed-in doctor. Own sessions only, clinic-scoped, paged, no PHI beyond
// the patient's display name and consent flags the dashboard needs.
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bearer, createHarness, SEED_EMAIL, type Harness } from './db/helpers.js';

let h: Harness;
let doctor1: string;
let doctor2: string;
let staff: string;
let admin: string;

beforeEach(async () => {
  h = await createHarness();
  [doctor1, doctor2, staff, admin] = await Promise.all([
    h.tokenFor(SEED_EMAIL.doctor1),
    h.tokenFor(SEED_EMAIL.doctor2),
    h.tokenFor(SEED_EMAIL.staff),
    h.tokenFor(SEED_EMAIL.admin),
  ]);
});
afterEach(async () => {
  await h.close();
});

const mk = async (token: string, patientIndex: number) =>
  (
    await request(h.app)
      .post('/api/v1/sessions')
      .set(...bearer(token))
      .send({ patientId: h.seed.patients[patientIndex]?.id })
  ).body.data.id as string;
const list = (query = '', token = doctor1) =>
  request(h.app)
    .get(`/api/v1/sessions${query}`)
    .set(...bearer(token));

describe('GET /sessions (my sessions)', () => {
  it('is empty for a doctor with no sessions', async () => {
    const res = await list();
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ items: [], nextBefore: null });
  });

  it("shows only the signed-in doctor's own sessions, never another doctor's", async () => {
    const mine1 = await mk(doctor1, 0);
    const mine2 = await mk(doctor1, 1);
    const theirs = await mk(doctor2, 2);
    const ids1 = (await list()).body.data.items.map((i: { id: string }) => i.id);
    expect(ids1.sort()).toEqual([mine1, mine2].sort());
    const ids2 = (await list('', doctor2)).body.data.items.map((i: { id: string }) => i.id);
    expect(ids2).toEqual([theirs]);
  });

  it('lists newest first and includes patient name, status and a consent summary', async () => {
    const first = await mk(doctor1, 0);
    const second = await mk(doctor1, 1);
    await request(h.app)
      .post(`/api/v1/sessions/${second}/consent`)
      .set(...bearer(staff))
      .send({
        scopes: ['audio', 'ai_processing'],
        noticeVersion: '0.1',
        noticeLanguage: 'en',
        source: 'staff',
      });
    const items = (await list()).body.data.items;
    expect(items.map((i: { id: string }) => i.id)).toEqual([second, first]);
    expect(items[0]).toMatchObject({
      status: 'created',
      patientName: h.seed.patients[1]?.name,
      consent: { audio: true, aiProcessing: true, whatsapp: false, recordingAllowed: true },
    });
    expect(items[1].consent).toEqual({
      audio: false,
      aiProcessing: false,
      whatsapp: false,
      recordingAllowed: false,
    });
  });

  it('a withdrawal shows up in the summary straight away', async () => {
    const id = await mk(doctor1, 0);
    const body = { noticeVersion: '0.1', noticeLanguage: 'en', source: 'staff' };
    await request(h.app)
      .post(`/api/v1/sessions/${id}/consent`)
      .set(...bearer(staff))
      .send({ ...body, scopes: ['audio', 'ai_processing'] });
    await request(h.app)
      .post(`/api/v1/sessions/${id}/consent/withdraw`)
      .set(...bearer(staff))
      .send({ scopes: ['audio'], source: 'patient' });
    expect((await list()).body.data.items[0].consent).toMatchObject({
      audio: false,
      aiProcessing: true,
      recordingAllowed: false,
    });
  });

  it('only the doctor role may call it: staff, admin, researcher and anonymous are refused', async () => {
    expect((await list('', staff)).status).toBe(403);
    expect((await list('', admin)).status).toBe(403);
    expect((await list('', await h.tokenFor(SEED_EMAIL.researcher))).status).toBe(403);
    expect((await request(h.app).get('/api/v1/sessions')).status).toBe(401);
  });

  it('filters by status and by open (not ended) sessions, which the dashboard calls drafts', async () => {
    const a = await mk(doctor1, 0);
    const b = await mk(doctor1, 1);
    await h.db.owner.query(
      "UPDATE consultation_session SET status = 'ended', ended_at = now() WHERE id = $1",
      [a],
    );
    expect((await list('?open=true')).body.data.items.map((i: { id: string }) => i.id)).toEqual([
      b,
    ]);
    expect((await list('?status=ended')).body.data.items.map((i: { id: string }) => i.id)).toEqual([
      a,
    ]);
    expect((await list('?open=false')).body.data.items).toHaveLength(2);
    expect((await list('?status=nonsense')).status).toBe(400);
    expect((await list('?open=maybe')).status).toBe(400);
  });

  it('pages with a cursor and caps the page size', async () => {
    for (let i = 0; i < 5; i += 1) await mk(doctor1, i);
    const page1 = (await list('?limit=2')).body.data;
    expect(page1.items).toHaveLength(2);
    expect(page1.nextBefore).toBeTruthy();
    const page2 = (await list(`?limit=2&before=${encodeURIComponent(page1.nextBefore)}`)).body.data;
    expect(page2.items.length).toBeGreaterThan(0);
    const seen = new Set([...page1.items, ...page2.items].map((i: { id: string }) => i.id));
    expect(seen.size).toBe(page1.items.length + page2.items.length); // no repeats
    expect((await list('?limit=0')).status).toBe(400);
    expect((await list('?limit=51')).status).toBe(400);
    expect((await list('?before=yesterday')).status).toBe(400);
  });

  it('never returns a session of another clinic even for the same doctor id', async () => {
    const id = await mk(doctor1, 0);
    await h.db.owner.query(
      'UPDATE consultation_session SET clinicos_clinic_id = $1 WHERE id = $2',
      ['5eed0000-0000-4000-8000-0000000000b2', id],
    );
    expect((await list()).body.data.items).toEqual([]);
  });

  it('does not expose the patient phone number or allergies', async () => {
    await mk(doctor1, 2);
    const text = JSON.stringify((await list()).body);
    expect(text).not.toMatch(/(?<!\d)0000000003(?!\d)/);
    expect(text).not.toContain('Drug-B');
    expect(text).not.toContain('allergies');
  });
});
