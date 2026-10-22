// Amendment screen (Phase 8 Run 2): a signed visit is never edited; a change is a NEW version with a reason. This run
// amends the MEDICINE LIST only (facts and the working condition are carried over unchanged, ADR-D38). The screen shows the
// version being replaced and, live, exactly what changed. The server re-checks the reason, the safety acknowledgement and the
// password, and keeps every earlier version.
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import { errorText } from '../api/errorText';
import type { SignedMedicine, SignedVisit, SignReadiness, VisitVersion } from '../api/prescription';
import type { FrequencyCode } from '../api/templates';
import { useRequest } from '../api/useRequest';
import { useAuth } from '../auth/AuthContext';
import { EMPTY, FieldsForm, orNull, type Fields } from '../components/clinical/PrescriptionTab';
import { MedicineCombobox, type MedicineLike } from '../components/clinical/MedicineCombobox';
import { Badge } from '../components/ui/Badge';
import { Banner } from '../components/ui/Banner';
import { Button } from '../components/ui/Button';
import { Input, TextArea } from '../components/ui/Field';
import { Skeleton } from '../components/ui/Feedback';
import { useDateText } from '../api/useDateText';

interface Row {
  key: string;
  medicineId: string | null;
  source: 'master' | 'free_text';
  /** the snapshot line this row started from; null = added in this amendment */
  original: SignedMedicine | null;
  fields: Fields;
}

const fieldsOf = (m: SignedMedicine): Fields => ({
  name: m.name,
  strength: m.strength ?? '',
  doseForm: m.doseForm ?? '',
  dose: m.dose ?? '',
  frequency: m.frequency as FrequencyCode,
  duration: m.duration,
  note: m.note ?? '',
});

const FIELD_KEYS = ['strength', 'doseForm', 'dose', 'frequency', 'duration', 'note'] as const;
const same = (a: string, b: string) => a.trim() === b.trim();

/** Field-by-field differences of one row against the line it replaces. */
function changesOf(
  row: Row,
): Array<{ field: (typeof FIELD_KEYS)[number]; from: string; to: string }> {
  if (!row.original) return [];
  const before = fieldsOf(row.original);
  return FIELD_KEYS.filter((k) => !same(before[k], row.fields[k])).map((k) => ({
    field: k,
    from: before[k],
    to: row.fields[k],
  }));
}

export function AmendPage() {
  const { t } = useTranslation(['consult', 'common', 'templates']);
  const { sessionId = '' } = useParams();
  const { api } = useAuth();
  const dateText = useDateText();
  const visit = useRequest(
    () => api.get<SignedVisit>(`/sessions/${sessionId}/visit`),
    [api, sessionId],
  );
  const readiness = useRequest(
    () => api.get<SignReadiness>(`/sessions/${sessionId}/sign-readiness`),
    [api, sessionId],
  );
  const [rows, setRows] = useState<Row[] | null>(null);
  const [reason, setReason] = useState('');
  const [password, setPassword] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [done, setDone] = useState<VisitVersion | null>(null);
  const [medicine, setMedicine] = useState<MedicineLike | null>(null);
  const [freeText, setFreeText] = useState(false);
  const [adding, setAdding] = useState<Fields>(EMPTY);
  const [pickerKey, setPickerKey] = useState(0);

  const v = visit.state.status === 'ready' ? visit.state.data : null;
  if (v && rows === null) {
    setRows(
      v.content.medicines.map((m) => ({
        key: `old-${m.position}`,
        medicineId: m.medicineId,
        source: m.source,
        original: m,
        fields: fieldsOf(m),
      })),
    );
  }
  const list = rows ?? [];
  const removed = v ? v.content.medicines.filter((m) => !list.some((r) => r.original === m)) : [];
  const added = list.filter((r) => r.original === null);
  const edited = list.filter((r) => changesOf(r).length > 0);
  const changeCount = removed.length + added.length + edited.length;
  const needsAck = readiness.state.status === 'ready' && !readiness.state.data.safety.configured;
  const safetyError =
    readiness.state.status === 'ready' && readiness.state.data.safety.error === true;
  const incomplete = list.some((r) => !r.fields.frequency || !r.fields.duration.trim());
  const canSubmit =
    !!reason.trim() &&
    !!password &&
    changeCount > 0 &&
    !incomplete &&
    !safetyError &&
    (!needsAck || acknowledged) &&
    !busy;
  const addReady =
    (freeText ? adding.name.trim() !== '' : medicine !== null) &&
    adding.frequency !== '' &&
    adding.duration.trim() !== '';

  function patch(key: string, fields: Fields) {
    setRows((current) => (current ?? []).map((r) => (r.key === key ? { ...r, fields } : r)));
  }

  async function submit() {
    setBusy(true);
    setFailure(null);
    try {
      const result = await api.post<VisitVersion>(`/sessions/${sessionId}/amend`, {
        password,
        safetyNotRunAcknowledged: acknowledged,
        reason: reason.trim(),
        medicines: list.map((r) => ({
          medicineId: r.medicineId,
          ...(r.source === 'free_text' ? { name: r.fields.name.trim() } : {}),
          strength: orNull(r.fields.strength),
          doseForm: orNull(r.fields.doseForm),
          dose: orNull(r.fields.dose),
          frequency: r.fields.frequency,
          duration: r.fields.duration.trim(),
          note: orNull(r.fields.note),
        })),
      });
      setDone(result);
    } catch (err) {
      setFailure(err instanceof ApiError ? err.code : 'UNKNOWN');
    } finally {
      setPassword('');
      setBusy(false);
    }
  }

  const fieldLabel = (k: (typeof FIELD_KEYS)[number]) => t(`consult:prescription.field.${k}`);
  const shown = (k: (typeof FIELD_KEYS)[number], value: string) =>
    k === 'frequency' && value
      ? t(`templates:frequency.${value}`, value)
      : value || t('consult:amend.empty');

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <header>
        <h1 className="font-display text-3xl font-semibold text-ink">{t('consult:amend.title')}</h1>
        <p className="mt-1 text-base text-body">{t('consult:amend.intro')}</p>
      </header>

      {visit.state.status === 'loading' ? (
        <Skeleton lines={4} label={t('consult:record.loading')} />
      ) : visit.state.status === 'error' ? (
        <Banner kind="blocked" live>
          {visit.state.error instanceof ApiError && visit.state.error.status === 404
            ? t('consult:record.notSigned')
            : errorText(t, visit.state.error)}
        </Banner>
      ) : null}

      {done ? (
        <section
          aria-label={t('consult:amend.resultRegion')}
          className="flex flex-col gap-2 rounded-lg border border-clear-accent bg-clear-bg p-4 text-clear-fg"
        >
          <h2 className="font-display text-xl font-semibold">{t('consult:amend.doneTitle')}</h2>
          <p role="status">{t('consult:amend.doneBody', { version: done.version })}</p>
          <p className="break-all text-xs">
            {t('consult:sign.hash')}: {done.contentHash}
          </p>
          <Link
            to={`/consult/${sessionId}/record`}
            className="inline-flex min-h-11 items-center text-base font-semibold underline"
          >
            {t('consult:sign.openRecord')}
          </Link>
        </section>
      ) : null}

      {v && !done ? (
        <>
          <section
            aria-label={t('consult:amend.replacing')}
            className="flex flex-col gap-1 rounded-lg border border-line bg-card p-4"
          >
            <h2 className="font-display text-xl font-semibold text-ink">
              {t('consult:amend.replacing')}
            </h2>
            <p className="text-sm text-ink">
              {t(
                v.kind === 'signed'
                  ? 'consult:record.versionSigned'
                  : 'consult:record.versionAmended',
                {
                  version: v.version,
                },
              )}{' '}
              · {dateText(v.signedAt)}
            </p>
            <p className="break-all text-xs text-body">
              {t('consult:sign.hash')}: {v.contentHash}
            </p>
            <p className="text-sm text-body">{t('consult:amend.kept')}</p>
          </section>

          <section
            aria-label={t('consult:amend.medicines')}
            className="flex flex-col gap-3 rounded-lg border border-line bg-card p-4"
          >
            <h2 className="font-display text-xl font-semibold text-ink">
              {t('consult:amend.medicines')}
            </h2>
            {list.length === 0 ? (
              <p className="text-sm text-body">{t('consult:diff.noMedicines')}</p>
            ) : null}
            <ul className="flex flex-col gap-3">
              {list.map((r) => (
                <li key={r.key} className="flex flex-col gap-3 rounded-md border border-line p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-base font-semibold text-ink">
                      {r.fields.name}{' '}
                      {r.source === 'free_text' ? (
                        <Badge>{t('consult:prescription.notInMaster')}</Badge>
                      ) : null}
                      {r.original === null ? <Badge>{t('consult:amend.newRow')}</Badge> : null}
                    </h3>
                    <Button
                      icon={Trash2}
                      aria-label={t('consult:prescription.removeRow', { name: r.fields.name })}
                      onClick={() => setRows((cur) => (cur ?? []).filter((x) => x.key !== r.key))}
                    >
                      {t('consult:prescription.remove')}
                    </Button>
                  </div>
                  <FieldsForm
                    value={r.fields}
                    onChange={(f) => patch(r.key, f)}
                    showName={false}
                    idPrefix={`amend-${r.key}`}
                  />
                </li>
              ))}
            </ul>

            <form
              aria-label={t('consult:prescription.addRegion')}
              className="flex flex-col gap-3 rounded-md border border-line p-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (!addReady) return;
                setRows((cur) => [
                  ...(cur ?? []),
                  {
                    key: `new-${Date.now()}`,
                    medicineId: freeText ? null : (medicine?.id ?? null),
                    source: freeText ? 'free_text' : 'master',
                    original: null,
                    fields: {
                      ...adding,
                      name: freeText ? adding.name.trim() : (medicine?.genericName ?? ''),
                    },
                  },
                ]);
                setAdding(EMPTY);
                setMedicine(null);
                setPickerKey((k) => k + 1);
              }}
            >
              <h3 className="text-base font-semibold text-ink">
                {t('consult:prescription.addTitle')}
              </h3>
              {freeText ? (
                <>
                  <Banner kind="acknowledge">{t('consult:prescription.freeTextNote')}</Banner>
                  <div>
                    <Button
                      onClick={() => {
                        setFreeText(false);
                        setAdding(EMPTY);
                      }}
                    >
                      {t('consult:prescription.backToMaster')}
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <MedicineCombobox
                    key={pickerKey}
                    value={medicine}
                    onChange={(m) => {
                      setMedicine(m);
                      setAdding((f) => ({
                        ...f,
                        strength: m?.strength ?? '',
                        doseForm: m?.doseForm ?? '',
                      }));
                    }}
                    label={t('consult:prescription.search')}
                  />
                  <div>
                    <Button
                      onClick={() => {
                        setFreeText(true);
                        setMedicine(null);
                        setAdding(EMPTY);
                      }}
                    >
                      {t('consult:prescription.useFreeText')}
                    </Button>
                  </div>
                </>
              )}
              {freeText || medicine ? (
                <FieldsForm
                  value={adding}
                  onChange={setAdding}
                  showName={freeText}
                  idPrefix="amend-add"
                />
              ) : null}
              <div>
                <Button type="submit" icon={Plus} disabled={!addReady}>
                  {t('consult:amend.addRow')}
                </Button>
              </div>
            </form>
          </section>

          <section
            aria-label={t('consult:amend.changes')}
            className="flex flex-col gap-2 rounded-lg border border-line bg-card p-4"
          >
            <h2 className="font-display text-xl font-semibold text-ink">
              {t('consult:amend.changes')}
            </h2>
            {changeCount === 0 ? (
              <p className="text-sm text-body">{t('consult:amend.noChanges')}</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm text-ink">
                {removed.map((m) => (
                  <li key={`r-${m.position}`}>{t('consult:amend.removed', { name: m.name })}</li>
                ))}
                {added.map((r) => (
                  <li key={`a-${r.key}`}>{t('consult:amend.added', { name: r.fields.name })}</li>
                ))}
                {edited.map((r) =>
                  changesOf(r).map((c) => (
                    <li key={`${r.key}-${c.field}`}>
                      {t('consult:amend.changed', {
                        name: r.fields.name,
                        field: fieldLabel(c.field),
                        from: shown(c.field, c.from),
                        to: shown(c.field, c.to),
                      })}
                    </li>
                  )),
                )}
              </ul>
            )}
          </section>

          <form
            aria-label={t('consult:amend.formLabel')}
            className="flex flex-col gap-4 rounded-lg border border-line bg-card p-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (canSubmit) void submit();
            }}
          >
            <TextArea
              label={t('consult:amend.reason')}
              hint={t('consult:amend.reasonHint')}
              value={reason}
              maxLength={500}
              onChange={(event) => setReason(event.target.value)}
              required
            />
            {safetyError ? (
              <Banner kind="blocked" live title={t('consult:sign.safetyErrorTitle')}>
                {t('consult:sign.safetyErrorBody')}
              </Banner>
            ) : needsAck ? (
              <>
                <Banner kind="acknowledge" title={t('consult:sign.safetyTitle')}>
                  {t('consult:sign.safetyBody')}
                </Banner>
                <label className="inline-flex min-h-11 items-center gap-2 text-base text-ink">
                  <input
                    type="checkbox"
                    checked={acknowledged}
                    onChange={(event) => setAcknowledged(event.target.checked)}
                    className="size-5 accent-[var(--color-action)]"
                  />
                  {t('consult:sign.safetyAck')}
                </label>
              </>
            ) : null}
            <Input
              type="password"
              autoComplete="current-password"
              label={t('consult:sign.password')}
              hint={t('consult:sign.passwordHint')}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            {failure ? (
              <Banner kind="blocked" live>
                {t(`consult:sign.error.${failure}`, { defaultValue: t('consult:amend.error') })}
              </Banner>
            ) : null}
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" variant="primary" loading={busy} disabled={!canSubmit}>
                {t('consult:amend.button')}
              </Button>
              <p className="text-xs text-body">
                {changeCount === 0
                  ? t('consult:amend.whyNoChange')
                  : incomplete
                    ? t('consult:prescription.incomplete')
                    : !reason.trim()
                      ? t('consult:amend.whyReason')
                      : ''}
              </p>
            </div>
          </form>
        </>
      ) : null}

      <p>
        <Link
          to={`/consult/${sessionId}/record`}
          className="inline-flex min-h-11 items-center text-base font-semibold text-ink underline"
        >
          {t('consult:amend.backToRecord')}
        </Link>
      </p>
    </div>
  );
}
