// Side-by-side diff (AI proposed vs doctor final). Colour-free: removed = struck-through with a minus icon,
// added = bold with a plus icon and a heavy ink bar. Each row also says "Removed", "Added" or "Unchanged" in text.
import { Minus, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { diffLines } from '../../design/diff';
import { cn } from './cn';

export function DiffViewer({
  before,
  after,
  beforeLabel,
  afterLabel,
  caption,
  lang,
}: {
  before: readonly string[];
  after: readonly string[];
  beforeLabel: string;
  afterLabel: string;
  caption: string;
  /** Language of the compared text (sets the lang attribute so fonts and script rules apply). */
  lang?: string;
}) {
  const { t } = useTranslation('common');
  const rows = diffLines(before, after);
  return (
    <div
      role="region"
      aria-label={caption}
      tabIndex={0}
      className="overflow-x-auto rounded-lg border border-line bg-card"
    >
      <table className="w-full table-fixed border-collapse text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-sunken">
          <tr>
            <th scope="col" className="w-1/2 px-3 py-2 font-semibold text-ink">
              {beforeLabel}
            </th>
            <th scope="col" className="w-1/2 px-3 py-2 font-semibold text-ink">
              {afterLabel}
            </th>
          </tr>
        </thead>
        <tbody lang={lang}>
          {rows.map((row, index) => (
            <tr key={index} className="border-t border-line align-top">
              <td className={cn('px-3 py-2 text-ink', row.kind === 'removed' && 'bg-sunken')}>
                {row.kind === 'same' ? (
                  <>
                    <span className="sr-only">{t('diff.unchanged')}: </span>
                    {row.before}
                  </>
                ) : null}
                {row.kind === 'removed' ? (
                  <span className="flex items-start gap-2">
                    <Minus aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                    <span className="sr-only">{t('diff.removed')}: </span>
                    <span className="line-through">{row.before}</span>
                  </span>
                ) : null}
              </td>
              <td
                className={cn(
                  'px-3 py-2 text-ink',
                  row.kind === 'added' && 'border-l-4 border-ink bg-selected',
                )}
              >
                {row.kind === 'same' ? (
                  <span className="sr-only">{t('diff.unchanged')}: </span>
                ) : null}
                {row.kind === 'same' ? row.after : null}
                {row.kind === 'added' ? (
                  <span className="flex items-start gap-2">
                    <Plus aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                    <span className="sr-only">{t('diff.added')}: </span>
                    <span className="font-semibold">{row.after}</span>
                  </span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
