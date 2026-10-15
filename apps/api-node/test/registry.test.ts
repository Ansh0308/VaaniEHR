// The route registry and the permissions table: structural rules that must hold for every route, now and in future.
// A new POST/PATCH/PUT/DELETE route without an audit action, or a route missing from the PRD expectations below,
// fails here (the full role x endpoint matrix runs against the database in test/rbac.db.test.ts).
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { AUDIT_ACTIONS } from '../src/audit/audit.js';
import { PERMISSIONS, roleHasPermission } from '../src/auth/permissions.js';
import { ROLES, type Role } from '../src/auth/types.js';
import { isMutating, mountRoutes, type RouteDef } from '../src/http/routeRegistry.js';
import { ok } from '../src/http/respond.js';
import { Router } from 'express';
import { allRoutes } from '../src/routes/index.js';
import type { Services } from '../src/services.js';
import { buildTestApp, testConfig, testIdentity } from './helpers.js';
import { PRD_EXPECTED } from './prdExpectations.js';
import { createApp } from '../src/app.js';
import type { AuthContext } from '../src/auth/types.js';

const config = testConfig();
const routes = allRoutes(config);
const key = (r: Pick<RouteDef, 'method' | 'path'>) => `${r.method.toUpperCase()} ${r.path}`;

describe('route registry structure', () => {
  it('has no duplicate method+path', () => {
    const keys = routes.map(key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every mutating route declares at least one audit action, and only known actions', () => {
    for (const route of routes) {
      if (isMutating(route.method)) {
        expect(route.audit.length, `${key(route)} has no audit action`).toBeGreaterThan(0);
      }
      for (const action of route.audit) expect(AUDIT_ACTIONS).toContain(action);
    }
  });

  it('GET routes never claim audit actions (the wrapper would refuse to write them)', () => {
    for (const route of routes.filter((r) => !isMutating(r.method))) {
      expect(route.audit, key(route)).toEqual([]);
    }
  });

  it('every route has a summary and a tag (they feed OpenAPI)', () => {
    for (const route of routes) {
      expect(route.summary.length, key(route)).toBeGreaterThan(10);
      expect(route.tag.length, key(route)).toBeGreaterThan(0);
    }
  });

  it('the registry and the hand-written PRD expectations list exactly the same routes', () => {
    expect(routes.map(key).sort()).toEqual(Object.keys(PRD_EXPECTED).sort());
  });

  it("each route's access rule equals the PRD expectation", () => {
    for (const route of routes) {
      const expected = PRD_EXPECTED[key(route)];
      if (expected === 'public' || expected === 'authenticated') {
        expect(route.access.kind, key(route)).toBe(expected);
      } else {
        expect(route.access.kind, key(route)).toBe('permission');
        const allowed = ROLES.filter(
          (role) =>
            route.access.kind === 'permission' && roleHasPermission(role, route.access.permission),
        );
        expect([...allowed].sort(), key(route)).toEqual([...(expected ?? [])].sort());
      }
    }
  });
});

describe('permissions table', () => {
  it('only mentions known roles', () => {
    for (const roles of Object.values(PERMISSIONS)) {
      for (const role of roles) expect(ROLES).toContain(role);
    }
  });

  it('patient has no permission at all (the role exists but is unused)', () => {
    for (const permission of Object.keys(PERMISSIONS)) {
      expect(roleHasPermission('patient', permission as keyof typeof PERMISSIONS)).toBe(false);
    }
  });

  it('researcher can only read the audit log (PRD 2.2) and nothing that touches a patient', () => {
    const granted = Object.keys(PERMISSIONS).filter((p) =>
      roleHasPermission('researcher', p as keyof typeof PERMISSIONS),
    );
    expect(granted).toEqual(['audit.read']);
  });

  it('only a doctor may open a session (PRD 2.2: record consultation)', () => {
    expect(PERMISSIONS['session.create']).toEqual(['doctor']);
  });

  it('only an admin may verify the audit chain', () => {
    expect(PERMISSIONS['audit.verify']).toEqual(['admin']);
  });

  it('every permission is used by at least one route (no dead entries)', () => {
    const used = new Set(
      routes.flatMap((r) => (r.access.kind === 'permission' ? [r.access.permission] : [])),
    );
    expect([...used].sort()).toEqual(Object.keys(PERMISSIONS).sort());
  });
});

describe('only the registry mounts mutating routes', () => {
  it('the app has no stray POST/PUT/PATCH/DELETE route outside /api/v1', () => {
    const { app } = buildTestApp();
    const stack = (app as unknown as { router: { stack: Array<{ route?: { methods: object } }> } })
      .router.stack;
    const stray = stack
      .filter((layer) => layer.route)
      .flatMap((layer) => Object.keys(layer.route?.methods ?? {}))
      .filter((method) => method !== 'get');
    expect(stray).toEqual([]);
  });
});

// ---- the wrapper's guarantees, with a fake database (no Postgres needed) ----

interface FakeCall {
  text: string;
}
function fakePool(calls: FakeCall[] = []) {
  const client = {
    query: async (text: string) => {
      calls.push({ text });
      return { rows: [], rowCount: 0 };
    },
    release: () => {},
  };
  return { connect: async () => client, query: client.query, calls };
}

const identity = (role: Role): AuthContext => ({
  sub: testIdentity(role).id,
  role,
  clinicId: testIdentity(role).clinicId,
  devUser: true,
});

function wrapperApp(defs: RouteDef[]) {
  const pool = fakePool();
  const { dev } = buildTestApp();
  const services = {
    config,
    pool,
    auth: dev,
    tokens: dev,
  } as unknown as Services;
  const v1 = Router();
  mountRoutes(v1, defs, services);
  const app = createApp({
    config,
    authProvider: dev,
    checkDb: async () => {},
    extend: (a) => a.use('/t', v1),
  });
  return { app, dev, pool };
}

describe('mountRoutes guarantees', () => {
  const publicPost = (
    handler: RouteDef['handler'],
    audit: RouteDef['audit'] = ['LOGOUT'],
  ): RouteDef => ({
    method: 'post',
    path: '/x',
    tag: 'Test',
    summary: 'wrapper test route',
    access: { kind: 'public' },
    audit,
    successStatus: 200,
    pre: [],
    handler,
  });

  it('a mutating handler that succeeds WITHOUT writing an audit row becomes a 500 and rolls back', async () => {
    const { app, pool } = wrapperApp([publicPost(async () => ({ data: { fine: true } }))]);
    const res = await request(app).post('/t/x').send({});
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL');
    expect(pool.calls.map((c) => c.text)).toContain('ROLLBACK');
    expect(pool.calls.map((c) => c.text)).not.toContain('COMMIT');
  });

  it('a mutating handler that writes a declared audit row commits', async () => {
    const { app, pool } = wrapperApp([
      publicPost(async (ctx) => {
        await ctx.audit({ action: 'LOGOUT' });
        return { data: { fine: true } };
      }),
    ]);
    const res = await request(app).post('/t/x').send({});
    expect(res.status).toBe(200);
    expect(pool.calls.map((c) => c.text)).toContain('COMMIT');
    expect(pool.calls.some((c) => c.text.includes('INSERT INTO audit_log'))).toBe(true);
  });

  it('writing an audit action the route did not declare is refused (500, rolled back)', async () => {
    const { app, pool } = wrapperApp([
      publicPost(async (ctx) => {
        await ctx.audit({ action: 'PATIENT_CREATED' });
        return { data: {} };
      }),
    ]);
    const res = await request(app).post('/t/x').send({});
    expect(res.status).toBe(500);
    expect(pool.calls.map((c) => c.text)).toContain('ROLLBACK');
  });

  it('a handler error rolls back and is mapped by the central error handler', async () => {
    const { app, pool } = wrapperApp([
      publicPost(async (ctx) => {
        await ctx.audit({ action: 'LOGOUT' });
        throw new Error('boom');
      }),
    ]);
    const res = await request(app).post('/t/x').send({});
    expect(res.status).toBe(500);
    expect(res.body.error.message).toBe('Internal server error');
    expect(pool.calls.map((c) => c.text)).toContain('ROLLBACK');
    expect(pool.calls.map((c) => c.text)).not.toContain('COMMIT');
  });

  it('GET routes run without a transaction and cannot write audit rows', async () => {
    const getRoute: RouteDef = {
      ...publicPost(async (ctx) => {
        await ctx.audit({ action: 'LOGOUT' });
        return { data: {} };
      }),
      method: 'get',
      audit: [],
    };
    const { app, pool } = wrapperApp([getRoute]);
    const res = await request(app).get('/t/x');
    expect(res.status).toBe(500);
    expect(pool.calls.map((c) => c.text)).not.toContain('BEGIN');
  });

  it('authentication runs before permission, and permission before validation', async () => {
    const route: RouteDef = {
      ...publicPost(async (ctx) => {
        await ctx.audit({ action: 'LOGOUT' });
        return { data: {} };
      }),
      access: { kind: 'permission', permission: 'audit.verify' },
      body: (await import('zod')).z.object({ n: (await import('zod')).z.number() }),
    };
    const { app, dev } = wrapperApp([route]);
    // no token -> 401 even though the body is invalid
    expect((await request(app).post('/t/x').send({ n: 'bad' })).status).toBe(401);
    // wrong role -> 403 even though the body is invalid (a 400 would leak the schema to a forbidden caller)
    const doctor = (await dev.issueToken(identity('doctor'))).accessToken;
    expect(
      (await request(app).post('/t/x').set('Authorization', `Bearer ${doctor}`).send({ n: 'bad' }))
        .status,
    ).toBe(403);
    // right role + bad body -> 400
    const admin = (await dev.issueToken(identity('admin'))).accessToken;
    const bad = await request(app)
      .post('/t/x')
      .set('Authorization', `Bearer ${admin}`)
      .send({ n: 'bad' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
    // right role + good body -> 200
    const good = await request(app)
      .post('/t/x')
      .set('Authorization', `Bearer ${admin}`)
      .send({ n: 1 });
    expect(good.status).toBe(200);
  });

  it('a route without any audit action cannot even be defined as mutating', async () => {
    const { permRoute } = await import('../src/http/routeRegistry.js');
    expect(() =>
      permRoute('audit.verify', {
        method: 'post',
        path: '/never',
        tag: 'Test',
        summary: 'no audit declared',
        audit: [],
        handler: async () => ({ data: ok }),
      }),
    ).toThrow(/must declare audit actions/);
  });
});
