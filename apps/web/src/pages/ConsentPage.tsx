// PG-05 Consent capture (staff, doctor; admin too, ADR-D20). The notice is shown in Gujarati and English side by side
// (placeholder text, Gujarati needs review), three independent switches (audio, AI processing, WhatsApp), who
// confirmed it, and a clear "withdraw consent" action. Recording stays off until audio AND AI processing are on record;
// the API enforces that on every recording request, and <ConsentGate> explains it where recording would happen.
import { ArrowLeft, ShieldCheck, ShieldOff } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { errorText } from '../api/errorText';
import { formatDateTime } from '../api/format';
import {
  CONSENT_SCOPES,
  type ConsentEvent,
  type ConsentScope,
  type ConsentState,
  type NoticeBundle,
  type NoticeLanguage,
  type Patient,
  type Session,
} from '../api/types';
import { useRequest } from '../api/useRequest';
import { homeFor, useAuth } from '../auth/AuthContext';
import { NeedsReview } from '../components/NeedsReview';
import { Banner } from '../components/ui/Banner';
import { StateBadge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { ErrorSummary, type FormError } from '../components/ui/ErrorSummary';
import { Skeleton } from '../components/ui/Feedback';
import { Modal } from '../components/ui/Overlay';
import { Switch } from '../components/ui/Switch';
import { Table, type Column } from '../components/ui/Table';
import { useToast } from '../components/ui/Toast';
import { cn } from '../components/ui/cn';

type Source = 'patient' | 'staff';
interface Loaded {
  session: Session;
  patient: Patient | null;
  consent: ConsentState & { events: ConsentEvent[] };
  notice: NoticeBundle;
}

function RadioGroup<V extends string>({
  legend,
  name,
  value,
  onChange,
  options,
  error,
  hint,
}: {
  legend: string;
  name: string;
  value: V | '';
  onChange: (value: V) => void;
  options: Array<{ value: V; label: string }>;
  error?: string | undefined;
  hint?: string;
}) {
  return (
    <fieldset
      className="flex flex-col gap-2"
      aria-describedby={error ? `${name}-error` : hint ? `${name}-hint` : undefined}
    >
      <legend className="text-sm font-semibold text-ink">{legend}</legend>
      {hint ? (
        <p id={`${name}-hint`} className="text-xs text-body">
          {hint}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        {options.map((option, index) => (
          <label
            key={option.value}
            className={cn(
              'inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border bg-card px-3 py-2 text-base text-ink',
              value === option.value ? 'border-ink bg-selected font-semibold' : 'border-control',
            )}
          >
            <input
              id={index === 0 ? `${name}-first` : undefined}
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="size-5 accent-(--action-primary)"
            />
            {option.label}
          </label>
        ))}
      </div>
      {error ? (
        <p id={`${name}-error`} className="text-xs font-semibold text-blocked-fg">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

export function ConsentPage() {
  const { t, i18n } = useTranslation('consent');
  const { sessionId = '' } = useParams();
  const { api, user } = useAuth();
  const toast = useToast();

  const { state, reload } = useRequest<Loaded>(async () => {
    const [session, consent, notice] = await Promise.all([
      api.get<Session>(`/sessions/${sessionId}`),
      api.get<ConsentState & { events: ConsentEvent[] }>(`/sessions/${sessionId}/consent`),
      api.get<NoticeBundle>('/consent/notice'),
    ]);
    // the patient's name is a convenience: the page still works if it cannot be read
    const patient = await api.get<Patient>(`/patients/${session.patientId}`).catch(() => null);
    return { session, patient, consent, notice };
  }, [api, sessionId]);

  const current = state.status === 'ready' ? state.data.consent : null;
  const [draft, setDraft] = useState<Record<ConsentScope, boolean>>({
    audio: false,
    ai_processing: false,
    whatsapp: false,
  });
  const [source, setSource] = useState<Source | ''>('');
  const [language, setLanguage] = useState<NoticeLanguage>(i18n.language === 'gu' ? 'gu' : 'en');
  const [sourceError, setSourceError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [announce, setAnnounce] = useState('');
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawSource, setWithdrawSource] = useState<Source | ''>('');
  const [withdrawError, setWithdrawError] = useState<string | undefined>();
  const summaryRef = useRef<HTMLDivElement>(null);
  const keepDraft = useRef(false);

  // the switches start from what is on record every time the record is (re)loaded
  useEffect(() => {
    if (keepDraft.current) {
      // a save just failed: refresh what is on record, but do not throw away what the person chose
      keepDraft.current = false;
      return;
    }
    if (current) {
      setDraft({
        audio: current.scopes.audio.granted,
        ai_processing: current.scopes.ai_processing.granted,
        whatsapp: current.scopes.whatsapp.granted,
      });
    }
  }, [current]);

  useEffect(() => {
    if (attempts > 0) summaryRef.current?.focus();
  }, [attempts]);

  const grants = useMemo(
    () => (current ? CONSENT_SCOPES.filter((s) => draft[s] && !current.scopes[s].granted) : []),
    [draft, current],
  );
  const withdrawals = useMemo(
    () => (current ? CONSENT_SCOPES.filter((s) => !draft[s] && current.scopes[s].granted) : []),
    [draft, current],
  );
  const changed = grants.length + withdrawals.length > 0;
  const anyGranted = current ? CONSENT_SCOPES.some((s) => current.scopes[s].granted) : false;

  const summary: FormError[] = [
    ...(sourceError ? [{ fieldId: 'consent-source-first', message: sourceError }] : []),
    ...(saveError ? [{ message: saveError }] : []),
  ];

  async function save() {
    if (!changed) return;
    if (source === '') {
      setSourceError(t('consent:save.sourceRequired'));
      setSaveError(null);
      setAttempts((a) => a + 1);
      return;
    }
    setSourceError(undefined);
    setSaveError(null);
    setSaving(true);
    try {
      if (grants.length > 0) {
        await api.post(`/sessions/${sessionId}/consent`, {
          scopes: grants,
          noticeVersion: state.status === 'ready' ? state.data.notice.version : '',
          noticeLanguage: language,
          source,
        });
      }
      if (withdrawals.length > 0) {
        await api.post(`/sessions/${sessionId}/consent/withdraw`, { scopes: withdrawals, source });
      }
      setAnnounce(t('consent:save.done'));
      toast.push({ kind: 'clear', title: t('consent:save.done') });
    } catch (err) {
      keepDraft.current = true;
      setSaveError(errorText(t, err));
      setAttempts((a) => a + 1);
    } finally {
      setSaving(false);
      reload();
    }
  }

  async function withdrawAll() {
    if (withdrawSource === '') {
      setWithdrawError(t('consent:save.sourceRequired'));
      return;
    }
    setSaving(true);
    try {
      await api.post(`/sessions/${sessionId}/consent/withdraw`, { source: withdrawSource });
      setWithdrawOpen(false);
      setWithdrawSource('');
      setAnnounce(t('consent:withdraw.done'));
      toast.push({
        kind: 'acknowledge',
        title: t('consent:withdraw.done'),
        message: t('consent:withdraw.stopRecording'),
      });
    } catch (err) {
      setWithdrawError(errorText(t, err));
    } finally {
      setSaving(false);
      reload();
    }
  }

  if (state.status === 'loading') {
    return (
      <div className="mx-auto max-w-5xl">
        <Skeleton lines={6} label={t('consent:loading')} />
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="mx-auto max-w-3xl">
        <h1 className="mb-4 font-display text-3xl font-semibold text-ink">{t('consent:title')}</h1>
        <Banner
          kind="blocked"
          live
          actions={<Button onClick={reload}>{t('common:action.retry')}</Button>}
        >
          {state.error.status === 404 ? t('consent:notFound') : errorText(t, state.error)}
        </Banner>
      </div>
    );
  }

  const { session, patient, consent, notice } = state.data;
  const ended = session.status === 'ended';
  const columns: Column<ConsentEvent>[] = [
    {
      key: 'when',
      header: t('consent:history.when'),
      render: (e) => formatDateTime(e.ts, i18n.language),
    },
    {
      key: 'scope',
      header: t('consent:history.scope'),
      render: (e) =>
        t(`clinical:consent.scope.${e.scope === 'ai_processing' ? 'aiProcessing' : e.scope}.label`),
    },
    {
      key: 'change',
      header: t('consent:history.change'),
      render: (e) => (e.granted ? t('consent:history.granted') : t('consent:history.withdrawn')),
    },
    {
      key: 'by',
      header: t('consent:history.by'),
      render: (e) => t(`shell:role.${e.recordedByRole}`, { defaultValue: e.recordedByRole }),
    },
    {
      key: 'source',
      header: t('consent:history.source'),
      render: (e) => t(`consent:source.${e.source}`),
    },
    {
      key: 'notice',
      header: t('consent:history.notice'),
      render: (e) => `${e.noticeVersion} / ${e.noticeLanguage}`,
    },
  ];
  const scopeKey = (s: ConsentScope) => (s === 'ai_processing' ? 'aiProcessing' : s);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8">
      <header className="flex flex-col gap-2">
        <Link
          to={user ? homeFor(user.role) : '/'}
          className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-ink underline"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          {t('consent:back')}
        </Link>
        <h1 className="font-display text-3xl font-semibold text-ink">{t('consent:title')}</h1>
        <p className="text-base text-body">
          {t('consent:forPatient', { name: patient?.name ?? t('consent:unnamed') })} ·{' '}
          {formatDateTime(session.startedAt, i18n.language)}
        </p>
      </header>

      {consent.recordingAllowed ? (
        <Banner kind="clear" live title={t('consent:status.onTitle')}>
          {t('consent:status.onBody')}
        </Banner>
      ) : (
        <Banner kind="blocked" live title={t('consent:status.offTitle')}>
          {t('consent:status.offBody')}
        </Banner>
      )}
      {ended ? (
        <Banner kind="acknowledge" title={t('consent:ended.title')}>
          {t('consent:ended.body')}
        </Banner>
      ) : null}

      <section aria-labelledby="notice-heading" className="flex flex-col gap-3">
        <h2 id="notice-heading" className="text-2xl font-semibold text-ink">
          {t('consent:notice.heading')}
        </h2>
        <p className="text-sm text-body">
          {t('consent:notice.version', { version: notice.version })}
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          {(['en', 'gu'] as const).map((lang) => {
            const n = notice.notices[lang];
            return (
              <section
                key={lang}
                lang={lang}
                aria-labelledby={`notice-${lang}`}
                className="flex flex-col gap-2 rounded-lg border border-line bg-card p-4"
              >
                <h3 id={`notice-${lang}`} className="text-lg font-semibold text-ink">
                  {n.title}
                </h3>
                {n.status === 'PLACEHOLDER' ? (
                  <p>
                    <StateBadge state="acknowledge" label={t('consent:notice.placeholder')} />
                  </p>
                ) : null}
                <p className="text-base text-body">{n.body}</p>
                <ul className="list-disc ps-5 text-sm text-body">
                  {CONSENT_SCOPES.map((scope) => (
                    <li key={scope}>
                      <span className="font-semibold text-ink">{n.scopes[scope].label}</span>:{' '}
                      {n.scopes[scope].description}
                    </li>
                  ))}
                </ul>
                {n.needsReview ? <NeedsReview /> : null}
              </section>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="switches-heading" className="flex flex-col gap-4">
        <h2 id="switches-heading" className="text-2xl font-semibold text-ink">
          {t('consent:switches.heading')}
        </h2>
        <p className="text-sm text-body">{t('consent:switches.intro')}</p>
        <ErrorSummary ref={summaryRef} title={t('consent:save.errorSummary')} errors={summary} />
        <div className="flex flex-col gap-3 rounded-lg border border-line bg-card p-4">
          {CONSENT_SCOPES.map((scope) => (
            <Switch
              key={scope}
              label={t(`clinical:consent.scope.${scopeKey(scope)}.label`)}
              description={t(`clinical:consent.scope.${scopeKey(scope)}.desc`)}
              checked={draft[scope]}
              onChange={(next) => {
                if (next && ended) return; // consent cannot be added to a finished session; it can still be withdrawn
                setDraft({ ...draft, [scope]: next });
              }}
              onText={t('common:state.on')}
              offText={t('common:state.off')}
            />
          ))}
        </div>

        <RadioGroup<Source>
          legend={t('consent:save.sourceLegend')}
          name="consent-source"
          value={source}
          onChange={(value) => {
            setSource(value);
            setSourceError(undefined);
          }}
          options={[
            { value: 'patient', label: t('consent:source.patient') },
            { value: 'staff', label: t('consent:source.staff') },
          ]}
          error={sourceError}
          hint={t('consent:save.sourceHint')}
        />
        <RadioGroup<NoticeLanguage>
          legend={t('consent:save.languageLegend')}
          name="consent-language"
          value={language}
          onChange={setLanguage}
          options={[
            { value: 'en', label: t('common:language.en') },
            { value: 'gu', label: t('common:language.gu') },
          ]}
        />

        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            icon={ShieldCheck}
            disabled={!changed}
            loading={saving}
            onClick={() => void save()}
          >
            {t('consent:save.button')}
          </Button>
          <Button
            icon={ShieldOff}
            disabled={!anyGranted}
            onClick={() => {
              setWithdrawError(undefined);
              setWithdrawOpen(true);
            }}
          >
            {t('consent:withdraw.button')}
          </Button>
          <p className="text-sm text-body">
            {changed ? t('consent:save.pending') : t('consent:save.nothing')}
          </p>
        </div>
        <p role="status" className="sr-only">
          {announce}
        </p>
      </section>

      <section aria-labelledby="history-heading" className="flex flex-col gap-3">
        <h2 id="history-heading" className="text-2xl font-semibold text-ink">
          {t('consent:history.heading')}
        </h2>
        <Table
          caption={t('consent:history.caption')}
          columns={columns}
          rows={consent.events}
          getRowId={(e) => String(e.seq)}
          emptyText={t('consent:history.empty')}
        />
      </section>

      <Modal
        open={withdrawOpen}
        onClose={() => setWithdrawOpen(false)}
        title={t('consent:withdraw.title')}
        description={t('consent:withdraw.description')}
        footer={
          <>
            <Button onClick={() => setWithdrawOpen(false)}>{t('common:action.cancel')}</Button>
            <Button variant="primary" loading={saving} onClick={() => void withdrawAll()}>
              {t('consent:withdraw.confirm')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Banner kind="acknowledge">{t('consent:withdraw.stopRecording')}</Banner>
          <RadioGroup<Source>
            legend={t('consent:withdraw.sourceLegend')}
            name="withdraw-source"
            value={withdrawSource}
            onChange={(value) => {
              setWithdrawSource(value);
              setWithdrawError(undefined);
            }}
            options={[
              { value: 'patient', label: t('consent:source.patient') },
              { value: 'staff', label: t('consent:source.staff') },
            ]}
            error={withdrawError}
          />
        </div>
      </Modal>
    </div>
  );
}
