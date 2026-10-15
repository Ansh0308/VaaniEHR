// Pages that exist in the PRD page list but are built in later phases (and the 404 page, PG-19).
import { Construction, SearchX } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';
import { EmptyState } from '../components/ui/Feedback';
import { NAV_ITEMS } from '../shell/nav';

const linkClass =
  'inline-flex min-h-11 items-center rounded-md border border-transparent bg-action px-4 py-2 text-base font-semibold text-on-action hover:bg-action-hover';

export function PlaceholderPage() {
  const { t } = useTranslation('shell');
  const { pathname } = useLocation();
  const item = NAV_ITEMS.find(
    (candidate) => pathname === candidate.to || pathname.startsWith(`${candidate.to}/`),
  );
  if (!item) {
    return (
      <div className="mx-auto max-w-2xl">
        <h1 className="mb-6 font-display text-3xl font-semibold text-ink">
          {t('shell:notFound.title')}
        </h1>
        <EmptyState
          icon={SearchX}
          title={t('shell:notFound.heading')}
          description={t('shell:notFound.body')}
          headingLevel={2}
          action={
            <Link to="/design" className={linkClass}>
              {t('shell:placeholder.open')}
            </Link>
          }
        />
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-6 font-display text-3xl font-semibold text-ink">{t(item.labelKey)}</h1>
      <EmptyState
        icon={Construction}
        title={t('shell:placeholder.title')}
        description={t('shell:placeholder.body', { pg: item.pg ?? '' })}
        headingLevel={2}
        action={
          <Link to="/design" className={linkClass}>
            {t('shell:placeholder.open')}
          </Link>
        }
      />
    </div>
  );
}
