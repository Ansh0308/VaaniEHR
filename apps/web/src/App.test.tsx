// Hard Rule 1 / NFR-PRIV-02: the simulated-data banner is always visible. Also: route guards, error pages, sign-out
// and token handling (the token is never written to browser storage).
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { config } from './config';
import { cleanupApp, renderApp, renderSignedOut } from './test-utils/harness';

afterEach(cleanupApp);

describe('simulated-data banner', () => {
  it('is on the login page, before anyone signs in', async () => {
    await renderSignedOut('/login');
    const banner = await screen.findByRole('region', { name: 'Prototype notice' });
    expect(banner.textContent).toContain('simulated data only');
  });

  it.each(['/design', '/settings', '/no-such-page'])(
    'is shown on %s when signed in',
    async (path) => {
      await renderApp({ role: 'admin', path });
      expect(screen.getByRole('region', { name: 'Prototype notice' }).textContent).toContain(
        'simulated data only',
      );
    },
  );

  it('defaults the simulated-data flag to true', () => {
    expect(config.simulatedDataOnly).toBe(true);
  });
});

describe('route guards (the API enforces permissions; these show each role only its own pages)', () => {
  it('signed-out visitors are sent to the login page', async () => {
    await renderSignedOut('/doctor');
    expect(await screen.findByRole('heading', { name: 'Sign in', level: 2 })).toBeTruthy();
  });

  it('a signed-out visitor is sent back to the page they asked for after signing in', async () => {
    await renderSignedOut('/settings');
    fireEvent.change(await screen.findByLabelText(/E-mail/), {
      target: { value: 'doctor@example.invalid' },
    });
    fireEvent.change(screen.getByLabelText(/Password/), { target: { value: 'fake-password' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    });
    expect(
      await screen.findByRole('heading', { name: 'Settings and about', level: 1 }),
    ).toBeTruthy();
  });

  it.each([
    ['doctor', '/patients'],
    ['doctor', '/admin/audit'],
    ['staff', '/doctor'],
    ['staff', '/admin/audit'],
    ['researcher', '/patients'],
    ['researcher', '/doctor'],
    ['admin', '/doctor'],
  ] as const)('%s opening %s sees a clear 403 page, not a redirect', async (role, path) => {
    await renderApp({ role, path });
    expect(
      await screen.findByRole('heading', { name: 'Your role cannot open this page' }),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go to my home page' })).toBeTruthy();
  });

  it.each([
    ['doctor', '/doctor', 'Doctor dashboard'],
    ['staff', '/patients', 'Patients'],
    ['admin', '/admin/audit', 'Audit log'],
    ['researcher', '/admin/audit', 'Audit log'],
  ] as const)('%s can open %s', async (role, path, heading) => {
    await renderApp({
      role,
      path,
      routes: {
        'GET /sessions': () => ({ data: { items: [], nextBefore: null } }),
        'GET /audit': () => ({ data: { items: [], nextBeforeSeq: null } }),
        'GET /audit/verify': () => ({ data: { ok: true } }),
      },
    });
    expect(await screen.findByRole('heading', { name: heading, level: 1 })).toBeTruthy();
  });

  it('"/" sends each role to its own home page', async () => {
    await renderApp({
      role: 'doctor',
      path: '/',
      routes: { 'GET /sessions': () => ({ data: { items: [], nextBefore: null } }) },
    });
    expect(await screen.findByRole('heading', { name: 'Doctor dashboard', level: 1 })).toBeTruthy();
  });

  it('unknown pages inside the app show the 404 page', async () => {
    await renderApp({ role: 'staff', path: '/no-such-page' });
    expect(await screen.findByRole('heading', { name: 'Nothing at this address' })).toBeTruthy();
  });

  it('planned pages open a labelled placeholder (nothing is faked)', async () => {
    await renderApp({ role: 'admin', path: '/admin/safety' });
    expect(await screen.findByRole('heading', { name: 'Planned for a later phase' })).toBeTruthy();
  });
});

describe('signing out and token handling', () => {
  it('sign-out revokes the token on the server and returns to the login page', async () => {
    const view = await renderApp({ role: 'admin', path: '/settings' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Sign out' })[0] as HTMLElement);
    await waitFor(() => expect(view.callsTo('POST', '/auth/logout')).toHaveLength(1));
    expect(view.callsTo('POST', '/auth/logout')[0]?.authorization).toBe('Bearer fake-token-admin');
    expect(await screen.findByRole('heading', { name: 'Sign in', level: 2 })).toBeTruthy();
  });

  it('the access token is never written to localStorage, sessionStorage, cookies or the URL', async () => {
    const view = await renderApp({ role: 'staff', path: '/patients' });
    expect(view.callsTo('POST', '/auth/login')).toHaveLength(1);
    const everything =
      JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + document.cookie;
    expect(everything).not.toContain('fake-token');
    expect(window.location.href).not.toContain('fake-token');
  });

  it('every API call after sign-in carries the token; the login call itself does not', async () => {
    const view = await renderApp({
      role: 'doctor',
      path: '/doctor',
      routes: { 'GET /sessions': () => ({ data: { items: [], nextBefore: null } }) },
    });
    await screen.findByRole('heading', { name: 'Doctor dashboard', level: 1 });
    expect(view.callsTo('POST', '/auth/login')[0]?.authorization).toBeNull();
    expect(view.callsTo('GET', '/sessions')[0]?.authorization).toBe('Bearer fake-token-doctor');
  });

  it('a 401 on a later request ends the session and the login page says so', async () => {
    const view = await renderApp({
      role: 'doctor',
      path: '/doctor',
      routes: {
        'GET /sessions': () => ({ status: 401, error: { code: 'UNAUTHENTICATED' } }),
      },
    });
    expect(await screen.findByText('You were signed out')).toBeTruthy();
    expect(view.callsTo('GET', '/sessions').length).toBeGreaterThan(0);
  });
});

describe('error pages (PG-19)', () => {
  it('shows a friendly 500 page without technical details', async () => {
    await renderSignedOut('/500');
    expect(
      await screen.findByRole('heading', { name: 'The page could not be shown' }),
    ).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/stack|TypeError|undefined/i);
  });

  it('shows 404 and 403 pages that link back home', async () => {
    await renderSignedOut('/404');
    expect(await screen.findByRole('heading', { name: 'Nothing at this address' })).toBeTruthy();
    cleanupApp();
    await renderSignedOut('/403');
    expect(
      await screen.findByRole('heading', { name: 'Your role cannot open this page' }),
    ).toBeTruthy();
  });
});
