// FactsPanel (PRD F3, FR-F3-01..05; Phase 5B): the facts found in the transcript, for the doctor to confirm.
// Nothing is extracted until the doctor presses the button. Every fact is a HEARD suggestion until the doctor confirms it.
// Grouped by type; each chip shows its state in words and an icon; hover or keyboard focus shows the supporting sentence
// and the page highlights it in the transcript. No confidence numbers. Test mode is labelled whenever no real model is used.
import { FlaskConical, ListChecks, Plus, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FACT_TYPES,
  type ExtractErrorCode,
  type ExtractMode,
  type Fact,
  type FactEditBody,
  type FactType,
} from '../../facts/useFacts';
import { Banner } from '../ui/Banner';
import { Button } from '../ui/Button';
import { Input, Select } from '../ui/Field';
import { FactChip } from './FactChip';

export type ExtractBlock = 'empty' | 'unsaved' | 'recording' | 'consent' | null;

export interface FactsPanelProps {
  facts: Fact[];
  /** current text of each segment by its seq, for the supporting sentence */
  sentenceOf: (seq: number | null) => string | null;
  mode: ExtractMode | null;
  blocked: ExtractBlock;
  busy: boolean;
  extracting: boolean;
  error: ExtractErrorCode | 'save' | null;
  announcement: string;
  onExtract: () => void;
  onConfirm: (id: string) => void;
  onReject: (id: string) => void;
  onEdit: (id: string, body: FactEditBody) => void;
  onAdd: (body: {
    type: FactType;
    value: string;
    negated: boolean;
    uncertain: boolean;
  }) => Promise<boolean>;
  /** a chip was hovered or focused (or left): the page highlights its words in the transcript */
  onPeek: (fact: Fact | null) => void;
}

export function FactsPanel(props: FactsPanelProps) {
  const { t } = useTranslation('consult');
  const { facts, mode } = props;
  const [adding, setAdding] = useState(false);
  const [type, setType] = useState<FactType>('symptom');
  const [value, setValue] = useState('');
  const [negated, setNegated] = useState(false);
  const [uncertain, setUncertain] = useState(false);

  const testMode = mode === 'sample' || mode === 'blocked';
  const cannot = props.blocked !== null || mode === 'blocked' || props.extracting;

  return (
    <section
      aria-label={t('consult:facts.region')}
      className="flex flex-col gap-4 rounded-lg border border-line bg-card p-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-display text-xl font-semibold text-ink">{t('consult:facts.title')}</h2>
        {testMode ? (
          <span className="inline-flex items-center gap-2 rounded-md border border-dashed border-ink bg-sunken px-3 py-1 text-sm font-semibold text-ink">
            <FlaskConical aria-hidden="true" className="size-4" />
            {t('consult:facts.testMode')}
          </span>
        ) : null}
      </div>
      <p className="text-sm text-body">{t('consult:facts.intro')}</p>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          icon={Sparkles}
          loading={props.extracting}
          disabled={cannot}
          onClick={props.onExtract}
        >
          {t('consult:facts.extract')}
        </Button>
        <Button icon={Plus} onClick={() => setAdding((on) => !on)} aria-expanded={adding}>
          {t('consult:facts.addManual')}
        </Button>
      </div>

      {props.blocked ? (
        <p className="text-sm text-body">{t(`consult:facts.blocked.${props.blocked}`)}</p>
      ) : null}
      {mode === 'blocked' ? (
        <Banner kind="blocked" live>
          {t('consult:facts.error.real_data_blocked')}
        </Banner>
      ) : null}
      {props.error ? (
        <Banner kind="blocked" live>
          {t(`consult:facts.error.${props.error}`)}
        </Banner>
      ) : null}

      <p role="status" aria-live="polite" className="sr-only">
        {props.announcement
          ? t('consult:facts.arrived', { count: Number(props.announcement) })
          : ''}
      </p>

      {adding ? (
        <form
          className="flex flex-col gap-3 rounded-md border border-line p-3"
          onSubmit={(event) => {
            event.preventDefault();
            void props.onAdd({ type, value, negated, uncertain }).then((ok) => {
              if (ok) {
                setValue('');
                setNegated(false);
                setUncertain(false);
                setAdding(false);
              }
            });
          }}
        >
          <Select
            label={t('consult:facts.typeLabel')}
            value={type}
            onChange={(event) => setType(event.target.value as FactType)}
            options={FACT_TYPES.map((x) => ({ value: x, label: t(`consult:facts.type.${x}`) }))}
          />
          <Input
            label={t('consult:facts.valueLabel')}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
          <label className="inline-flex min-h-11 items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={negated}
              onChange={(event) => setNegated(event.target.checked)}
              className="size-5 accent-[var(--color-action)]"
            />
            {t('consult:facts.notPresent')}
          </label>
          <label className="inline-flex min-h-11 items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={uncertain}
              onChange={(event) => setUncertain(event.target.checked)}
              className="size-5 accent-[var(--color-action)]"
            />
            {t('consult:facts.uncertain')}
          </label>
          <div>
            <Button type="submit" variant="primary" disabled={!value.trim() || props.busy}>
              {t('consult:facts.addSave')}
            </Button>
          </div>
        </form>
      ) : null}

      {facts.length === 0 ? (
        <p className="flex items-center gap-2 text-base text-body">
          <ListChecks aria-hidden="true" className="size-5 shrink-0" />
          {t('consult:facts.empty')}
        </p>
      ) : (
        FACT_TYPES.filter((x) => facts.some((f) => f.type === x)).map((x) => (
          <div key={x} className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-ink">{t(`consult:facts.type.${x}`)}</h3>
            <ul className="flex flex-col gap-2">
              {facts
                .filter((f) => f.type === x)
                .map((f) => (
                  <li key={f.id}>
                    <FactChip
                      label={t(`consult:facts.type.${x}`)}
                      value={f.value}
                      status={f.status}
                      negated={f.negated}
                      uncertain={f.uncertain}
                      manual={f.source === 'manual'}
                      originalValue={f.edited ? f.originalValue : null}
                      sentence={props.sentenceOf(f.sourceSegmentSeq) ?? f.evidenceQuote}
                      busy={props.busy}
                      onConfirm={() => props.onConfirm(f.id)}
                      onReject={() => props.onReject(f.id)}
                      onEdit={(body) => props.onEdit(f.id, body)}
                      onPeek={(on) => props.onPeek(on ? f : null)}
                    />
                  </li>
                ))}
            </ul>
          </div>
        ))
      )}

      <p className="text-xs text-body">{t('consult:facts.keys')}</p>
    </section>
  );
}
