// App shell: skip link, permanent banner, top bar (menu, language, user), left navigation by role.
// Laptop (>= 1024px): fixed left column. Tablet and below: navigation opens in a drawer from the menu button.
import { Menu, User } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet } from 'react-router-dom';
import { IconButton } from '../components/ui/Button';
import { Drawer } from '../components/ui/Overlay';
import { cn } from '../components/ui/cn';
import { useDemoSession } from '../demo/session';
import { LanguageToggle } from './LanguageToggle';
import { navFor } from './nav';
import { SimulatedDataBanner } from './SimulatedDataBanner';

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation('shell');
  const { role } = useDemoSession();
  return (
    <nav aria-label={t('shell:nav.label')}>
      <ul className="flex flex-col gap-1">
        {navFor(role).map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  'flex min-h-11 items-center gap-3 rounded-md border-l-4 px-3 py-2 text-base font-semibold text-ink',
                  isActive ? 'border-ink bg-selected' : 'border-transparent hover:bg-sunken',
                )
              }
            >
              <item.icon aria-hidden="true" className="size-5 shrink-0" />
              {t(item.labelKey)}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function AppShell() {
  const { t } = useTranslation('shell');
  const { role, userName } = useDemoSession();
  const [menuOpen, setMenuOpen] = useState(false);
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
        <IconButton
          icon={Menu}
          label={t('shell:nav.open')}
          aria-haspopup="dialog"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(true)}
          className="lg:hidden"
        />
        <p className="text-lg font-bold text-ink">{t('common:appName')}</p>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <LanguageToggle />
          <p className="inline-flex items-center gap-2 text-sm text-ink">
            <User aria-hidden="true" className="size-5" />
            <span>
              <span className="font-semibold">{userName}</span>
              <span className="text-body"> ({t(`shell:role.${role}`)})</span>
            </span>
          </p>
        </div>
      </header>
      <div className="flex flex-1">
        <aside className="hidden w-64 shrink-0 border-r border-line bg-card p-3 lg:block">
          <NavList />
        </aside>
        <main id="main" tabIndex={-1} className="min-w-0 flex-1 p-4 md:p-6">
          <Outlet />
        </main>
      </div>
      <Drawer
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        side="left"
        title={t('shell:nav.label')}
      >
        <NavList onNavigate={() => setMenuOpen(false)} />
      </Drawer>
    </div>
  );
}
