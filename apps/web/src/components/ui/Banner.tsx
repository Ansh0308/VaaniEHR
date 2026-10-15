import { Info } from 'lucide-react';
import type { ReactNode } from 'react';
import { STATE_STYLES, type SafetyState } from '../../design/states';
import { cn } from './cn';

/** Inline banner for one of the safety states (or neutral). Icon + text; blocked uses role="alert" when live. */
export function Banner({
  kind = 'neutral',
  title,
  children,
  live = false,
  actions,
  className,
}: {
  kind?: 'neutral' | SafetyState;
  title?: string;
  children: ReactNode;
  /** Announce to screen readers when it appears (role=alert for blocked, role=status otherwise). */
  live?: boolean;
  actions?: ReactNode;
  className?: string;
}) {
  const style = kind === 'neutral' ? null : STATE_STYLES[kind];
  const Icon = style ? style.Icon : Info;
  const role = live ? (kind === 'blocked' ? 'alert' : 'status') : undefined;
  return (
    <div
      role={role}
      className={cn(
        'flex items-start gap-3 rounded-md p-3',
        style ? style.panel : 'border border-control bg-card text-ink',
        className,
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn('mt-0.5 size-5 shrink-0', style ? style.icon : 'text-ink')}
      />
      <div className="min-w-0 flex-1 text-sm">
        {title ? <p className="font-semibold">{title}</p> : null}
        <div>{children}</div>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
