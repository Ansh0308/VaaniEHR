import { FlaskConical } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { config } from '../config';

/**
 * Permanent "research prototype - simulated data only" banner (AGENTS.md Hard Rule 1, NFR-PRIV-02).
 * Not dismissible and always rendered: there is no prop or setting that hides it.
 */
export function SimulatedDataBanner() {
  const { t } = useTranslation('shell');
  return (
    <div
      role="region"
      aria-label={t('shell:banner.label')}
      className="flex items-center justify-center gap-2 border-b border-acknowledge-accent bg-acknowledge-bg px-4 py-2 text-center text-sm font-semibold text-acknowledge-fg"
    >
      <FlaskConical aria-hidden="true" className="size-4 shrink-0" />
      <span>{t('shell:banner.text')}</span>
      {config.simulatedDataOnly ? null : (
        <span className="font-bold">{t('shell:banner.configError')}</span>
      )}
    </div>
  );
}
