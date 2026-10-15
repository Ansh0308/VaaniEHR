// AlertCard (PRD F6, FR-F6-02/04): clear / acknowledge / blocked. A blocked alert can only be kept after a typed
// override reason (min 8 characters), which the caller must log. Demo rules are FAKE; real rules need a source.
import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { STATE_STYLES } from '../../design/states';
import { Button } from '../ui/Button';
import { TextArea } from '../ui/Field';
import { cn } from '../ui/cn';

export const MIN_OVERRIDE_REASON = 8;

export interface AlertCardProps {
  severity: 'clear' | 'acknowledge' | 'blocked';
  title: string;
  message: string;
  lang?: string;
  /** Rule id and its cited source (every rule row needs a source: Hard Rule 3). */
  source: { ruleId: string; citation: string };
  onAcknowledge?: () => void;
  /** Called with the typed reason; the caller must write it to the audit log (FR-F7-04). */
  onOverride?: (reason: string) => void;
}

export function AlertCard({
  severity,
  title,
  message,
  lang,
  source,
  onAcknowledge,
  onOverride,
}: AlertCardProps) {
  const { t } = useTranslation('clinical');
  const style = STATE_STYLES[severity];
  const headingId = useId();
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [resolution, setResolution] = useState<'open' | 'acknowledged' | 'overridden'>('open');

  function submitOverride() {
    if (reason.trim().length < MIN_OVERRIDE_REASON) {
      setError(t('clinical:alert.reasonTooShort', { min: MIN_OVERRIDE_REASON }));
      reasonRef.current?.focus();
      return;
    }
    setError(undefined);
    setResolution('overridden');
    onOverride?.(reason.trim());
  }

  return (
    <section
      aria-labelledby={headingId}
      className={cn('flex flex-col gap-3 rounded-lg p-4', style.panel)}
    >
      <div className="flex items-start gap-3">
        <style.Icon aria-hidden="true" className={cn('mt-0.5 size-6 shrink-0', style.icon)} />
        <div>
          <h3 id={headingId} className="text-lg font-semibold">
            <span>{t(`common:${style.labelKey}`)}: </span>
            <span lang={lang}>{title}</span>
          </h3>
          <p lang={lang} className="mt-1 text-base">
            {message}
          </p>
          <p className="mt-1 text-sm">
            {t('clinical:alert.rule', { id: source.ruleId })} - {source.citation}
          </p>
        </div>
      </div>

      {severity === 'acknowledge' && resolution === 'open' ? (
        <div>
          <Button
            onClick={() => {
              setResolution('acknowledged');
              onAcknowledge?.();
            }}
          >
            {t('common:action.acknowledge')}
          </Button>
        </div>
      ) : null}

      {severity === 'blocked' && resolution === 'open' ? (
        <div className="flex flex-col gap-2 rounded-md bg-card p-3 text-ink">
          <TextArea
            ref={reasonRef}
            label={t('clinical:alert.reasonLabel')}
            hint={t('clinical:alert.reasonHint', { min: MIN_OVERRIDE_REASON })}
            error={error}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            required
            requiredText={t('common:status.required')}
            rows={3}
            data-testid="override-reason"
          />
          <div>
            <Button variant="primary" onClick={submitOverride}>
              {t('common:action.override')}
            </Button>
          </div>
        </div>
      ) : null}

      {resolution !== 'open' ? (
        <p role="status" className="text-sm font-semibold">
          {resolution === 'acknowledged'
            ? t('clinical:alert.acknowledged')
            : t('clinical:alert.overridden')}
        </p>
      ) : null}
    </section>
  );
}
