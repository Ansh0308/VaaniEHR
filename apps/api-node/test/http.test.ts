// API conventions: envelopes, request id, /health, /ready, 404, malformed JSON, validation, public config.
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { validate } from '../src/http/validate.js';
import { ok } from '../src/http/respond.js';
import { buildTestApp } from './helpers.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('API conventions', () => {
  it('GET /health returns the success envelope and a request id', async () => {
    const { app } = buildTestApp();
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { status: 'ok', service: 'api-node' } });
    expect(res.headers['x-request-id']).toMatch(UUID);
  });

  it('reuses a well-formed inbound X-Request-Id and replaces a malformed one', async () => {
    const { app } = buildTestApp();
    const good = await request(app).get('/health').set('X-Request-Id', 'client-req-12345');
    expect(good.headers['x-request-id']).toBe('client-req-12345');
    const bad = await request(app)
      .get('/health')
      .set('X-Request-Id', 'bad id with spaces <script>');
    expect(bad.headers['x-request-id']).toMatch(UUID);
  });

  it('GET /ready is 200 when the database check passes', async () => {
    const { app } = buildTestApp({ checkDb: () => Promise.resolve() });
    const res = await request(app).get('/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: { status: 'ready', checks: { database: 'up' } },
    });
  });

  it('GET /ready is 503 with the error envelope when the database check fails', async () => {
    const { app } = buildTestApp({
      checkDb: () => Promise.reject(new Error('connection refused')),
    });
    const res = await request(app).get('/ready');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      success: false,
      error: { code: 'NOT_READY', message: 'Database is not reachable' },
    });
    expect(JSON.stringify(res.body)).not.toContain('connection refused');
  });

  it('unknown routes return a 404 error envelope', async () => {
    const { app } = buildTestApp();
    const res = await request(app).get('/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Route not found' },
    });
  });

  it('malformed JSON returns 400 BAD_REQUEST, not a stack trace', async () => {
    const { app } = buildTestApp({
      extend: (a) => a.post('/echo', (req, res) => ok(res, req.body)),
    });
    const res = await request(app)
      .post('/echo')
      .set('Content-Type', 'application/json')
      .send('{"a":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.(js|ts)/);
  });

  it('zod validation failures return 400 VALIDATION_ERROR with a readable message', async () => {
    const schema = z.object({ name: z.string().min(2) });
    const { app } = buildTestApp({
      extend: (a) =>
        a.post('/things', validate({ body: schema }), (_req, res) =>
          ok(res, { created: true }, 201),
        ),
    });
    const bad = await request(app).post('/things').send({ name: 'x' });
    expect(bad.status).toBe(400);
    expect(bad.body.success).toBe(false);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
    expect(bad.body.error.message).toContain('body.name');
    const good = await request(app).post('/things').send({ name: 'ok' });
    expect(good.status).toBe(201);
  });

  it('unexpected errors return a generic 500 envelope without internals', async () => {
    const { app } = buildTestApp({
      extend: (a) =>
        a.get('/boom', () => {
          throw new Error('secret internal detail');
        }),
    });
    const res = await request(app).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      success: false,
      error: { code: 'INTERNAL', message: 'Internal server error' },
    });
  });

  it('GET /config/public exposes only the simulated-data flag and provider name', async () => {
    const { app } = buildTestApp();
    const res = await request(app).get('/config/public');
    expect(res.body).toEqual({
      success: true,
      data: { simulatedDataOnly: true, authProvider: 'dev' },
    });
  });

  it('sets security headers and hides x-powered-by', async () => {
    const { app } = buildTestApp();
    const res = await request(app).get('/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});
