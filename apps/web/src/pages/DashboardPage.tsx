// PG-02 Doctor dashboard. Shows ONLY what the system really has:
//  - the doctor's own sessions (drafts = sessions that are not ended; sign-off arrives in a later phase);
//  - a way to start a session for a patient (phone lookup, then "Start session", then the consent page);
//  - the queue / tokens come from ClinicOS, so the area is a clearly labelled placeholder. No fake queue, no numbers.
import { ClipboardCheck, Hourglass, Link2, Play } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { errorText } from '../api/errorText';
import { formatDateTime } from '../api/format';
import type { SessionListItem } from '../api/types';
import { useRequest } from '../api/useRequest';
import { usePatientLookup } from '../api/usePatientLookup';
import { useAuth } from '../auth/AuthContext';
import { AllergyList } from '../components/clinical/AllergyList';
import { PhoneSearch } from '../components/clinical/PhoneSearch';
import { Banner } from '../components/ui/Banner';
import { StateBadge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { EmptyState, Skeleton } from '../components/ui/Feedback';
import { Table, type Column } from '../components/ui/Table';
import { useToast } from '../components/ui/Toast';

const linkClass =
  'inline-flex min-h-11 items-center rounded-md border border-control bg-card px-3 py-2 text-sm font-semibold text-ink hover:bg-sunken';

interface SessionPage {
  items: SessionListItem[];
  nextBefore: string | null;
}

export function DashboardPage() {
  const { t, i18n } = useTranslation('dashboard');
  const { api, user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const lookup = usePatientLookup(api);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [extra, setExtra] = useState<SessionListItem[]>([]);
  const [next, setNext] = useState<string | null | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);

  const { state, reload } = useRequest(async () => {
    setExtra([]);
    setNext(undefined);
    return api.get<SessionPage>('/sessions', { limit: 20 });
  }, [api]);

  const cursor = next === undefined && state.status === 'ready' ? state.data.nextBefore : next;
  const sessions: SessionListItem[] =
    state.status === 'ready' ? [...state.data.items, ...extra] : [];
  const open = sessions.filter((s) => s.status !== 'ended').length;

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await api.get<SessionPage>('/sessions', { limit: 20, before: cursor });
      setExtra((e) => [...e, ...page.items]);
      setNext(page.nextBefore);
    } catch (err) {
      toast.push({ kind: 'blocked', title: errorText(t, err) });
    } finally {
      setLoadingMore(false);
    }
  }

  async function startSession() {
    if (!lookup.patient) return;
    setStarting(true);
    setStartError(null);
    try {
      const session = await api.post<{ id: string }>('/sessions', { patientId: lookup.patient.id });
      navigate(`/consult/${session.id}/consent`);
    } catch (err) {
      setStartError(errorText(t, err));
    } finally {
      setStarting(false);
    }
  }

  async function copyLink(id: string) {
    const url = `${window.location.origin}/consult/${id}/consent`;
    try {
      await navigator.clipboard.writeText(url);
      toast.push({ kind: 'clear', title: t('dashboard:sessions.copied') });
    } catch {
      toast.push({ kind: 'acknowledge', title: t('dashboard:sessions.copyFailed'), message: url });
    }
  }

  const columns: Column<SessionListItem>[] = [
    {
      key: 'patient',
      header: t('dashboard:sessions.patient'),
      render: (s) => s.patientName ?? t('dashboard:sessions.noName'),
    },
    {
      key: 'started',
      header: t('dashboard:sessions.started'),
      render: (s) => formatDateTime(s.startedAt, i18n.language),
    },
    {
      key: 'status',
      header: t('dashboard:sessions.status'),
      render: (s) => t(`dashboard:sessions.statusValue.${s.status}`),
    },
    {
      key: 'consent',
      header: t('dashboard:sessions.consent'),
      render: (s) =>
        s.consent.recordingAllowed ? (
          <StateBadge state="clear" label={t('dashboard:sessions.consentOn')} />
        ) : (
          <StateBadge state="acknowledge" label={t('dashboard:sessions.consentNeeded')} />
        ),
    },
    {
      key: 'actions',
      header: t('dashboard:sessions.actions'),
      render: (s) => (
        <div className="flex flex-wrap gap-2">
          <Link to={`/consult/${s.id}/consent`} className={linkClass}>
            <span>
              {t('dashboard:sessions.openConsent')}
              <span className="sr-only">
                {' '}
                {t('dashboard:sessions.forPatient', {
                  name: s.patientName ?? t('dashboard:sessions.noName'),
                })}
              </span>
            </span>
          </Link>
          <Button
            icon={Link2}
            onClick={() => void copyLink(s.id)}
            aria-label={t('dashboard:sessions.copyLinkFor', {
              name: s.patientName ?? t('dashboard:sessions.noName'),
            })}
          >
            {t('dashboard:sessions.copyLink')}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8">
      <header>
        <h1 className="font-display text-3xl font-semibold text-ink">{t('dashboard:title')}</h1>
        <p className="mt-1 text-base text-body">
          {t('dashboard:welcome', { name: user?.name ?? '' })}
        </p>
      </header>

      <section aria-labelledby="start-heading" className="flex flex-col gap-3">
        <h2 id="start-heading" className="text-2xl font-semibold text-ink">
          {t('dashboard:start.heading')}
        </h2>
        <p className="text-sm text-body">{t('dashboard:start.intro')}</p>
        <PhoneSearch
          phone={lookup.phone}
          onPhone={lookup.setPhone}
          status={lookup.status}
          error={lookup.error}
          onSubmit={() => void lookup.submit()}
        />
        {lookup.status === 'notFound' ? (
          <Banner kind="acknowledge" live title={t('dashboard:start.notFoundTitle')}>
            {t('dashboard:start.notFoundBody')}
          </Banner>
        ) : null}
        {lookup.patient ? (
          <div className="flex flex-col gap-3 rounded-lg border border-line bg-card p-4 shadow-card">
            <p className="text-lg font-semibold text-ink">
              {lookup.patient.name ?? t('dashboard:sessions.noName')}
            </p>
            <AllergyList allergies={lookup.patient.allergies} />
            {startError ? (
              <Banner kind="blocked" live>
                {startError}
              </Banner>
            ) : null}
            <div>
              <Button
                variant="primary"
                icon={Play}
                loading={starting}
                onClick={() => void startSession()}
              >
                {t('dashboard:start.button')}
              </Button>
            </div>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="queue-heading" className="flex flex-col gap-3">
        <h2 id="queue-heading" className="text-2xl font-semibold text-ink">
          {t('dashboard:queue.heading')}
        </h2>
        <Banner kind="neutral" title={t('dashboard:queue.unavailableTitle')}>
          {t('dashboard:queue.unavailableBody')}
        </Banner>
      </section>

      <section aria-labelledby="sessions-heading" className="flex flex-col gap-3">
        <h2 id="sessions-heading" className="text-2xl font-semibold text-ink">
          {t('dashboard:sessions.heading')}
        </h2>
        {state.status === 'loading' ? (
          <Skeleton lines={4} label={t('dashboard:sessions.loading')} />
        ) : state.status === 'error' ? (
          <Banner
            kind="blocked"
            live
            actions={<Button onClick={reload}>{t('common:action.retry')}</Button>}
          >
            {errorText(t, state.error)}
          </Banner>
        ) : sessions.length === 0 ? (
          <EmptyState
            icon={ClipboardCheck}
            title={t('dashboard:sessions.emptyTitle')}
            description={t('dashboard:sessions.emptyBody')}
          />
        ) : (
          <>
            <p className="flex items-center gap-2 text-sm text-body">
              <Hourglass aria-hidden="true" className="size-4" />
              {t('dashboard:sessions.openCount', { count: open })}
            </p>
            <Table
              caption={t('dashboard:sessions.caption')}
              columns={columns}
              rows={sessions}
              getRowId={(s) => s.id}
              emptyText={t('dashboard:sessions.emptyTitle')}
            />
            <p className="text-xs text-body">{t('dashboard:sessions.draftNote')}</p>
            {cursor ? (
              <div>
                <Button loading={loadingMore} onClick={() => void loadMore()}>
                  {t('common:action.loadMore')}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
