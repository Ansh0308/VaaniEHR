// PG-09 Sign-off (doctor) - MINIMAL page for Phase 8 Run 1. It shows what the SERVER says blocks signing, the "Safety checks
// were not run" acknowledgement (the safety engine does not exist yet), and the password re-entry. The page never decides:
// the sign button is always offered once a password is typed, and the server answers with the named blockers. The real
// sign-off page (side-by-side diff, signed summary, amendments) is Phase 8 Run 2.
import { FileCheck2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import { errorText } from '../api/errorText';
import {
  BLOCKER_CODES,
  type Blocker,
  type SignReadiness,
  type VisitVersion,
} from '../api/prescription';
import { useRequest } from '../api/useRequest';
import { useAuth } from '../auth/AuthContext';
import { Banner } from '../components/ui/Banner';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Field';
import { Skeleton } from '../components/ui/Feedback';

const isBlocker = (b: unknown): b is Blocker =>
  typeof b === 'object' &&
  b !== null &&
  (BLOCKER_CODES as readonly string[]).includes((b as Blocker).code) &&
  typeof (b as Blocker).count === 'number';

export function SignPage() {
  const { t } = useTranslation(['consult', 'common']);
  const { sessionId = '' } = useParams();
  const { api } = useAuth();
  const readiness = useRequest(
    () => api.get<SignReadiness>(`/sessions/${sessionId}/sign-readiness`),
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
      setPassword('');
      readiness.reload();
    } catch (err) {
      if (err instanceof ApiError) {
        const list = (err.details?.['blockers'] as unknown[] | undefined) ?? [];
        setRefusal({ kind: err.code, blockers: list.filter(isBlocker) });
        if (err.code === 'SIGN_BLOCKED') readiness.reload();
      } else {
        setRefusal({ kind: 'UNKNOWN', blockers: [] });
      }
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  const back = `/consult/${sessionId}`;
  const data = readiness.state.status === 'ready' ? readiness.state.data : null;
  const shown = refusal?.kind === 'SIGN_BLOCKED' ? refusal.blockers : (data?.blockers ?? []);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
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
        <Banner kind="clear" live title={t('consult:sign.signedTitle')}>
          <p>{t('consult:sign.signedBody', { version: signed.version })}</p>
          <p className="break-all text-xs">
            {t('consult:sign.hash')}: {signed.contentHash}
          </p>
          {signed.safetyNotRunAcknowledged ? <p>{t('consult:sign.safetyFlag')}</p> : null}
        </Banner>
      ) : data?.signed ? (
        <Banner kind="clear">
          {t('consult:sign.alreadySigned', { version: data.currentVersion ?? 1 })}
        </Banner>
      ) : null}

      {data && !data.signed && !signed ? (
        <>
          {shown.length > 0 ? (
            <Banner
              kind="blocked"
              live={refusal?.kind === 'SIGN_BLOCKED'}
              title={t('consult:sign.blockedTitle')}
            >
              <ul className="list-disc ps-5">
                {shown.map((b) => (
                  <li key={b.code}>{t(`consult:sign.blocker.${b.code}`, { count: b.count })}</li>
                ))}
              </ul>
            </Banner>
          ) : (
            <Banner kind="clear">{t('consult:sign.noBlockers')}</Banner>
          )}

          {!data.safety.configured ? (
            <Banner kind="acknowledge" title={t('consult:sign.safetyTitle')}>
              {t('consult:sign.safetyBody')}
            </Banner>
          ) : null}

          <form
            className="flex flex-col gap-4 rounded-lg border border-line bg-card p-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (password) void sign();
            }}
          >
            {!data.safety.configured ? (
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
            <div className="flex flex-wrap gap-3">
              <Button
                type="submit"
                variant="primary"
                icon={FileCheck2}
                loading={busy}
                disabled={!password}
              >
                {t('consult:sign.button')}
              </Button>
            </div>
          </form>
        </>
      ) : null}

      <p>
        <Link
          to={back}
          className="inline-flex min-h-11 items-center text-base font-semibold text-ink underline"
        >
          {t('consult:sign.back')}
        </Link>
      </p>
    </div>
  );
}
