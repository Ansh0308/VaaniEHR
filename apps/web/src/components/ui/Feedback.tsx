import type { LucideIcon } from 'lucide-react';
import { createElement, type ReactNode } from 'react';
import { cn } from './cn';

/** Empty state: an invitation, not an apology (title names the space, one line of body, one clear action). */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  headingLevel = 2,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
  headingLevel?: 2 | 3 | 4;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-control bg-card p-8 text-center">
      <span className="float-slow grid size-16 place-items-center rounded-full bg-sunken">
        <Icon aria-hidden="true" className="size-9 text-ink" />
      </span>
      {createElement(`h${headingLevel}`, { className: 'text-xl font-semibold text-ink' }, title)}
      <p className="max-w-prose text-base text-body">{description}</p>
      {action}
    </div>
  );
}

/** Loading placeholder. The visual bars are hidden from assistive tech; one polite status text replaces them. */
export function Skeleton({
  lines = 3,
  label,
  className,
}: {
  lines?: number;
  label: string;
  className?: string;
}) {
  return (
    <div role="status" aria-busy="true" className={cn('flex flex-col gap-2', className)}>
      <span className="sr-only">{label}</span>
      {Array.from({ length: lines }, (_, index) => (
        <div
          key={index}
          aria-hidden="true"
          className={cn(
            'shimmer h-4 rounded-sm bg-selected',
            index === lines - 1 ? 'w-2/3' : 'w-full',
          )}
        />
      ))}
    </div>
  );
}
