import { Languages } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/** Marks Gujarati text that has not been reviewed by a Gujarati speaker yet (always English, so reviewers see it). */
export function NeedsReview() {
  const { i18n } = useTranslation();
  const en = i18n.getFixedT('en', 'common');
  return (
    <p
      lang="en"
      className="mt-2 inline-flex items-center gap-1.5 rounded-sm border border-dashed border-control bg-card px-2 py-1 text-xs font-semibold text-ink"
    >
      <Languages aria-hidden="true" className="size-4" />
      {en('needsReview')}
    </p>
  );
}
