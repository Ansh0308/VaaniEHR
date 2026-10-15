// TranscriptPane (PRD PG-06, FR-F2-05/06/07). Speaker-labelled segments, partial text marked "listening",
// low-confidence words underlined (with a text cue), editing stubbed. Sample data in the demo is FAKE.
import { Pencil, Stethoscope, User } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '../ui/Button';
import { cn } from '../ui/cn';

export interface TranscriptSegment {
  id: string;
  speaker: 'doctor' | 'patient';
  text: string;
  /** BCP-47 language of the text (en, gu, hi). Sets the lang attribute so the right font and script rules apply. */
  lang: string;
  /** false while the recogniser is still revising this segment (partial result). */
  final: boolean;
  /** Words the engine was unsure about (underlined and listed for screen readers). */
  lowConfidence?: string[];
}

function renderText(segment: TranscriptSegment, uncertainLabel: string) {
  const words = segment.lowConfidence ?? [];
  if (words.length === 0) return segment.text;
  const pattern = new RegExp(
    `(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`,
    'g',
  );
  return segment.text.split(pattern).map((part, index) =>
    words.includes(part) ? (
      <span key={index} className="underline decoration-dotted decoration-2 underline-offset-4">
        {part}
        <span className="sr-only"> ({uncertainLabel})</span>
      </span>
    ) : (
      part
    ),
  );
}

export function TranscriptPane({
  segments,
  onEdit,
}: {
  segments: TranscriptSegment[];
  onEdit?: (id: string) => void;
}) {
  const { t } = useTranslation('clinical');
  return (
    <section
      aria-label={t('clinical:transcript.region')}
      className="rounded-lg border border-line bg-card p-4"
    >
      <ol className="flex flex-col gap-3" aria-live="off">
        {segments.map((segment) => {
          const Icon = segment.speaker === 'doctor' ? Stethoscope : User;
          return (
            <li
              key={segment.id}
              className={cn(
                'flex items-start gap-3 rounded-md border p-3',
                segment.speaker === 'doctor' ? 'border-control bg-card' : 'border-line bg-sunken',
              )}
            >
              <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-ink" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink">
                  {t(`clinical:transcript.speaker.${segment.speaker}`)}
                </p>
                <p
                  lang={segment.lang}
                  className={cn('text-base', segment.final ? 'text-ink' : 'text-body')}
                >
                  {renderText(segment, t('clinical:transcript.lowConfidence'))}
                </p>
                {!segment.final ? (
                  <p className="mt-1 text-xs text-body">{t('clinical:transcript.partial')}</p>
                ) : null}
              </div>
              {onEdit ? (
                <IconButton
                  icon={Pencil}
                  label={t('clinical:transcript.edit', {
                    speaker: t(`clinical:transcript.speaker.${segment.speaker}`),
                  })}
                  onClick={() => onEdit(segment.id)}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
