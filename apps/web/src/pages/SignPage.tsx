// PG-09 Sign-off (doctor): the checklist of what the SERVER says blocks signing (each with a link to fix it), the
// AI-vs-final diff, the "Safety checks were not run" acknowledgement, password re-entry and a clear result. The submit button
// stays disabled while a blocker, a safety-engine error or a missing acknowledgement exists, but the page never decides: the
// server re-checks everything and its answer (a named blocker list, a safety error) is shown if the page was out of date.
import { CircleCheck, FileCheck2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import { errorText } from '../api/errorText';
import {
  BLOCKER_CODES,
  type Blocker,
  type BlockerCode,
  type Preview,
  type SignReadiness,
  type VisitVersion,
} from '../api/prescription';
import { useDateText } from '../api/useDateText';
import { useRequest } from '../api/useRequest';
import { useAuth } from '../auth/AuthContext';
import { SignDiff } from '../components/clinical/SignDiff';
import { Banner } from '../components/ui/Banner';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Field';
import { Skeleton } from '../components/ui/Feedback';

const isBlocker = (b: unknown): b is Blocker =>
  typeof b === 'object' &&
  b !== null &&
  (BLOCKER_CODES as readonly string[]).includes((b as Blocker).code) &&
  typeof (b as Blocker).count === 'number';

/** Where each blocker is fixed: the workspace section, the consent screen or the signed record. */
export function fixLink(
  code: BlockerCode,
  sessionId: string,
): { pathname: string; search?: string; hash?: string } {
  const workspace = `/consult/${sessionId}`;
  switch (code) {
    case 'unconfirmed_facts':
      return { pathname: workspace, hash: '#facts-region' };
    case 'red_flag_unacknowledged':
      return { pathname: workspace, hash: '#red-flag-region' };
    case 'no_working_condition':
      return { pathname: workspace, hash: '#candidates-region' };
    case 'incomplete_medicine':
      return { pathname: workspace, search: '?tab=prescription' };
    case 'consent_missing':
      return { pathname: `${workspace}/consent` };
    case 'session_not_draft':
      return { pathname: `${workspace}/record` };
  }
}

export function SignPage() {
  const { t } = useTranslation(['consult', 'common']);
  const { sessionId = '' } = useParams();
  const { api } = useAuth();
  const readiness = useRequest(
    () => api.get<SignReadiness>(`/sessions/${sessionId}/sign-readiness`),
    [api, sessionId],
  );
  const preview = useRequest(
    () => api.get<Preview>(`/sessions/${sessionId}/sign-preview`),
    [api, sessionId],
  );
  const [password, setPassword] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<{ kind: string; blockers: Blocker[] } | null>(null);
  const [signed, setSigned] = useState<VisitVersion | null>(null);

  async function sign() {
    setBusy(true);
    setRefusal(null);
    try {
      const result = await api.post<VisitVersion>(`/sessions/${sessionId}/sign`, {
        password,
        safetyNotRunAcknowledged: acknowledged,
      });
      setSigned(result);
      readiness.reload();
    } catch (err) {
      if (err instanceof ApiError) {
        const list = (err.details?.['blockers'] as unknown[] | undefined) ?? [];
        setRefusal({ kind: err.code, blockers: list.filter(isBlocker) });
        readiness.reload();
        preview.reload();
      } else {
        setRefusal({ kind: 'UNKNOWN', blockers: [] });
      }
    } finally {
      setPassword('');
      setBusy(false);
    }
  }

  const data = readiness.state.status === 'ready' ? readiness.state.data : null;
  const blockers = refusal?.kind === 'SIGN_BLOCKED' ? refusal.blockers : (data?.blockers ?? []);
  const safetyError = data?.safety.error === true || refusal?.kind === 'SAFETY_ERROR';
  const needsAck = data !== null && !data.safety.configured;
  const canSubmit =
    !!password && blockers.length === 0 && !safetyError && (!needsAck || acknowledged) && !busy;
  const dateOf = useDateText();

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <header>
        <h1 className="font-display text-3xl font-semibold text-ink">{t('consult:sign.title')}</h1>
        <p className="mt-1 text-base text-body">{t('consult:sign.intro')}</p>
      </header>

      {readiness.state.status === 'loading' ? (
        <Skeleton lines={3} label={t('consult:sign.loading')} />
      ) : readiness.state.status === 'error' ? (
        <Banner
          kind="blocked"
          live
          actions={<Button onClick={readiness.reload}>{t('common:action.retry')}</Button>}
        >
          {errorText(t, readiness.state.error)}
        </Banner>
      ) : null}

      {signed ? (
        <section
          aria-label={t('consult:sign.resultRegion')}
          className="flex flex-col gap-3 rounded-lg border border-clear-accent bg-clear-bg p-4 text-clear-fg"
        >
          <h2 className="flex items-center gap-2 font-display text-xl font-semibold">
            <CircleCheck aria-hidden="true" className="size-6" />
            {t('consult:sign.signedTitle')}
          </h2>
          <p role="status">{t('consult:sign.signedBody', { version: signed.version })}</p>
          <p className="text-sm">{dateOf(signed.signedAt)}</p>
          <p className="break-all text-xs">
            {t('consult:sign.hash')}: {signed.contentHash}
          </p>
          {signed.safetyNotRunAcknowledged ? (
            <p className="font-semibold">{t('consult:sign.safetyFlag')}</p>
          ) : null}
          <p>
            <Link
              to={`/consult/${sessionId}/record`}
              className="inline-flex min-h-11 items-center text-base font-semibold underline"
            >
              {t('consult:sign.openRecord')}
            </Link>
          </p>
        </section>
      ) : data?.signed ? (
        <Banner
          kind="clear"
          title={t('consult:sign.alreadySigned', { version: data.currentVersion ?? 1 })}
        >
          <Link
            to={`/consult/${sessionId}/record`}
            className="inline-flex min-h-11 items-center text-base font-semibold underline"
          >
            {t('consult:sign.openRecord')}
          </Link>
        </Banner>
      ) : null}

      {data && !data.signed && !signed ? (
        <>
          <section
            aria-label={t('consult:sign.checklist')}
            className="flex flex-col gap-3 rounded-lg border border-line bg-card p-4"
          >
            <h2 className="font-display text-xl font-semibold text-ink">
              {t('consult:sign.checklist')}
            </h2>
            {blockers.length > 0 ? (
              <Banner
                kind="blocked"
                live={refusal?.kind === 'SIGN_BLOCKED'}
                title={t('consult:sign.blockedTitle')}
              >
                <ul className="flex flex-col gap-1">
                  {blockers.map((b) => (
                    <li key={b.code} className="flex flex-wrap items-center gap-x-3">
                      <span>{t(`consult:sign.blocker.${b.code}`, { count: b.count })}</span>
                      <Link
                        to={fixLink(b.code, sessionId)}
                        className="inline-flex min-h-11 items-center font-semibold underline"
                      >
                        {t('consult:sign.fix')}
                      </Link>
                    </li>
                  ))}
                </ul>
              </Banner>
            ) : (
              <Banner kind="clear">{t('consult:sign.noBlockers')}</Banner>
            )}
            {safetyError ? (
              <Banner kind="blocked" live title={t('consult:sign.safetyErrorTitle')}>
                {t('consult:sign.safetyErrorBody')}
              </Banner>
            ) : !data.safety.configured ? (
              <Banner kind="acknowledge" title={t('consult:sign.safetyTitle')}>
                {t('consult:sign.safetyBody')}
              </Banner>
            ) : null}
          </section>

          {preview.state.status === 'ready' ? (
            <SignDiff preview={preview.state.data} />
          ) : preview.state.status === 'error' ? (
            <Banner
              kind="blocked"
              actions={<Button onClick={preview.reload}>{t('common:action.retry')}</Button>}
            >
              {errorText(t, preview.state.error)}
            </Banner>
          ) : (
            <Skeleton lines={4} label={t('consult:sign.loading')} />
          )}

          <form
            aria-label={t('consult:sign.formLabel')}
            className="flex flex-col gap-4 rounded-lg border border-line bg-card p-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (canSubmit) void sign();
            }}
          >
            {needsAck ? (
              <label className="inline-flex min-h-11 items-center gap-2 text-base text-ink">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                  className="size-5 accent-[var(--color-action)]"
                />
                {t('consult:sign.safetyAck')}
              </label>
            ) : null}
            <Input
              type="password"
              autoComplete="current-password"
              label={t('consult:sign.password')}
              hint={t('consult:sign.passwordHint')}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            {refusal && refusal.kind !== 'SIGN_BLOCKED' ? (
              <Banner kind="blocked" live>
                {t(`consult:sign.error.${refusal.kind}`, {
                  defaultValue: t('consult:sign.error.UNKNOWN'),
                })}
              </Banner>
            ) : null}
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="submit"
                variant="primary"
                icon={FileCheck2}
                loading={busy}
                disabled={!canSubmit}
                aria-describedby="sign-why-disabled"
              >
                {t('consult:sign.button')}
              </Button>
              <p id="sign-why-disabled" className="text-xs text-body">
                {blockers.length > 0
                  ? t('consult:sign.whyBlocked')
                  : safetyError
                    ? t('consult:sign.whySafety')
                    : needsAck && !acknowledged
                      ? t('consult:sign.whyAck')
                      : !password
                        ? t('consult:sign.whyPassword')
                        : ''}
              </p>
            </div>
          </form>
        </>
      ) : null}

      <p>
        <Link
          to={`/consult/${sessionId}`}
          className="inline-flex min-h-11 items-center text-base font-semibold text-ink underline"
        >
          {t('consult:sign.back')}
        </Link>
      </p>
    </div>
  );
}
