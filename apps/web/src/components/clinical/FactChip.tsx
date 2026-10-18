// FactChip (PRD F3, FR-F3-02/05): one extracted fact. Every state is shown with an icon AND words, never colour alone:
//   heard: dashed outline, ear, "Heard"       confirmed: solid heavy outline, check, "Confirmed"
//   rejected: dotted outline, cross, "Rejected"   stale: dashed outline, warning, "Text changed - re-check"
//   negated: ban icon + "Not present" (value struck through)   uncertain: question mark + "Uncertain"
// Hovering OR focusing the chip shows the supporting sentence (and tells the page, which highlights it in the
// transcript). There is NO confidence figure: the model gives none we could trust and the screen never invents one.
// Keys c / r / e act only while the chip ITSELF has focus, so typing in the edit form never triggers them.
import {
  Ban,
  Check,
  CircleHelp,
  Ear,
  Pencil,
  TriangleAlert,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useId, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, IconButton } from '../ui/Button';
import { Input } from '../ui/Field';
import { cn } from '../ui/cn';

export type FactStatus = 'heard' | 'confirmed' | 'rejected' | 'stale';

export interface FactEdit {
  value: string;
  negated: boolean;
  uncertain: boolean;
}

export interface FactChipProps {
  label: string; // fact type, e.g. "Symptom"
  value: string;
  lang?: string;
  status: FactStatus;
  negated?: boolean;
  uncertain?: boolean;
  /** typed by the doctor, not extracted */
  manual?: boolean;
  /** the value the model gave, kept visible after an edit */
  originalValue?: string | null;
  /** the sentence that supports the fact; shown on hover or focus */
  sentence?: string | null;
  onConfirm?: () => void;
  onReject?: () => void;
  onEdit?: (edit: FactEdit) => void;
  /** called with true when the chip is hovered or focused, false when not */
  onPeek?: (on: boolean) => void;
  busy?: boolean;
}

const STATUS_ICON: Record<FactStatus, LucideIcon> = {
  heard: Ear,
  confirmed: Check,
  rejected: X,
  stale: TriangleAlert,
};

const FRAME: Record<FactStatus, string> = {
  heard: 'border border-dashed border-unconfirmed-accent bg-unconfirmed-bg',
  confirmed: 'border-2 border-solid border-ink bg-card',
  rejected: 'border border-dotted border-control bg-sunken',
  stale: 'border-2 border-dashed border-ink bg-unconfirmed-bg',
};

export function FactChip({
  label,
  value,
  lang,
  status,
  negated,
  uncertain,
  manual,
  originalValue,
  sentence,
  onConfirm,
  onReject,
  onEdit,
  onPeek,
  busy,
}: FactChipProps) {
  const { t } = useTranslation('clinical');
  const [peek, setPeek] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<FactEdit>({
    value,
    negated: !!negated,
    uncertain: !!uncertain,
  });
  const sentenceId = useId();
  const StatusIcon = STATUS_ICON[status];

  const peekTo = (on: boolean) => {
    setPeek(on);
    onPeek?.(on);
  };
  const startEdit = () => {
    setDraft({ value, negated: !!negated, uncertain: !!uncertain });
    setEditing(true);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // only when the chip itself is focused: never while a form field inside it has focus
    if (event.target !== event.currentTarget || event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    const key = event.key.toLowerCase();
    if (key === 'c' && onConfirm && status !== 'confirmed') onConfirm();
    else if (key === 'r' && onReject && status !== 'rejected') onReject();
    else if (key === 'e' && onEdit) startEdit();
    else return;
    event.preventDefault();
  };

  return (
    <div
      tabIndex={0}
      role="group"
      aria-label={t('clinical:fact.group', { label, value })}
      aria-describedby={peek && sentence ? sentenceId : undefined}
      data-status={status}
      onMouseEnter={() => peekTo(true)}
      onMouseLeave={() => peekTo(false)}
      onFocus={() => peekTo(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) peekTo(false);
      }}
      onKeyDown={onKeyDown}
      className={cn(
        'flex min-h-11 w-full flex-col gap-1 rounded-md py-1 pr-1 pl-3 text-base text-ink',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink',
        FRAME[status],
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <StatusIcon aria-hidden="true" className="size-4 shrink-0" />
        <span className="text-xs font-semibold text-body">{label}</span>
        {negated ? (
          <span className="inline-flex items-center gap-1 rounded-sm border border-ink px-1.5 text-xs font-semibold">
            <Ban aria-hidden="true" className="size-3.5" />
            {t('clinical:fact.notPresent')}
          </span>
        ) : null}
        <span lang={lang} className={cn('font-semibold', negated && 'line-through')}>
          {value}
        </span>
        {uncertain ? (
          <span className="inline-flex items-center gap-1 text-xs font-semibold">
            <CircleHelp aria-hidden="true" className="size-4" />
            {t('clinical:fact.uncertain')}
          </span>
        ) : null}
        <span className="text-xs font-semibold text-body">{t(`clinical:fact.${status}`)}</span>
        {manual ? (
          <span className="rounded-sm border border-control px-1.5 text-xs font-semibold">
            {t('clinical:fact.manual')}
          </span>
        ) : null}
        <span className="ml-auto flex items-center">
          {onConfirm && status !== 'confirmed' ? (
            <IconButton
              icon={Check}
              label={t('clinical:fact.confirmAction', { value })}
              onClick={onConfirm}
              disabled={busy}
            />
          ) : null}
          {onEdit && !editing ? (
            <IconButton
              icon={Pencil}
              label={t('clinical:fact.editAction', { value })}
              onClick={startEdit}
              disabled={busy}
            />
          ) : null}
          {onReject && status !== 'rejected' ? (
            <IconButton
              icon={X}
              label={t('clinical:fact.rejectAction', { value })}
              onClick={onReject}
              disabled={busy}
            />
          ) : null}
        </span>
      </div>

      {status === 'stale' ? (
        <p className="text-sm font-semibold text-ink">{t('clinical:fact.staleHelp')}</p>
      ) : null}
      {originalValue ? (
        <p className="text-sm text-body">
          {t('clinical:fact.original')} <span lang={lang}>{originalValue}</span>
        </p>
      ) : null}
      {peek && sentence ? (
        <p
          id={sentenceId}
          role="note"
          className="rounded-sm border border-line bg-sunken px-2 py-1 text-sm text-ink"
        >
          <span className="font-semibold">{t('clinical:fact.sentence')} </span>
          <span lang={lang}>{sentence}</span>
        </p>
      ) : null}

      {editing && onEdit ? (
        <form
          className="flex flex-col gap-2 pr-2 pb-2"
          onSubmit={(event) => {
            event.preventDefault();
            onEdit(draft);
            setEditing(false);
          }}
        >
          <Input
            label={t('clinical:fact.editValue')}
            lang={lang}
            value={draft.value}
            onChange={(event) => setDraft({ ...draft, value: event.target.value })}
          />
          <label className="inline-flex min-h-11 items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={draft.negated}
              onChange={(event) => setDraft({ ...draft, negated: event.target.checked })}
              className="size-5 accent-[var(--color-action)]"
            />
            {t('clinical:fact.notPresent')}
          </label>
          <label className="inline-flex min-h-11 items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={draft.uncertain}
              onChange={(event) => setDraft({ ...draft, uncertain: event.target.checked })}
              className="size-5 accent-[var(--color-action)]"
            />
            {t('clinical:fact.uncertain')}
          </label>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" disabled={!draft.value.trim() || busy}>
              {t('clinical:fact.editSave')}
            </Button>
            <Button onClick={() => setEditing(false)}>{t('clinical:fact.editCancel')}</Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
