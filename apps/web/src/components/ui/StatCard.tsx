// A figure with a label: a raised card whose number counts up. Only ever shows a number the page really has.
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { CountUp } from '../motion/motion';

export function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
}) {
  const { i18n } = useTranslation();
  return (
    <div className="lift flex items-center gap-4 rounded-lg border border-line bg-card p-4 shadow-card">
      <span
        aria-hidden="true"
        className="grid size-12 shrink-0 place-items-center rounded-md bg-sunken text-ink"
      >
        <Icon className="size-6" />
      </span>
      <div className="min-w-0">
        <p className="font-display text-3xl leading-none font-semibold text-ink">
          <CountUp value={value} locale={i18n.language === 'gu' ? 'gu-IN' : 'en-IN'} />
        </p>
        <p className="mt-1 text-sm text-body">{label}</p>
      </div>
    </div>
  );
}
