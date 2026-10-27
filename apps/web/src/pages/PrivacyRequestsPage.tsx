// PG-20 Data erasure requests (staff and admin; Phase 12B Run 2, ADR-D45). Staff and admins record a request for a patient; an admin
// reviews it and completes or refuses it. The page says in plain words what completing does (removes everything that is not part
// of a signed visit record, keeps the signed record and the audit log) and that whether a signed record must be kept is still
// to be confirmed by the owner's guide, institution or a clinician (OCI-016). Counts only: no clinical content is shown here.
import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../api/client';
import { digitsOf, usePatientLookup } from '../api/usePatientLookup';
import type { ErasureChannel, ErasureImpact, ErasureRequest, ErasureStatus } from '../api/privacy';
import { useDateText } from '../api/useDateText';
import { useRequest } from '../api/useRequest';
import { useAuth } from '../auth/AuthContext';
import { Banner } from '../components/ui/Banner';
import { StateBadge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { ErrorSummary, type FormError } from '../components/ui/ErrorSummary';
import { Input, Select, TextArea } from '../components/ui/Field';
import { Skeleton } from '../components/ui/Feedback';
import { Modal } from '../components/ui/Overlay';
import { Table, type Column } from '../components/ui/Table';
import { useToast } from '../components/ui/Toast';
import type { SafetyState } from '../design/states';

const STATE_OF: Record<ErasureStatus, SafetyState> = {
  received: 'unconfirmed',
  in_review: 'acknowledge',
  completed: 'clear',
  refused: 'blocked',
};
const CHANNELS: ErasureChannel[] = ['in_person', 'phone', 'written'];

type Dialog = { kind: 'complete' | 'refuse'; request: ErasureRequest } | null;

export function PrivacyRequestsPage() {
  const { t } = useTranslation(['privacy', 'common']);
  const { api, user } = useAuth();
  const dateText = useDateText();
  const toast = useToast();
  const isAdmin = user?.role === 'admin';
  const [filter, setFilter] = useState<ErasureStatus | ''>('');
  const list = useRequest(
    () =>
      api.get<{ items: ErasureRequest[] }>('/privacy/requests', filter ? { status: filter } : {}),
    [api, filter],
  );
  const lookup = usePatientLookup(api);
  const [channel, setChannel] = useState<ErasureChannel | ''>('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<FormError[]>([]);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const [impact, setImpact] = useState<{ request: ErasureRequest; counts: ErasureImpact } | null>(
    null,
  );
  const [dialog, setDialog] = useState<Dialog>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | undefined>();

  const nameOf = (r: ErasureRequest) => r.patientName ?? t('privacy:form.unnamed');
  const items = list.state.status === 'ready' ? list.state.data.items : [];

  function failureKey(err: unknown): string {
    if (err instanceof ApiError) return err.status === 409 ? 'conflict' : 'other';
    return 'other';
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const found: FormError[] = [];
    if (digitsOf(lookup.phone).length !== 10) {
      found.push({ fieldId: 'privacy-phone', message: t('privacy:form.errors.phone') });
    } else if (!lookup.patient) {
      found.push({ fieldId: 'privacy-phone', message: t('privacy:form.errors.patient') });
    }
    if (!channel)
      found.push({ fieldId: 'privacy-channel', message: t('privacy:form.errors.channel') });
    setErrors(found);
    if (found.length > 0 || !lookup.patient || !channel) {
      setTimeout(() => summaryRef.current?.focus(), 0);
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      await api.post('/privacy/requests', {
        patientId: lookup.patient.id,
        channel,
        note: note.trim(),
      });
      toast.push({ kind: 'clear', title: t('privacy:form.recorded') });
      lookup.reset();
      setChannel('');
      setNote('');
      list.reload();
    } catch (err) {
      setFailure(err instanceof ApiError && err.status === 409 ? 'open' : failureKey(err));
    } finally {
      setBusy(false);
    }
  }

  async function act(fn: () => Promise<unknown>, doneText?: string): Promise<boolean> {
    setFailure(null);
    try {
      await fn();
      if (doneText) toast.push({ kind: 'clear', title: doneText });
      list.reload();
      return true;
    } catch (err) {
      setFailure(failureKey(err));
      list.reload();
      return false;
    }
  }

  async function showImpact(request: ErasureRequest) {
    setFailure(null);
    try {
      const out = await api.get<{ counts: ErasureImpact }>(
        `/privacy/requests/${request.id}/impact`,
      );
      setImpact({ request, counts: out.counts });
    } catch (err) {
      setFailure(failureKey(err));
    }
  }

  function open(kind: 'complete' | 'refuse', request: ErasureRequest) {
    setConfirmed(false);
    setReason('');
    setReasonError(undefined);
    setDialog({ kind, request });
  }

  const columns: Column<ErasureRequest>[] = [
    { key: 'patient', header: t('privacy:queue.columns.patient'), render: (r) => nameOf(r) },
    {
      key: 'received',
      header: t('privacy:queue.columns.received'),
      render: (r) => dateText(r.receivedAt),
    },
    {
      key: 'channel',
      header: t('privacy:queue.columns.channel'),
      render: (r) => t(`privacy:form.channels.${r.channel}`),
    },
    {
      key: 'status',
      header: t('privacy:queue.columns.status'),
      render: (r) => (
        <div className="flex flex-col gap-1">
          <StateBadge state={STATE_OF[r.status]} label={t(`privacy:queue.status.${r.status}`)} />
          {r.status === 'refused' && r.refusalReason ? (
            <span className="text-sm text-body">
              {t('privacy:queue.refusedBecause', { reason: r.refusalReason })}
            </span>
          ) : null}
          {r.status === 'completed' && r.decidedAt ? (
            <span className="text-sm text-body">
              {t('privacy:queue.completedOn', { when: dateText(r.decidedAt) })}
            </span>
          ) : null}
          {r.status === 'completed' && r.result ? (
            <details>
              <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-ink">
                {t('privacy:result.title')}
              </summary>
              <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
                {Object.entries(r.result).map(([key, value]) => (
                  <div key={key} className="flex justify-between gap-3">
                    <dt className="text-body">{t(`privacy:result.labels.${key}`, key)}</dt>
                    <dd className="font-semibold text-ink">{value}</dd>
                  </div>
                ))}
              </dl>
            </details>
          ) : null}
        </div>
      ),
    },
  ];
  if (isAdmin) {
    columns.push({
      key: 'actions',
      header: t('privacy:queue.columns.actions'),
      render: (r) => (
        <div className="flex flex-wrap gap-2">
          {r.status === 'received' ? (
            <Button
              aria-label={`${t('privacy:actions.review')}: ${nameOf(r)}`}
              onClick={() => void act(() => api.post(`/privacy/requests/${r.id}/review`, {}))}
            >
              {t('privacy:actions.review')}
            </Button>
          ) : null}
          {r.status === 'in_review' ? (
            <>
              <Button
                aria-label={`${t('privacy:actions.impact')}: ${nameOf(r)}`}
                onClick={() => void showImpact(r)}
              >
                {t('privacy:actions.impact')}
              </Button>
              <Button
                variant="primary"
                aria-label={`${t('privacy:actions.complete')}: ${nameOf(r)}`}
                onClick={() => open('complete', r)}
              >
                {t('privacy:actions.complete')}
              </Button>
            </>
          ) : null}
          {r.status === 'received' || r.status === 'in_review' ? (
            <Button
              aria-label={`${t('privacy:actions.refuse')}: ${nameOf(r)}`}
              onClick={() => open('refuse', r)}
            >
              {t('privacy:actions.refuse')}
            </Button>
          ) : null}
        </div>
      ),
    });
  }

  async function submitDialog() {
    if (!dialog) return;
    if (dialog.kind === 'complete') {
      if (!confirmed) return;
      const ok = await act(
        () => api.post(`/privacy/requests/${dialog.request.id}/complete`, { confirm: true }),
        t('privacy:complete.done'),
      );
      if (ok) {
        setDialog(null);
        setImpact(null);
      }
      return;
    }
    if (reason.trim().length < 3) {
      setReasonError(t('privacy:refuse.tooShort'));
      return;
    }
    const ok = await act(
      () => api.post(`/privacy/requests/${dialog.request.id}/refuse`, { reason: reason.trim() }),
      t('privacy:refuse.done'),
    );
    if (ok) setDialog(null);
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <header>
        <h1 className="font-display text-3xl font-semibold text-ink">{t('privacy:title')}</h1>
        <p className="mt-1 text-base text-body">{t('privacy:intro')}</p>
      </header>

      <Banner kind="acknowledge" title={t('privacy:rules.title')}>
        <ul className="list-disc space-y-1 ps-5">
          <li>{t('privacy:rules.removes')}</li>
          <li>{t('privacy:rules.keeps')}</li>
          <li className="font-semibold">{t('privacy:rules.open')}</li>
        </ul>
      </Banner>

      <form
        onSubmit={(e) => void submit(e)}
        noValidate
        aria-labelledby="privacy-form-title"
        className="flex flex-col gap-4 rounded-lg border border-line bg-card p-4"
      >
        <h2 id="privacy-form-title" className="font-display text-xl font-semibold text-ink">
          {t('privacy:form.title')}
        </h2>
        <ErrorSummary ref={summaryRef} title={t('privacy:form.errorSummary')} errors={errors} />
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-60 flex-1">
            <Input
              id="privacy-phone"
              label={t('privacy:form.phone')}
              hint={t('privacy:form.phoneHint')}
              inputMode="numeric"
              autoComplete="off"
              value={lookup.phone}
              onChange={(e) => lookup.setPhone(e.target.value)}
            />
          </div>
          <Button type="button" onClick={() => void lookup.submit()}>
            {t('privacy:form.find')}
          </Button>
        </div>
        <p role="status" className="min-h-6 text-base font-semibold text-ink">
          {lookup.status === 'found' && lookup.patient
            ? t('privacy:form.found', { name: lookup.patient.name ?? t('privacy:form.unnamed') })
            : lookup.status === 'notFound'
              ? t('privacy:form.notFound')
              : ''}
        </p>
        <Select
          id="privacy-channel"
          label={t('privacy:form.channel')}
          value={channel}
          onChange={(e) => setChannel(e.target.value as ErasureChannel | '')}
          options={[
            { value: '', label: t('privacy:form.channelChoose') },
            ...CHANNELS.map((c) => ({ value: c, label: t(`privacy:form.channels.${c}`) })),
          ]}
        />
        <TextArea
          label={t('privacy:form.note')}
          hint={t('privacy:form.noteHint')}
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <div>
          <Button type="submit" variant="primary" loading={busy}>
            {t('privacy:form.submit')}
          </Button>
        </div>
      </form>

      {failure ? (
        <Banner kind="blocked" live>
          {t(`privacy:errors.${failure}`)}
        </Banner>
      ) : null}

      <section aria-labelledby="privacy-queue-title" className="flex flex-col gap-3">
        <h2 id="privacy-queue-title" className="font-display text-xl font-semibold text-ink">
          {t('privacy:queue.title')}
        </h2>
        {!isAdmin ? <p className="text-sm text-body">{t('privacy:queue.ownOnly')}</p> : null}
        <div className="max-w-xs">
          <Select
            label={t('privacy:queue.filter')}
            value={filter}
            onChange={(e) => setFilter(e.target.value as ErasureStatus | '')}
            options={[
              { value: '', label: t('privacy:queue.all') },
              ...(['received', 'in_review', 'completed', 'refused'] as ErasureStatus[]).map(
                (s) => ({
                  value: s,
                  label: t(`privacy:queue.status.${s}`),
                }),
              ),
            ]}
          />
        </div>
        {list.state.status === 'loading' ? (
          <Skeleton lines={3} label={t('privacy:queue.loading')} />
        ) : (
          <Table
            caption={t('privacy:queue.caption')}
            columns={columns}
            rows={items}
            getRowId={(r) => r.id}
            emptyText={t('privacy:queue.empty')}
          />
        )}
      </section>

      {impact ? (
        <section
          aria-labelledby="privacy-impact-title"
          className="flex flex-col gap-3 rounded-lg border border-line bg-card p-4"
        >
          <h2 id="privacy-impact-title" className="font-display text-xl font-semibold text-ink">
            {t('privacy:impact.title')}
          </h2>
          <p className="text-base text-body">
            {t('privacy:impact.intro', { name: nameOf(impact.request) })}
          </p>
          <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
            {Object.entries(impact.counts).map(([key, value]) => (
              <div key={key} className="flex justify-between gap-3">
                <dt className="text-body">{t(`privacy:impact.labels.${key}`, key)}</dt>
                <dd className="font-semibold text-ink">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      <Modal
        open={dialog !== null}
        onClose={() => setDialog(null)}
        title={
          dialog?.kind === 'complete' ? t('privacy:complete.title') : t('privacy:refuse.title')
        }
        description={
          dialog
            ? dialog.kind === 'complete'
              ? t('privacy:complete.body', { name: nameOf(dialog.request) })
              : t('privacy:refuse.body')
            : undefined
        }
        footer={
          <div className="flex flex-wrap justify-end gap-3">
            <Button onClick={() => setDialog(null)}>{t('common:action.cancel')}</Button>
            <Button
              variant="primary"
              disabled={dialog?.kind === 'complete' && !confirmed}
              onClick={() => void submitDialog()}
            >
              {dialog?.kind === 'complete'
                ? t('privacy:complete.submit')
                : t('privacy:refuse.submit')}
            </Button>
          </div>
        }
      >
        {dialog?.kind === 'complete' ? (
          <label className="flex min-h-11 items-start gap-3 text-base text-ink">
            <input
              type="checkbox"
              className="mt-1 size-6 shrink-0"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            <span>{t('privacy:complete.confirm')}</span>
          </label>
        ) : (
          <TextArea
            label={t('privacy:refuse.reason')}
            maxLength={500}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setReasonError(undefined);
            }}
            {...(reasonError ? { error: reasonError } : {})}
          />
        )}
      </Modal>
    </div>
  );
}
