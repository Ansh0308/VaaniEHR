// PG-06 Consultation: consent gate, token in the first message, live draft transcript, speaker toggles, inline edit,
// withdrawal handling, no confidence display, no storage writes. Fake microphone and fake WebSocket; no network.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Capture, SocketLike } from '../asr/AsrClient';
import { createBrowserCapture, openBrowserSocket } from '../asr/browser';
import { cleanupApp, IDS, noConsent, renderApp, type Handler } from '../test-utils/harness';

vi.mock('../asr/browser', () => ({
  createBrowserCapture: vi.fn(),
  openBrowserSocket: vi.fn(),
}));

class FakeSocket implements SocketLike {
  readyState = 1;
  sent: Array<string | ArrayBuffer> = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    queueMicrotask(() => this.onopen?.());
  }
  send(data: string | ArrayBuffer) {
    this.sent.push(data);
    if (typeof data === 'string' && JSON.parse(data).type === 'start') {
      queueMicrotask(() => this.server({ type: 'ready', engine: 'mock', sampleRate: 16000 }));
    }
  }
  close() {}
  server(message: object) {
    act(() => this.onmessage?.({ data: JSON.stringify(message) }));
  }
  drop(code: number) {
    act(() => this.onclose?.({ code }));
  }
}

const SESSION = IDS.session;
const sockets: FakeSocket[] = [];
let capture: Capture & { stopped: number };

beforeEach(() => {
  sockets.length = 0;
  capture = {
    stopped: 0,
    start() {},
    flush: async () => undefined,
    stop() {
      this.stopped += 1;
    },
  };
  vi.mocked(createBrowserCapture).mockImplementation(async () => capture);
  vi.mocked(openBrowserSocket).mockImplementation(() => {
    const socket = new FakeSocket();
    sockets.push(socket);
    return socket;
  });
});
afterEach(cleanupApp);

const consentWith = (audio: boolean, ai: boolean) => {
  const base = noConsent();
  const on = {
    granted: true,
    since: '2026-10-17T10:00:00.000Z',
    noticeVersion: '0.1',
    noticeLanguage: 'en',
    source: 'staff',
  };
  return {
    ...base,
    scopes: {
      ...base.scopes,
      ...(audio ? { audio: on } : {}),
      ...(ai ? { ai_processing: on } : {}),
    },
    recordingAllowed: audio && ai,
  };
};
const open = (
  consent = consentWith(true, true),
  language: 'en' | 'gu' = 'en',
  extra: Record<string, Handler> = {},
) =>
  renderApp({
    role: 'doctor',
    path: `/consult/${SESSION}`,
    language,
    routes: {
      'GET /sessions/:id/consent': () => ({ data: consent }),
      'POST /sessions/:id/asr-token': () => ({ data: { token: 'tok-1', expiresInSeconds: 120 } }),
      ...extra,
    },
  });
const start = async () =>
  fireEvent.click(await screen.findByRole('button', { name: 'Start recording' }));
const flush = () => act(() => new Promise((r) => setTimeout(r, 0)));

describe('consent gate', () => {
  it('Start is disabled and the missing consent is named, with a link to the consent screen', async () => {
    const app = await open(consentWith(true, false));
    const button = (await screen.findByRole('button', {
      name: 'Start recording',
    })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText(/Consent missing: AI processing/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open the consent screen' }).getAttribute('href')).toBe(
      `/consult/${SESSION}/consent`,
    );
    fireEvent.click(button);
    expect(createBrowserCapture).not.toHaveBeenCalled();
    expect(app.callsTo('POST', `/sessions/${SESSION}/asr-token`)).toHaveLength(0);
  });

  it('with both consents Start is enabled and the bar says so', async () => {
    await open();
    expect(
      ((await screen.findByRole('button', { name: 'Start recording' })) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    expect(screen.getByText(/Consent on record: audio recording and AI processing/)).toBeTruthy();
  });
});

describe('recording', () => {
  it('asks for a token, sends it as the first message, and shows a draft with unknown speakers', async () => {
    const app = await open();
    await start();
    await waitFor(() => expect(sockets).toHaveLength(1));
    await flush();
    expect(app.callsTo('POST', `/sessions/${SESSION}/asr-token`)).toHaveLength(1);
    expect(JSON.parse(sockets[0]?.sent[0] as string)).toMatchObject({
      type: 'start',
      token: 'tok-1',
    });
    expect(await screen.findByText('Recording', { selector: 'span' })).toBeTruthy();
    expect(screen.getByText('Draft — doctor must review')).toBeTruthy();

    const socket = sockets[0] as FakeSocket;
    socket.server({
      type: 'partial',
      segment: { kind: 'partial', startMs: 0, endMs: 500, text: 'namaste', language: 'gu-IN' },
    });
    expect(screen.getByText('Listening: this text may change.')).toBeTruthy();
    socket.server({
      type: 'final',
      segment: {
        kind: 'final',
        startMs: 200,
        endMs: 1400,
        text: 'namaste doctor',
        language: 'gu-IN',
        confidence: null,
      },
    });
    const item = (await screen.findByText('namaste doctor')).closest('li') as HTMLElement;
    expect(screen.queryByText('Listening: this text may change.')).toBeNull();
    expect(within(item).getByRole('radio', { name: 'Unknown' })).toHaveProperty('checked', true);
    expect(within(item).getByText('Language: gu-IN')).toBeTruthy();
    expect(within(item).getByText('00:00 to 00:01')).toBeTruthy();
  });

  it('the doctor sets the speaker per segment, and "next speaker" applies to the next segment only', async () => {
    await open();
    await start();
    await waitFor(() => expect(sockets).toHaveLength(1));
    await flush();
    const socket = sockets[0] as FakeSocket;
    const final = (text: string) =>
      socket.server({
        type: 'final',
        segment: { kind: 'final', startMs: 0, endMs: 1000, text, language: 'en-IN' },
      });
    fireEvent.click(screen.getByRole('radio', { name: 'Doctor', checked: false }));
    final('first');
    fireEvent.click(screen.getAllByRole('radio', { name: 'Patient' })[0] as HTMLElement); // next speaker
    final('second');
    const first = (await screen.findByText('first')).closest('li') as HTMLElement;
    const second = (await screen.findByText('second')).closest('li') as HTMLElement;
    expect(within(first).getByRole('radio', { name: 'Doctor' })).toHaveProperty('checked', true);
    expect(within(second).getByRole('radio', { name: 'Patient' })).toHaveProperty('checked', true);
    fireEvent.click(within(first).getByRole('radio', { name: 'Patient' }));
    expect(within(first).getByRole('radio', { name: 'Patient' })).toHaveProperty('checked', true);
  });

  it('inline edit keeps the engine text as the original and marks the segment Edited', async () => {
    await open();
    await start();
    await waitFor(() => expect(sockets).toHaveLength(1));
    await flush();
    sockets[0]?.server({
      type: 'final',
      segment: { kind: 'final', startMs: 0, endMs: 900, text: 'ગલામાં દુખાવો', language: 'gu-IN' },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Edit segment 1' }));
    fireEvent.change(screen.getByLabelText('Text of segment 1'), {
      target: { value: 'ગળામાં દુખાવો' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const item = (await screen.findByText('ગળામાં દુખાવો')).closest('li') as HTMLElement;
    expect(within(item).getByText('Edited')).toBeTruthy();
    expect(within(item).getByText('ગલામાં દુખાવો')).toBeTruthy(); // the original, kept in the details
  });

  it('stopping releases the microphone and ends in the idle state', async () => {
    await open();
    await start();
    await waitFor(() => expect(sockets).toHaveLength(1));
    await flush();
    fireEvent.click(await screen.findByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(capture.stopped).toBeGreaterThan(0));
    expect(JSON.parse(sockets[0]?.sent.at(-1) as string)).toEqual({ type: 'stop' });
    sockets[0]?.server({ type: 'closed', audioSeconds: 2 });
    expect(await screen.findByText('Ready')).toBeTruthy();
  });

  it('a blocked microphone shows a plain message and opens no connection', async () => {
    vi.mocked(createBrowserCapture).mockRejectedValue(
      Object.assign(new Error('x'), { name: 'NotAllowedError' }),
    );
    await open();
    await start();
    expect((await screen.findByRole('alert')).textContent).toContain('microphone is blocked');
    expect(sockets).toHaveLength(0);
  });
});

describe('withdrawal and limits', () => {
  it('consent withdrawn stops the microphone at once and says so', async () => {
    await open();
    await start();
    await waitFor(() => expect(sockets).toHaveLength(1));
    await flush();
    sockets[0]?.server({ type: 'error', code: 'consent_withdrawn' });
    sockets[0]?.drop(4403);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Consent was withdrawn');
    expect(capture.stopped).toBeGreaterThan(0);
    expect(sockets).toHaveLength(1); // no reconnect
  });

  it('the monthly allowance being used up is shown, not retried', async () => {
    await open();
    await start();
    await waitFor(() => expect(sockets).toHaveLength(1));
    await flush();
    sockets[0]?.drop(4429);
    expect((await screen.findByRole('alert')).textContent).toContain(
      "month's speech-service allowance",
    );
    expect(sockets).toHaveLength(1);
  });
});

describe('what the screen never shows or stores', () => {
  it('shows no confidence figure and writes nothing to browser storage', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    await open();
    await start();
    await waitFor(() => expect(sockets).toHaveLength(1));
    await flush();
    sockets[0]?.server({
      type: 'final',
      segment: {
        kind: 'final',
        startMs: 0,
        endMs: 1000,
        text: 'some words',
        language: 'en-IN',
        confidence: 0.97,
      },
    });
    await screen.findByText('some words');
    expect(document.body.textContent).not.toMatch(/confidence|97%|0\.97|low confidence/i);
    expect(document.querySelector('[class*="underline"][class*="dotted"]')).toBeNull();
    const languageWrites = setItem.mock.calls.filter(([key]) => key !== 'vaaniehr.language');
    expect(languageWrites).toEqual([]);
    setItem.mockRestore();
  });

  it('is readable in Gujarati and keeps the draft label', async () => {
    await open(consentWith(true, true), 'gu');
    expect(await screen.findByText('ડ્રાફ્ટ — ડૉક્ટરે સમીક્ષા કરવી જરૂરી')).toBeTruthy();
    expect(screen.getByText('Needs review by a Gujarati speaker')).toBeTruthy();
  });

  it('only doctors can open it', async () => {
    await renderApp({
      role: 'staff',
      path: `/consult/${SESSION}`,
      routes: { 'GET /sessions/:id/consent': () => ({ data: consentWith(true, true) }) },
    });
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Start recording' })).toBeNull(),
    );
  });
});
