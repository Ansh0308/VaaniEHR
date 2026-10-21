// CandidatesPanel (PRD F4, FR-F4-09; Phase 6C): up to three candidate conditions with the facts that support them and the
// facts that count against them, and a "Select as working condition" action with undo. The words are "candidates" and
// "working condition". No score, percentage or confidence is shown. "Suggestions are aids; the doctor decides."
import { Undo2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CandidateList, Evidence, PathwayRecord } from '../../api/pathwayAids';
import type { Fact } from '../../facts/useFacts';
import { Banner } from '../ui/Banner';
import { Button } from '../ui/Button';
import { Skeleton } from '../ui/Feedback';
import { Input } from '../ui/Field';
import { KeptRecord, TestPathwayBanner } from './QuestionPanel';

export interface CandidatesPanelProps {
  consentOk: boolean;
  loading: boolean;
  busy: boolean;
  error: 'load' | 'save' | 'consent' | null;
  list: CandidateList | null;
  record: PathwayRecord | null;
  facts: Fact[];
  onSelect: (
    body: { pathwayId: string; version: number } | { notListed: true; text: string },
  ) => void;
  onUndo: () => void;
}

function EvidenceList({
  label,
  items,
  facts,
}: {
  label: string;
  items: Evidence[];
  facts: Fact[];
}) {
  const { t } = useTranslation('consult');
  if (items.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-semibold text-body">{label}</p>
      <ul className="mt-1 flex flex-wrap gap-2">
        {items.map((e) => {
          const fact = e.factId ? facts.find((f) => f.id === e.factId) : undefined;
          return (
            <li
              key={e.ruleId}
              className="rounded-md border border-line bg-card px-2 py-1 text-sm text-ink"
            >
              {fact
                ? fact.negated
                  ? t('consult:pathway.candidates.factAbsent', { value: fact.value })
                  : fact.value
                : t('consult:pathway.candidates.slotOnly', { slot: e.slot })}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function CandidatesPanel(props: CandidatesPanelProps) {
  const { t } = useTranslation('consult');
  const [note, setNote] = useState('');
  const [open, setOpen] = useState(false);
  const { list } = props;
  const selected = list?.selected ?? props.record?.selected ?? null;
  const notActive = list?.notActive ?? props.record?.notActive ?? false;
  return (
    <section
      aria-label={t('consult:pathway.candidates.region')}
      className="flex flex-col gap-4 rounded-lg border border-line bg-card p-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-display text-xl font-semibold text-ink">
          {t('consult:pathway.candidates.title')}
        </h2>
        {props.consentOk && notActive ? <TestPathwayBanner /> : null}
      </div>
      <p className="text-sm font-semibold text-ink">{t('consult:pathway.aid')}</p>

      {!props.consentOk ? (
        <>
          <Banner kind="acknowledge">{t('consult:pathway.noConsent')}</Banner>
          <KeptRecord record={props.record} />
        </>
      ) : props.loading ? (
        <Skeleton lines={3} label={t('consult:pathway.loading')} />
      ) : props.error === 'load' ? (
        <Banner kind="blocked" live>
          {t('consult:pathway.error.load')}
        </Banner>
      ) : props.error === 'consent' ? (
        <Banner kind="acknowledge" live>
          {t('consult:pathway.noConsent')}
        </Banner>
      ) : list ? (
        <>
          {props.error === 'save' ? (
            <Banner kind="blocked" live>
              {t('consult:pathway.error.save')}
            </Banner>
          ) : null}
          {selected ? (
            <div
              className="flex flex-wrap items-center gap-3 rounded-md border-2 border-ink p-3"
              data-testid="working-condition"
            >
              <p className="min-w-0 flex-1 text-base font-semibold text-ink">
                {selected.notListed
                  ? t('consult:pathway.candidates.workingNotListed', { text: selected.text ?? '' })
                  : t('consult:pathway.candidates.working', {
                      title: selected.title ?? selected.pathwayId,
                    })}
              </p>
              <Button icon={Undo2} disabled={props.busy} onClick={props.onUndo}>
                {t('consult:pathway.candidates.undo')}
              </Button>
            </div>
          ) : null}
          {list.candidates.length === 0 ? (
            <p className="text-base text-ink">{t('consult:pathway.candidates.none')}</p>
          ) : (
            <ol className="flex flex-col gap-3">
              {list.candidates.map((c) => {
                const isSelected =
                  !!selected && !selected.notListed && selected.pathwayId === c.pathwayId;
                return (
                  <li
                    key={c.pathwayId}
                    className="flex flex-col gap-2 rounded-md border border-line p-3"
                    data-candidate={c.pathwayId}
                  >
                    <p className="text-lg font-semibold text-ink">
                      {t('consult:pathway.candidates.rank', { n: c.rank })} {c.title}
                    </p>
                    <EvidenceList
                      label={t('consult:pathway.candidates.supporting')}
                      items={c.evidenceFor}
                      facts={props.facts}
                    />
                    <EvidenceList
                      label={t('consult:pathway.candidates.against')}
                      items={c.evidenceAgainst}
                      facts={props.facts}
                    />
                    <p className="text-sm text-body">
                      {t('consult:pathway.candidates.source', {
                        doc: c.source.doc,
                        page: c.source.page,
                      })}
                    </p>
                    <div>
                      <Button
                        variant={isSelected ? 'secondary' : 'primary'}
                        disabled={props.busy || isSelected}
                        onClick={() =>
                          props.onSelect({ pathwayId: c.pathwayId, version: c.version })
                        }
                      >
                        {isSelected
                          ? t('consult:pathway.candidates.isSelected')
                          : t('consult:pathway.candidates.select')}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
          <div className="flex flex-col gap-2">
            <Button aria-expanded={open} onClick={() => setOpen((on) => !on)}>
              {t('consult:pathway.candidates.notListed')}
            </Button>
            {open ? (
              <form
                className="flex flex-col gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  props.onSelect({ notListed: true, text: note.trim() });
                  setNote('');
                  setOpen(false);
                }}
              >
                <Input
                  label={t('consult:pathway.candidates.noteLabel')}
                  value={note}
                  maxLength={200}
                  onChange={(event) => setNote(event.target.value)}
                />
                <div>
                  <Button type="submit" variant="primary" disabled={!note.trim() || props.busy}>
                    {t('consult:pathway.candidates.noteSave')}
                  </Button>
                </div>
              </form>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}
