// The browser side of the audio stream (ADR-D25, ADR-D27). A plain controller with injected parts (microphone capture,
// WebSocket, token source), so it is tested with fakes and no browser.
//
// Rules this file keeps:
//  - the consent token is the FIRST message on the socket, never part of the URL;
//  - audio frames and transcript text stay in memory only: nothing goes to localStorage, sessionStorage, IndexedDB
//    or the console;
//  - one automatic reconnect with a fresh token, then a clear error; frames captured meanwhile are buffered (about
//    10 s at most) and sent after the reconnect, or dropped;
//  - consent withdrawn (close 4403) stops the microphone and clears the buffer at once.

export type AsrState = 'idle' | 'connecting' | 'recording' | 'processing' | 'error';
export type AsrErrorKind =
  | 'mic_denied'
  | 'mic_unavailable'
  | 'mic_lost'
  | 'consent_withdrawn'
  | 'spend_cap'
  | 'idle_timeout'
  | 'token'
  | 'not_configured'
  | 'engine'
  | 'protocol'
  | 'connection_lost';

export interface WireSegment {
  kind: 'partial' | 'final';
  startMs: number;
  endMs: number;
  text: string;
  language: string | null;
  speaker: string | null;
  confidence: number | null;
  engine: string;
  engineVersion: string;
}

export interface Capture {
  /** Begins delivering ~250 ms PCM16 frames. */
  start(onFrame: (frame: ArrayBuffer) => void): void;
  /** Delivers the partly filled last frame, then resolves. */
  flush(): Promise<void>;
  /** Releases the microphone (stops every track). Safe to call twice. */
  stop(): void;
}

export interface SocketLike {
  readyState: number;
  send(data: string | ArrayBuffer): void;
  close(code?: number): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number }) => void) | null;
  onerror: (() => void) | null;
}

export interface AsrDeps {
  getToken: () => Promise<string>;
  openSocket: () => SocketLike;
  /** Asks for the microphone; rejects with an Error whose `name` is the DOM exception name. */
  createCapture: (onEnded: () => void) => Promise<Capture>;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
}

export interface AsrHandlers {
  onState: (state: AsrState) => void;
  onSegment: (segment: WireSegment) => void;
  onError: (kind: AsrErrorKind) => void;
  /** true while a dropped connection is being re-established */
  onReconnecting?: (reconnecting: boolean) => void;
}

const OPEN = 1;
const MAX_BUFFERED_FRAMES = 40; // 40 x 250 ms = 10 s
const STOP_WAIT_MS = 30_000;
const READY_WAIT_MS = 10_000;

export class AsrClient {
  private state: AsrState = 'idle';
  private capture: Capture | null = null;
  private socket: SocketLike | null = null;
  private ready = false;
  private reconnects = 0;
  private reconnecting = false;
  private stopping = false;
  private buffer: ArrayBuffer[] = [];
  private lastError: string | null = null;
  private stopTimer: unknown = null;
  private language: string | null = null;

  constructor(
    private readonly deps: AsrDeps,
    private readonly handlers: AsrHandlers,
  ) {}

  get current(): AsrState {
    return this.state;
  }

  async start(language: string | null = 'gu-IN'): Promise<void> {
    if (this.state === 'connecting' || this.state === 'recording' || this.state === 'processing')
      return;
    this.language = language;
    this.reconnects = 0;
    this.stopping = false;
    this.buffer = [];
    this.setState('connecting');
    try {
      this.capture = await this.deps.createCapture(() => this.fail('mic_lost'));
    } catch (error) {
      const name = (error as { name?: string })?.name;
      this.fail(
        name === 'NotAllowedError' || name === 'SecurityError' ? 'mic_denied' : 'mic_unavailable',
      );
      return;
    }
    if ((this.state as AsrState) !== 'connecting') {
      this.capture.stop(); // stopped while the permission prompt was open
      return;
    }
    try {
      await this.connect();
    } catch (reason) {
      this.onConnectFailed(reason);
      return;
    }
    this.capture.start((frame) => this.onFrame(frame));
    this.setState('recording');
  }

  async stop(): Promise<void> {
    if (this.state !== 'recording' && this.state !== 'connecting') return;
    this.stopping = true;
    await this.capture?.flush();
    this.capture?.stop();
    this.capture = null;
    this.buffer = [];
    if (this.socket && this.socket.readyState === OPEN && this.ready) {
      this.socket.send(JSON.stringify({ type: 'stop' }));
      this.setState('processing');
      const set = this.deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
      this.stopTimer = set(() => this.finish(), STOP_WAIT_MS);
    } else {
      this.finish();
    }
  }

  /** Called when the page goes away. Releases everything without raising errors. */
  dispose(): void {
    this.stopping = true;
    this.releaseAll();
    this.state = 'idle';
  }

  // ------------------------------------------------------------------ connection
  private connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.ready = false;
      this.lastError = null;
      let settled = false;
      const set = this.deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
      const clear = this.deps.clearTimer ?? ((id: unknown) => clearTimeout(id as number));
      const timer = set(() => done(new Error('timeout')), READY_WAIT_MS);
      const done = (error?: unknown) => {
        if (settled) return;
        settled = true;
        clear(timer);
        if (error) reject(error);
        else resolve();
      };
      this.deps
        .getToken()
        .then((token) => {
          const socket = this.deps.openSocket();
          this.socket = socket;
          socket.onopen = () => {
            // the token is the first message; it is never put in the URL
            socket.send(JSON.stringify({ type: 'start', token, language: this.language }));
          };
          socket.onmessage = (event) => {
            const message = parseMessage(event.data);
            if (!message) return;
            if (message.type === 'ready') {
              this.ready = true;
              done();
            } else if (message.type === 'partial' || message.type === 'final') {
              this.handlers.onSegment(message.segment as WireSegment);
            } else if (message.type === 'error') {
              this.lastError = String(message.code ?? '');
            } else if (message.type === 'closed') {
              this.finish();
            }
          };
          socket.onerror = () => undefined;
          socket.onclose = (event) => {
            if (!settled) done({ code: event.code, reason: this.lastError });
            else this.onClosed(event.code);
          };
        })
        .catch(() => done({ code: -1, reason: 'token' }));
    });
  }

  private onFrame(frame: ArrayBuffer): void {
    if (this.socket && this.socket.readyState === OPEN && this.ready && !this.reconnecting) {
      this.socket.send(frame);
    } else if (this.reconnecting) {
      this.buffer.push(frame);
      if (this.buffer.length > MAX_BUFFERED_FRAMES) this.buffer.shift();
    }
  }

  private onConnectFailed(reason: unknown): void {
    const info = reason as { code?: number; reason?: string | null };
    this.mapClose(info.code ?? 0, info.reason ?? null);
  }

  private onClosed(code: number): void {
    if (this.stopping) {
      this.finish();
      return;
    }
    this.ready = false;
    this.mapClose(code, this.lastError);
  }

  /** Close codes are listed in apps/asr-py/app/ws.py. */
  private mapClose(code: number, reason: string | null): void {
    switch (code) {
      case 4403:
        return this.fail('consent_withdrawn');
      case 4429:
        return this.fail('spend_cap');
      case 4408:
        return this.fail('idle_timeout');
      case 4503:
        return this.fail('not_configured');
      case 1011:
        return this.fail('engine');
      case 1009:
      case 4400:
        return this.fail('protocol');
      case 4401:
        // an expired or used token is repaired by one fresh token; any other refusal is final
        if (reason === 'expired' || reason === 'already_used') return void this.reconnect('token');
        return this.fail('token');
      case -1:
        return this.fail('token');
      default:
        return void this.reconnect('connection_lost');
    }
  }

  private async reconnect(failureKind: AsrErrorKind): Promise<void> {
    if (this.stopping || this.state === 'error' || this.state === 'idle') return;
    if (this.reconnects >= 1 || !this.capture) {
      this.fail(failureKind);
      return;
    }
    this.reconnects += 1;
    this.reconnecting = true;
    this.handlers.onReconnecting?.(true);
    this.setState('connecting');
    this.detach(this.socket); // the old socket must not report its close as a new failure
    this.socket = null;
    try {
      await this.connect();
    } catch (reason) {
      this.reconnecting = false;
      this.handlers.onReconnecting?.(false);
      const info = reason as { code?: number; reason?: string | null };
      if (info.code === 4403) this.fail('consent_withdrawn');
      else if (info.code === 4429) this.fail('spend_cap');
      else this.fail(failureKind);
      return;
    }
    const pending = this.buffer;
    this.buffer = [];
    const live = this.socket as SocketLike | null;
    for (const frame of pending) live?.send(frame);
    this.reconnecting = false;
    this.handlers.onReconnecting?.(false);
    if ((this.state as AsrState) === 'connecting') this.setState('recording');
  }

  // ------------------------------------------------------------------ endings
  private fail(kind: AsrErrorKind): void {
    if (this.state === 'error') return;
    this.releaseAll(); // microphone off and audio buffers cleared before anything else is shown
    this.setState('error');
    this.handlers.onError(kind);
  }

  private finish(): void {
    this.releaseAll();
    if (this.state !== 'error') this.setState('idle');
  }

  private releaseAll(): void {
    this.capture?.stop();
    this.capture = null;
    this.buffer = [];
    this.reconnecting = false;
    this.ready = false;
    if (this.stopTimer !== null) {
      (this.deps.clearTimer ?? ((id: unknown) => clearTimeout(id as number)))(this.stopTimer);
      this.stopTimer = null;
    }
    this.detach(this.socket);
    this.socket = null;
  }

  private detach(socket: SocketLike | null): void {
    if (!socket) return;
    socket.onmessage = socket.onclose = socket.onerror = socket.onopen = null;
    try {
      socket.close();
    } catch {
      /* already closed */
    }
  }

  private setState(next: AsrState): void {
    if (this.state === next) return;
    this.state = next;
    this.handlers.onState(next);
  }
}

function parseMessage(data: unknown): { type?: string; [key: string]: unknown } | null {
  if (typeof data !== 'string') return null;
  try {
    const value = JSON.parse(data) as unknown;
    return value && typeof value === 'object' ? (value as { type?: string }) : null;
  } catch {
    return null;
  }
}
