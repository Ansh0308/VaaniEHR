// AsrClient with a fake socket, a fake microphone and a fake token source: no browser, no network.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AsrClient,
  type AsrErrorKind,
  type AsrState,
  type Capture,
  type SocketLike,
  type WireSegment,
} from './AsrClient';

class FakeSocket implements SocketLike {
  readyState = 1;
  sent: Array<string | ArrayBuffer> = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(private readonly autoReady: boolean) {
    queueMicrotask(() => this.onopen?.());
  }
  send(data: string | ArrayBuffer) {
    this.sent.push(data);
    if (this.autoReady && typeof data === 'string' && JSON.parse(data).type === 'start') {
      queueMicrotask(() => this.server({ type: 'ready', engine: 'mock', sampleRate: 16000 }));
    }
  }
  close() {
    this.closed = true;
  }
  server(message: object) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  drop(code: number) {
    this.onclose?.({ code });
  }
  texts() {
    return this.sent.filter((s): s is string => typeof s === 'string').map((s) => JSON.parse(s));
  }
  frames() {
    return this.sent.filter((s) => typeof s !== 'string') as ArrayBuffer[];
  }
}

class FakeCapture implements Capture {
  stopped = 0;
  flushed = 0;
  started = false;
  emit: ((frame: ArrayBuffer) => void) | null = null;
  start(onFrame: (frame: ArrayBuffer) => void) {
    this.started = true;
    this.emit = onFrame;
  }
  async flush() {
    this.flushed += 1;
  }
  stop() {
    this.stopped += 1;
  }
}

const frame = (n: number) => new Uint8Array([n]).buffer;
const tick = () => new Promise((r) => setTimeout(r, 0));

function setup(options: { autoReady?: boolean; micError?: string; tokenFails?: boolean } = {}) {
  const sockets: FakeSocket[] = [];
  const capture = new FakeCapture();
  let tokens = 0;
  const states: AsrState[] = [];
  const errors: AsrErrorKind[] = [];
  const segments: WireSegment[] = [];
  let onEnded: () => void = () => undefined;
  const client = new AsrClient(
    {
      getToken: async () => {
        if (options.tokenFails) throw new Error('no');
        tokens += 1;
        return `token-${tokens}`;
      },
      openSocket: () => {
        const socket = new FakeSocket(options.autoReady ?? true);
        sockets.push(socket);
        return socket;
      },
      createCapture: async (ended) => {
        onEnded = ended;
        if (options.micError) throw Object.assign(new Error('mic'), { name: options.micError });
        return capture;
      },
      setTimer: () => 0,
      clearTimer: () => undefined,
    },
    {
      onState: (s) => states.push(s),
      onSegment: (s) => segments.push(s),
      onError: (k) => errors.push(k),
    },
  );
  return { client, sockets, capture, states, errors, segments, ended: () => onEnded() };
}

describe('AsrClient', () => {
  it('sends the token as the FIRST message, then streams frames only after the server says ready', async () => {
    const t = setup();
    await t.client.start('gu-IN');
    const socket = t.sockets[0] as FakeSocket;
    expect(socket.texts()[0]).toEqual({ type: 'start', token: 'token-1', language: 'gu-IN' });
    expect(socket.sent[0]).toBe(JSON.stringify(socket.texts()[0]));
    expect(t.states).toEqual(['connecting', 'recording']);
    t.capture.emit?.(frame(1));
    expect(socket.frames()).toHaveLength(1);
    socket.server({ type: 'partial', segment: { kind: 'partial', text: 'na' } });
    socket.server({ type: 'final', segment: { kind: 'final', text: 'namaste' } });
    expect(t.segments.map((s) => s.text)).toEqual(['na', 'namaste']);
  });

  it('a refused microphone opens no connection and says why', async () => {
    const t = setup({ micError: 'NotAllowedError' });
    await t.client.start();
    expect(t.errors).toEqual(['mic_denied']);
    expect(t.sockets).toHaveLength(0);
    const other = setup({ micError: 'NotFoundError' });
    await other.client.start();
    expect(other.errors).toEqual(['mic_unavailable']);
  });

  it('a token that cannot be fetched stops the microphone and shows an error', async () => {
    const t = setup({ tokenFails: true });
    await t.client.start();
    expect(t.errors).toEqual(['token']);
    expect(t.capture.stopped).toBeGreaterThan(0);
  });

  it('consent withdrawn (4403) stops the microphone and drops later frames at once, with no reconnect', async () => {
    const t = setup();
    await t.client.start();
    const socket = t.sockets[0] as FakeSocket;
    socket.server({ type: 'error', code: 'consent_withdrawn' });
    socket.drop(4403);
    expect(t.errors).toEqual(['consent_withdrawn']);
    expect(t.capture.stopped).toBeGreaterThan(0);
    expect(t.sockets).toHaveLength(1);
    t.capture.emit?.(frame(9));
    expect(socket.frames()).toHaveLength(0);
    expect(t.client.current).toBe('error');
  });

  it('reconnects ONCE with a fresh token, sends the frames buffered meanwhile, then gives up', async () => {
    const t = setup();
    await t.client.start();
    const first = t.sockets[0] as FakeSocket;
    t.capture.emit?.(frame(1));
    first.drop(1006);
    t.capture.emit?.(frame(2)); // captured while reconnecting
    t.capture.emit?.(frame(3));
    await tick();
    const second = t.sockets[1] as FakeSocket;
    expect(second.texts()[0]).toMatchObject({ type: 'start', token: 'token-2' });
    expect(second.frames().map((f) => new Uint8Array(f)[0])).toEqual([2, 3]);
    expect(t.client.current).toBe('recording');
    second.drop(1006);
    await tick();
    expect(t.errors).toEqual(['connection_lost']);
    expect(t.sockets).toHaveLength(2);
    expect(t.capture.stopped).toBeGreaterThan(0);
  });

  it('an expired or used token is repaired once; any other token refusal is final', async () => {
    const a = setup({ autoReady: false });
    const pending = a.client.start();
    await tick();
    a.sockets[0]?.server({ type: 'error', code: 'expired' });
    a.sockets[0]?.drop(4401);
    await tick();
    a.sockets[1]?.server({ type: 'ready' });
    await pending;
    await tick();
    expect(a.sockets[1]?.texts()[0]).toMatchObject({ token: 'token-2' });

    const b = setup({ autoReady: false });
    const pendingB = b.client.start();
    await tick();
    b.sockets[0]?.server({ type: 'error', code: 'wrong_session' });
    b.sockets[0]?.drop(4401);
    await pendingB;
    expect(b.errors).toEqual(['token']);
    expect(b.sockets).toHaveLength(1);
  });

  it.each([
    [4429, 'spend_cap'],
    [4408, 'idle_timeout'],
    [4503, 'not_configured'],
    [1011, 'engine'],
    [1009, 'protocol'],
  ] as const)('close code %i is shown as %s and is not retried', async (code, kind) => {
    const t = setup();
    await t.client.start();
    t.sockets[0]?.drop(code);
    await tick();
    expect(t.errors).toEqual([kind]);
    expect(t.sockets).toHaveLength(1);
  });

  it('stop flushes the last frame, releases the microphone, asks the server to finish and waits for it', async () => {
    const t = setup();
    await t.client.start();
    const socket = t.sockets[0] as FakeSocket;
    await t.client.stop();
    expect(t.capture.flushed).toBe(1);
    expect(t.capture.stopped).toBeGreaterThan(0);
    expect(socket.texts().at(-1)).toEqual({ type: 'stop' });
    expect(t.client.current).toBe('processing');
    socket.server({ type: 'final', segment: { kind: 'final', text: 'last words' } });
    socket.server({ type: 'closed', audioSeconds: 3 });
    expect(t.segments.at(-1)?.text).toBe('last words');
    expect(t.client.current).toBe('idle');
  });

  it('the microphone being unplugged stops everything', async () => {
    const t = setup();
    await t.client.start();
    t.ended();
    expect(t.errors).toEqual(['mic_lost']);
    expect(t.sockets[0]?.closed).toBe(true);
  });

  it('dispose (the page closing) releases the microphone without raising an error', async () => {
    const t = setup();
    await t.client.start();
    t.client.dispose();
    expect(t.capture.stopped).toBeGreaterThan(0);
    expect(t.errors).toEqual([]);
  });
});

describe('what is never written', () => {
  const spies: Array<ReturnType<typeof vi.spyOn>> = [];
  beforeEach(() => {
    spies.push(
      vi.spyOn(Storage.prototype, 'setItem'),
      vi.spyOn(console, 'log'),
      vi.spyOn(console, 'info'),
      vi.spyOn(console, 'debug'),
      vi.spyOn(console, 'warn'),
      vi.spyOn(console, 'error'),
    );
  });
  afterEach(() => {
    spies.forEach((s) => s.mockRestore());
    spies.length = 0;
  });

  it('a whole session, a drop and a withdrawal write nothing to browser storage or the console', async () => {
    const idb = vi.fn();
    vi.stubGlobal('indexedDB', { open: idb });
    const t = setup();
    await t.client.start();
    t.capture.emit?.(frame(1));
    t.sockets[0]?.server({ type: 'final', segment: { kind: 'final', text: 'private words' } });
    t.sockets[0]?.drop(1006);
    await tick();
    t.sockets[1]?.drop(4403);
    await tick();
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expect(idb).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
