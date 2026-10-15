import { useId } from 'react';
import { cn } from './cn';

/** On/off switch (role="switch"). The state is always written as text (On/Off), not only shown by position. */
export function Switch({
  label,
  checked,
  onChange,
  onText,
  offText,
  description,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  onText: string;
  offText: string;
  description?: string;
}) {
  const descId = useId();
  return (
    <div className="flex min-h-11 items-start justify-between gap-4">
      <div>
        <span className="text-base font-semibold text-ink" id={`${descId}-label`}>
          {label}
        </span>
        {description ? (
          <p id={descId} className="text-sm text-body">
            {description}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${descId}-label`}
        aria-describedby={description ? descId : undefined}
        onClick={() => onChange(!checked)}
        className={cn(
          'inline-flex min-h-11 min-w-24 shrink-0 items-center justify-center rounded-md border-2 px-3 text-sm font-semibold',
          checked ? 'border-ink bg-action text-on-action' : 'border-control bg-card text-ink',
        )}
      >
        {/* the state is exposed by aria-checked; the visible word is for sighted users */}
        <span aria-hidden="true">{checked ? onText : offText}</span>
      </button>
    </div>
  );
}
