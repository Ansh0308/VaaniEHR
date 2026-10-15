import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from './cn';

export interface Step {
  id: string;
  label: string;
}

/** Progress through a flow. The current step carries aria-current="step"; status is also written as text. */
export function Stepper({
  steps,
  currentId,
  label,
}: {
  steps: Step[];
  currentId: string;
  label: string;
}) {
  const { t } = useTranslation('common');
  const currentIndex = steps.findIndex((step) => step.id === currentId);
  return (
    <ol aria-label={label} className="flex flex-wrap gap-x-6 gap-y-3">
      {steps.map((step, index) => {
        const status =
          index < currentIndex ? 'completed' : index === currentIndex ? 'current' : 'upcoming';
        return (
          <li
            key={step.id}
            aria-current={status === 'current' ? 'step' : undefined}
            className="flex items-center gap-2 text-base"
          >
            <span
              aria-hidden="true"
              className={cn(
                'inline-flex size-8 items-center justify-center rounded-md border text-sm font-semibold',
                status === 'completed' && 'border-ink bg-action text-on-action',
                status === 'current' && 'border-ink border-2 bg-card text-ink',
                status === 'upcoming' && 'border-control bg-card text-body',
              )}
            >
              {status === 'completed' ? <Check className="size-4" /> : index + 1}
            </span>
            <span className={cn(status === 'current' ? 'font-semibold text-ink' : 'text-body')}>
              {step.label}
              <span className="sr-only">
                {' '}
                ({t(`stepper.${status}`)},{' '}
                {t('stepper.stepOf', { n: index + 1, total: steps.length })})
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
