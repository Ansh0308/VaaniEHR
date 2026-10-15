// Frame for pages that need no sign-in and show no data (the design-system specimen): banner, language switch, content.
import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { AppShell } from './AppShell';
import { LanguageToggle } from './LanguageToggle';
import { SimulatedDataBanner } from './SimulatedDataBanner';

function PublicFrame() {
  const { t } = useTranslation('shell');
  return (
    <div className="flex min-h-screen flex-col bg-page">
      <a
        href="#main"
        className="sr-only-focusable absolute top-2 left-2 z-50 rounded-md bg-action px-4 py-3 text-base font-semibold text-on-action"
      >
        {t('shell:skip')}
      </a>
      <SimulatedDataBanner />
      <header className="flex flex-wrap items-center gap-3 border-b border-line bg-card px-4 py-2">
        <p className="text-lg font-bold text-ink">{t('common:appName')}</p>
        <div className="ml-auto">
          <LanguageToggle />
        </div>
      </header>
      <main id="main" tabIndex={-1} className="min-w-0 flex-1 p-4 md:p-6">
        <Outlet />
      </main>
    </div>
  );
}

/** Signed in: the normal app shell. Signed out: a plain frame (the page shows no patient data). */
export function ShellOrPublic() {
  const { user } = useAuth();
  return user ? <AppShell /> : <PublicFrame />;
}
