// ADR-D10: sockets authenticate at the handshake; rooms are server-derived, never client-chosen.
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { VAANI_NAMESPACE } from '../src/realtime/socket.js';
import { startTestServer, TEST_CLINIC_ID, testIdentity, type RunningServer } from './helpers.js';

const OTHER_CLINIC_ID = 'c0ffee00-0000-4000-8000-0000000000c2';
const OTHER_USER_ID = 'b0b00000-0000-4000-8000-000000000099';

let server: RunningServer;
const open: Socket[] = [];

function client(auth?: Record<string, unknown>, namespace = VAANI_NAMESPACE): Socket {
  const socket = connect(`${server.url}${namespace}`, {
    auth,
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
  });
  open.push(socket);
  return socket;
}

const connected = (s: Socket) =>
  new Promise<'connected' | string>((resolve) => {
    s.on('connect', () => resolve('connected'));
    s.on('connect_error', (e) => resolve(e.message));
  });

const emitAck = <T>(s: Socket, event: string, payload?: unknown) =>
  new Promise<T>((resolve) => {
    if (payload === undefined) s.emit(event, (r: T) => resolve(r));
    else s.emit(event, payload, (r: T) => resolve(r));
  });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function tokenFor(role: 'doctor' | 'staff' | 'admin') {
  const user = testIdentity(role);
  const { accessToken } = await server.dev.issueToken({
    sub: user.id,
    role: user.role,
    clinicId: user.clinicId,
    devUser: true,
  });
  return accessToken;
}

beforeAll(async () => {
  server = await startTestServer();
});
afterEach(() => {
  while (open.length) open.pop()?.close();
});
afterAll(async () => {
  await server.close();
});

describe('/vaani namespace handshake', () => {
  it('rejects a connection with no token', async () => {
    expect(await connected(client())).toBe('UNAUTHENTICATED');
  });

  it('rejects a connection with an empty or non-string token', async () => {
    expect(await connected(client({ token: '' }))).toBe('UNAUTHENTICATED');
    expect(await connected(client({ token: 12345 }))).toBe('UNAUTHENTICATED');
  });

  it('rejects a bad token', async () => {
    expect(await connected(client({ token: 'not.a.valid.jwt' }))).toBe('UNAUTHENTICATED');
  });

  it('rejects an expired token', async () => {
    const user = testIdentity('doctor');
    const { accessToken } = await server.dev.issueToken(
      { sub: user.id, role: user.role, clinicId: user.clinicId, devUser: true },
      -30,
    );
    expect(await connected(client({ token: accessToken }))).toBe('UNAUTHENTICATED');
  });

  it('accepts a valid token and reports the verified identity', async () => {
    const socket = client({ token: await tokenFor('doctor') });
    expect(await connected(socket)).toBe('connected');
    const me = await emitAck<{ ok: boolean; auth: { role: string; clinicId: string } }>(
      socket,
      'whoami',
    );
    expect(me.ok).toBe(true);
    expect(me.auth).toMatchObject({ role: 'doctor', clinicId: TEST_CLINIC_ID });
  });

  it('the default namespace "/" is closed even with a valid token', async () => {
    const socket = client({ token: await tokenFor('doctor') }, '/');
    expect(await connected(socket)).toBe('UNAUTHENTICATED');
  });
});

describe('rooms are server-derived', () => {
  it('delivers a clinic broadcast to clients of that clinic only', async () => {
    const a = client({ token: await tokenFor('doctor') });
    const otherToken = (
      await server.dev.issueToken({
        sub: OTHER_USER_ID,
        role: 'doctor',
        clinicId: OTHER_CLINIC_ID,
        devUser: true,
      })
    ).accessToken;
    const b = client({ token: otherToken });
    expect(await connected(a)).toBe('connected');
    expect(await connected(b)).toBe('connected');

    const gotA: unknown[] = [];
    const gotB: unknown[] = [];
    a.on('test:event', (p) => gotA.push(p));
    b.on('test:event', (p) => gotB.push(p));

    server.realtime.emitToClinic(TEST_CLINIC_ID, 'test:event', { n: 1 });
    await sleep(300);
    expect(gotA).toEqual([{ n: 1 }]);
    expect(gotB).toEqual([]);
  });

  it("a client cannot join another clinic's room by asking", async () => {
    const a = client({ token: await tokenFor('doctor') });
    expect(await connected(a)).toBe('connected');
    const received: unknown[] = [];
    a.on('other:clinic', (p) => received.push(p));

    const answer = await emitAck<{ ok: boolean; error?: { code: string } }>(a, 'join', {
      clinicId: OTHER_CLINIC_ID,
      room: `clinic:${OTHER_CLINIC_ID}`,
    });
    expect(answer).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });

    server.realtime.emitToClinic(OTHER_CLINIC_ID, 'other:clinic', { secret: 'fake' });
    await sleep(300);
    expect(received).toEqual([]);
  });

  it('ignores client-supplied clinic ids in the handshake auth payload', async () => {
    const a = client({ token: await tokenFor('doctor'), clinicId: OTHER_CLINIC_ID });
    expect(await connected(a)).toBe('connected');
    const me = await emitAck<{ auth: { clinicId: string } }>(a, 'whoami');
    expect(me.auth.clinicId).toBe(TEST_CLINIC_ID);
    const received: unknown[] = [];
    a.on('other:clinic', (p) => received.push(p));
    server.realtime.emitToClinic(OTHER_CLINIC_ID, 'other:clinic', { secret: 'fake' });
    await sleep(300);
    expect(received).toEqual([]);
  });
});
