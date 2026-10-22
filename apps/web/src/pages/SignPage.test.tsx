// PG-09 minimal sign page (Phase 8 Run 1): the server's blockers in words, the "Safety checks were not run"
// acknowledgement, password re-entry, the server's refusals, and the signed result. The page never decides by itself.
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Blocker, SignReadiness } from '../api/prescription';
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
    routes,
  });
}
const typePassword = (value = 'pw-for-test') =>
  fireEvent.change(screen.getByLabelText(/^Your password/), { target: { value } });

describe('Sign page', () => {
  it('shows the blockers the server names, in words with counts', async () => {
    await open({
      'GET /sessions/:id/sign-readiness': () => ({
        data: ready({
          blockers: [
            { code: 'unconfirmed_facts', count: 2 },
            { code: 'red_flag_unacknowledged', count: 1 },
            { code: 'incomplete_medicine', count: 1 },
          ],
        }),
      }),
    });
    expect(await screen.findByText('2 facts are not confirmed yet.')).toBeTruthy();
    expect(screen.getByText('1 red flag is not acknowledged.')).toBeTruthy();
    expect(screen.getByText('1 medicine row has no frequency or duration.')).toBeTruthy();
  });

  it('needs the password, shows the unconfigured-safety notice and sends the acknowledgement as typed', async () => {
    const { calls } = await open({
      'GET /sessions/:id/sign-readiness': () => ({ data: ready() }),
      'POST /sessions/:id/sign': () => ({ status: 201, data: version }),
    });
    expect(await screen.findByText('Safety checks are not configured')).toBeTruthy();
    const button = screen.getByRole('button', { name: 'Sign visit' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    typePassword();
    expect(button.disabled).toBe(false);
    fireEvent.click(screen.getByLabelText('Safety checks were not run'));
    fireEvent.click(button);
    expect((await screen.findByText('Visit signed')).textContent).toBeTruthy();
    expect(screen.getByText(/a{64}/)).toBeTruthy();
    expect(screen.getByText('Recorded: Safety checks were not run.')).toBeTruthy();
    const post = calls.find((c) => c.method === 'POST' && c.path.endsWith('/sign'));
    expect(post?.body).toEqual({ password: 'pw-for-test', safetyNotRunAcknowledged: true });
  });

  it('without the acknowledgement it still asks the server, and says what the server answered', async () => {
    const { calls } = await open({
      'GET /sessions/:id/sign-readiness': () => ({ data: ready() }),
      'POST /sessions/:id/sign': () => ({
        status: 400,
        error: { code: 'SAFETY_ACK_REQUIRED', message: 'x' },
      }),
    });
    await screen.findByText('Safety checks are not configured');
    typePassword();
    fireEvent.click(screen.getByRole('button', { name: 'Sign visit' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /Tick .Safety checks were not run/,
    );
    const post = calls.find((c) => c.method === 'POST' && c.path.endsWith('/sign'));
    expect(post?.body).toMatchObject({ safetyNotRunAcknowledged: false });
    expect((screen.getByLabelText(/^Your password/) as HTMLInputElement).value).toBe(''); // never kept
  });

  it('a refused sign-off lists the blockers from the server and reads the page state again', async () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'Sign visit' }));
    expect(await screen.findByText('1 fact is not confirmed yet.')).toBeTruthy();
    expect(screen.getByText('This visit cannot be signed yet')).toBeTruthy();
  });

  it('a wrong password and a lock-out are said plainly', async () => {
    let code = 'INVALID_PASSWORD';
    await open({
      'GET /sessions/:id/sign-readiness': () => ({ data: ready() }),
      'POST /sessions/:id/sign': () => ({
        status: code === 'INVALID_PASSWORD' ? 403 : 429,
        error: { code, message: 'x' },
      }),
    });
    await screen.findByText('Safety checks are not configured');
    fireEvent.click(screen.getByLabelText('Safety checks were not run'));
    typePassword('wrong');
    fireEvent.click(screen.getByRole('button', { name: 'Sign visit' }));
    expect((await screen.findByRole('alert')).textContent).toBe('The password is not correct.');
    code = 'RATE_LIMITED';
    typePassword('wrong');
    fireEvent.click(screen.getByRole('button', { name: 'Sign visit' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/Too many wrong passwords/),
    );
  });

  it('a configured safety engine needs no acknowledgement box', async () => {
    await open({
      'GET /sessions/:id/sign-readiness': () => ({
        data: ready({ safety: { configured: true, blocked: 0, message: 'x' } }),
      }),
    });
    await screen.findByText('Nothing is blocking the sign-off.');
    expect(screen.queryByLabelText('Safety checks were not run')).toBeNull();
  });

  it('an already signed visit shows its version and no sign form', async () => {
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
  });

  it('works in Gujarati', async () => {
    await open({ 'GET /sessions/:id/sign-readiness': () => ({ data: ready() }) }, 'gu');
    expect(await screen.findByRole('button', { name: 'મુલાકાત પર સહી કરો' })).toBeTruthy();
  });
});
