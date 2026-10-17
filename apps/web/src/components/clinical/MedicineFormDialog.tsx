// Add or edit one medicine (PG-12, admin). The API decides what an admin may set: codes and review fields cannot be
// set here, a new row starts as "not reviewed", and an edit to a reviewed row clears the review (the dialog says so).
import { Save } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../../api/client';
import { errorText } from '../../api/errorText';
import type { Medicine, MedicineInput } from '../../api/medicines';
import { useAuth } from '../../auth/AuthContext';
import { Banner } from '../ui/Banner';
import { Button } from '../ui/Button';
import { ErrorSummary, type FormError } from '../ui/ErrorSummary';
import { Input, TextArea } from '../ui/Field';
import { Modal } from '../ui/Overlay';

interface Draft {
  genericName: string;
  strength: string;
  doseForm: string;
  route: string;
  therapeuticCategory: string;
  nlemYear: string;
  source: string;
  sourcePage: string;
  sourceNotes: string;
}

const EMPTY: Draft = {
  genericName: '',
  strength: '',
  doseForm: '',
  route: '',
  therapeuticCategory: '',
  nlemYear: '',
  source: '',
  sourcePage: '',
  sourceNotes: '',
};

const draftOf = (m: Medicine | null): Draft =>
  m
    ? {
        genericName: m.genericName,
        strength: m.strength ?? '',
        doseForm: m.doseForm ?? '',
        route: m.route ?? '',
        therapeuticCategory: m.therapeuticCategory ?? '',
        nlemYear: m.nlemYear === null ? '' : String(m.nlemYear),
        source: m.source,
        sourcePage: m.sourcePage === null ? '' : String(m.sourcePage),
        sourceNotes: m.sourceNotes ?? '',
      }
    : EMPTY;

const orNull = (v: string): string | null => (v.trim() === '' ? null : v.trim());
const whole = (v: string): number | null => (v.trim() === '' ? null : Number(v.trim()));

/** The request body from the form: empty text means "no value" (null). */
function toInput(d: Draft): MedicineInput {
  return {
    genericName: d.genericName.trim(),
    source: d.source.trim(),
    strength: orNull(d.strength),
    doseForm: orNull(d.doseForm),
    route: orNull(d.route),
    therapeuticCategory: orNull(d.therapeuticCategory),
    nlemYear: whole(d.nlemYear),
    sourcePage: whole(d.sourcePage),
    sourceNotes: orNull(d.sourceNotes),
  };
}

export function MedicineFormDialog({
  open,
  medicine,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** null: add a new medicine. */
  medicine: Medicine | null;
  onClose: () => void;
  onSaved: (medicine: Medicine, created: boolean) => void;
}) {
  const { t } = useTranslation('medicines');
  const { api } = useAuth();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [attempts, setAttempts] = useState(0);
  const summaryRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const editing = medicine !== null;

  useEffect(() => {
    if (open) {
      setDraft(draftOf(medicine));
      setErrors({});
    }
  }, [open, medicine]);
  useEffect(() => {
    if (attempts > 0) summaryRef.current?.focus();
  }, [attempts]);

  const set = (key: keyof Draft) => (event: { target: { value: string } }) =>
    setDraft((d) => ({ ...d, [key]: event.target.value }));

  function validate(): Record<string, string> {
    const next: Record<string, string> = {};
    if (draft.genericName.trim() === '') next.genericName = t('medicines:form.nameRequired');
    if (draft.source.trim() === '') next.source = t('medicines:form.sourceRequired');
    const page = whole(draft.sourcePage);
    if (page !== null && (!Number.isInteger(page) || page < 1 || page > 10_000))
      next.sourcePage = t('medicines:form.pageInvalid');
    const year = whole(draft.nlemYear);
    if (year !== null && (!Number.isInteger(year) || year < 1990 || year > 2100))
      next.nlemYear = t('medicines:form.yearInvalid');
    return next;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setAttempts((n) => n + 1);
      return;
    }
    const input = toInput(draft);
    setBusy(true);
    try {
      if (medicine) {
        const before = toInput(draftOf(medicine));
        const changed = Object.fromEntries(
          Object.entries(input).filter(
            ([key, value]) => value !== before[key as keyof MedicineInput],
          ),
        );
        if (Object.keys(changed).length === 0) {
          setErrors({ form: t('medicines:form.nothingChanged') });
          setAttempts((n) => n + 1);
          return;
        }
        onSaved(await api.patch<Medicine>(`/medicines/${medicine.id}`, changed), false);
      } else {
        onSaved(await api.post<Medicine>('/medicines', input), true);
      }
    } catch (err) {
      setErrors({
        form:
          err instanceof ApiError && err.status === 409
            ? t('medicines:form.duplicate')
            : errorText(t, err),
      });
      setAttempts((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }

  const fieldIds: Record<string, string> = {
    genericName: 'medicine-name',
    source: 'medicine-source',
    sourcePage: 'medicine-page',
    nlemYear: 'medicine-year',
  };
  const summary: FormError[] = Object.entries(errors).map(([key, message]) => ({
    ...(fieldIds[key] ? { fieldId: fieldIds[key] } : {}),
    message,
  }));
  const err = (key: string) => (errors[key] ? { error: errors[key] } : {});

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? t('medicines:form.editTitle') : t('medicines:form.addTitle')}
      description={
        editing ? t('medicines:form.editDescription') : t('medicines:form.addDescription')
      }
      initialFocusRef={nameRef}
      footer={
        <>
          <Button onClick={onClose}>{t('common:action.cancel')}</Button>
          <Button variant="primary" icon={Save} type="submit" form="medicine-form" loading={busy}>
            {t('medicines:form.save')}
          </Button>
        </>
      }
    >
      <form id="medicine-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <ErrorSummary ref={summaryRef} title={t('medicines:form.errorSummary')} errors={summary} />
        {editing && medicine?.reviewStatus === 'reviewed' ? (
          <Banner kind="acknowledge">{t('medicines:form.clearsReview')}</Banner>
        ) : null}
        <Input
          ref={nameRef}
          id="medicine-name"
          label={t('medicines:form.genericName')}
          maxLength={200}
          autoComplete="off"
          required
          requiredText={t('common:status.required')}
          value={draft.genericName}
          onChange={set('genericName')}
          {...err('genericName')}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label={t('medicines:form.strength')}
            maxLength={120}
            autoComplete="off"
            value={draft.strength}
            onChange={set('strength')}
          />
          <Input
            label={t('medicines:form.doseForm')}
            maxLength={120}
            autoComplete="off"
            value={draft.doseForm}
            onChange={set('doseForm')}
          />
        </div>
        <Input
          label={t('medicines:form.route')}
          hint={t('medicines:form.routeHint')}
          maxLength={80}
          autoComplete="off"
          value={draft.route}
          onChange={set('route')}
        />
        <Input
          label={t('medicines:form.category')}
          maxLength={300}
          autoComplete="off"
          value={draft.therapeuticCategory}
          onChange={set('therapeuticCategory')}
        />
        <Input
          id="medicine-source"
          label={t('medicines:form.source')}
          hint={t('medicines:form.sourceHint')}
          maxLength={300}
          autoComplete="off"
          required
          requiredText={t('common:status.required')}
          value={draft.source}
          onChange={set('source')}
          {...err('source')}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            id="medicine-page"
            label={t('medicines:form.sourcePage')}
            hint={t('medicines:form.sourcePageHint')}
            inputMode="numeric"
            autoComplete="off"
            value={draft.sourcePage}
            onChange={set('sourcePage')}
            {...err('sourcePage')}
          />
          <Input
            id="medicine-year"
            label={t('medicines:form.nlemYear')}
            inputMode="numeric"
            autoComplete="off"
            value={draft.nlemYear}
            onChange={set('nlemYear')}
            {...err('nlemYear')}
          />
        </div>
        <TextArea
          label={t('medicines:form.sourceNotes')}
          maxLength={1000}
          value={draft.sourceNotes}
          onChange={set('sourceNotes')}
        />
      </form>
    </Modal>
  );
}
