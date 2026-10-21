// RedFlagBanner (FR-F4-03; Phase 6C): shown while a pathway red-flag condition is met and the doctor has not yet pressed
// Acknowledge. Assertive (role="alert"), icon plus words (never colour alone), it stays until Acknowledge is pressed (the
// existing route, audited). The wording is neutral and gives no advice about what to do for the patient.
import { TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { NextQuestion } from '../../api/pathwayAids';
import { Button } from '../ui/Button';

export function RedFlagBanner({
  next,
  busy,
  onAcknowledge,
}: {
  next: NextQuestion | null;
  busy: boolean;
  onAcknowledge: (eventId: string) => void;
}) {
  const { t } = useTranslation('consult');
  if (!next || next.outcome !== 'RED_FLAG' || !next.eventId || next.eventStatus !== 'suggested') {
    return null;
  }
  const eventId = next.eventId;
  return (
    <div
      role="alert"
      className="flex flex-col gap-3 rounded-lg border-2 border-ink bg-unconfirmed-bg p-4 text-ink"
      data-testid="red-flag-banner"
    >
      <p className="flex items-start gap-2 text-lg font-semibold">
        <TriangleAlert aria-hidden="true" className="mt-0.5 size-6 shrink-0" />
        {t('consult:pathway.redFlag.title')}
      </p>
      <p className="text-base">
        {next.pathwayTitle ? `${next.pathwayTitle}. ` : ''}
        {next.reasonText}
      </p>
      {next.notActive ? (
        <p className="text-sm font-semibold">{t('consult:pathway.testBanner')}</p>
      ) : null}
      <div>
        <Button variant="primary" disabled={busy} onClick={() => onAcknowledge(eventId)}>
          {t('consult:pathway.redFlag.acknowledge')}
        </Button>
      </div>
      <p className="text-sm text-body">{t('consult:pathway.redFlag.stays')}</p>
    </div>
  );
}
