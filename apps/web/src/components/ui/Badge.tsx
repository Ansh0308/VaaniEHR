import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { STATE_STYLES, type SafetyState } from '../../design/states';
import { cn } from './cn';
import { IconButton } from './Button';

/** Non-interactive status badge for one of the five safety states: icon + text label, never colour alone. */
export function StateBadge({
  state,
  label,
  className,
}: {
  state: SafetyState;
  /** Override the default translated label (e.g. a more specific text). */
  label?: string;
  className?: string;
}) {
  const { t } = useTranslation('common');
  const style = STATE_STYLES[state];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs font-semibold',
        style.badge,
        className,
      )}
      data-state={state}
    >
      <style.Icon aria-hidden="true" className="size-4 shrink-0" />
      {label ?? t(style.labelKey)}
    </span>
  );
}

/** Neutral badge (counts, tags). */
export function Badge({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-sm border border-control bg-card px-2 py-0.5 text-xs font-semibold text-ink',
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Interactive chip: a toggle button (aria-pressed) and/or a removable item. */
export function Chip({
  children,
  selected,
  onToggle,
  onRemove,
  removeLabel,
  className,
}: {
  children: ReactNode;
  selected?: boolean;
  onToggle?: () => void;
  onRemove?: () => void;
  /** Required with onRemove: accessible name of the remove button. */
  removeLabel?: string;
  className?: string;
}) {
  const { t } = useTranslation('common');
  const body = onToggle ? (
    <button
      type="button"
      aria-pressed={selected ?? false}
      onClick={onToggle}
      className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 text-sm font-semibold text-ink"
    >
      {selected ? <span className="sr-only">{t('status.selected')}: </span> : null}
      {children}
    </button>
  ) : (
    <span className="inline-flex min-h-11 items-center px-3 text-sm font-semibold text-ink">
      {children}
    </span>
  );
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border',
        selected ? 'border-ink bg-selected' : 'border-control bg-card',
        className,
      )}
    >
      {body}
      {onRemove ? (
        <IconButton
          icon={X}
          label={removeLabel ?? t('action.remove')}
          onClick={onRemove}
          className="size-11"
        />
      ) : null}
    </span>
  );
}
