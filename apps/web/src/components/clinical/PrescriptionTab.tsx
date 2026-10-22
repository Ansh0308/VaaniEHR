// PrescriptionTab (PG-08, Phase 8): the doctor adds medicine rows from the medicine master (generic name first, source
// shown) or, as a clearly labelled fallback, as free text ("Not in master list"). A template can be applied and every field
// edited until the visit is signed. NOTHING here suggests a medicine, checks one or guides a dose: every value is what the
// doctor typed or what the master / template already holds. The server validates and decides what is locked.
import { ClipboardPlus, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { PrescriptionRow, RowDraft, RowPatch } from '../../api/prescription';
import { FREQUENCY_CODES, type FrequencyCode, type TemplateSummary } from '../../api/templates';
import type { PrescriptionError } from '../../prescription/usePrescription';
import { Badge } from '../ui/Badge';
import { Banner } from '../ui/Banner';
import { Button } from '../ui/Button';
import { Input, Select } from '../ui/Field';
import { Skeleton } from '../ui/Feedback';
import { MedicineCombobox, type MedicineLike } from './MedicineCombobox';

export interface PrescriptionTabProps {
  rows: PrescriptionRow[];
  locked: boolean;
  loading: boolean;
  busy: boolean;
  error: PrescriptionError;
  /** the templates this doctor may use; null until read */
  templates: TemplateSummary[] | null;
  onAdd: (draft: RowDraft) => Promise<boolean>;
  onEdit: (id: string, patch: RowPatch) => Promise<boolean>;
  onRemove: (id: string) => void;
  onApplyTemplate: (templateId: string) => Promise<boolean>;
  /** where "Review and sign" goes */
  signHref: string;
}

export interface Fields {
  name: string;
  strength: string;
  doseForm: string;
  dose: string;
  frequency: FrequencyCode | '';
  duration: string;
  note: string;
}
export const EMPTY: Fields = {
  name: '',
  strength: '',
  doseForm: '',
  dose: '',
  frequency: '',
  duration: '',
  note: '',
};
export const orNull = (v: string): string | null => (v.trim() ? v.trim() : null);

export function FieldsForm({
  value,
  onChange,
  showName,
  idPrefix,
}: {
  value: Fields;
  onChange: (next: Fields) => void;
  showName: boolean;
  idPrefix: string;
}) {
  const { t } = useTranslation(['consult', 'templates']);
  const set = (key: keyof Fields) => (event: { target: { value: string } }) =>
    onChange({ ...value, [key]: event.target.value });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {showName ? (
        <Input
          id={`${idPrefix}-name`}
          label={t('consult:prescription.field.name')}
          value={value.name}
          onChange={set('name')}
          required
        />
      ) : null}
      <Input
        id={`${idPrefix}-strength`}
        label={t('consult:prescription.field.strength')}
        value={value.strength}
        onChange={set('strength')}
      />
      <Input
        id={`${idPrefix}-form`}
        label={t('consult:prescription.field.doseForm')}
        value={value.doseForm}
        onChange={set('doseForm')}
      />
      <Input
        id={`${idPrefix}-dose`}
        label={t('consult:prescription.field.dose')}
        value={value.dose}
        onChange={set('dose')}
      />
      <Select
        id={`${idPrefix}-frequency`}
        label={t('consult:prescription.field.frequency')}
        value={value.frequency}
        onChange={set('frequency')}
        required
        options={[
          { value: '', label: t('consult:prescription.field.frequencyChoose') },
          ...FREQUENCY_CODES.map((c) => ({ value: c, label: t(`templates:frequency.${c}`) })),
        ]}
      />
      <Input
        id={`${idPrefix}-duration`}
        label={t('consult:prescription.field.duration')}
        value={value.duration}
        onChange={set('duration')}
        required
      />
      <div className="sm:col-span-2">
        <Input
          id={`${idPrefix}-note`}
          label={t('consult:prescription.field.note')}
          value={value.note}
          onChange={set('note')}
        />
      </div>
    </div>
  );
}

const fieldsOf = (r: PrescriptionRow): Fields => ({
  name: r.name,
  strength: r.strength ?? '',
  doseForm: r.doseForm ?? '',
  dose: r.dose ?? '',
  frequency: r.frequency ?? '',
  duration: r.duration ?? '',
  note: r.note ?? '',
});

function RowCard({
  row,
  busy,
  locked,
  onEdit,
  onRemove,
}: {
  row: PrescriptionRow;
  busy: boolean;
  locked: boolean;
  onEdit: PrescriptionTabProps['onEdit'];
  onRemove: PrescriptionTabProps['onRemove'];
}) {
  const { t } = useTranslation(['consult', 'templates']);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Fields>(() => fieldsOf(row));
  const detail = [row.strength, row.doseForm].filter(Boolean).join(' · ');
  const schedule = [
    row.dose,
    row.frequency ? t(`templates:frequency.${row.frequency}`) : null,
    row.duration,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <li className="flex flex-col gap-2 rounded-md border border-line bg-card p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-ink">{row.name}</h3>
          {detail ? <p className="text-sm text-body">{detail}</p> : null}
        </div>
        {row.source === 'free_text' ? <Badge>{t('consult:prescription.notInMaster')}</Badge> : null}
      </div>
      {row.source === 'master' && row.masterSource ? (
        <p className="text-xs text-body">
          {t('consult:prescription.sourceLine', {
            source: row.masterSource,
            page: row.masterSourcePagePrinted ?? row.masterSourcePage ?? '',
          })}
          {row.masterReviewStatus === 'not_reviewed'
            ? ` · ${t('consult:prescription.notReviewed')}`
            : ''}
        </p>
      ) : null}
      {schedule ? <p className="text-sm text-ink">{schedule}</p> : null}
      {row.note ? <p className="text-sm text-body">{row.note}</p> : null}
      {row.incomplete ? (
        <Banner kind="acknowledge">{t('consult:prescription.incomplete')}</Banner>
      ) : null}

      {editing ? (
        <form
          className="flex flex-col gap-3 rounded-md border border-line p-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!draft.frequency || !draft.duration.trim()) return;
            void onEdit(row.id, {
              ...(row.source === 'free_text' ? { name: draft.name.trim() } : {}),
              strength: orNull(draft.strength),
              doseForm: orNull(draft.doseForm),
              dose: orNull(draft.dose),
              frequency: draft.frequency,
              duration: draft.duration.trim(),
              note: orNull(draft.note),
            }).then((ok) => {
              if (ok) setEditing(false);
            });
          }}
        >
          <FieldsForm
            value={draft}
            onChange={setDraft}
            showName={row.source === 'free_text'}
            idPrefix={`edit-${row.id}`}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              variant="primary"
              disabled={busy || !draft.frequency || !draft.duration.trim()}
            >
              {t('consult:prescription.saveRow')}
            </Button>
            <Button
              onClick={() => {
                setDraft(fieldsOf(row));
                setEditing(false);
              }}
            >
              {t('consult:prescription.cancel')}
            </Button>
          </div>
        </form>
      ) : null}

      {!locked && !editing ? (
        <div className="flex flex-wrap gap-2">
          <Button
            icon={Pencil}
            disabled={busy}
            aria-label={t('consult:prescription.editRow', { name: row.name })}
            onClick={() => {
              setDraft(fieldsOf(row));
              setEditing(true);
            }}
          >
            {t('consult:prescription.edit')}
          </Button>
          <Button
            icon={Trash2}
            disabled={busy}
            aria-label={t('consult:prescription.removeRow', { name: row.name })}
            onClick={() => onRemove(row.id)}
          >
            {t('consult:prescription.remove')}
          </Button>
        </div>
      ) : null}
    </li>
  );
}

export function PrescriptionTab(props: PrescriptionTabProps) {
  const { t } = useTranslation(['consult', 'templates']);
  const { rows, locked, busy } = props;
  const [medicine, setMedicine] = useState<MedicineLike | null>(null);
  const [freeText, setFreeText] = useState(false);
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [pickerKey, setPickerKey] = useState(0);
  const [templateId, setTemplateId] = useState('');

  const ready =
    (freeText ? fields.name.trim() !== '' : medicine !== null) &&
    fields.frequency !== '' &&
    fields.duration.trim() !== '';

  function pick(m: MedicineLike | null) {
    setMedicine(m);
    // strength and form start from the master and can be changed
    setFields((f) => ({ ...f, strength: m?.strength ?? '', doseForm: m?.doseForm ?? '' }));
  }
  function reset() {
    setMedicine(null);
    setFields(EMPTY);
    setPickerKey((k) => k + 1);
  }

  return (
    <section
      aria-label={t('consult:prescription.region')}
      className="flex flex-col gap-4 rounded-lg border border-line bg-card p-4"
    >
      <h2 className="font-display text-xl font-semibold text-ink">
        {t('consult:prescription.title')}
      </h2>
      <p className="text-sm text-body">{t('consult:prescription.intro')}</p>

      {locked ? (
        <Banner kind="clear" live>
          {t('consult:prescription.locked')}
        </Banner>
      ) : null}
      {props.error ? (
        <Banner kind="blocked" live>
          {t(`consult:prescription.error.${props.error}`)}
        </Banner>
      ) : null}

      {props.loading ? (
        <Skeleton lines={3} label={t('consult:prescription.loading')} />
      ) : rows.length === 0 ? (
        <p className="text-base text-body">{t('consult:prescription.empty')}</p>
      ) : (
        <ul aria-label={t('consult:prescription.listLabel')} className="flex flex-col gap-3">
          {rows.map((row) => (
            <RowCard
              key={`${row.id}:${row.frequency ?? ''}:${row.duration ?? ''}`}
              row={row}
              busy={busy}
              locked={locked}
              onEdit={props.onEdit}
              onRemove={props.onRemove}
            />
          ))}
        </ul>
      )}

      {!locked ? (
        <>
          <form
            className="flex flex-col gap-3 rounded-md border border-line p-3"
            aria-label={t('consult:prescription.addRegion')}
            onSubmit={(event) => {
              event.preventDefault();
              if (!ready || fields.frequency === '') return;
              void props
                .onAdd({
                  medicineId: freeText ? null : (medicine?.id ?? null),
                  ...(freeText ? { name: fields.name.trim() } : {}),
                  strength: orNull(fields.strength),
                  doseForm: orNull(fields.doseForm),
                  dose: orNull(fields.dose),
                  frequency: fields.frequency,
                  duration: fields.duration.trim(),
                  note: orNull(fields.note),
                })
                .then((ok) => {
                  if (ok) reset();
                });
            }}
          >
            <h3 className="text-base font-semibold text-ink">
              {t('consult:prescription.addTitle')}
            </h3>
            {freeText ? (
              <>
                <Banner kind="acknowledge">{t('consult:prescription.freeTextNote')}</Banner>
                <Button
                  onClick={() => {
                    setFreeText(false);
                    reset();
                  }}
                >
                  {t('consult:prescription.backToMaster')}
                </Button>
              </>
            ) : (
              <>
                <MedicineCombobox
                  key={pickerKey}
                  value={medicine}
                  onChange={pick}
                  label={t('consult:prescription.search')}
                />
                <div>
                  <Button
                    onClick={() => {
                      setFreeText(true);
                      reset();
                    }}
                  >
                    {t('consult:prescription.useFreeText')}
                  </Button>
                </div>
              </>
            )}
            {freeText || medicine ? (
              <FieldsForm value={fields} onChange={setFields} showName={freeText} idPrefix="add" />
            ) : null}
            <div>
              <Button type="submit" variant="primary" icon={Plus} disabled={busy || !ready}>
                {t('consult:prescription.add')}
              </Button>
            </div>
          </form>

          {props.templates && props.templates.length > 0 ? (
            <div className="flex flex-wrap items-end gap-3 rounded-md border border-line p-3">
              <div className="min-w-48 flex-1">
                <Select
                  label={t('consult:prescription.templateLabel')}
                  value={templateId}
                  onChange={(event) => setTemplateId(event.target.value)}
                  options={[
                    { value: '', label: t('consult:prescription.templateChoose') },
                    ...props.templates.map((x) => ({ value: x.id, label: x.name })),
                  ]}
                />
              </div>
              <Button
                icon={ClipboardPlus}
                disabled={busy || !templateId}
                onClick={() => void props.onApplyTemplate(templateId).then(() => setTemplateId(''))}
              >
                {t('consult:prescription.applyTemplate')}
              </Button>
            </div>
          ) : null}
        </>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
        <Link
          to={props.signHref}
          className="press-primary inline-flex min-h-11 items-center justify-center rounded-md border border-transparent bg-action px-4 py-2 text-base font-semibold text-on-action shadow-card hover:bg-action-hover"
        >
          {locked ? t('consult:prescription.openRecord') : t('consult:prescription.reviewSign')}
        </Link>
        <p className="text-xs text-body">{t('consult:prescription.noChecks')}</p>
      </div>
    </section>
  );
}
