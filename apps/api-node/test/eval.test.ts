// Evaluation benchmark run endpoints (PG-17, FR-F12-03, ADR-D43).
// Read-only; admin and researcher only; strictly path-traversal resistant.
import { Router } from 'express';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { evalRoutes } from '../src/eval/routes.js';
import { mountRoutes } from '../src/http/routeRegistry.js';
import type { Services } from '../src/services.js';
import { buildTestApp, testIdentity } from './helpers.js';

const claimsOf = (role: 'doctor' | 'staff' | 'admin' | 'researcher') => {
  const id = testIdentity(role);
  return { sub: id.id, role: id.role, clinicId: id.clinicId, devUser: true as const };
};

describe('Evaluation API (PG-17)', () => {
  const { app, dev } = buildTestApp({
    extend: (a, { dev: authDev, config }) => {
      const v1 = Router();
      const fakeServices = {
        config,
        auth: authDev,
        tokens: authDev,
      } as unknown as Services;
      mountRoutes(v1, evalRoutes(), fakeServices);
      a.use('/api/v1', v1);
    },
  });
  let adminToken: string;
  let researcherToken: string;
  let doctorToken: string;
  let staffToken: string;

  beforeAll(async () => {
    adminToken = (await dev.issueToken(claimsOf('admin'))).accessToken;
    researcherToken = (await dev.issueToken(claimsOf('researcher'))).accessToken;
    doctorToken = (await dev.issueToken(claimsOf('doctor'))).accessToken;
    staffToken = (await dev.issueToken(claimsOf('staff'))).accessToken;
  });

  it('anonymous requests are refused with 401', async () => {
    const res = await request(app).get('/api/v1/eval/runs');
    expect(res.status).toBe(401);
  });

  it('doctor and staff roles are refused with 403', async () => {
    const dRes = await request(app)
      .get('/api/v1/eval/runs')
      .set('Authorization', `Bearer ${doctorToken}`);
    expect(dRes.status).toBe(403);

    const sRes = await request(app)
      .get('/api/v1/eval/runs')
      .set('Authorization', `Bearer ${staffToken}`);
    expect(sRes.status).toBe(403);
  });

  it('admin and researcher can list evaluation runs', async () => {
    const adminRes = await request(app)
      .get('/api/v1/eval/runs')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(adminRes.status).toBe(200);
    expect(Array.isArray(adminRes.body.data)).toBe(true);

    const resRes = await request(app)
      .get('/api/v1/eval/runs')
      .set('Authorization', `Bearer ${researcherToken}`);
    expect(resRes.status).toBe(200);
    expect(Array.isArray(resRes.body.data)).toBe(true);
  });

  it('rejects path traversal attempts with 400 validation error', async () => {
    const res = await request(app)
      .get('/api/v1/eval/runs/..%2F..%2Fetc')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
  });

  it('returns 404 for non-existent valid run ids', async () => {
    const res = await request(app)
      .get('/api/v1/eval/runs/19990101T000000')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });

  it('returns full run details for sample-results or existing run', async () => {
    const listRes = await request(app)
      .get('/api/v1/eval/runs')
      .set('Authorization', `Bearer ${researcherToken}`);
    expect(listRes.status).toBe(200);
    const runs = listRes.body.data;
    if (runs.length > 0) {
      const targetId = runs[0].id;
      const detailRes = await request(app)
        .get(`/api/v1/eval/runs/${targetId}`)
        .set('Authorization', `Bearer ${researcherToken}`);
      expect(detailRes.status).toBe(200);
      const data = detailRes.body.data;
      expect(data.id).toBe(targetId);
      expect(data.manifest).toBeDefined();
      expect(typeof data.summaryMd).toBe('string');
      expect(typeof data.tableTex).toBe('string');
      expect(typeof data.cellsCsv).toBe('string');
      expect(typeof data.errorsCsv).toBe('string');
    }
  });
});
