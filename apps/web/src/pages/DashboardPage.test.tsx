// PG-02 Doctor dashboard: my sessions (real data only), start-a-session flow, honest queue placeholder, all states.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanupApp,
  fakeNotices,
  fakePatient,
  IDS,
  noConsent,
  renderApp,
  type Handler,
} from '../test-utils/harness';

afterEach(cleanupApp);

const session = (over: Record<string, unknown> = {}) => ({
  id: IDS.session,
  tokenId: null,
  patientId: IDS.patient,
  doctorId: IDS.user('doctor'),
  clinicId: IDS.clinic,
  startedAt: '2026-10-15T09:30:00.000Z',
  endedAt: null,
  languageMix: null,
  status: 'created',
  patientName: 'Fake Patient',
  consent: { audio: false, aiProcessing: false, whatsapp: false, recordingAllowed: false },
  ...over,
});
const list =
  (items: unknown[], nextBefore: string | null = null): Handler =>
  () => ({
    data: { items, nextBefore },
  });

describe('doctor dashboard', () => {
  it('lists only the sessions the API returns, with status and consent badges', async () => {
    await renderApp({
      role: 'doctor',
      path: '/doctor',
      routes: {
        'GET /sessions': list([
          session(),
          session({
            id: '5eed0000-0000-4000-8000-0000000000a2',
            patientName: 'Another Fake',
            status: 'ended',
            consent: { audio: true, aiProcessing: true, whatsapp: false, recordingAllowed: true },
          }),
        ]),
      },
    });
    const table = await screen.findByRole('table', { name: 'Sessions, newest first' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0] as HTMLElement).getByText('Fake Patient')).toBeTruthy();
    expect(within(rows[0] as HTMLElement).getByText('Created')).toBeTruthy();
    expect(within(rows[0] as HTMLElement).getByText('Consent needed')).toBeTruthy();
    expect(within(rows[1] as HTMLElement).getByText('Ended')).toBeTruthy();
    expect(within(rows[1] as HTMLElement).getByText('Recording consent on record')).toBeTruthy();
    // open sessions are counted from the real list: 1 of the 2 is not ended
    expect(screen.getByText('Open sessions in this list: 1')).toBeTruthy();
    expect(screen.getByText(/nothing here is signed/i)).toBeTruthy();
  });

  it('shows the queue as a clearly labelled placeholder: no fake queue and no numbers', async () => {
    await renderApp({ role: 'doctor', path: '/doctor', routes: { 'GET /sessions': list([]) } });
    const heading = await screen.findByRole('heading', { name: "Today's queue" });
    const section = heading.closest('section') as HTMLElement;
    expect(within(section).getByText('Not available until the ClinicOS integration')).toBeTruthy();
    expect(section.textContent).not.toMatch(/\d/); // not a single invented number
    expect(within(section).queryByRole('table')).toBeNull();
    expect(within(section).queryByRole('list')).toBeNull();
  });

  it('shows a loading state, then an empty state with a helpful message', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await renderApp({
      role: 'doctor',
      path: '/doctor',
      routes: {
        'GET /sessions': async () => {
          await gate;
          return { data: { items: [], nextBefore: null } };
        },
      },
    });
    expect(screen.getByText('Loading your sessions')).toBeTruthy();
    await act(async () => release?.());
    expect(await screen.findByRole('heading', { name: 'No sessions yet' })).toBeTruthy();
    expect(screen.getByText(/Sessions you start will appear here/)).toBeTruthy();
  });

  it('shows a plain error with a working retry', async () => {
    let calls = 0;
    await renderApp({
      role: 'doctor',
      path: '/doctor',
      routes: {
        'GET /sessions': () => {
          calls += 1;
          return calls === 1
            ? { status: 500, error: { code: 'INTERNAL' } }
            : { data: { items: [session()], nextBefore: null } };
        },
      },
    });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Something went wrong');
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('table', { name: 'Sessions, newest first' })).toBeTruthy();
  });

  it('"Load more" fetches the next page with the cursor and appends it', async () => {
    const view = await renderApp({
      role: 'doctor',
      path: '/doctor',
      routes: {
        'GET /sessions': (req) =>
          req.query.get('before')
            ? {
                data: {
                  items: [
                    session({
                      id: '5eed0000-0000-4000-8000-0000000000a3',
                      patientName: 'Older Fake',
                    }),
                  ],
                  nextBefore: null,
                },
              }
            : { data: { items: [session()], nextBefore: '2026-10-15T09:30:00.000Z' } },
      },
    });
    await screen.findByRole('table', { name: 'Sessions, newest first' });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    });
    expect(await screen.findByText('Older Fake')).toBeTruthy();
    expect(view.calls.filter((c) => c.path === '/sessions').at(-1)?.query['before']).toBe(
      '2026-10-15T09:30:00.000Z',
    );
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('copies the consent link for a session', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await renderApp({
      role: 'doctor',
      path: '/doctor',
      routes: { 'GET /sessions': list([session()]) },
    });
    await screen.findByRole('table', { name: 'Sessions, newest first' });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy link for Fake Patient' }));
    });
    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/consult/${IDS.session}/consent`,
    );
    expect(await screen.findByText('Consent link copied')).toBeTruthy();
  });
});

describe('start a session', () => {
  const lookup =
    (found: boolean): Handler =>
    () => ({ data: found ? { found: true, patient: fakePatient() } : { found: false } });

  it('finds the patient by phone, shows allergies, starts the session and opens the consent page', async () => {
    const view = await renderApp({
      role: 'doctor',
      path: '/doctor',
      routes: {
        'GET /sessions': list([]),
        'POST /patients/lookup': lookup(true),
        'POST /sessions': () => ({ status: 201, data: session() }),
        'GET /sessions/:id': () => ({ data: session() }),
        'GET /sessions/:id/consent': () => ({ data: noConsent() }),
        'GET /consent/notice': () => ({ data: fakeNotices() }),
        'GET /patients/:id': () => ({ data: fakePatient() }),
      },
    });
    await screen.findByRole('heading', { name: 'No sessions yet' });
    fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '00000 00001' } });
    expect(await screen.findByText('Fake Patient')).toBeTruthy(); // instant match, no button press
    expect(screen.getByText('Drug-A (FAKE)')).toBeTruthy();
    expect(view.callsTo('POST', '/patients/lookup')[0]?.body).toEqual({ phone: '0000000001' });
    fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
    await waitFor(() => expect(view.callsTo('POST', '/sessions')).toHaveLength(1));
    expect(view.callsTo('POST', '/sessions')[0]?.body).toEqual({ patientId: IDS.patient });
    expect(await screen.findByRole('heading', { name: 'Consent', level: 1 })).toBeTruthy();
  });

  it('the phone number is only ever sent in a POST body, never in a URL', async () => {
    const view = await renderApp({
      role: 'doctor',
      path: '/doctor',
      routes: { 'GET /sessions': list([]), 'POST /patients/lookup': lookup(true) },
    });
    await screen.findByRole('heading', { name: 'No sessions yet' });
    fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '0000000001' } });
    await screen.findByText('Fake Patient');
    for (const url of view.fetchMock.mock.calls.map((c) => String(c[0]))) {
      expect(url).not.toContain('0000000001');
    }
  });

  it('explains when no patient has the number, and does not offer to register (doctors cannot)', async () => {
    await renderApp({
      role: 'doctor',
      path: '/doctor',
      routes: { 'GET /sessions': list([]), 'POST /patients/lookup': lookup(false) },
    });
    await screen.findByRole('heading', { name: 'No sessions yet' });
    fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '0000000099' } });
    expect(
      await screen.findByText('Ask staff to register the patient first, then search again.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Register/ })).toBeNull();
  });

  it('an incomplete number is explained on search, with no request', async () => {
    const view = await renderApp({
      role: 'doctor',
      path: '/doctor',
      routes: { 'GET /sessions': list([]) },
    });
    await screen.findByRole('heading', { name: 'No sessions yet' });
    fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '12345' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find' }));
    expect(await screen.findByText('Enter a 10-digit phone number.')).toBeTruthy();
    expect(view.callsTo('POST', '/patients/lookup')).toHaveLength(0);
  });
});

describe('dashboard in Gujarati', () => {
  it('shows Gujarati headings', async () => {
    await renderApp({
      role: 'doctor',
      path: '/doctor',
      language: 'gu',
      routes: { 'GET /sessions': list([]) },
    });
    expect(await screen.findByRole('heading', { name: 'ડૉક્ટર ડેશબોર્ડ', level: 1 })).toBeTruthy();
  });
});
