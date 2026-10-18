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

describe('saving the draft transcript (ADR-D28)', () => {
  const savedRoutes = (put: Handler, extra: Record<string, Handler> = {}) => ({
    'GET /sessions/:id/transcript': () => ({
      data: { segments: [], draftCount: 0, confirmedCount: 0 },
    }),
    'PUT /sessions/:id/transcript/segments': put,
    ...extra,
  });
  const okPut: Handler = () => ({ data: { segments: [], draftCount: 1, confirmedCount: 0 } });
  const speak = async (text = 'saved words') => {
    await start();
    await waitFor(() => expect(sockets).toHaveLength(1));
    await flush();
    sockets[0]?.server({
      type: 'final',
      segment: {
        kind: 'final',
        startMs: 100,
        endMs: 1100,
        text,
        language: 'gu-IN',
        engine: 'mock',
        engineVersion: '1.0',
      },
    });
  };

  it('autosaves shortly after the text changes, with the engine text, speaker and engine; the text is not in the URL', async () => {
    const app = await open(consentWith(true, true), 'en', savedRoutes(okPut));
    await speak();
    expect(await screen.findByText('Unsaved changes')).toBeTruthy();
    await waitFor(
      () => expect(app.callsTo('PUT', `/sessions/${SESSION}/transcript/segments`)).toHaveLength(1),
      {
        timeout: 5000,
      },
    );
    const call = app.callsTo('PUT', `/sessions/${SESSION}/transcript/segments`)[0];
    expect(call?.path).not.toContain('saved');
    expect(call?.body).toEqual({
      segments: [
        {
          seq: 0,
          speaker: 'unknown',
          originalText: 'saved words',
          editedText: null,
          language: 'gu-IN',
          startMs: 100,
          endMs: 1100,
          engine: 'mock',
          engineVersion: '1.0',
        },
      ],
    });
    expect(await screen.findByText('All changes saved')).toBeTruthy();
  });

  it('an edit is saved as editedText with the engine text kept as the original', async () => {
    const app = await open(consentWith(true, true), 'en', savedRoutes(okPut));
    await speak('ગલામાં');
    await waitFor(
      () => expect(app.callsTo('PUT', `/sessions/${SESSION}/transcript/segments`)).toHaveLength(1),
      { timeout: 5000 },
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Edit segment 1' }));
    fireEvent.change(screen.getByLabelText('Text of segment 1'), { target: { value: 'ગળામાં' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(
      () => expect(app.callsTo('PUT', `/sessions/${SESSION}/transcript/segments`)).toHaveLength(2),
      { timeout: 5000 },
    );
    const body = app.callsTo('PUT', `/sessions/${SESSION}/transcript/segments`)[1]?.body as {
      segments: Array<{ originalText: string; editedText: string }>;
    };
    expect(body.segments[0]).toMatchObject({ originalText: 'ગલામાં', editedText: 'ગળામાં' });
  });

  it('says plainly when saving is refused because consent is gone, and does not retry', async () => {
    const app = await open(
      consentWith(true, true),
      'en',
      savedRoutes(() => ({ status: 403, error: { code: 'CONSENT_REQUIRED', message: 'x' } })),
    );
    await speak();
    expect(
      await screen.findByText(
        /Not saved: consent for audio and AI processing/,
        {},
        { timeout: 5000 },
      ),
    ).toBeTruthy();
    expect(app.callsTo('PUT', `/sessions/${SESSION}/transcript/segments`)).toHaveLength(1);
    expect(
      (screen.getByRole('button', { name: 'Confirm transcript' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('Confirm asks first, then confirms and locks every segment', async () => {
    const app = await open(
      consentWith(true, true),
      'en',
      savedRoutes(okPut, {
        'POST /sessions/:id/transcript/confirm': () => ({
          data: { segments: [], draftCount: 0, confirmedCount: 1 },
        }),
      }),
    );
    await speak();
    await waitFor(
      () => expect(app.callsTo('PUT', `/sessions/${SESSION}/transcript/segments`)).toHaveLength(1),
      { timeout: 5000 },
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Stop' }));
    sockets[0]?.server({ type: 'closed', audioSeconds: 2 });
    await screen.findByText('Ready');
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm transcript' }));
    const dialog = await screen.findByRole('dialog');
    expect(app.callsTo('POST', `/sessions/${SESSION}/transcript/confirm`)).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    await waitFor(() =>
      expect(app.callsTo('POST', `/sessions/${SESSION}/transcript/confirm`)).toHaveLength(1),
    );
    const item = (await screen.findByText('saved words')).closest('li') as HTMLElement;
    expect(await within(item).findByText('Confirmed')).toBeTruthy();
    expect(within(item).queryByRole('button', { name: 'Edit segment 1' })).toBeNull();
    expect(within(item).queryByRole('radio')).toBeNull();
  });

  it('shows what was saved before when a doctor comes back, with confirmed text locked', async () => {
    await open(consentWith(true, true), 'en', {
      'GET /sessions/:id/transcript': () => ({
        data: {
          segments: [
            {
              seq: 0,
              speaker: 'doctor',
              originalText: 'old words',
              editedText: null,
              text: 'old words',
              language: 'en-IN',
              startMs: 0,
              endMs: 900,
              engine: 'mock',
              engineVersion: '1.0',
              status: 'confirmed',
            },
          ],
          draftCount: 0,
          confirmedCount: 1,
        },
      }),
    });
    const item = (await screen.findByText('old words')).closest('li') as HTMLElement;
    expect(within(item).getByText('Confirmed')).toBeTruthy();
    expect(within(item).getByText('Doctor')).toBeTruthy();
  });
});

describe('facts panel', () => {
  const savedTranscript = () => ({
    data: {
      segments: [
        {
          seq: 0,
          speaker: 'patient',
          originalText: 'I have fever since two days',
          editedText: null,
          text: 'I have fever since two days',
          language: 'en-IN',
          startMs: 0,
          endMs: 900,
          engine: 'mock',
          engineVersion: '1.0',
          status: 'draft',
        },
      ],
      draftCount: 1,
      confirmedCount: 0,
    },
  });
  const heard = (over: Record<string, unknown> = {}) => ({
    id: 'f1',
    type: 'symptom',
    value: 'fever',
    negated: false,
    uncertain: false,
    speaker: 'patient',
    source: 'extracted',
    sourceSegmentSeq: 0,
    spanStart: 7,
    spanEnd: 12,
    evidenceQuote: 'fever',
    matchType: 'exact',
    status: 'heard',
    edited: false,
    originalValue: null,
    pipeline: 'grounded',
    model: 'sample-extraction',
    conceptId: null,
    snomedId: null,
    confirmedAt: null,
    ...over,
  });
  const list = (facts: unknown[]) => ({
    data: { facts, heardCount: facts.length, confirmedCount: 0, rejectedCount: 0, staleCount: 0 },
  });

  it('Extract facts asks for a consent token, calls the speech service once, then shows the facts', async () => {
    let extracted = false;
    const app = await open(consentWith(true, true), 'en', {
      'GET /sessions/:id/transcript': savedTranscript,
      'GET /extraction/mode': () => ({ data: { mode: 'sample', model: 'sample-extraction' } }),
      'GET /sessions/:id/facts': () => list(extracted ? [heard()] : []),
      'POST /sessions/:id/extract': () => {
        extracted = true;
        return { data: { mode: 'sample', summary: { inserted: 1 } } };
      },
    });
    expect(await screen.findByText('Test mode - sample extraction')).toBeTruthy();
    const button = (await screen.findByRole('button', {
      name: 'Extract facts',
    })) as HTMLButtonElement;
    await waitFor(() => expect(button.disabled).toBe(false));
    expect(app.callsTo('POST', `/sessions/${SESSION}/extract`)).toHaveLength(0); // never by itself
    fireEvent.click(button);
    expect(await screen.findByRole('group', { name: /Symptoms: fever/ })).toBeTruthy();
    expect(app.callsTo('POST', `/sessions/${SESSION}/asr-token`)).toHaveLength(1);
    expect(app.callsTo('POST', `/sessions/${SESSION}/extract`)).toHaveLength(1);
    expect(screen.getByText('New facts arrived: 1')).toBeTruthy();
  });

  it('shows a rate limit in plain words', async () => {
    await open(consentWith(true, true), 'en', {
      'GET /sessions/:id/transcript': savedTranscript,
      'GET /sessions/:id/facts': () => list([]),
      'POST /sessions/:id/extract': () => ({
        status: 429,
        error: { code: 'rate_limited', message: 'x' },
      }),
    });
    const button = (await screen.findByRole('button', {
      name: 'Extract facts',
    })) as HTMLButtonElement;
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
    expect((await screen.findByRole('alert')).textContent).toMatch(/busy right now/);
  });

  it('focusing a fact highlights its words in the transcript; c confirms through the API', async () => {
    const patches: unknown[] = [];
    await open(consentWith(true, true), 'en', {
      'GET /sessions/:id/transcript': savedTranscript,
      'GET /sessions/:id/facts': () => list([heard()]),
      'PATCH /sessions/:id/facts/:factId': (req) => {
        patches.push(req.body);
        return { data: heard({ status: 'confirmed' }) };
      },
    });
    const chip = await screen.findByRole('group', { name: /Symptoms: fever/ });
    fireEvent.focus(chip);
    expect(document.querySelector('mark')?.textContent).toBe('fever');
    expect(screen.getByRole('note').textContent).toContain('I have fever since two days');
    fireEvent.keyDown(chip, { key: 'c' });
    await waitFor(() => expect(patches).toEqual([{ action: 'confirm' }]));
  });

  it('a stale fact says the text changed', async () => {
    await open(consentWith(true, true), 'en', {
      'GET /sessions/:id/transcript': savedTranscript,
      'GET /sessions/:id/facts': () => list([heard({ status: 'stale' })]),
    });
    expect(await screen.findByText('Text changed - re-check')).toBeTruthy();
  });
});
