// App shell: skip link, permanent banner, top bar (menu, language, user), left navigation by role.
// Laptop (>= 1024px): fixed left column. Tablet and below: navigation opens in a drawer from the menu button.
import { AudioWaveform, LogOut, Menu } from 'lucide-react';
import { LayoutGroup, motion } from 'motion/react';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Button, IconButton } from '../components/ui/Button';
import { Drawer } from '../components/ui/Overlay';
import { PageTransition } from '../components/motion/motion';
import { cn } from '../components/ui/cn';
import { useAuth } from '../auth/AuthContext';
import { LanguageToggle } from './LanguageToggle';
import { navFor } from './nav';
import { SimulatedDataBanner } from './SimulatedDataBanner';

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation('shell');
  const { user } = useAuth();
  const group = useId(); // the aside and the drawer each get their own sliding highlight
  return (
    <nav aria-label={t('shell:nav.label')}>
      <LayoutGroup id={group}>
        <ul className="flex flex-col gap-1">
          {navFor(user?.role ?? 'staff').map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cn(
                    'group relative flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-base font-semibold text-ink transition-colors duration-(--motion-fast)',
                    !isActive && 'hover:bg-sunken',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive ? (
                      <motion.span
                        layoutId="nav-active"
                        aria-hidden="true"
                        className="absolute inset-0 rounded-md border-l-4 border-ink bg-selected shadow-card"
                        transition={{ type: 'spring', stiffness: 420, damping: 36 }}
                      />
                    ) : null}
                    <item.icon
                      aria-hidden="true"
                      className="relative size-5 shrink-0 transition-transform duration-(--motion-base) group-hover:scale-110"
                    />
                    <span className="relative">{t(item.labelKey)}</span>
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </LayoutGroup>
    </nav>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (
    (parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '')
  ).toUpperCase();
}

export function AppShell() {
  const { t } = useTranslation('shell');
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  // single-page navigation (Phase 12B accessibility audit, WCAG 2.4.2 and 2.4.3): after every route change the page title follows
  // the page's own heading, and focus moves to the main region so keyboard and screen-reader users start at the new content
  // instead of on a link that is no longer there. Not on the first load.
  const location = useLocation();
  const firstLoad = useRef(true);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const heading = document.querySelector('main h1')?.textContent?.trim();
      if (heading) document.title = `${heading} - VaaniEHR`;
      if (!firstLoad.current) document.getElementById('main')?.focus({ preventScroll: true });
      firstLoad.current = false;
    }, 150);
    return () => window.clearTimeout(timer);
  }, [location.pathname]);
  return (
    <div className="bg-aurora flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only-focusable absolute top-2 left-2 z-50 rounded-md bg-action px-4 py-3 text-base font-semibold text-on-action"
      >
        {t('shell:skip')}
      </a>
      <SimulatedDataBanner />
      <header className="glass sticky top-0 z-30 flex flex-wrap items-center gap-3 border-b border-line px-4 py-2 shadow-card">
        <IconButton
          icon={Menu}
          label={t('shell:nav.open')}
          aria-haspopup="dialog"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(true)}
          className="lg:hidden"
        />
        <p className="flex items-center gap-2.5 font-display text-xl font-semibold text-ink">
          <span
            aria-hidden="true"
            className="grid size-9 place-items-center rounded-md bg-action text-on-action shadow-card"
          >
            <AudioWaveform className="size-5" />
          </span>
          {t('common:appName')}
        </p>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <LanguageToggle />
          {user ? (
            <>
              <p className="inline-flex items-center gap-2 text-sm text-ink">
                <span
                  aria-hidden="true"
                  className="grid size-8 place-items-center rounded-full bg-selected text-xs font-bold text-ink"
                >
                  {initials(user.name)}
                </span>
                <span>
                  <span className="font-semibold">{user.name}</span>
                  <span className="text-body"> ({t(`shell:role.${user.role}`)})</span>
                </span>
              </p>
              <Button icon={LogOut} onClick={() => void logout()}>
                {t('shell:signOut')}
              </Button>
            </>
          ) : null}
        </div>
      </header>
      <div className="flex flex-1">
        <aside className="hidden w-64 shrink-0 border-r border-line bg-card/70 p-3 lg:sticky lg:top-16 lg:block lg:h-[calc(100vh-4rem)] lg:self-start">
          <NavList />
        </aside>
        <main id="main" tabIndex={-1} className="min-w-0 flex-1 p-4 outline-none md:p-6">
          <PageTransition>
            <Outlet />
          </PageTransition>
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
