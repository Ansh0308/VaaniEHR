// PG-11 WhatsApp summary approval (doctor; Phase 10 Run 1, ADR-D41). The Gujarati summary is built on the server from the SIGNED
// record only. The doctor types the warning signs and the follow-up in their own words (the only editable fields); everything
// else is copied from the signed visit and cannot be changed here. The Gujarati preview sits beside an approximate English
// back-translation. Approving stores the exact text with a hash; sending needs the approval, WhatsApp consent and a signed
// visit, all re-checked by the server. The preview is labelled "needs Gujarati review": its fixed phrases are unreviewed.
import { CircleCheck, Send } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import type { WhatsAppState, WhatsAppSummary } from '../api/whatsapp';
import { useDateText } from '../api/useDateText';
import { useRequest } from '../api/useRequest';
import { useAuth } from '../auth/AuthContext';
import { WhatsAppLog } from '../components/clinical/WhatsAppLog';
import { Badge } from '../components/ui/Badge';
import { Banner } from '../components/ui/Banner';
import { Button } from '../components/ui/Button';
import { TextArea } from '../components/ui/Field';
import { Skeleton } from '../components/ui/Feedback';
import { errorText } from '../api/errorText';

const linkClass = 'inline-flex min-h-11 items-center text-base font-semibold text-ink underline';
const LIMIT = 600;

export function WhatsAppSummaryPage() {
  const { t } = useTranslation(['consult', 'common']);
  const { sessionId = '' } = useParams();
  const { api } = useAuth();
  const dateText = useDateText();
  const state = useRequest(
    () => api.get<WhatsAppState>(`/sessions/${sessionId}/whatsapp`),
    [api, sessionId],
  );
  const [warning, setWarning] = useState('');
  const [followUp, setFollowUp] = useState('');
  const [busy, setBusy] = useState<null | 'preview' | 'approve' | 'send'>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const data = state.state.status === 'ready' ? state.state.data : null;
  const summary: WhatsAppSummary | null = data?.summary ?? null;

  // the fields start from what is stored for the current version
  useEffect(() => {
    if (summary) {
      setWarning(summary.warningSigns);
      setFollowUp(summary.followUp);
    }
  }, [summary?.id]);

  const signed = data?.signedVersion != null;
  const consent = data?.whatsappConsent === true;
  const approved = summary?.status === 'approved';
  const dirty =
    !!summary && !approved && (warning !== summary.warningSigns || followUp !== summary.followUp);
  const sentOk = (data?.messages ?? []).some(
    (m) => m.summaryVersion === summary?.version && m.status !== 'failed',
  );
  const canWork = signed && consent && !!data;

  async function run<T>(
    kind: 'preview' | 'approve' | 'send',
    fn: () => Promise<T>,
  ): Promise<boolean> {
    setBusy(kind);
    setFailure(null);
    try {
      await fn();
      state.reload();
      return true;
    } catch (err) {
      setFailure(
        err instanceof ApiError
          ? err.code === 'CONSENT_REQUIRED'
            ? 'consent'
            : err.status === 400
              ? 'invalid'
              : 'conflict'
          : 'other',
      );
      state.reload();
      return false;
    } finally {
      setBusy(null);
    }
  }
  const preview = () =>
    run('preview', () =>
      api.post(`/sessions/${sessionId}/whatsapp/summary`, { warningSigns: warning, followUp }),
    );
  const approve = () =>
    run('approve', () => api.post(`/sessions/${sessionId}/whatsapp/approve`, {}));
  const send = () => run('send', () => api.post(`/sessions/${sessionId}/whatsapp/send`, {}));
  const approveAndSend = async () => {
    if (await approve()) await send();
  };

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <header>
        <h1 className="font-display text-3xl font-semibold text-ink">{t('consult:wa.title')}</h1>
        <p className="mt-1 text-base text-body">{t('consult:wa.intro')}</p>
      </header>

      {state.state.status === 'loading' ? (
        <Skeleton lines={3} label={t('consult:wa.loading')} />
      ) : state.state.status === 'error' ? (
        <Banner
          kind="blocked"
          live
          actions={<Button onClick={state.reload}>{t('common:action.retry')}</Button>}
        >
          {errorText(t, state.state.error)}
        </Banner>
      ) : null}

      {data ? (
        <>
          {data.provider === 'mock' ? (
            <Banner kind="neutral" title={t('consult:wa.mockTitle')}>
              {t('consult:wa.mockBody')}
            </Banner>
          ) : (
            <Banner kind="acknowledge" title={t('consult:wa.realTitle')}>
              {t('consult:wa.realBody')}
            </Banner>
          )}
          {!signed ? (
            <Banner kind="acknowledge" title={t('consult:wa.notSigned')}>
              <Link to={`/consult/${sessionId}/sign`} className={linkClass}>
                {t('consult:record.goSign')}
              </Link>
            </Banner>
          ) : null}
          {signed && !consent ? (
            <Banner kind="blocked" live title={t('consult:wa.noConsent')}>
              <p>{t('consult:wa.noConsentBody')}</p>
              <Link to={`/consult/${sessionId}/consent`} className={linkClass}>
                {t('consult:wa.openConsent')}
              </Link>
            </Banner>
          ) : null}
          {signed && data.safetyNotRun ? (
            <Banner kind="acknowledge" title={t('consult:record.safetyNotRunTitle')}>
              {t('consult:wa.safetyNotRun')}
            </Banner>
          ) : null}
          {summary?.stale ? (
            <Banner kind="blocked" live title={t('consult:wa.staleTitle')}>
              {t('consult:wa.staleBody')}
            </Banner>
          ) : null}

          <section
            aria-label={t('consult:wa.fieldsRegion')}
            className="flex flex-col gap-4 rounded-lg border border-line bg-card p-4"
          >
            <h2 className="font-display text-xl font-semibold text-ink">
              {t('consult:wa.fieldsTitle')}
            </h2>
            <p className="text-sm text-body">{t('consult:wa.fieldsIntro')}</p>
            <TextArea
              label={t('consult:wa.warning')}
              hint={t('consult:wa.warningHint')}
              value={warning}
              maxLength={LIMIT}
              disabled={approved || !canWork}
              onChange={(e) => setWarning(e.target.value)}
            />
            <TextArea
              label={t('consult:wa.followUp')}
              hint={t('consult:wa.followUpHint')}
              value={followUp}
              maxLength={LIMIT}
              disabled={approved || !canWork}
              onChange={(e) => setFollowUp(e.target.value)}
            />
            {!approved ? (
              <div>
                <Button
                  variant="primary"
                  loading={busy === 'preview'}
                  disabled={!canWork || busy !== null}
                  onClick={() => void preview()}
                >
                  {t('consult:wa.preview')}
                </Button>
              </div>
            ) : null}
          </section>

          {failure ? (
            <Banner kind="blocked" live>
              {t(`consult:wa.error.${failure}`)}
            </Banner>
          ) : null}

          {summary ? (
            <section
              aria-label={t('consult:wa.previewRegion')}
              className="flex flex-col gap-4 rounded-lg border border-line bg-card p-4"
            >
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="font-display text-xl font-semibold text-ink">
                  {t('consult:wa.previewTitle')}
                </h2>
                <Badge>
                  {approved ? t('consult:wa.statusApproved') : t('consult:wa.statusNeedsReview')}
                </Badge>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="flex flex-col gap-2 rounded-md border border-control bg-card p-3">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                    {t('consult:wa.gujarati')}
                    <Badge>{t('consult:wa.needsReview')}</Badge>
                  </p>
                  <p
                    lang="gu"
                    className="whitespace-pre-wrap text-base text-ink"
                    data-testid="wa-gu"
                  >
                    {summary.textGu}
                  </p>
                </div>
                <div className="flex flex-col gap-2 rounded-md border border-line bg-sunken p-3">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                    {t('consult:wa.english')}
                    <Badge>{t('consult:wa.approximate')}</Badge>
                  </p>
                  <p
                    lang="en"
                    className="whitespace-pre-wrap text-base text-ink"
                    data-testid="wa-en"
                  >
                    {summary.textEn}
                  </p>
                  <p className="text-xs text-body">{t('consult:wa.approximateNote')}</p>
                </div>
              </div>
              <p className="text-xs text-body">
                {t('consult:wa.phraseNote', { version: summary.phraseTableVersion })}
              </p>
              {approved && summary.textHash ? (
                <p className="break-all text-xs text-body">
                  {t('consult:wa.approvedAt', {
                    time: summary.approvedAt ? dateText(summary.approvedAt) : '',
                  })}{' '}
                  · {t('consult:sign.hash')}: {summary.textHash}
                </p>
              ) : null}
              {dirty ? <Banner kind="acknowledge">{t('consult:wa.dirty')}</Banner> : null}
              <div className="flex flex-wrap items-center gap-3">
                {!approved ? (
                  <>
                    <Button
                      variant="primary"
                      icon={CircleCheck}
                      loading={busy === 'approve'}
                      disabled={!canWork || summary.stale || dirty || busy !== null}
                      onClick={() => void approve()}
                    >
                      {t('consult:wa.approve')}
                    </Button>
                    <Button
                      icon={Send}
                      disabled={!canWork || summary.stale || dirty || busy !== null}
                      onClick={() => void approveAndSend()}
                    >
                      {t('consult:wa.approveSend')}
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="primary"
                    icon={Send}
                    loading={busy === 'send'}
                    disabled={!canWork || summary.stale || sentOk || busy !== null}
                    onClick={() => void send()}
                  >
                    {sentOk ? t('consult:wa.sent') : t('consult:wa.send')}
                  </Button>
                )}
              </div>
            </section>
          ) : null}

          <WhatsAppLog messages={data.messages} />
        </>
      ) : null}

      <p>
        <Link to={`/consult/${sessionId}/record`} className={linkClass}>
          {t('consult:wa.backToRecord')}
        </Link>
      </p>
    </div>
  );
}
