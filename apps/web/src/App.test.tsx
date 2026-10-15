// Hard Rule 1 / NFR-PRIV-02: the simulated-data banner is always visible.
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import App from './App';
import { ToastProvider } from './components/ui/Toast';
import { config } from './config';
import { DemoSessionProvider } from './demo/session';
import i18n from './i18n';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <DemoSessionProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </DemoSessionProvider>
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe('App shell', () => {
  it.each(['/design', '/patients', '/no-such-page'])(
    'always shows the simulated-data banner on %s',
    async (path) => {
      await i18n.changeLanguage('en');
      renderAt(path);
      const banner = screen.getByRole('region', { name: 'Prototype notice' });
      expect(banner.textContent).toContain('simulated data only');
    },
  );

  it('defaults the simulated-data flag to true', () => {
    expect(config.simulatedDataOnly).toBe(true);
  });
});
