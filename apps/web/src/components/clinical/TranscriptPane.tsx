// TranscriptPane (PRD PG-06, FR-F2-05/06/07). A DRAFT: the label is always visible. Segments show the speaker (unknown
// until the doctor sets it, per segment), the time, the language the engine reported, and the text. A partial result
// is grey and marked "listening"; a final result is full-strength. There is NO confidence display: Sarvam gives none
// and the interface never invents one (PRD_ERRATA). Text is shown exactly as the engine wrote it (no transliteration).
// Editing keeps the engine's original text beside the edited text. Sample data in the design demo is FAKE.
import { FilePenLine, Pencil, Stethoscope, User, UserRound } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '../ui/Badge';
import { Button, IconButton } from '../ui/Button';
import { TextArea } from '../ui/Field';
import { cn } from '../ui/cn';

export type SegmentSpeaker = 'unknown' | 'doctor' | 'patient';

export interface TranscriptSegment {
  id: string;
  speaker: SegmentSpeaker;
  text: string;
  /** BCP-47 language of the text (en, gu, hi). Sets the lang attribute so the right font and script rules apply. */
  lang: string;
  /** false while the recogniser is still revising this segment (partial result). */
  final: boolean;
  startMs?: number;
  endMs?: number;
  /** the engine's own text, when the doctor has changed `text` */
  originalText?: string;
  edited?: boolean;
  /** confirmed by the doctor: shown as such, no longer editable */
  locked?: boolean;
}

const SPEAKERS: SegmentSpeaker[] = ['unknown', 'doctor', 'patient'];
const ICONS = { unknown: UserRound, doctor: Stethoscope, patient: User } as const;

function mmss(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function SegmentRow({
  segment,
  index,
  onSpeaker,
  onEditSave,
}: {
  segment: TranscriptSegment;
  index: number;
  onSpeaker?: (id: string, speaker: SegmentSpeaker) => void;
  onEditSave?: (id: string, text: string) => void;
}) {
  const { t } = useTranslation('consult');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(segment.text);
  const group = useId();
  const n = index + 1;
  const Icon = ICONS[segment.speaker];
  const language = segment.lang ? segment.lang.split('-')[0] : undefined;
  return (
    <li className="flex flex-col gap-2 rounded-md border border-line bg-card p-3">
      <div className="flex flex-wrap items-center gap-3">
        <Icon aria-hidden="true" className="size-5 shrink-0 text-ink" />
        <span className="text-sm font-semibold text-ink">
          {t(`consult:transcript.speaker.${segment.speaker}`)}
        </span>
        {segment.endMs !== undefined ? (
          <span className="text-xs text-body">
            {segment.startMs !== undefined && segment.final
              ? t('consult:transcript.time', {
                  from: mmss(segment.startMs),
                  to: mmss(segment.endMs),
                })
              : t('consult:transcript.approxTime', { to: mmss(segment.endMs) })}
          </span>
        ) : null}
        {segment.lang ? (
          <Badge>{t('consult:transcript.language', { lang: segment.lang })}</Badge>
        ) : null}
        {segment.edited ? (
          <Badge className="border-dashed">{t('consult:transcript.edited')}</Badge>
        ) : null}
        {segment.locked ? <Badge>{t('consult:transcript.confirmed')}</Badge> : null}
      </div>

      {editing ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            onEditSave?.(segment.id, draft);
            setEditing(false);
          }}
        >
          <TextArea
            label={t('consult:transcript.editLabel', { n })}
            lang={language}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary">
              {t('consult:transcript.save')}
            </Button>
            <Button
              onClick={() => {
                setDraft(segment.text);
                setEditing(false);
              }}
            >
              {t('consult:transcript.cancel')}
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex items-start gap-2">
          <p
            lang={language}
            className={cn('min-w-0 flex-1 text-base', segment.final ? 'text-ink' : 'text-body')}
          >
            {segment.text}
          </p>
          {segment.final && onEditSave && !segment.locked ? (
            <IconButton
              icon={Pencil}
              label={t('consult:transcript.edit', { n })}
              onClick={() => {
                setDraft(segment.text);
                setEditing(true);
              }}
            />
          ) : null}
        </div>
      )}

      {!segment.final ? (
        <p className="text-xs text-body">{t('consult:transcript.listening')}</p>
      ) : null}
      {segment.edited && segment.originalText !== undefined ? (
        <details className="text-sm text-body">
          <summary className="min-h-11 cursor-pointer py-2">
            {t('consult:transcript.original')}
          </summary>
          <p lang={language}>{segment.originalText}</p>
        </details>
      ) : null}

      {segment.final && onSpeaker && !segment.locked ? (
        <fieldset className="flex flex-wrap items-center gap-2">
          <legend className="sr-only">{t('consult:transcript.speakerLegend', { n })}</legend>
          {SPEAKERS.map((speaker) => (
            <label
              key={speaker}
              className={cn(
                'inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm text-ink',
                segment.speaker === speaker
                  ? 'border-ink bg-selected font-semibold'
                  : 'border-control bg-card',
              )}
            >
              <input
                type="radio"
                name={`${group}-speaker`}
                value={speaker}
                checked={segment.speaker === speaker}
                onChange={() => onSpeaker(segment.id, speaker)}
                className="size-5 accent-[var(--color-action)]"
              />
              {t(`consult:transcript.speaker.${speaker}`)}
            </label>
          ))}
        </fieldset>
      ) : null}
    </li>
  );
}

export function TranscriptPane({
  segments,
  onSpeaker,
  onEditSave,
}: {
  segments: TranscriptSegment[];
  onSpeaker?: (id: string, speaker: SegmentSpeaker) => void;
  onEditSave?: (id: string, text: string) => void;
}) {
  const { t } = useTranslation('clinical');
  return (
    <section
      aria-label={t('clinical:transcript.region')}
      className="rounded-lg border border-line bg-card p-4"
    >
      <p className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-dashed border-control bg-sunken px-3 py-2 text-sm font-semibold text-ink">
        <FilePenLine aria-hidden="true" className="size-5 shrink-0" />
        {t('consult:draft')}
        <span className="font-normal text-body">{t('consult:draftNote')}</span>
      </p>
      {segments.length === 0 ? (
        <p className="text-base text-body">{t('consult:transcript.empty')}</p>
      ) : (
        <ol className="flex flex-col gap-3" aria-live="off">
          {segments.map((segment, index) => (
            <SegmentRow
              key={segment.id}
              segment={segment}
              index={index}
              {...(onSpeaker ? { onSpeaker } : {})}
              {...(onEditSave ? { onEditSave } : {})}
            />
          ))}
        </ol>
      )}
      {onEditSave ? (
        <p className="mt-3 text-xs text-body">{t('consult:transcript.inMemory')}</p>
      ) : null}
    </section>
  );
}
