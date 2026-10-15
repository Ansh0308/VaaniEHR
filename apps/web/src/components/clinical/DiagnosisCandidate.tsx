// DiagnosisCandidate (PRD F4, FR-F4-09): one ranked candidate with evidence for and against and its source node.
// Wording is "working condition" and "candidate": the system never says "diagnosed". Demo labels are FAKE.
import { BookOpen, Minus, Plus } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/Button';
import { cn } from '../ui/cn';

export interface DiagnosisCandidateProps {
  rank: number;
  label: string;
  lang?: string;
  /** 0..1 */
  score: number;
  evidenceFor: string[];
  evidenceAgainst: string[];
  source: { pathway: string; node: string };
  selected?: boolean;
  onSelect?: () => void;
}

export function DiagnosisCandidate({
  rank,
  label,
  lang,
  score,
  evidenceFor,
  evidenceAgainst,
  source,
  selected = false,
  onSelect,
}: DiagnosisCandidateProps) {
  const { t } = useTranslation('clinical');
  const headingId = useId();
  const percent = Math.round(Math.min(1, Math.max(0, score)) * 100);
  return (
    <article
      aria-labelledby={headingId}
      className={cn(
        'flex flex-col gap-3 rounded-lg bg-card p-4',
        selected ? 'border-2 border-ink' : 'border border-control',
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={headingId} className="text-lg font-semibold text-ink">
          <span className="text-sm font-semibold text-body">
            {t('clinical:candidate.rank', { rank })}{' '}
          </span>
          <span lang={lang}>{label}</span>
        </h3>
        <span className="text-sm font-semibold text-ink">
          {t('clinical:candidate.score', { score: percent })}
        </span>
      </div>
      <div
        role="meter"
        aria-label={t('clinical:candidate.scoreLabel', { label })}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-3 w-full overflow-hidden rounded-sm border border-control bg-sunken"
      >
        <div style={{ width: `${percent}%` }} className="h-full bg-action" />
      </div>

      <div>
        <p className="text-sm font-semibold text-ink">{t('clinical:candidate.for')}</p>
        <ul className="mt-1 flex flex-wrap gap-2" aria-label={t('clinical:candidate.for')}>
          {evidenceFor.map((item) => (
            <li
              key={item}
              lang={lang}
              className="inline-flex items-center gap-1.5 rounded-sm border border-control bg-card px-2 py-1 text-sm text-ink"
            >
              <Plus aria-hidden="true" className="size-4" />
              {item}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="text-sm font-semibold text-ink">{t('clinical:candidate.against')}</p>
        <ul className="mt-1 flex flex-wrap gap-2" aria-label={t('clinical:candidate.against')}>
          {evidenceAgainst.map((item) => (
            <li
              key={item}
              lang={lang}
              className="inline-flex items-center gap-1.5 rounded-sm border border-dashed border-control bg-sunken px-2 py-1 text-sm text-ink"
            >
              <Minus aria-hidden="true" className="size-4" />
              {item}
            </li>
          ))}
        </ul>
      </div>

      <p className="inline-flex items-center gap-2 text-sm text-body">
        <BookOpen aria-hidden="true" className="size-4 shrink-0" />
        {t('clinical:question.source', { pathway: source.pathway, node: source.node })}
      </p>
      <div>
        <Button
          variant={selected ? 'primary' : 'secondary'}
          aria-pressed={selected}
          onClick={onSelect}
        >
          {selected ? t('clinical:candidate.selected') : t('clinical:candidate.select')}
        </Button>
      </div>
    </article>
  );
}
