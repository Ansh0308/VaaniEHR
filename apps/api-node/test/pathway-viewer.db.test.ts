// The read-only pathway viewer API (PG-14, ADR-D35): doctors and admins read, nobody else, nobody writes. Toy pathways and
// one temporary active pathway with a fake sign-off. Fake words only.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createHarness, SEED_EMAIL, TOY_PATHWAYS_ENV, type Harness } from './db/helpers.js';

let h: Harness;
let doctor: string;
let admin: string;
const get = (path: string, token: string) =>
  request(h.app)
    .get(`/api/v1${path}`)
    .set(...bearer(token));

beforeAll(async () => {
  h = await createHarness();
  doctor = await h.tokenFor(SEED_EMAIL.doctor1);
  admin = await h.tokenFor(SEED_EMAIL.admin);
});
afterAll(async () => {
  await h.close();
});

describe('who may read', () => {
  it('doctors and admins read; staff and researchers are refused; no token is refused; nothing can be written', async () => {
    for (const token of [doctor, admin]) {
      expect((await get('/pathways', token)).status).toBe(200);
      expect((await get('/pathways/toy_condition_a', token)).status).toBe(200);
    }
    for (const email of [SEED_EMAIL.staff, SEED_EMAIL.researcher]) {
      const token = await h.tokenFor(email);
      expect((await get('/pathways', token)).status).toBe(403);
      expect((await get('/pathways/toy_condition_a', token)).status).toBe(403);
    }
    expect((await request(h.app).get('/api/v1/pathways')).status).toBe(401);
    for (const method of ['post', 'put', 'patch', 'delete'] as const) {
      const res = await request(h.app)
        [method]('/api/v1/pathways/toy_condition_a')
        .set(...bearer(admin))
        .send({});
      expect(res.status).toBe(404);
    }
  });
});

describe('the toy pathways', () => {
  it('lists every loaded pathway as not active and not signed off', async () => {
    const d = (await get('/pathways', doctor)).body.data;
    expect(d.testPathwaysAllowed).toBe(true);
    expect(d.pathways.map((p: { id: string }) => p.id)).toEqual([
      'toy_condition_a',
      'toy_condition_b',
      'toy_condition_c',
    ]);
    for (const p of d.pathways) {
      expect(p).toMatchObject({
        status: 'test',
        notActive: true,
        signedOff: false,
        latestVersion: 1,
      });
      expect(p.title.gu).toMatch(/^\[TOY-GU\]/);
    }
  });
  it('shows every node with text in en, gu and hi, its edges, rules and (absent) source trail', async () => {
    const d = (await get('/pathways/toy_condition_b', admin)).body.data;
    expect(d).toMatchObject({
      id: 'toy_condition_b',
      version: 1,
      notActive: true,
      reviewedBy: null,
    });
    const q2 = d.nodes.find((n: { id: string }) => n.id === 'q2');
    expect(q2.ask).toEqual({
      en: expect.any(String),
      gu: expect.stringMatching(/^\[TOY-GU\]/),
      hi: expect.stringMatching(/^\[TOY-HI\]/),
    });
    expect(q2.choices).toEqual(['x', 'y', 'z']);
    expect(q2.edges.map((e: { to: string }) => e.to)).toEqual(['q3', 't1']);
    expect(q2.sourceQuote).toBeNull();
    const q3 = d.nodes.find((n: { id: string }) => n.id === 'q3');
    expect(q3.redFlagIf).toEqual({ op: 'eq', value: true });
    expect(d.nodes.find((n: { type: string }) => n.type === 'terminal').refer).toBe(false);
    expect(d.rules.length).toBe(2);
  });
  it('unknown pathway, unknown version and a bad id are refused', async () => {
    expect((await get('/pathways/nope', doctor)).status).toBe(404);
    expect((await get('/pathways/toy_condition_a?version=7', doctor)).status).toBe(404);
    expect((await get('/pathways/Bad-Id', doctor)).status).toBe(400);
    expect((await get('/pathways/toy_condition_a?version=0', doctor)).status).toBe(400);
  });
  it('the response never carries diagnosis wording', async () => {
    const text = JSON.stringify((await get('/pathways/toy_condition_a', doctor)).body);
    expect(text).not.toMatch(/diagnos|confirmed|prescrib|treatment/i);
  });
});

describe('an active pathway with a version history', () => {
  it('shows the source trail, the sign-off and every version newest first', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'viewer-'));
    try {
      const toyDir = TOY_PATHWAYS_ENV.PATHWAYS_DIR;
      const base = JSON.parse(
        readFileSync(join(toyDir, '_toy', 'toy_condition_a.pathway.json'), 'utf8'),
      );
      base.status = 'active';
      base.source = {
        doc: 'TOY - not a real source',
        page: 3,
        reviewed_by: 'Dr Fake Reviewer',
        reviewed_on: '2026-10-01',
      };
      for (const n of base.nodes) {
        n.source_quote = `TOY sentence for ${n.id}`;
        n.page = 3;
      }
      writeFileSync(join(dir, 'a1.pathway.json'), JSON.stringify(base));
      writeFileSync(
        join(dir, 'a2.pathway.json'),
        JSON.stringify({ ...base, version: 2, title: { ...base.title, en: 'Toy condition A v2' } }),
      );
      const harness = await createHarness({
        PATHWAYS_DIR: dir,
        PATHWAYS_ALLOW_TEST: 'false',
        PATHWAYS_SLOT_MAP: undefined,
      });
      try {
        const token = await harness.tokenFor(SEED_EMAIL.doctor1);
        const call = (path: string) =>
          request(harness.app)
            .get(`/api/v1${path}`)
            .set(...bearer(token));
        const list = (await call('/pathways')).body.data;
        expect(list.testPathwaysAllowed).toBe(false);
        expect(list.pathways).toHaveLength(1);
        expect(list.pathways[0]).toMatchObject({
          latestVersion: 2,
          status: 'active',
          notActive: false,
          signedOff: true,
        });
        expect(list.pathways[0].versions.map((v: { version: number }) => v.version)).toEqual([
          2, 1,
        ]);
        const latest = (await call('/pathways/toy_condition_a')).body.data;
        expect(latest).toMatchObject({
          version: 2,
          reviewedBy: 'Dr Fake Reviewer',
          reviewedOn: '2026-10-01',
        });
        expect(latest.title.en).toBe('Toy condition A v2');
        expect(latest.nodes[0]).toMatchObject({ sourceQuote: 'TOY sentence for q1', page: 3 });
        const old = (await call('/pathways/toy_condition_a?version=1')).body.data;
        expect(old.title.en).toBe('Toy condition A');
      } finally {
        await harness.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
