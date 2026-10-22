// Previous visits (PG-06 side list): this doctor's earlier SIGNED visits for the same patient, newest first, each linking to
// the read-only visit record (PG-10). Nothing is shown for the current visit or for other doctors' visits.
import { History } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { PreviousVisit } from '../../api/prescription';
import { formatDateTime } from '../../api/format';

export function PreviousVisits({ visits }: { visits: PreviousVisit[] | null }) {
  const { t, i18n } = useTranslation('consult');
  if (visits === null) return null;
  return (
    <section
      aria-label={t('consult:previous.region')}
      className="flex flex-col gap-2 rounded-lg border border-line bg-card p-4"
    >
      <h2 className="flex items-center gap-2 font-display text-xl font-semibold text-ink">
        <History aria-hidden="true" className="size-5" />
        {t('consult:previous.title')}
      </h2>
      {visits.length === 0 ? (
        <p className="text-sm text-body">{t('consult:previous.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {visits.map((v) => (
            <li key={v.sessionId} className="flex flex-wrap items-center gap-x-3 text-sm text-ink">
              <Link
                to={`/consult/${v.sessionId}/record`}
                className="inline-flex min-h-11 items-center font-semibold underline"
              >
                {formatDateTime(v.signedAt, i18n.language)}
              </Link>
              <span>
                {t('consult:previous.counts', {
                  version: v.currentVersion,
                  facts: v.factCount,
                  medicines: v.medicineCount,
                })}
              </span>
              {v.safetyNotRun ? (
                <span className="font-semibold">{t('consult:record.safetyNotRunShort')}</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
