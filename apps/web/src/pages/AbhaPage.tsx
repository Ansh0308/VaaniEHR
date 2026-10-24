// PG-04 ABHA verification (Phase 9B, ADR-D42, FR-F9-01..03). A staged flow: enter a TEST ABHA number or address, enter the OTP, see
// the result. It runs against the MOCK (default) or the ABDM SANDBOX, never against real people, and says so permanently at the top
// of the page. The staff member confirms the patient agreed before anything is requested. The number and the OTP live only in this
// page's state while they are typed; the server keeps a salted hash and the ABHA address, never the number or the OTP. Errors are
// written in plain words from our own text (never the provider's).
import { CircleCheck, KeyRound, ShieldAlert } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import type { AbhaStarted, AbhaStatus } from '../api/abha';
import { ApiError } from '../api/client';
import { errorText } from '../api/errorText';
import { useDateText } from '../api/useDateText';
import { useRequest } from '../api/useRequest';
import { useAuth } from '../auth/AuthContext';
import { ModeBadge } from '../components/clinical/AbhaBadge';
import { Banner } from '../components/ui/Banner';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Field';
import { Skeleton } from '../components/ui/Feedback';
import { Stepper } from '../components/ui/Stepper';

const linkClass = 'inline-flex min-h-11 items-center text-base font-semibold text-ink underline';
type Stage = 'enter' | 'otp' | 'result';

const ERROR_KEYS: Record<string, string> = {
  ABHA_IDENTITY_REJECTED: 'rejected',
  ABHA_OTP_WRONG: 'wrong',
  ABHA_OTP_EXPIRED: 'expired',
  ABHA_RATE_LIMITED: 'limited',
  ABHA_UNAVAILABLE: 'down',
  ABHA_NOT_FOUND: 'unknown',
  ABHA_FAILED: 'failed',
};

export function AbhaPage() {
  const { t } = useTranslation(['patients', 'common']);
  const { patientId = '' } = useParams();
  const { api } = useAuth();
  const dateText = useDateText();
  const status = useRequest(
    () => api.get<AbhaStatus>(`/abha/status/${patientId}`),
    [api, patientId],
  );
  const [stage, setStage] = useState<Stage>('enter');
  const [attested, setAttested] = useState(false);
  const [identity, setIdentity] = useState('');
  const [otp, setOtp] = useState('');
  const [txnId, setTxnId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ key: string; left: number } | null>(null);
  const [result, setResult] = useState<AbhaStatus | null>(null);
  const identityRef = useRef<HTMLInputElement>(null);
  const data = status.state.status === 'ready' ? status.state.data : null;
  const mode = data?.mode ?? null;

  function fail(err: unknown) {
    if (err instanceof ApiError) {
      const raw = err.details?.['attemptsLeft'];
      const left = typeof raw === 'number' ? raw : 0;
      const key = ERROR_KEYS[err.code];
      if (key) return setProblem({ key, left });
      if (err.status === 409) return setProblem({ key: 'finished', left });
    }
    setProblem({ key: 'other', left: 0 });
  }

  async function sendOtp(event: FormEvent) {
    event.preventDefault();
    if (!attested || identity.trim().length < 3) return;
    setBusy(true);
    setProblem(null);
    try {
      const started = await api.post<AbhaStarted>('/abha/verify/start', {
        patientId,
        identity: identity.trim(),
        attested: true,
      });
      setTxnId(started.txnId);
      setIdentity(''); // the number is not kept in the page once the OTP is on its way
      setStage('otp');
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function checkOtp(event: FormEvent) {
    event.preventDefault();
    if (!txnId || !/^\d{6}$/.test(otp)) return;
    setBusy(true);
    setProblem(null);
    try {
      const done = await api.post<AbhaStatus>('/abha/verify/otp', { txnId, otp });
      setResult(done);
      setOtp('');
      setStage('result');
      status.reload();
    } catch (err) {
      setOtp('');
      fail(err);
      // a finished, expired or locked check cannot be retried: go back to the first step
      const last =
        err instanceof ApiError &&
        (err.code === 'ABHA_OTP_EXPIRED' ||
          err.code === 'ABHA_RATE_LIMITED' ||
          err.status === 409 ||
          (err.code === 'ABHA_OTP_WRONG' && err.details?.['attemptsLeft'] === 0));
      if (last) {
        setTxnId(null);
        setStage('enter');
      }
    } finally {
      setBusy(false);
    }
  }

  function again() {
    setStage('enter');
    setTxnId(null);
    setOtp('');
    setIdentity('');
    setAttested(false);
    setProblem(null);
    setResult(null);
    setTimeout(() => identityRef.current?.focus(), 0);
  }

  const steps = [
    { id: 'enter', label: t('patients:abha.steps.enter') },
    { id: 'otp', label: t('patients:abha.steps.otp') },
    { id: 'result', label: t('patients:abha.steps.result') },
  ];
  const shown = result ?? data;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <header>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-3xl font-semibold text-ink">
            {t('patients:abha.title')}
          </h1>
          {mode ? <ModeBadge mode={mode} /> : null}
        </div>
        <p className="mt-1 text-base text-body">{t('patients:abha.intro')}</p>
      </header>

      {status.state.status === 'loading' ? (
        <Skeleton lines={3} label={t('patients:abha.loading')} />
      ) : status.state.status === 'error' ? (
        <Banner
          kind="blocked"
          live
          actions={<Button onClick={status.reload}>{t('common:action.retry')}</Button>}
        >
          {errorText(t, status.state.error)}
        </Banner>
      ) : null}

      {mode ? (
        <Banner kind="acknowledge" title={t(`patients:abha.mode.${mode}`)}>
          {t(`patients:abha.notice.${mode}`)}
        </Banner>
      ) : null}

      {data ? (
        <>
          {data.verified && stage !== 'result' ? (
            <Banner
              kind="clear"
              title={t('patients:abha.alreadyTitle', {
                mode: t(`patients:abha.mode.${data.verifiedMode ?? data.mode}`),
              })}
            >
              {t('patients:abha.alreadyBody', {
                address: data.abhaAddress ?? t('patients:card.unknown'),
                when: data.verifiedAt ? dateText(data.verifiedAt) : '',
              })}
            </Banner>
          ) : null}

          <Stepper steps={steps} currentId={stage} label={t('patients:abha.stepsLabel')} />

          {problem ? (
            <Banner kind="blocked" live title={t(`patients:abha.error.${problem.key}.title`)}>
              {t(`patients:abha.error.${problem.key}.body`, { count: problem.left })}
            </Banner>
          ) : null}

          {stage === 'enter' ? (
            <form
              onSubmit={(e) => void sendOtp(e)}
              noValidate
              className="flex flex-col gap-4 rounded-lg border border-line bg-card p-4"
            >
              <h2 className="font-display text-xl font-semibold text-ink">
                {t('patients:abha.enter.title')}
              </h2>
              <label className="flex min-h-11 items-start gap-3 text-base text-ink">
                <input
                  type="checkbox"
                  className="mt-1 size-6 shrink-0"
                  checked={attested}
                  onChange={(e) => setAttested(e.target.checked)}
                />
                <span>{t('patients:abha.enter.attest')}</span>
              </label>
              <Input
                ref={identityRef}
                label={t('patients:abha.enter.label')}
                hint={t(`patients:abha.enter.hint.${mode ?? 'mock'}`)}
                autoComplete="off"
                value={identity}
                onChange={(e) => setIdentity(e.target.value)}
              />
              {data.mockIdentities ? (
                <details className="rounded-md border border-line p-3 text-sm text-body">
                  <summary className="min-h-11 cursor-pointer py-2 text-base font-semibold text-ink">
                    {t('patients:abha.enter.mockList')}
                  </summary>
                  <ul className="mt-2 flex flex-col gap-2">
                    {data.mockIdentities.map((m) => (
                      <li key={m.number}>
                        <button
                          type="button"
                          className="min-h-11 text-left underline"
                          onClick={() => setIdentity(m.address)}
                        >
                          {m.address}
                        </button>{' '}
                        <span>
                          ({m.number}) {t('patients:abha.enter.gives', { outcome: m.outcome })}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {data.mockOtp ? (
                    <p className="mt-2">
                      {t('patients:abha.enter.mockOtp', { otp: data.mockOtp })}
                    </p>
                  ) : null}
                </details>
              ) : null}
              <div>
                <Button
                  type="submit"
                  variant="primary"
                  icon={KeyRound}
                  loading={busy}
                  disabled={!attested || identity.trim().length < 3}
                >
                  {t('patients:abha.enter.send')}
                </Button>
              </div>
            </form>
          ) : null}

          {stage === 'otp' ? (
            <form
              onSubmit={(e) => void checkOtp(e)}
              noValidate
              className="flex flex-col gap-4 rounded-lg border border-line bg-card p-4"
            >
              <h2 className="font-display text-xl font-semibold text-ink">
                {t('patients:abha.otp.title')}
              </h2>
              <Input
                label={t('patients:abha.otp.label')}
                hint={t(`patients:abha.otp.hint.${mode ?? 'mock'}`)}
                autoComplete="one-time-code"
                inputMode="numeric"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
              />
              <div className="flex flex-wrap gap-3">
                <Button
                  type="submit"
                  variant="primary"
                  loading={busy}
                  disabled={!/^\d{6}$/.test(otp)}
                >
                  {t('patients:abha.otp.check')}
                </Button>
                <Button type="button" onClick={again}>
                  {t('patients:abha.otp.startOver')}
                </Button>
              </div>
            </form>
          ) : null}

          {stage === 'result' && shown ? (
            <section
              aria-labelledby="abha-result"
              className="flex flex-col gap-3 rounded-lg border border-line bg-card p-4"
            >
              <h2
                id="abha-result"
                className="flex items-center gap-2 font-display text-xl font-semibold text-ink"
              >
                <CircleCheck aria-hidden="true" className="size-6" />
                {t('patients:abha.result.title', {
                  mode: t(`patients:abha.mode.${shown.verifiedMode ?? shown.mode}`),
                })}
              </h2>
              <p className="text-base text-ink">
                {t('patients:abha.result.address', {
                  address: shown.abhaAddress ?? t('patients:card.unknown'),
                })}
              </p>
              <p className="flex items-start gap-2 text-sm text-body">
                <ShieldAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
                {t('patients:abha.result.stored')}
              </p>
              <div className="flex flex-wrap gap-3">
                <Button type="button" onClick={again}>
                  {t('patients:abha.result.again')}
                </Button>
                <Link to="/patients" className={linkClass}>
                  {t('patients:abha.back')}
                </Link>
              </div>
            </section>
          ) : null}
        </>
      ) : null}

      {stage !== 'result' ? (
        <Link to="/patients" className={linkClass}>
          {t('patients:abha.back')}
        </Link>
      ) : null}
    </div>
  );
}
