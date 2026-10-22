// PG-10 Visit record (doctor): a read-only, structured view of the signed snapshot, its content hash, the "Safety checks were
// not run" flag shown prominently, the version history with every amendment reason and time, and an empty FHIR tab that says
// when it arrives. Nothing here can be edited: a change is an amendment (its own screen) that adds a version.
import { History, Pencil } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { errorText } from '../api/errorText';
import type { SignedVisit, VersionSummary } from '../api/prescription';
import { useDateText } from '../api/useDateText';
import { useRequest } from '../api/useRequest';
import { useAuth } from '../auth/AuthContext';
import { Badge } from '../components/ui/Badge';
import { Banner } from '../components/ui/Banner';
import { Skeleton } from '../components/ui/Feedback';
import { Tabs } from '../components/ui/Tabs';
import { ApiError } from '../api/client';

const linkClass = 'inline-flex min-h-11 items-center text-base font-semibold text-ink underline';

export function SafetyFlag({ configured, notRun }: { configured: boolean; notRun: boolean }) {
  const { t } = useTranslation('consult');
  return notRun ? (
    <Banner kind="acknowledge" title={t('consult:record.safetyNotRunTitle')}>
      {t('consult:record.safetyNotRunBody')}
    </Banner>
  ) : configured ? (
    <Banner kind="clear">{t('consult:record.safetyRan')}</Banner>
  ) : null;
}

function Snapshot({ visit }: { visit: SignedVisit }) {
  const { t } = useTranslation(['consult', 'templates']);
  const c = visit.content;
  const wc = c.workingCondition;
  return (
    <div className="flex flex-col gap-5">
      <section aria-label={t('consult:record.facts')} className="flex flex-col gap-2">
        <h2 className="text-base font-semibold text-ink">{t('consult:record.facts')}</h2>
        {c.facts.length === 0 ? (
          <p className="text-sm text-body">{t('consult:diff.noFacts')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {c.facts.map((f) => (
              <li key={f.id} className="rounded-md border border-line bg-card p-3 text-sm text-ink">
                <span className="font-semibold">{t(`consult:facts.type.${f.type}`)}:</span>{' '}
                {f.value}
                {f.negated ? ` · ${t('consult:diff.negated')}` : ''}
                {f.uncertain ? ` · ${t('consult:diff.uncertain')}` : ''}{' '}
                <Badge>
                  {f.source === 'manual'
                    ? t('consult:diff.doctorEntered')
                    : f.edited
                      ? t('consult:diff.edited')
                      : t('consult:diff.unchanged')}
                </Badge>
                {f.edited && f.originalValue ? (
                  <p className="mt-1 text-xs text-body">
                    {t('consult:diff.engine')}: {f.originalValue}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label={t('consult:record.condition')} className="flex flex-col gap-2">
        <h2 className="text-base font-semibold text-ink">{t('consult:record.condition')}</h2>
        <p className="text-sm text-ink">
          {!wc
            ? t('consult:diff.noCondition')
            : wc.kind === 'not_listed'
              ? t('consult:diff.notListed', { text: wc.text })
              : `${wc.pathwayId} (v${wc.version})`}
        </p>
      </section>

      <section aria-label={t('consult:record.medicines')} className="flex flex-col gap-2">
        <h2 className="text-base font-semibold text-ink">{t('consult:record.medicines')}</h2>
        {c.medicines.length === 0 ? (
          <p className="text-sm text-body">{t('consult:diff.noMedicines')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {c.medicines.map((m) => (
              <li
                key={m.position}
                className="rounded-md border border-line bg-card p-3 text-sm text-ink"
              >
                <p className="font-semibold">
                  {m.name}{' '}
                  {m.source === 'free_text' ? (
                    <Badge>{t('consult:prescription.notInMaster')}</Badge>
                  ) : null}
                </p>
                <p>{[m.strength, m.doseForm].filter(Boolean).join(' · ')}</p>
                <p>
                  {[
                    m.dose,
                    t(`templates:frequency.${m.frequency}`, m.frequency),
                    m.duration,
                    m.note,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                {m.masterSource ? (
                  <p className="text-xs text-body">
                    {t('consult:prescription.sourceLine', {
                      source: m.masterSource,
                      page: m.masterSourcePage === null ? '' : m.masterSourcePage - 1,
                    })}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label={t('consult:record.consent')} className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-ink">{t('consult:record.consent')}</h2>
        <p className="text-sm text-ink">
          {t('consult:record.consentLine', {
            audio: c.consent.audio ? t('consult:record.yes') : t('consult:record.no'),
            ai: c.consent.aiProcessing ? t('consult:record.yes') : t('consult:record.no'),
          })}
        </p>
        <p className="text-sm text-body">
          {c.aiContentIncluded ? t('consult:record.aiIncluded') : t('consult:record.aiNotIncluded')}
        </p>
      </section>
    </div>
  );
}

function History_({
  versions,
  current,
  shown,
  sessionId,
}: {
  versions: VersionSummary[];
  current: number;
  shown: number;
  sessionId: string;
}) {
  const { t } = useTranslation('consult');
  const dateText = useDateText();
  return (
    <section
      aria-label={t('consult:record.history')}
      className="flex flex-col gap-3 rounded-lg border border-line bg-card p-4"
    >
      <h2 className="flex items-center gap-2 font-display text-xl font-semibold text-ink">
        <History aria-hidden="true" className="size-5" />
        {t('consult:record.history')}
      </h2>
      <ol className="flex flex-col gap-3">
        {[...versions].reverse().map((v) => (
          <li key={v.version} className="rounded-md border border-line p-3 text-sm text-ink">
            <p className="font-semibold">
              {t(
                v.kind === 'signed'
                  ? 'consult:record.versionSigned'
                  : 'consult:record.versionAmended',
                {
                  version: v.version,
                },
              )}
              {v.version === current ? ` · ${t('consult:record.currentTag')}` : ''}
            </p>
            <p>{dateText(v.signedAt)}</p>
            {v.reason ? (
              <p>
                {t('consult:record.reason')}: {v.reason}
              </p>
            ) : null}
            {v.safetyNotRunAcknowledged ? (
              <p className="font-semibold">{t('consult:record.safetyNotRunShort')}</p>
            ) : null}
            <p className="break-all text-xs text-body">
              {t('consult:sign.hash')}: {v.contentHash}
            </p>
            {v.version !== shown ? (
              <Link to={`/consult/${sessionId}/record?v=${v.version}`} className={linkClass}>
                {t('consult:record.viewVersion', { version: v.version })}
              </Link>
            ) : (
              <p className="text-xs text-body">{t('consult:record.shownNow')}</p>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

export function VisitRecordPage() {
  const { t } = useTranslation(['consult', 'common']);
  const { sessionId = '' } = useParams();
  const [params] = useSearchParams();
  const wanted = Number(params.get('v')) || null;
  const { api } = useAuth();
  const dateText = useDateText();
  const visit = useRequest(
    () =>
      api.get<SignedVisit>(
        wanted ? `/sessions/${sessionId}/visit/versions/${wanted}` : `/sessions/${sessionId}/visit`,
      ),
    [api, sessionId, wanted],
  );
  const history = useRequest(
    () => api.get<{ versions: VersionSummary[] }>(`/sessions/${sessionId}/visit/versions`),
    [api, sessionId],
  );
  const notSigned =
    visit.state.status === 'error' &&
    visit.state.error instanceof ApiError &&
    visit.state.error.status === 404;
  const v = visit.state.status === 'ready' ? visit.state.data : null;
  const versions = history.state.status === 'ready' ? history.state.data.versions : [];
  const currentVersion =
    versions.length > 0 ? Math.max(...versions.map((x) => x.version)) : (v?.version ?? 1);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <header>
        <h1 className="font-display text-3xl font-semibold text-ink">
          {t('consult:record.title')}
        </h1>
        <p className="mt-1 text-base text-body">{t('consult:record.intro')}</p>
      </header>

      {visit.state.status === 'loading' ? (
        <Skeleton lines={4} label={t('consult:record.loading')} />
      ) : notSigned ? (
        <Banner kind="acknowledge" title={t('consult:record.notSigned')}>
          <Link to={`/consult/${sessionId}/sign`} className={linkClass}>
            {t('consult:record.goSign')}
          </Link>
        </Banner>
      ) : visit.state.status === 'error' ? (
        <Banner kind="blocked" live>
          {errorText(t, visit.state.error)}
        </Banner>
      ) : null}

      {v ? (
        <>
          <SafetyFlag configured={v.safetyConfigured} notRun={v.safetyNotRunAcknowledged} />
          <section
            aria-label={t('consult:record.summary')}
            className="flex flex-col gap-2 rounded-lg border border-line bg-card p-4"
          >
            <p className="flex flex-wrap items-center gap-2 text-base font-semibold text-ink">
              <Badge>
                {t(
                  v.kind === 'signed'
                    ? 'consult:record.versionSigned'
                    : 'consult:record.versionAmended',
                  {
                    version: v.version,
                  },
                )}
              </Badge>
              {v.version === currentVersion ? (
                <Badge>{t('consult:record.currentTag')}</Badge>
              ) : (
                <Badge>{t('consult:record.olderTag')}</Badge>
              )}
            </p>
            <p className="text-sm text-ink">{dateText(v.signedAt)}</p>
            {v.reason ? (
              <p className="text-sm text-ink">
                {t('consult:record.reason')}: {v.reason}
              </p>
            ) : null}
            <p className="break-all text-xs text-body">
              {t('consult:sign.hash')}: {v.contentHash}
            </p>
            <div className="flex flex-wrap gap-4">
              <Link to={`/consult/${sessionId}/amend`} className={linkClass}>
                <Pencil aria-hidden="true" className="me-2 size-4" />
                {t('consult:record.amend')}
              </Link>
              <Link to={`/consult/${sessionId}`} className={linkClass}>
                {t('consult:sign.back')}
              </Link>
            </div>
          </section>

          <Tabs
            label={t('consult:record.tabsLabel')}
            tabs={[
              {
                id: 'record',
                label: t('consult:record.tabRecord'),
                panel: <Snapshot visit={v} />,
              },
              {
                id: 'fhir',
                label: t('consult:record.tabFhir'),
                panel: (
                  <p className="rounded-md border border-dashed border-control p-4 text-base text-body">
                    {t('consult:record.fhirSoon')}
                  </p>
                ),
              },
            ]}
          />
          {versions.length > 0 ? (
            <History_
              versions={versions}
              current={currentVersion}
              shown={v.version}
              sessionId={sessionId}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
