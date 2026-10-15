// ConsentPanel (PRD F1, PG-05, FR-F1-01..05): three separate scopes, the notice in English and Gujarati side by
// side, a version, and a withdraw action. The notice text here is a PLACEHOLDER: the legal wording must be
// supplied and approved by the owner and the institution, and the Gujarati needs review (Hard Rule 3).
import { ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { NeedsReview } from '../NeedsReview';
import { Banner } from '../ui/Banner';
import { Button } from '../ui/Button';
import { Switch } from '../ui/Switch';

export type ConsentScope = 'audio' | 'aiProcessing' | 'whatsapp';
export type ConsentState = Record<ConsentScope, boolean>;

export interface ConsentPanelProps {
  scopes: ConsentState;
  noticeVersion: string;
  onChange: (scope: ConsentScope, value: boolean) => void;
  onWithdraw: () => void;
}

const SCOPES: ConsentScope[] = ['audio', 'aiProcessing', 'whatsapp'];

export function ConsentPanel({ scopes, noticeVersion, onChange, onWithdraw }: ConsentPanelProps) {
  const { t, i18n } = useTranslation('clinical');
  const en = i18n.getFixedT('en', 'clinical');
  const gu = i18n.getFixedT('gu', 'clinical');
  const recordingAllowed = scopes.audio && scopes.aiProcessing;
  return (
    <section
      aria-label={t('clinical:consent.region')}
      className="flex flex-col gap-4 rounded-lg border border-control bg-card p-4"
    >
      <div className="flex items-center gap-2">
        <ShieldCheck aria-hidden="true" className="size-6 text-ink" />
        <h3 className="text-lg font-semibold text-ink">{t('clinical:consent.heading')}</h3>
        <span className="text-sm text-body">
          {t('clinical:consent.version', { version: noticeVersion })}
        </span>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div lang="en" className="rounded-md border border-line bg-sunken p-3">
          <p className="text-sm font-semibold text-ink">{en('clinical:consent.noticeTitle')}</p>
          <p className="mt-1 text-sm text-body">{en('clinical:consent.noticePlaceholder')}</p>
        </div>
        <div lang="gu" className="rounded-md border border-line bg-sunken p-3">
          <p className="text-sm font-semibold text-ink">{gu('clinical:consent.noticeTitle')}</p>
          <p className="mt-1 text-sm text-body">{gu('clinical:consent.noticePlaceholder')}</p>
          <NeedsReview />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {SCOPES.map((scope) => (
          <Switch
            key={scope}
            label={t(`clinical:consent.scope.${scope}.label`)}
            description={t(`clinical:consent.scope.${scope}.desc`)}
            checked={scopes[scope]}
            onChange={(value) => onChange(scope, value)}
            onText={t('clinical:consent.on')}
            offText={t('clinical:consent.off')}
          />
        ))}
      </div>

      <Banner kind={recordingAllowed ? 'clear' : 'acknowledge'} live>
        {recordingAllowed
          ? t('clinical:consent.recordingAllowed')
          : t('clinical:consent.recordingOff')}
      </Banner>

      <div>
        <Button onClick={onWithdraw}>{t('common:action.withdraw')}</Button>
      </div>
    </section>
  );
}
