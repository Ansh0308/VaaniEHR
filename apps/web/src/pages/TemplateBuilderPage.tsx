// PG-13 Template builder (doctor, admin): name, who can use it (personal or clinic-wide), and an ordered list of
// medicines picked with the MedicineCombobox. Order is changed with move up / move down buttons (keyboard and touch
// friendly; focus stays on the button that was pressed). Frequency is a code from a fixed list, never free text.
// The preview shows how the template reads; "Load template" shows what the later prescription builder receives.
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  FileDown,
  Plus,
  Save,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { errorText } from '../api/errorText';
import {
  FREQUENCY_CODES,
  type FrequencyCode,
  type TemplateDetail,
  type TemplateInput,
  type Visibility,
} from '../api/templates';
import { useRequest } from '../api/useRequest';
import { useAuth } from '../auth/AuthContext';
import {
  MedicineCombobox,
  medicineText,
  type MedicineLike,
} from '../components/clinical/MedicineCombobox';
import { TemplateLoadDialog } from '../components/clinical/TemplateLoadDialog';
import { NeedsReview } from '../components/NeedsReview';
import { Badge } from '../components/ui/Badge';
import { Banner } from '../components/ui/Banner';
import { Button, IconButton } from '../components/ui/Button';
import { ErrorSummary, type FormError } from '../components/ui/ErrorSummary';
import { Skeleton } from '../components/ui/Feedback';
import { Input, Select, TextArea } from '../components/ui/Field';
import { useToast } from '../components/ui/Toast';

const MAX_ITEMS = 40;

interface Line {
  /** Stable identity of the row while it is edited (not an API id): keeps each combobox with its own row. */
  key: string;
  medicine: MedicineLike | null;
  dose: string;
  frequency: FrequencyCode | '';
  duration: string;
  instructions: string;
}

interface Form {
  name: string;
  visibility: Visibility;
  lines: Line[];
}

const orNull = (v: string): string | null => (v.trim() === '' ? null : v.trim());
const signature = (f: Form): string =>
  JSON.stringify([
    f.name.trim(),
    f.visibility,
    f.lines.map((l) => [
      l.medicine?.id ?? null,
      l.dose.trim(),
      l.frequency,
      l.duration.trim(),
      l.instructions.trim(),
    ]),
  ]);

export function TemplateBuilderPage() {
  const { t } = useTranslation('templates');
  const { api } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const { id } = useParams();
  const isNew = id === undefined;

  const counter = useRef(0);
  const newKey = () => `line-${++counter.current}`;
  const blank = (): Line => ({
    key: newKey(),
    medicine: null,
    dose: '',
    frequency: '',
    duration: '',
    instructions: '',
  });

  const [form, setForm] = useState<Form>({ name: '', visibility: 'personal', lines: [] });
  const [saved, setSaved] = useState<string>(
    signature({ name: '', visibility: 'personal', lines: [] }),
  );
  const [detail, setDetail] = useState<TemplateDetail | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [attempts, setAttempts] = useState(0);
  const [busy, setBusy] = useState(false);
  const [announce, setAnnounce] = useState('');
  const [loadOpen, setLoadOpen] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const focusAfter = useRef<string | null>(null);

  const fetched = useRequest(
    async () => (id ? api.get<TemplateDetail>(`/templates/${id}`) : null),
    [api, id],
  );

  function apply(d: TemplateDetail) {
    const next: Form = {
      name: d.name,
      visibility: d.visibility,
      lines: d.items.map((i) => ({
        key: newKey(),
        medicine: i.medicine,
        dose: i.dose ?? '',
        frequency: i.frequency ?? '',
        duration: i.duration ?? '',
        instructions: i.instructions ?? '',
      })),
    };
    setDetail(d);
    setForm(next);
    setSaved(signature(next));
  }
  useEffect(() => {
    if (fetched.state.status === 'ready' && fetched.state.data) apply(fetched.state.data);
  }, [fetched.state.status === 'ready' ? fetched.state.data : null]);
  useEffect(() => {
    if (attempts > 0) summaryRef.current?.focus();
  }, [attempts]);
  useEffect(() => {
    const target = focusAfter.current;
    if (target) {
      focusAfter.current = null;
      const element = document.getElementById(target) as HTMLButtonElement | null;
      element?.focus();
    }
  });

  const readOnly = detail !== null && (!detail.canEdit || detail.retired);
  const dirty = signature(form) !== saved;
  const canChangeVisibility = detail === null || detail.ownedByMe;

  const setLine = (key: string, patch: Partial<Line>) =>
    setForm((f) => ({ ...f, lines: f.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }));
  const nameOf = (l: Line, index: number) =>
    l.medicine ? l.medicine.genericName : t('templates:builder.unnamed', { n: index + 1 });

  function add() {
    const line = blank();
    setForm((f) => ({ ...f, lines: [...f.lines, line] }));
    focusAfter.current = `item-${line.key}-medicine`;
    setAnnounce(t('templates:builder.added', { n: form.lines.length + 1 }));
  }
  function remove(index: number) {
    const gone = form.lines[index];
    if (!gone) return;
    setForm((f) => ({ ...f, lines: f.lines.filter((_, i) => i !== index) }));
    focusAfter.current = 'add-item';
    setAnnounce(t('templates:builder.removed', { name: nameOf(gone, index) }));
  }
  function move(index: number, by: -1 | 1) {
    const to = index + by;
    const line = form.lines[index];
    if (!line || to < 0 || to >= form.lines.length) return;
    const lines = [...form.lines];
    lines.splice(index, 1);
    lines.splice(to, 0, line);
    setForm((f) => ({ ...f, lines }));
    // keep the keyboard where it was; at the end of the list the other button takes over
    const atEdge = by === -1 ? to === 0 : to === form.lines.length - 1;
    focusAfter.current = `move-${atEdge ? (by === -1 ? 'down' : 'up') : by === -1 ? 'up' : 'down'}-${line.key}`;
    setAnnounce(
      t('templates:builder.moved', {
        name: nameOf(line, index),
        n: to + 1,
        total: lines.length,
      }),
    );
  }

  function validate(): Record<string, string> {
    const next: Record<string, string> = {};
    if (form.name.trim() === '') next.name = t('templates:builder.nameRequired');
    if (form.lines.length === 0) next.items = t('templates:builder.noItems');
    if (form.lines.length > MAX_ITEMS)
      next.items = t('templates:builder.tooMany', { max: MAX_ITEMS });
    form.lines.forEach((l, index) => {
      if (!l.medicine)
        next[`line:${l.key}`] = t('templates:builder.itemNoMedicine', { n: index + 1 });
    });
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
    const body: TemplateInput = {
      name: form.name.trim(),
      visibility: form.visibility,
      items: form.lines.map((l) => ({
        medicineId: (l.medicine as MedicineLike).id,
        dose: orNull(l.dose),
        frequency: l.frequency === '' ? null : l.frequency,
        duration: orNull(l.duration),
        instructions: orNull(l.instructions),
      })),
    };
    setBusy(true);
    try {
      if (isNew) {
        await api.post<TemplateDetail>('/templates', body);
        toast.push({ kind: 'clear', title: t('templates:builder.created') });
        navigate('/admin/templates');
      } else {
        apply(await api.put<TemplateDetail>(`/templates/${id}`, body));
        toast.push({ kind: 'clear', title: t('templates:builder.updated') });
      }
    } catch (err) {
      setErrors({ form: errorText(t, err) });
      setAttempts((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }

  const summary: FormError[] = Object.entries(errors).map(([key, message]) => ({
    ...(key === 'name'
      ? { fieldId: 'template-name' }
      : key === 'items'
        ? { fieldId: 'add-item' }
        : key.startsWith('line:')
          ? { fieldId: `item-${key.slice(5)}-medicine` }
          : {}),
    message,
  }));

  if (!isNew && fetched.state.status === 'loading')
    return (
      <div className="mx-auto max-w-4xl">
        <Skeleton lines={6} label={t('templates:list.loading')} />
      </div>
    );
  if (!isNew && fetched.state.status === 'error')
    return (
      <div className="mx-auto flex max-w-4xl flex-col gap-4">
        <Banner
          kind="blocked"
          live
          actions={<Button onClick={fetched.reload}>{t('common:action.retry')}</Button>}
        >
          {errorText(t, fetched.state.error)}
        </Banner>
        <Link to="/admin/templates" className="inline-flex min-h-11 items-center underline">
          {t('templates:builder.back')}
        </Link>
      </div>
    );

  const title = isNew
    ? t('templates:builder.titleNew')
    : readOnly
      ? t('templates:builder.titleView')
      : t('templates:builder.titleEdit');
  const frequencyOptions = [
    { value: '', label: t('templates:builder.frequencyNone') },
    ...FREQUENCY_CODES.map((c) => ({ value: c, label: t(`templates:frequency.${c}`) })),
  ];

  const preview = (
    <section
      aria-labelledby="preview-heading"
      className="flex flex-col gap-3 rounded-lg border border-line bg-card p-4"
    >
      <h2 id="preview-heading" className="text-xl font-semibold text-ink">
        {t('templates:preview.heading')}
      </h2>
      <p className="text-sm text-body">{t('templates:preview.description')}</p>
      {form.lines.filter((l) => l.medicine).length === 0 ? (
        <p className="text-base text-body">{t('templates:preview.empty')}</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {form.lines.map((l, index) =>
            l.medicine ? (
              <li key={l.key} className="rounded-md border border-control p-3">
                <p className="text-base font-semibold text-ink">
                  {t('templates:preview.line', {
                    n: index + 1,
                    medicine: medicineText(l.medicine),
                  })}
                </p>
                <dl className="mt-1 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="font-semibold text-body">{t('templates:preview.dose')}</dt>
                    <dd className="text-ink">{l.dose.trim() || t('templates:preview.notSet')}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-body">{t('templates:preview.frequency')}</dt>
                    <dd className="text-ink">
                      {l.frequency
                        ? t(`templates:frequency.${l.frequency}`)
                        : t('templates:preview.notSet')}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-body">{t('templates:preview.duration')}</dt>
                    <dd className="text-ink">
                      {l.duration.trim() || t('templates:preview.notSet')}
                    </dd>
                  </div>
                </dl>
                {l.instructions.trim() ? (
                  <p className="mt-1 text-sm text-ink">
                    <span className="font-semibold text-body">
                      {t('templates:preview.instructions')}:{' '}
                    </span>
                    {l.instructions.trim()}
                  </p>
                ) : null}
              </li>
            ) : null,
          )}
        </ol>
      )}
    </section>
  );

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <Link
          to="/admin/templates"
          className="inline-flex min-h-11 w-fit items-center gap-1.5 rounded-sm font-semibold text-ink underline"
        >
          <ArrowLeft aria-hidden="true" className="size-5" />
          {t('templates:builder.back')}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl font-semibold text-ink">{title}</h1>
            <p className="mt-1 text-base text-body">{t('templates:builder.intro')}</p>
            <p className="mt-1 text-sm text-body">{t('templates:builder.demoNote')}</p>
            <GujaratiNote />
          </div>
          {detail && !detail.retired ? (
            <div className="flex flex-col items-end gap-1">
              <Button
                icon={FileDown}
                disabled={dirty}
                aria-describedby={dirty ? 'save-before-load' : undefined}
                onClick={() => setLoadOpen(true)}
              >
                {t('templates:load.button')}
              </Button>
              {dirty ? (
                <p id="save-before-load" className="text-xs text-body">
                  {t('templates:builder.saveBeforeLoad')}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </header>

      {detail?.retired ? (
        <Banner kind="acknowledge">{t('templates:builder.retiredTemplate')}</Banner>
      ) : detail && !detail.canEdit ? (
        <Banner>{t('templates:builder.readOnly')}</Banner>
      ) : null}

      {readOnly ? (
        <section className="flex flex-col gap-2 rounded-lg border border-line bg-card p-4">
          <h2 className="text-xl font-semibold text-ink">{form.name}</h2>
          <p className="flex flex-wrap items-center gap-2 text-sm text-body">
            <Badge>{t(`templates:visibility.${form.visibility}`)}</Badge>
            {t(`templates:visibility.${form.visibility}Help`)}
          </p>
        </section>
      ) : (
        <form onSubmit={submit} noValidate className="flex flex-col gap-6">
          <ErrorSummary
            ref={summaryRef}
            title={t('templates:builder.errorSummary')}
            errors={summary}
          />
          <Input
            id="template-name"
            label={t('templates:builder.name')}
            hint={t('templates:builder.nameHint')}
            maxLength={120}
            autoComplete="off"
            required
            requiredText={t('common:status.required')}
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            {...(errors.name ? { error: errors.name } : {})}
          />

          <fieldset className="flex flex-col gap-2" disabled={!canChangeVisibility}>
            <legend className="text-sm font-semibold text-ink">
              {t('templates:builder.visibilityLegend')}
            </legend>
            {(['personal', 'clinic'] as const).map((v) => (
              <label
                key={v}
                className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-control bg-card p-3"
              >
                <input
                  type="radio"
                  name="template-visibility"
                  value={v}
                  checked={form.visibility === v}
                  onChange={() => setForm((f) => ({ ...f, visibility: v }))}
                  className="mt-1 size-5 accent-[var(--color-action)]"
                />
                <span>
                  <span className="block text-base font-semibold text-ink">
                    {t(`templates:visibility.${v}`)}
                  </span>
                  <span className="block text-sm text-body">
                    {t(`templates:visibility.${v}Help`)}
                  </span>
                </span>
              </label>
            ))}
            {!canChangeVisibility ? (
              <p className="text-xs text-body">{t('templates:builder.visibilityOnly')}</p>
            ) : null}
          </fieldset>

          <section aria-labelledby="items-heading" className="flex flex-col gap-3">
            <h2 id="items-heading" className="text-xl font-semibold text-ink">
              {t('templates:builder.itemsHeading')}
            </h2>
            {errors.items ? (
              <p className="text-xs font-semibold text-blocked-fg">{errors.items}</p>
            ) : null}
            {form.lines.length === 0 ? (
              <p className="text-base text-body">{t('templates:builder.itemsEmpty')}</p>
            ) : (
              <ol className="flex flex-col gap-4">
                {form.lines.map((l, index) => (
                  <li
                    key={l.key}
                    aria-labelledby={`item-${l.key}-heading`}
                    className="flex flex-col gap-3 rounded-lg border border-line bg-card p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 id={`item-${l.key}-heading`} className="text-base font-semibold text-ink">
                        {t('templates:builder.itemHeading', {
                          n: index + 1,
                          total: form.lines.length,
                        })}
                      </h3>
                      <div className="flex gap-1">
                        <IconButton
                          id={`move-up-${l.key}`}
                          icon={ArrowUp}
                          label={t('templates:builder.moveUp', { name: nameOf(l, index) })}
                          disabled={index === 0}
                          onClick={() => move(index, -1)}
                        />
                        <IconButton
                          id={`move-down-${l.key}`}
                          icon={ArrowDown}
                          label={t('templates:builder.moveDown', { name: nameOf(l, index) })}
                          disabled={index === form.lines.length - 1}
                          onClick={() => move(index, 1)}
                        />
                        <IconButton
                          icon={Trash2}
                          label={t('templates:builder.remove', { name: nameOf(l, index) })}
                          onClick={() => remove(index)}
                        />
                      </div>
                    </div>
                    <MedicineCombobox
                      inputId={`item-${l.key}-medicine`}
                      value={l.medicine}
                      onChange={(medicine) => setLine(l.key, { medicine })}
                      label={t('templates:builder.medicine')}
                      {...(errors[`line:${l.key}`]
                        ? { error: errors[`line:${l.key}`] as string }
                        : {})}
                    />
                    {l.medicine?.retired ? (
                      <p className="flex items-start gap-2 text-sm font-semibold text-ink">
                        <TriangleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
                        {t('templates:builder.retiredMedicine')}
                      </p>
                    ) : null}
                    <div className="grid gap-4 sm:grid-cols-3">
                      <Input
                        label={t('templates:builder.dose')}
                        hint={t('templates:builder.doseHint')}
                        maxLength={120}
                        autoComplete="off"
                        value={l.dose}
                        onChange={(e) => setLine(l.key, { dose: e.target.value })}
                      />
                      <Select
                        label={t('templates:builder.frequency')}
                        value={l.frequency}
                        options={frequencyOptions}
                        onChange={(e) =>
                          setLine(l.key, { frequency: e.target.value as FrequencyCode | '' })
                        }
                      />
                      <Input
                        label={t('templates:builder.duration')}
                        hint={t('templates:builder.durationHint')}
                        maxLength={120}
                        autoComplete="off"
                        value={l.duration}
                        onChange={(e) => setLine(l.key, { duration: e.target.value })}
                      />
                    </div>
                    <TextArea
                      label={t('templates:builder.instructions')}
                      maxLength={500}
                      value={l.instructions}
                      onChange={(e) => setLine(l.key, { instructions: e.target.value })}
                    />
                  </li>
                ))}
              </ol>
            )}
            <div>
              <Button
                id="add-item"
                icon={Plus}
                onClick={add}
                disabled={form.lines.length >= MAX_ITEMS}
              >
                {t('templates:builder.addItem')}
              </Button>
            </div>
          </section>

          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" icon={Save} type="submit" loading={busy}>
              {t('templates:builder.save')}
            </Button>
          </div>
        </form>
      )}

      {preview}

      <p role="status" className="sr-only">
        {announce}
      </p>

      {detail ? (
        <TemplateLoadDialog
          templateId={loadOpen ? detail.id : null}
          name={detail.name}
          onClose={() => setLoadOpen(false)}
        />
      ) : null}
    </div>
  );
}

function GujaratiNote() {
  const { i18n } = useTranslation();
  return i18n.language === 'gu' ? <NeedsReview /> : null;
}
