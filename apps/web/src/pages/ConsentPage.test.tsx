// PG-05 Consent: both notices side by side, three independent switches, source required, withdraw, history, and the
// ConsentGate that future recording screens use. Recording stays off until audio AND AI processing are on record.
import { render, act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { ConsentGate } from '../components/clinical/ConsentGate';
import i18n from '../i18n';
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

type Scope = 'audio' | 'ai_processing' | 'whatsapp';

/** A tiny stateful fake of the consent endpoints. */
function consentApi(initial: Partial<Record<Scope, boolean>> = {}, status = 'created') {
  const state = { ...{ audio: false, ai_processing: false, whatsapp: false }, ...initial };
  const events: Array<Record<string, unknown>> = [];
  let seq = 0;
  const view = () => {
    const base = noConsent();
    for (const s of Object.keys(state) as Scope[]) {
      (base.scopes as Record<string, unknown>)[s] = {
        granted: state[s],
        since: state[s] ? '2026-10-15T10:00:00.000Z' : null,
        noticeVersion: state[s] ? '0.1' : null,
        noticeLanguage: state[s] ? 'en' : null,
        source: state[s] ? 'staff' : null,
      };
    }
    return {
      ...base,
      recordingAllowed: state.audio && state.ai_processing,
      whatsappAllowed: state.whatsapp,
      events: [...events],
    };
  };
  const routes: Record<string, Handler> = {
    'GET /sessions/:id': () => ({
      data: {
        id: IDS.session,
        tokenId: null,
        patientId: IDS.patient,
        doctorId: IDS.user('doctor'),
        clinicId: IDS.clinic,
        startedAt: '2026-10-15T09:30:00.000Z',
        endedAt: null,
        languageMix: null,
        status,
      },
    }),
    'GET /sessions/:id/consent': () => ({ data: view() }),
    'GET /consent/notice': () => ({ data: fakeNotices() }),
    'GET /patients/:id': () => ({ data: fakePatient() }),
    'POST /sessions/:id/consent': (req) => {
      const body = req.body as { scopes: Scope[]; source: string; noticeLanguage: string };
      for (const s of body.scopes) {
        state[s] = true;
        events.push({
          seq: ++seq,
          scope: s,
          granted: true,
          noticeVersion: '0.1',
          noticeLanguage: body.noticeLanguage,
          source: body.source,
          recordedByRole: 'staff',
          ts: '2026-10-15T10:00:00.000Z',
        });
      }
      return { status: 201, data: view() };
    },
    'POST /sessions/:id/consent/withdraw': (req) => {
      const body = req.body as { scopes?: Scope[]; source: string };
      for (const s of body.scopes ?? (Object.keys(state) as Scope[])) {
        if (!state[s]) continue;
        state[s] = false;
        events.push({
          seq: ++seq,
          scope: s,
          granted: false,
          noticeVersion: '0.1',
          noticeLanguage: 'en',
          source: body.source,
          recordedByRole: 'doctor',
          ts: '2026-10-15T10:05:00.000Z',
        });
      }
      return { data: { ...view(), stopRecording: true } };
    },
  };
  return { routes, state };
}

const open = (
  role: 'staff' | 'doctor' | 'admin',
  initial?: Partial<Record<Scope, boolean>>,
  status?: string,
) => {
  const api = consentApi(initial, status);
  return renderApp({ role, path: `/consult/${IDS.session}/consent`, routes: api.routes }).then(
    (view) => ({
      view,
      api,
    }),
  );
};
const sw = (name: RegExp) => screen.getByRole('switch', { name });
const choose = (label: string | RegExp) =>
  fireEvent.click(screen.getByRole('radio', { name: label }));
const save = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Save consent' }));
  });
};

describe('consent notice', () => {
  it('shows the notice in English and Gujarati side by side, marked as placeholder, Gujarati needs review', async () => {
    await open('staff');
    await screen.findByRole('heading', { name: 'Consent', level: 1 });
    const en = document.querySelector('section[lang="en"]') as HTMLElement;
    const gu = document.querySelector('section[lang="gu"]') as HTMLElement;
    expect(en).toBeTruthy();
    expect(gu).toBeTruthy();
    expect(within(en).getByText('[PLACEHOLDER] Notice text.')).toBeTruthy();
    expect(within(gu).getByText('[પ્લેસહોલ્ડર] સૂચનાનું લખાણ.')).toBeTruthy();
    expect(within(en).getByText('Placeholder wording')).toBeTruthy();
    expect(within(gu).getByText('Needs review by a Gujarati speaker')).toBeTruthy();
    expect(within(en).queryByText('Needs review by a Gujarati speaker')).toBeNull();
    expect(screen.getByText(/Notice version 0.1/)).toBeTruthy();
  });

  it('shows the patient name and the session start', async () => {
    await open('doctor');
    expect(await screen.findByText(/Patient: Fake Patient/)).toBeTruthy();
  });
});

describe('recording is off until audio AND AI processing are both on record', () => {
  it('starts with everything off, a blocked banner and nothing to save', async () => {
    await open('staff');
    await screen.findByRole('heading', { name: 'Consent', level: 1 });
    const banner = screen.getByText('Recording is off').closest('[role="alert"]') as HTMLElement;
    expect(banner.textContent).toContain('This cannot be skipped');
    for (const name of [/Audio recording/, /AI processing/, /WhatsApp summary/]) {
      expect(sw(name).getAttribute('aria-checked')).toBe('false');
    }
    expect(
      (screen.getByRole('button', { name: 'Save consent' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: 'Withdraw consent' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByText('No changes to save.')).toBeTruthy();
  });

  it('the three switches are independent', async () => {
    await open('staff');
    await screen.findByRole('heading', { name: 'Consent', level: 1 });
    fireEvent.click(sw(/WhatsApp summary/));
    expect(sw(/WhatsApp summary/).getAttribute('aria-checked')).toBe('true');
    expect(sw(/Audio recording/).getAttribute('aria-checked')).toBe('false');
    expect(sw(/AI processing/).getAttribute('aria-checked')).toBe('false');
    fireEvent.click(sw(/Audio recording/));
    expect(sw(/AI processing/).getAttribute('aria-checked')).toBe('false');
  });

  it('saving needs to know who confirmed it: no request without that, and the error summary takes focus', async () => {
    const { view } = await open('staff');
    await screen.findByRole('heading', { name: 'Consent', level: 1 });
    fireEvent.click(sw(/Audio recording/));
    await save();
    const summary = await screen.findByRole('alert', { name: 'Consent was not saved' });
    expect(summary.textContent).toContain('Choose who confirmed this consent.');
    expect(document.activeElement).toBe(summary);
    expect(view.callsTo('POST', `/sessions/${IDS.session}/consent`)).toHaveLength(0);
  });

  it('granting audio alone leaves recording off; adding AI processing turns it on', async () => {
    const { view } = await open('staff');
    await screen.findByRole('heading', { name: 'Consent', level: 1 });
    fireEvent.click(sw(/Audio recording/));
    choose(/Staff entered it/);
    await save();
    await waitFor(() =>
      expect(view.callsTo('POST', `/sessions/${IDS.session}/consent`)).toHaveLength(1),
    );
    expect(view.callsTo('POST', `/sessions/${IDS.session}/consent`)[0]?.body).toEqual({
      scopes: ['audio'],
      noticeVersion: '0.1',
      noticeLanguage: 'en',
      source: 'staff',
    });
    expect(await screen.findByText('Recording is off')).toBeTruthy();

    fireEvent.click(sw(/AI processing/));
    await save();
    expect(await screen.findByText('Recording consent is on record')).toBeTruthy();
    expect(screen.queryByText('Recording is off')).toBeNull();
  });

  it('records which language the notice was shown in and who confirmed it', async () => {
    const { view } = await open('doctor');
    await screen.findByRole('heading', { name: 'Consent', level: 1 });
    fireEvent.click(sw(/Audio recording/));
    fireEvent.click(sw(/AI processing/));
    choose(/The patient confirmed it themselves/);
    choose('ગુજરાતી');
    await save();
    await waitFor(() =>
      expect(view.callsTo('POST', `/sessions/${IDS.session}/consent`)).toHaveLength(1),
    );
    expect(view.callsTo('POST', `/sessions/${IDS.session}/consent`)[0]?.body).toEqual({
      scopes: ['audio', 'ai_processing'],
      noticeVersion: '0.1',
      noticeLanguage: 'gu',
      source: 'patient',
    });
  });

  it('admins can capture consent too (ADR-D20)', async () => {
    await open('admin');
    expect(await screen.findByRole('heading', { name: 'Consent', level: 1 })).toBeTruthy();
  });
});

describe('withdrawing consent', () => {
  it('turning a granted switch off and saving withdraws only that scope', async () => {
    const { view } = await open('staff', { audio: true, ai_processing: true });
    expect(await screen.findByText('Recording consent is on record')).toBeTruthy();
    fireEvent.click(sw(/Audio recording/));
    choose(/The patient confirmed it themselves/);
    await save();
    await waitFor(() =>
      expect(view.callsTo('POST', `/sessions/${IDS.session}/consent/withdraw`)).toHaveLength(1),
    );
    expect(view.callsTo('POST', `/sessions/${IDS.session}/consent/withdraw`)[0]?.body).toEqual({
      scopes: ['audio'],
      source: 'patient',
    });
    expect(view.callsTo('POST', `/sessions/${IDS.session}/consent`)).toHaveLength(0);
    expect(await screen.findByText('Recording is off')).toBeTruthy();
  });

  it('"Withdraw consent" asks for confirmation and for who withdrew it, then withdraws everything', async () => {
    const { view } = await open('doctor', { audio: true, ai_processing: true, whatsapp: true });
    await screen.findByText('Recording consent is on record');
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw consent' }));
    const dialog = await screen.findByRole('dialog', { name: 'Withdraw all consent?' });
    expect(within(dialog).getByText(/recording is running it must stop now/i)).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Withdraw all consent' }));
    });
    expect(within(dialog).getByText('Choose who confirmed this consent.')).toBeTruthy(); // not allowed without it
    expect(view.callsTo('POST', `/sessions/${IDS.session}/consent/withdraw`)).toHaveLength(0);
    fireEvent.click(
      within(dialog).getByRole('radio', { name: /The patient confirmed it themselves/ }),
    );
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Withdraw all consent' }));
    });
    await waitFor(() =>
      expect(view.callsTo('POST', `/sessions/${IDS.session}/consent/withdraw`)).toHaveLength(1),
    );
    expect(view.callsTo('POST', `/sessions/${IDS.session}/consent/withdraw`)[0]?.body).toEqual({
      source: 'patient',
    });
    expect(await screen.findByText('Recording is off')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('Cancel leaves the consent exactly as it was', async () => {
    const { view } = await open('staff', { audio: true });
    await screen.findByRole('heading', { name: 'Consent', level: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw consent' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(view.callsTo('POST', `/sessions/${IDS.session}/consent/withdraw`)).toHaveLength(0);
  });
});

describe('history, ended sessions and errors', () => {
  it('shows the consent history as a table', async () => {
    const { view, api } = await open('staff');
    await screen.findByRole('heading', { name: 'Consent', level: 1 });
    expect(screen.getByText('No consent has been recorded for this session yet.')).toBeTruthy();
    fireEvent.click(sw(/Audio recording/));
    choose(/Staff entered it/);
    await save();
    const table = await screen.findByRole('table', { name: 'Consent history for this session' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(1);
    expect(within(rows[0] as HTMLElement).getByText('Granted')).toBeTruthy();
    expect(within(rows[0] as HTMLElement).getByText('0.1 / en')).toBeTruthy();
    expect(api.state.audio).toBe(true);
    expect(view.callsTo('GET', `/sessions/${IDS.session}/consent`).length).toBeGreaterThan(1); // refreshed after saving
  });

  it('an ended session says so and cannot get new consent, but the switches can still be turned off', async () => {
    await open('staff', { audio: true }, 'ended');
    expect(await screen.findByText('This session has ended')).toBeTruthy();
    fireEvent.click(sw(/WhatsApp summary/));
    expect(sw(/WhatsApp summary/).getAttribute('aria-checked')).toBe('false'); // cannot be added
    fireEvent.click(sw(/Audio recording/));
    expect(sw(/Audio recording/).getAttribute('aria-checked')).toBe('false'); // withdrawing is allowed
  });

  it('an unknown session shows a clear message with a retry, not a blank page', async () => {
    await renderApp({
      role: 'staff',
      path: `/consult/${IDS.session}/consent`,
      routes: {
        'GET /sessions/:id': () => ({ status: 404, error: { code: 'NOT_FOUND' } }),
        'GET /sessions/:id/consent': () => ({ status: 404, error: { code: 'NOT_FOUND' } }),
        'GET /consent/notice': () => ({ data: fakeNotices() }),
      },
    });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('This session was not found');
    expect(within(alert).getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('a failed save is explained and keeps what the person chose', async () => {
    const api = consentApi();
    api.routes['POST /sessions/:id/consent'] = () => ({ status: 500, error: { code: 'INTERNAL' } });
    await renderApp({ role: 'staff', path: `/consult/${IDS.session}/consent`, routes: api.routes });
    await screen.findByRole('heading', { name: 'Consent', level: 1 });
    fireEvent.click(sw(/Audio recording/));
    choose(/Staff entered it/);
    await save();
    const summary = await screen.findByRole('alert', { name: 'Consent was not saved' });
    expect(summary.textContent).toContain('Something went wrong');
    expect(sw(/Audio recording/).getAttribute('aria-checked')).toBe('true');
  });
});

describe('ConsentGate (used where recording will happen)', () => {
  const gate = (allowed: boolean) =>
    render(
      <MemoryRouter>
        <ConsentGate sessionId={IDS.session} recordingAllowed={allowed}>
          <button type="button">Start recording</button>
        </ConsentGate>
      </MemoryRouter>,
    );

  it('hides the protected content and links back to the consent page when consent is missing', async () => {
    await i18n.changeLanguage('en');
    gate(false);
    expect(screen.queryByRole('button', { name: 'Start recording' })).toBeNull();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Recording needs consent first');
    expect(
      within(alert).getByRole('link', { name: 'Open the consent page' }).getAttribute('href'),
    ).toBe(`/consult/${IDS.session}/consent`);
    cleanup();
  });

  it('shows the protected content when both consents are on record', async () => {
    await i18n.changeLanguage('en');
    gate(true);
    expect(screen.getByRole('button', { name: 'Start recording' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    cleanup();
  });
});
