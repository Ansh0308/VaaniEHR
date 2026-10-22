// PG-09 sign-off page (Phase 8 Run 2): the server's blockers as a checklist with a link to fix each, the AI-vs-final diff
// ("doctor-entered" where the engine proposed nothing), the "Safety checks were not run" acknowledgement, the safety-engine
// ERROR state, password re-entry and a clear result. The button is off while something is open, but the server stays the
// authority: a stale page still gets the server's answer. Fake data only.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Blocker, Preview, SignReadiness } from '../api/prescription';
import { cleanupApp, IDS, renderApp, type Handler } from '../test-utils/harness';

afterEach(cleanupApp);

const ready = (over: Partial<SignReadiness> = {}): SignReadiness => ({
  signed: false,
  blockers: [],
  medicineCount: 1,
  safety: { configured: false, blocked: 0, message: 'x' },
  currentVersion: null,
  ...over,
});
const fakePreview = (over: Partial<Preview> = {}): Preview => ({
  facts: [
    {
      id: 'f1',
      type: 'symptom',
      value: 'toy final words',
      negated: false,
      uncertain: false,
      status: 'confirmed',
      source: 'extracted',
      edited: true,
      originalValue: 'toy engine words',
      originalNegated: false,
      originalUncertain: false,
      evidenceQuote: 'toy quote',
      conceptConfirmed: false,
    },
    {
      id: 'f2',
      type: 'duration',
      value: '2 days toy',
      negated: false,
      uncertain: false,
      status: 'confirmed',
      source: 'manual',
      edited: false,
      originalValue: null,
      originalNegated: null,
      originalUncertain: null,
      evidenceQuote: null,
      conceptConfirmed: false,
    },
  ],
  workingCondition: {
    kind: 'pathway',
    pathwayId: 'toy_condition_a',
    version: 1,
    text: null,
    engineRank: 2,
  },
  engineCandidates: [{ pathwayId: 'toy_condition_a', version: 1, rank: 2 }],
  medicines: [
    {
      id: 'm1',
      name: 'Drug-A (FAKE)',
      source: 'master',
      strength: '500 mg',
      doseForm: 'Tablet',
      dose: '1 tablet',
      frequency: 'BD',
      duration: '3 days',
      note: null,
      incomplete: false,
      templateOriginal: {
        templateName: 'Toy template',
        dose: '1 tablet',
        frequency: 'BD',
        duration: '7 days',
        instructions: null,
      },
    },
    {
      id: 'm2',
      name: 'Hand-typed (FAKE)',
      source: 'free_text',
      strength: null,
      doseForm: null,
      dose: null,
      frequency: 'OD',
      duration: '1 day',
      note: null,
      incomplete: false,
      templateOriginal: null,
    },
  ],
  ...over,
});
const version = {
  version: 1,
  kind: 'signed',
  contentHash: 'a'.repeat(64),
  safetyConfigured: false,
  safetyNotRunAcknowledged: true,
  reason: null,
  signedBy: IDS.user('doctor'),
  signedAt: '2026-10-22T10:00:00.000Z',
  content: {},
};

async function open(routes: Record<string, Handler>, language: 'en' | 'gu' = 'en') {
  return renderApp({
    role: 'doctor',
    path: `/consult/${IDS.session}/sign`,
    language,
    routes: { 'GET /sessions/:id/sign-preview': () => ({ data: fakePreview() }), ...routes },
  });
}
const typePassword = (value = 'pw-for-test') =>
  fireEvent.change(screen.getByLabelText(/^Your password/), { target: { value } });
const signButton = () => screen.getByRole('button', { name: 'Sign visit' }) as HTMLButtonElement;

describe('Sign page: checklist', () => {
  it('lists the blockers the server names, in words, each with a link to fix it', async () => {
    await open({
      'GET /sessions/:id/sign-readiness': () => ({
        data: ready({
          blockers: [
            { code: 'unconfirmed_facts', count: 2 },
            { code: 'red_flag_unacknowledged', count: 1 },
            { code: 'no_working_condition', count: 1 },
            { code: 'incomplete_medicine', count: 1 },
            { code: 'consent_missing', count: 1 },
          ],
        }),
      }),
    });
    const list = await screen.findByRole('region', { name: 'What is left before signing' });
    expect(within(list).getByText('2 facts are not confirmed yet.')).toBeTruthy();
    expect(within(list).getByText('1 red flag is not acknowledged.')).toBeTruthy();
    const hrefs = within(list)
      .getAllByRole('link', { name: 'Fix this' })
      .map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual([
      `/consult/${IDS.session}#facts-region`,
      `/consult/${IDS.session}#red-flag-region`,
      `/consult/${IDS.session}#candidates-region`,
      `/consult/${IDS.session}?tab=prescription`,
      `/consult/${IDS.session}/consent`,
    ]);
  });

  it('the sign button stays off while a blocker exists, even with the password and the acknowledgement', async () => {
    await open({
      'GET /sessions/:id/sign-readiness': () => ({
        data: ready({ blockers: [{ code: 'unconfirmed_facts', count: 1 }] }),
      }),
    });
    await screen.findByText('1 fact is not confirmed yet.');
    typePassword();
    fireEvent.click(screen.getByLabelText('Safety checks were not run'));
    expect(signButton().disabled).toBe(true);
    expect(screen.getByText(/the list above is not clear/)).toBeTruthy();
  });
});

describe('Sign page: engine proposal beside the final', () => {
  it('shows the engine text and evidence beside the doctor final, and doctor-entered where there is no engine version', async () => {
    await open({ 'GET /sessions/:id/sign-readiness': () => ({ data: ready() }) });
    const diff = await screen.findByRole('region', { name: 'Engine proposal and final' });
    const edited = within(diff).getByRole('listitem', { name: 'Symptoms: toy final words' });
    expect(within(edited).getByText('toy engine words')).toBeTruthy();
    expect(within(edited).getByText(/toy quote/)).toBeTruthy();
    expect(within(edited).getByText('toy final words')).toBeTruthy();
    expect(within(edited).getByText('Edited by the doctor')).toBeTruthy();
    const manual = within(diff).getByRole('listitem', { name: /2 days toy/ });
    expect(within(manual).getAllByText('Doctor-entered').length).toBeGreaterThan(0);
  });

  it('shows the working condition as chosen with its rank among the engine candidates', async () => {
    await open({ 'GET /sessions/:id/sign-readiness': () => ({ data: ready() }) });
    const diff = await screen.findByRole('region', { name: 'Engine proposal and final' });
    expect(within(diff).getByText('Chosen from the engine’s list (rank 2)')).toBeTruthy();
  });

  it('shows a template line beside the edited row, names what changed, and never invents an original', async () => {
    await open({ 'GET /sessions/:id/sign-readiness': () => ({ data: ready() }) });
    const diff = await screen.findByRole('region', { name: 'Engine proposal and final' });
    const fromTemplate = within(diff).getByRole('listitem', { name: 'Drug-A (FAKE)' });
    expect(within(fromTemplate).getByText('Template: Toy template')).toBeTruthy();
    expect(within(fromTemplate).getByText(/7 days/)).toBeTruthy();
    expect(within(fromTemplate).getByText('Changed from the template: Duration')).toBeTruthy();
    const typed = within(diff).getByRole('listitem', { name: 'Hand-typed (FAKE)' });
    expect(within(typed).getAllByText('Doctor-entered').length).toBeGreaterThan(0);
    expect(within(typed).queryByText(/Template:/)).toBeNull();
  });

  it('a fact the doctor rejected is shown as removed, not signed', async () => {
    const p = fakePreview();
    const first = p.facts[0];
    if (!first) throw new Error('fixture');
    first.status = 'rejected';
    await open({
      'GET /sessions/:id/sign-readiness': () => ({ data: ready() }),
      'GET /sessions/:id/sign-preview': () => ({ data: p }),
    });
    expect(await screen.findByText('Removed by the doctor (not signed)')).toBeTruthy();
  });
});

describe('Sign page: acknowledgement, password, result', () => {
  it('needs the acknowledgement and the password, then sends them as typed', async () => {
    const { calls } = await open({
      'GET /sessions/:id/sign-readiness': () => ({ data: ready() }),
      'POST /sessions/:id/sign': () => ({ status: 201, data: version }),
    });
    expect(await screen.findByText('Safety checks are not configured')).toBeTruthy();
    expect(signButton().disabled).toBe(true);
    typePassword();
    expect(signButton().disabled).toBe(true);
    expect(screen.getByText(/Tick .Safety checks were not run. to continue/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Safety checks were not run'));
    expect(signButton().disabled).toBe(false);
    fireEvent.click(signButton());
    const result = await screen.findByRole('region', { name: 'Sign-off result' });
    expect(within(result).getByText('Visit signed')).toBeTruthy();
    expect(within(result).getByText(/a{64}/)).toBeTruthy();
    expect(within(result).getByText('Recorded: Safety checks were not run.')).toBeTruthy();
    expect(
      within(result).getByRole('link', { name: 'Open the visit record' }).getAttribute('href'),
    ).toBe(`/consult/${IDS.session}/record`);
    const post = calls.find((c) => c.method === 'POST' && c.path.endsWith('/sign'));
    expect(post?.body).toEqual({ password: 'pw-for-test', safetyNotRunAcknowledged: true });
  });

  it('a configured safety engine needs no acknowledgement box', async () => {
    await open({
      'GET /sessions/:id/sign-readiness': () => ({
        data: ready({ safety: { configured: true, blocked: 0, message: 'x' } }),
      }),
    });
    await screen.findByText('Nothing is blocking the sign-off.');
    expect(screen.queryByLabelText('Safety checks were not run')).toBeNull();
    typePassword();
    expect(signButton().disabled).toBe(false);
  });

  it('a safety-engine ERROR blocks signing with a clear message and nothing is skipped', async () => {
    await open({
      'GET /sessions/:id/sign-readiness': () => ({
        data: ready({ safety: { configured: true, blocked: 0, message: 'x', error: true } }),
      }),
    });
    expect(await screen.findByText('Safety checks failed to run')).toBeTruthy();
    typePassword();
    expect(signButton().disabled).toBe(true);
    expect(screen.getByText(/the safety checks failed to run/)).toBeTruthy();
    expect(screen.queryByLabelText('Safety checks were not run')).toBeNull();
  });

  it('the server stays the authority: a stale page still gets the named blockers back', async () => {
    let blockers: Blocker[] = [];
    await open({
      'GET /sessions/:id/sign-readiness': () => ({ data: ready({ blockers }) }),
      'POST /sessions/:id/sign': () => {
        blockers = [{ code: 'unconfirmed_facts', count: 1 }];
        return {
          status: 409,
          error: { code: 'SIGN_BLOCKED', message: 'x', details: { blockers } } as never,
        };
      },
    });
    await screen.findByText('Nothing is blocking the sign-off.');
    typePassword();
    fireEvent.click(screen.getByLabelText('Safety checks were not run'));
    fireEvent.click(signButton());
    expect(await screen.findByText('1 fact is not confirmed yet.')).toBeTruthy();
    expect(screen.getByText('This visit cannot be signed yet')).toBeTruthy();
    expect(signButton().disabled).toBe(true);
  });

  it('a wrong password, a lock-out and a server safety error are said plainly; the password is cleared', async () => {
    let code = 'INVALID_PASSWORD';
    await open({
      'GET /sessions/:id/sign-readiness': () => ({ data: ready() }),
      'POST /sessions/:id/sign': () => ({
        status: code === 'RATE_LIMITED' ? 429 : code === 'SAFETY_ERROR' ? 503 : 403,
        error: { code, message: 'x' },
      }),
    });
    await screen.findByText('Safety checks are not configured');
    fireEvent.click(screen.getByLabelText('Safety checks were not run'));
    typePassword('wrong');
    fireEvent.click(signButton());
    expect((await screen.findByRole('alert')).textContent).toBe('The password is not correct.');
    expect((screen.getByLabelText(/^Your password/) as HTMLInputElement).value).toBe('');
    code = 'RATE_LIMITED';
    typePassword('wrong');
    fireEvent.click(signButton());
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/Too many wrong passwords/),
    );
    code = 'SAFETY_ERROR';
    typePassword('wrong');
    fireEvent.click(signButton());
    await waitFor(() =>
      expect(
        screen
          .getAllByRole('alert')
          .map((a) => a.textContent)
          .join(' '),
      ).toMatch(/safety checks failed to run/),
    );
  });

  it('an already signed visit shows its version, a link to the record and no sign form', async () => {
    await open({
      'GET /sessions/:id/sign-readiness': () => ({
        data: ready({
          signed: true,
          currentVersion: 2,
          blockers: [{ code: 'session_not_draft', count: 1 }],
        }),
      }),
    });
    expect(await screen.findByText('This visit is signed (version 2).')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Sign visit' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Open the visit record' })).toBeTruthy();
  });

  it('works in Gujarati', async () => {
    await open({ 'GET /sessions/:id/sign-readiness': () => ({ data: ready() }) }, 'gu');
    expect(await screen.findByRole('button', { name: 'મુલાકાત પર સહી કરો' })).toBeTruthy();
    expect(screen.getByText('એન્જિને શું સૂચવ્યું અને શું સહી થશે')).toBeTruthy();
  });
});
