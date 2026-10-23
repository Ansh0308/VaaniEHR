// FHIR tab of the visit record (PG-10, Phase 9A, ADR-D40): the bundles built from the signed version, the validator's verdict
// (valid / invalid / not validated) with every error and warning and its path, the bundle as pretty JSON (doctor only) and a
// download button that is OFF unless the validator called the bundle valid (the server refuses the export as well). A signed
// visit stays signed whatever the verdict. The first time the tab is opened for a version with no bundle it builds one, once;
// nothing retries by itself.
import { Download, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../../api/client';
import type { BundleKind, FhirBundleView, FhirList, ValidationIssue } from '../../api/fhir';
import { errorText } from '../../api/errorText';
import { useAuth } from '../../auth/AuthContext';
import { StateBadge } from '../ui/Badge';
import { Banner } from '../ui/Banner';
import { Button } from '../ui/Button';
import { Skeleton } from '../ui/Feedback';

const KIND_ORDER: BundleKind[] = ['op_consult', 'prescription'];
const STATE_OF = { valid: 'clear', invalid: 'blocked', not_validated: 'acknowledge' } as const;

function IssueList({ issues }: { issues: ValidationIssue[] }) {
  const { t } = useTranslation('consult');
  const shown = issues.filter((i) => i.severity !== 'information');
  if (shown.length === 0) return <p className="text-sm text-body">{t('consult:fhir.noIssues')}</p>;
  return (
    <ul aria-label={t('consult:fhir.issues')} className="flex flex-col gap-2">
      {shown.map((i, n) => (
        <li
          key={`${i.path}:${n}`}
          className="rounded-md border border-line bg-card p-2 text-sm text-ink"
        >
          <p className="font-semibold">
            {t(`consult:fhir.severity.${i.severity === 'fatal' ? 'error' : i.severity}`)}
          </p>
          <p className="break-all text-xs text-body">{i.path}</p>
          <p>{i.message}</p>
        </li>
      ))}
    </ul>
  );
}

function BundleCard({
  b,
  sessionId,
  busy,
  onRevalidate,
}: {
  b: FhirBundleView;
  sessionId: string;
  busy: boolean;
  onRevalidate: () => void;
}) {
  const { t } = useTranslation('consult');
  const { api } = useAuth();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(false);

  async function download() {
    setExporting(true);
    setExportError(false);
    try {
      const file = await api.post<{ filename: string; bundle: unknown }>(
        `/sessions/${sessionId}/fhir/export`,
        { kind: b.kind, version: b.version },
      );
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(file.bundle, null, 2)], { type: 'application/fhir+json' }),
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = file.filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setExportError(true);
    } finally {
      setExporting(false);
    }
  }

  return (
    <section
      aria-label={t(`consult:fhir.kind.${b.kind}`)}
      className="flex flex-col gap-3 rounded-lg border border-line bg-card p-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-display text-lg font-semibold text-ink">
          {t(`consult:fhir.kind.${b.kind}`)}
        </h2>
        <StateBadge state={STATE_OF[b.status]} label={t(`consult:fhir.status.${b.status}`)} />
      </div>
      <p className="text-sm text-ink">
        {t('consult:fhir.counts', { errors: b.errorCount, warnings: b.warningCount })}
      </p>
      <p className="text-xs text-body">
        {t('consult:fhir.validatedBy', {
          ig: b.igVersion,
          validator: b.validatorVersion ?? t('consult:fhir.noValidator'),
        })}
      </p>
      {b.status === 'invalid' ? (
        <Banner kind="blocked" live>
          {t('consult:fhir.invalidBody')}
        </Banner>
      ) : null}
      {b.status === 'not_validated' ? (
        <Banner kind="acknowledge" title={t('consult:fhir.notValidatedTitle')}>
          <p>{b.notValidatedReason}</p>
          <p>{t('consult:fhir.notValidatedBody')}</p>
        </Banner>
      ) : null}
      <IssueList issues={b.issues} />

      {b.bundle ? (
        <>
          <pre
            tabIndex={0}
            aria-label={t('consult:fhir.jsonLabel', { kind: t(`consult:fhir.kind.${b.kind}`) })}
            className="max-h-96 overflow-auto rounded-md border border-line bg-sunken p-3 text-xs text-ink"
          >
            {JSON.stringify(b.bundle, null, 2)}
          </pre>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              icon={Download}
              disabled={!b.exportable || exporting}
              loading={exporting}
              onClick={() => void download()}
            >
              {t('consult:fhir.download')}
            </Button>
            {b.status === 'not_validated' ? (
              <Button icon={RefreshCw} disabled={busy} onClick={onRevalidate}>
                {t('consult:fhir.revalidate')}
              </Button>
            ) : null}
            {!b.exportable ? (
              <p className="text-xs text-body">{t('consult:fhir.downloadOff')}</p>
            ) : null}
          </div>
          {exportError ? (
            <Banner kind="blocked" live>
              {t('consult:fhir.exportFailed')}
            </Banner>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

export function FhirTab({
  sessionId,
  version,
  canBuild,
}: {
  sessionId: string;
  /** the version shown on the page; null = the current one */
  version: number | null;
  /** the doctor may build and validate; the admin only reads */
  canBuild: boolean;
}) {
  const { t } = useTranslation(['consult', 'common']);
  const { api } = useAuth();
  const [data, setData] = useState<FhirList | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const asked = useRef<string>('');

  async function load() {
    try {
      const d = await api.get<FhirList>(`/sessions/${sessionId}/fhir`, version ? { version } : {});
      setData(d);
      setError(null);
      return d;
    } catch (err) {
      setError(err);
      return null;
    }
  }
  async function build(revalidate: boolean) {
    setBusy(true);
    try {
      const d = await api.post<FhirList>(`/sessions/${sessionId}/fhir`, { revalidate });
      setData(d);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    let alive = true;
    void (async () => {
      const d = await load();
      // the FIRST time a signed version is opened with no bundle yet, build it once; a failure is shown, never retried
      const key = `${sessionId}:${version ?? 'current'}`;
      if (
        alive &&
        d &&
        canBuild &&
        d.currentVersion !== null &&
        d.bundles.length === 0 &&
        asked.current !== key
      ) {
        asked.current = key;
        await build(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [sessionId, version]);

  if (error && !data) {
    const notSigned = error instanceof ApiError && error.status === 409;
    return (
      <Banner kind={notSigned ? 'acknowledge' : 'blocked'} live>
        {notSigned ? t('consult:record.notSigned') : errorText(t, error)}
      </Banner>
    );
  }
  if (!data || busy) return <Skeleton lines={4} label={t('consult:fhir.building')} />;
  const bundles = [...data.bundles].sort(
    (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind),
  );
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-body">{t('consult:fhir.intro')}</p>
      {error ? (
        <Banner kind="blocked" live>
          {t('consult:fhir.buildFailed')}
        </Banner>
      ) : null}
      {bundles.length === 0 ? (
        <div className="flex flex-col gap-3">
          <p className="rounded-md border border-dashed border-control p-4 text-base text-body">
            {t('consult:fhir.none')}
          </p>
          {canBuild && data.currentVersion !== null ? (
            <div>
              <Button variant="primary" disabled={busy} onClick={() => void build(false)}>
                {t('consult:fhir.build')}
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        bundles.map((b) => (
          <BundleCard
            key={b.kind}
            b={b}
            sessionId={sessionId}
            busy={busy}
            onRevalidate={() => void build(true)}
          />
        ))
      )}
    </div>
  );
}
