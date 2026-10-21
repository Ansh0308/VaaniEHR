// ConceptLink (FR-F3-04; remaining Phase 5 items, ADR-D37): under a fact chip, the concept the owner's UNREVIEWED draft list
// suggests for the fact, or the one the doctor already confirmed. The system never sets a link: the doctor presses
// Confirm. Words and an icon, never a score or percentage. "None of these" only hides the suggestions for this fact on
// this screen. A link whose words changed is shown as "needs re-checking" and counts for nothing until confirmed again.
import { Check, Link2, Tags, Unlink } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ConceptSuggestion } from '../../api/concepts';
import { Button } from '../ui/Button';

export interface ConceptLinkProps {
  status: 'none' | 'confirmed' | 'stale';
  /** label of the linked concept, if any */
  linkedLabel: string | null;
  suggestions: ConceptSuggestion[];
  busy: boolean;
  onConfirm: (conceptId: string) => void;
  onClear: () => void;
}

const listName = (review: 'unreviewed' | 'reviewed', t: (key: string) => string): string =>
  review === 'reviewed'
    ? t('consult:facts.concept.reviewedList')
    : t('consult:facts.concept.unreviewedList');

export function ConceptLink(props: ConceptLinkProps) {
  const { t } = useTranslation('consult');
  const [others, setOthers] = useState(false);
  const [hidden, setHidden] = useState(false);
  const first = props.suggestions[0];
  const rest = props.suggestions.slice(1);

  if (props.status === 'confirmed') {
    return (
      <div
        className="flex flex-wrap items-center gap-2 pb-1 text-sm text-ink"
        data-concept="confirmed"
      >
        <Link2 aria-hidden="true" className="size-4 shrink-0" />
        <span>
          {t('consult:facts.concept.linked', {
            label: props.linkedLabel ?? '',
            list: t('consult:facts.concept.unreviewedList'),
          })}
        </span>
        <Button icon={Unlink} disabled={props.busy} onClick={props.onClear}>
          {t('consult:facts.concept.clear')}
        </Button>
      </div>
    );
  }

  if (props.status === 'stale') {
    return (
      <div className="flex flex-col gap-2 pb-1 text-sm text-ink" data-concept="stale">
        <p className="flex items-center gap-2 font-semibold">
          <Tags aria-hidden="true" className="size-4 shrink-0" />
          {t('consult:facts.concept.stale', {
            label: props.linkedLabel ?? '',
            list: t('consult:facts.concept.unreviewedList'),
          })}
        </p>
        <div className="flex flex-wrap gap-2">
          {first ? (
            <Button disabled={props.busy} onClick={() => props.onConfirm(first.conceptId)}>
              {t('consult:facts.concept.confirmAgain', { label: first.label })}
            </Button>
          ) : null}
          <Button icon={Unlink} disabled={props.busy} onClick={props.onClear}>
            {t('consult:facts.concept.clear')}
          </Button>
        </div>
      </div>
    );
  }

  if (!first || hidden) {
    return hidden ? (
      <p className="flex items-center gap-2 pb-1 text-sm text-body" data-concept="declined">
        <Tags aria-hidden="true" className="size-4 shrink-0" />
        {t('consult:facts.concept.noneChosen')}
      </p>
    ) : null;
  }

  return (
    <div className="flex flex-col gap-2 pb-1 text-sm text-ink" data-concept="suggested">
      <p className="flex items-center gap-2 font-semibold">
        <Tags aria-hidden="true" className="size-4 shrink-0" />
        {t('consult:facts.concept.suggested', {
          label: first.label,
          list: listName(first.reviewStatus, t),
        })}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          icon={Check}
          disabled={props.busy}
          onClick={() => props.onConfirm(first.conceptId)}
        >
          {t('consult:facts.concept.confirm')}
        </Button>
        <Button
          disabled={props.busy || rest.length === 0}
          aria-expanded={others}
          onClick={() => setOthers((on) => !on)}
        >
          {t('consult:facts.concept.another')}
        </Button>
        <Button disabled={props.busy} onClick={() => setHidden(true)}>
          {t('consult:facts.concept.none')}
        </Button>
      </div>
      {others && rest.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label={t('consult:facts.concept.otherList')}>
          {rest.map((s) => (
            <li key={s.conceptId}>
              <Button disabled={props.busy} onClick={() => props.onConfirm(s.conceptId)}>
                {t('consult:facts.concept.choose', { label: s.label })}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
