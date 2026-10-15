// FactChip (PRD F3, FR-F3-02/05): one extracted fact. States are shown with an icon AND words, never colour:
//   heard (unconfirmed): dashed outline + ear icon + "Heard"      confirmed: solid heavy outline + check + "Confirmed"
//   negated: "No" prefix and struck-through value                  uncertain: question-mark icon + "Uncertain"
import { Check, CircleHelp, Ear, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '../ui/Button';
import { cn } from '../ui/cn';

export interface FactChipProps {
  label: string; // fact type, e.g. "Symptom"
  value: string;
  lang?: string;
  status: 'heard' | 'confirmed';
  negated?: boolean;
  uncertain?: boolean;
  onConfirm?: () => void;
  onReject?: () => void;
}

export function FactChip({
  label,
  value,
  lang,
  status,
  negated,
  uncertain,
  onConfirm,
  onReject,
}: FactChipProps) {
  const { t } = useTranslation('clinical');
  const confirmed = status === 'confirmed';
  return (
    <div
      className={cn(
        'inline-flex flex-wrap items-center gap-2 rounded-md bg-card py-1 pr-1 pl-3 text-base text-ink',
        confirmed
          ? 'border-2 border-solid border-ink'
          : 'border border-dashed border-unconfirmed-accent bg-unconfirmed-bg',
      )}
      data-status={status}
    >
      {confirmed ? (
        <Check aria-hidden="true" className="size-4 shrink-0" />
      ) : (
        <Ear aria-hidden="true" className="size-4 shrink-0 text-unconfirmed-accent" />
      )}
      <span className="text-xs font-semibold text-body">{label}</span>
      {negated ? (
        <span className="rounded-sm border border-ink px-1.5 text-xs font-semibold">
          {t('clinical:fact.negated')}
        </span>
      ) : null}
      <span lang={lang} className={cn('font-semibold', negated && 'line-through')}>
        {value}
      </span>
      {uncertain ? (
        <span className="inline-flex items-center gap-1 text-xs font-semibold">
          <CircleHelp aria-hidden="true" className="size-4" />
          {t('clinical:fact.uncertain')}
        </span>
      ) : null}
      <span className="text-xs font-semibold text-body">
        {confirmed ? t('clinical:fact.confirmed') : t('clinical:fact.heard')}
      </span>
      {!confirmed && onConfirm ? (
        <IconButton
          icon={Check}
          label={t('clinical:fact.confirmAction', { value })}
          onClick={onConfirm}
        />
      ) : null}
      {onReject ? (
        <IconButton
          icon={X}
          label={t('clinical:fact.rejectAction', { value })}
          onClick={onReject}
        />
      ) : null}
    </div>
  );
}
