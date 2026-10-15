// QuestionCard (PRD F4, FR-F4-04/08): a suggested question with the reason and the guideline node it came from.
// The rules choose the question; the AI-suggested badge marks only the wording. Demo content is FAKE.
import { BookOpen, Check, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/Button';
import { StateBadge } from '../ui/Badge';

export interface QuestionCardProps {
  question: string;
  /** Language of the question text. */
  lang: string;
  /** One-line reason ("asks because ..."). */
  reason: string;
  source: { pathway: string; node: string; page?: string };
  onAsked?: () => void;
  onDismiss?: () => void;
}

export function QuestionCard({
  question,
  lang,
  reason,
  source,
  onAsked,
  onDismiss,
}: QuestionCardProps) {
  const { t } = useTranslation('clinical');
  return (
    <article className="flex flex-col gap-3 rounded-lg border border-control bg-card p-4 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-body">{t('clinical:question.heading')}</h3>
        <StateBadge state="ai" label={t('clinical:question.aiWording')} />
      </div>
      <p lang={lang} className="text-lg font-semibold text-ink">
        {question}
      </p>
      <p className="text-sm text-body">
        <span className="font-semibold text-ink">{t('clinical:question.because')}: </span>
        {reason}
      </p>
      <p className="inline-flex items-center gap-2 text-sm text-body">
        <BookOpen aria-hidden="true" className="size-4 shrink-0" />
        <span>
          {t('clinical:question.source', {
            pathway: source.pathway,
            node: source.node,
          })}
          {source.page ? `, ${t('clinical:question.page', { page: source.page })}` : ''}
        </span>
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" icon={Check} onClick={onAsked}>
          {t('common:action.asked')}
        </Button>
        <Button icon={X} onClick={onDismiss}>
          {t('common:action.dismiss')}
        </Button>
      </div>
    </article>
  );
}
