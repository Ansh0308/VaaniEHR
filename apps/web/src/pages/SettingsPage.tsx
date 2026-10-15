// PG-18 Settings and About (everyone): language, who is signed in, API status, the intended-use statement
// (PRD section 1.6, quoted as written) and the licence list of the shipped web dependencies.
import { LogOut } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import licences from '../licensing/licences.generated.json';
import { useRequest } from '../api/useRequest';
import { useAuth } from '../auth/AuthContext';
import { NeedsReview } from '../components/NeedsReview';
import { StateBadge } from '../components/ui/Badge';
import { Banner } from '../components/ui/Banner';
import { Button } from '../components/ui/Button';
import { Skeleton } from '../components/ui/Feedback';
import { Table, type Column } from '../components/ui/Table';
import { LanguageToggle } from '../shell/LanguageToggle';

interface Licence {
  name: string;
  version: string;
  licence: string;
}

interface Status {
  health: boolean;
  database: boolean;
  simulatedDataOnly: boolean | null;
}

export function SettingsPage() {
  const { t, i18n } = useTranslation('settings');
  const { api, user, logout } = useAuth();

  const status = useRequest<Status>(async () => {
    const [health, ready, config] = await Promise.allSettled([
      api.root('/health'),
      api.root('/ready'),
      api.root<{ simulatedDataOnly: boolean }>('/config/public'),
    ]);
    return {
      health: health.status === 'fulfilled',
      database: ready.status === 'fulfilled',
      simulatedDataOnly: config.status === 'fulfilled' ? config.value.simulatedDataOnly : null,
    };
  }, [api]);

  const columns: Column<Licence>[] = [
    { key: 'name', header: t('settings:licences.package'), render: (l) => l.name },
    { key: 'version', header: t('settings:licences.version'), render: (l) => l.version },
    { key: 'licence', header: t('settings:licences.licence'), render: (l) => l.licence },
  ];

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8">
      <header>
        <h1 className="font-display text-3xl font-semibold text-ink">{t('settings:title')}</h1>
      </header>

      <section aria-labelledby="lang-heading" className="flex flex-col gap-3">
        <h2 id="lang-heading" className="text-2xl font-semibold text-ink">
          {t('settings:language.heading')}
        </h2>
        <p className="text-sm text-body">{t('settings:language.body')}</p>
        <div>
          <LanguageToggle />
        </div>
      </section>

      <section aria-labelledby="account-heading" className="flex flex-col gap-3">
        <h2 id="account-heading" className="text-2xl font-semibold text-ink">
          {t('settings:account.heading')}
        </h2>
        {user ? (
          <dl className="grid gap-x-6 gap-y-1 text-base sm:grid-cols-2">
            <div>
              <dt className="text-sm text-body">{t('settings:account.name')}</dt>
              <dd className="font-semibold text-ink">{user.name}</dd>
            </div>
            <div>
              <dt className="text-sm text-body">{t('settings:account.role')}</dt>
              <dd className="font-semibold text-ink">{t(`shell:role.${user.role}`)}</dd>
            </div>
          </dl>
        ) : null}
        <div>
          <Button icon={LogOut} onClick={() => void logout()}>
            {t('settings:account.signOut')}
          </Button>
        </div>
      </section>

      <section aria-labelledby="status-heading" className="flex flex-col gap-3">
        <h2 id="status-heading" className="text-2xl font-semibold text-ink">
          {t('settings:status.heading')}
        </h2>
        {status.state.status === 'loading' ? (
          <Skeleton lines={2} label={t('settings:status.loading')} />
        ) : status.state.status === 'error' ? (
          <Banner kind="acknowledge" live>
            {t('settings:status.unknown')}
          </Banner>
        ) : (
          <ul className="flex flex-col gap-2 text-base text-ink">
            <li className="flex flex-wrap items-center gap-3">
              <span>{t('settings:status.api')}</span>
              <StateBadge
                state={status.state.data.health ? 'clear' : 'blocked'}
                label={
                  status.state.data.health ? t('settings:status.up') : t('settings:status.down')
                }
              />
            </li>
            <li className="flex flex-wrap items-center gap-3">
              <span>{t('settings:status.database')}</span>
              <StateBadge
                state={status.state.data.database ? 'clear' : 'blocked'}
                label={
                  status.state.data.database ? t('settings:status.up') : t('settings:status.down')
                }
              />
            </li>
            <li className="flex flex-wrap items-center gap-3">
              <span>{t('settings:status.simulated')}</span>
              <StateBadge
                state={status.state.data.simulatedDataOnly === true ? 'clear' : 'blocked'}
                label={
                  status.state.data.simulatedDataOnly === true
                    ? t('settings:status.simulatedOn')
                    : t('settings:status.simulatedUnknown')
                }
              />
            </li>
          </ul>
        )}
        <div>
          <Button onClick={status.reload}>{t('settings:status.refresh')}</Button>
        </div>
      </section>

      <section aria-labelledby="about-heading" className="flex flex-col gap-3">
        <h2 id="about-heading" className="text-2xl font-semibold text-ink">
          {t('settings:about.heading')}
        </h2>
        <Banner kind="acknowledge" title={t('settings:about.prototypeTitle')}>
          {t('settings:about.prototypeBody')}
        </Banner>
        <h3 className="text-lg font-semibold text-ink">{t('settings:about.intendedUseHeading')}</h3>
        <blockquote className="border-s-4 border-line ps-4 text-base text-ink">
          {t('settings:about.intendedUse')}
        </blockquote>
        {i18n.language === 'gu' ? <NeedsReview /> : null}
      </section>

      <section aria-labelledby="licences-heading" className="flex flex-col gap-3">
        <h2 id="licences-heading" className="text-2xl font-semibold text-ink">
          {t('settings:licences.heading')}
        </h2>
        <p className="text-sm text-body">{t('settings:licences.intro')}</p>
        <Table
          caption={t('settings:licences.caption')}
          columns={columns}
          rows={licences as Licence[]}
          getRowId={(l) => l.name}
          emptyText={t('settings:licences.empty')}
        />
        <p className="text-sm text-body">{t('settings:licences.more')}</p>
      </section>
    </div>
  );
}
