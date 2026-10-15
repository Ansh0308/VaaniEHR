// PG-18 Settings / About: language, account, system status, intended-use statement, licence list.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import packageJson from '../../package.json';
import licences from '../licensing/licences.generated.json';
import { cleanupApp, renderApp, type Handler } from '../test-utils/harness';

afterEach(cleanupApp);

const up: Record<string, Handler> = {
  'GET /health': () => ({ data: { status: 'ok' } }),
  'GET /ready': () => ({ data: { status: 'ready' } }),
  'GET /config/public': () => ({ data: { simulatedDataOnly: true, authProvider: 'dev' } }),
};

describe('settings and about', () => {
  it('shows who is signed in and signs out', async () => {
    const view = await renderApp({ role: 'researcher', path: '/settings', routes: up });
    await screen.findByRole('heading', { name: 'Settings and about', level: 1 });
    const section = screen
      .getByRole('heading', { name: 'Your account' })
      .closest('section') as HTMLElement;
    expect(within(section).getByText('Fake researcher')).toBeTruthy();
    expect(within(section).getByText('Researcher')).toBeTruthy();
    fireEvent.click(within(section).getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(view.callsTo('POST', '/auth/logout')).toHaveLength(1));
  });

  it('every role can open it', async () => {
    for (const role of ['doctor', 'staff', 'admin', 'researcher'] as const) {
      await renderApp({ role, path: '/settings', routes: up });
      expect(
        await screen.findByRole('heading', { name: 'Settings and about', level: 1 }),
      ).toBeTruthy();
      cleanupApp();
    }
  });

  it('shows system status with icon and text, never colour alone', async () => {
    await renderApp({ role: 'admin', path: '/settings', routes: up });
    const section = (await screen.findByRole('heading', { name: 'System status' })).closest(
      'section',
    ) as HTMLElement;
    await waitFor(() => expect(within(section).getAllByText('Working')).toHaveLength(2));
    expect(within(section).getByText('On')).toBeTruthy();
  });

  it('reports an unreachable database honestly', async () => {
    await renderApp({
      role: 'admin',
      path: '/settings',
      routes: { ...up, 'GET /ready': () => ({ status: 503, error: { code: 'NOT_READY' } }) },
    });
    const section = (await screen.findByRole('heading', { name: 'System status' })).closest(
      'section',
    ) as HTMLElement;
    expect(await within(section).findByText('Not reachable')).toBeTruthy();
    expect(within(section).getByText('Working')).toBeTruthy(); // the server itself is fine
  });

  it('states the intended use exactly as written in PRD section 1.6, and that it is not for real patients', async () => {
    await renderApp({ role: 'doctor', path: '/settings', routes: up });
    const quote =
      (
        await screen.findByText(
          /VaaniEHR is a research prototype that helps a registered medical practitioner/,
        )
      ).textContent ?? '';
    expect(quote).toContain('it does not diagnose, treat, or replace clinical judgement');
    expect(quote).toContain(
      'Every clinical output requires review and sign-off by the practitioner',
    );
    expect(quote).toContain('not approved for use with real patients');
    expect(screen.getByText('Research prototype. Simulated data only.')).toBeTruthy();
  });

  it('lists the licence of every shipped web dependency', async () => {
    await renderApp({ role: 'staff', path: '/settings', routes: up });
    const table = await screen.findByRole('table', {
      name: "Licences of the web app's dependencies",
    });
    const names = Object.keys(packageJson.dependencies).sort();
    expect(licences.map((l) => l.name)).toEqual(names);
    for (const l of licences) {
      const cell = within(table).getByText(l.name);
      const rowText = cell.closest('tr')?.textContent ?? '';
      expect(rowText).toContain(l.version);
      expect(rowText).toContain(l.licence);
    }
  });

  it('can be read in Gujarati, with the intended-use translation flagged for review', async () => {
    await renderApp({ role: 'doctor', path: '/settings', routes: up, language: 'gu' });
    expect(
      await screen.findByRole('heading', { name: 'સેટિંગ્સ અને માહિતી', level: 1 }),
    ).toBeTruthy();
    expect(screen.getAllByText('Needs review by a Gujarati speaker').length).toBeGreaterThan(0);
  });
});
