// PG-16 Audit log (admin: full rows; researcher: anonymised rows). Filters are user, action and date range only.
// "Chain verified" comes from GET /audit/verify (admin). CSV export is admin only and is itself an audit event;
// the file holds identifiers only and is capped, which this page says plainly when it happens.
import { Download, FilterX, Funnel, ShieldCheck } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { AUDIT_ACTIONS } from '../api/auditActions';
import { errorText } from '../api/errorText';
import { formatDateTime } from '../api/format';
import type { AuditPage as AuditPageData, AuditRow, VerifyResult } from '../api/types';
import { useRequest } from '../api/useRequest';
import { useAuth } from '../auth/AuthContext';
import { Banner } from '../components/ui/Banner';
import { StateBadge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { ErrorSummary, type FormError } from '../components/ui/ErrorSummary';
import { Skeleton } from '../components/ui/Feedback';
import { Input, Select } from '../components/ui/Field';
import { Table, type Column } from '../components/ui/Table';
import { useToast } from '../components/ui/Toast';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE = 50;

interface Filters {
  actorUserId: string;
  action: string;
  from: string;
  to: string;
}
const EMPTY: Filters = { actorUserId: '', action: '', from: '', to: '' };

/** Only the filters that are set, in the shape the API expects. */
const clean = (f: Filters) =>
  Object.fromEntries(Object.entries(f).filter(([, v]) => v !== '')) as Record<string, string>;

export function AuditPage() {
  const { t, i18n } = useTranslation('audit');
  const { api, user } = useAuth();
  const toast = useToast();
  const isAdmin = user?.role === 'admin';

  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [applied, setApplied] = useState<Filters>(EMPTY);
  const [errors, setErrors] = useState<{ user?: string; range?: string }>({});
  const [extra, setExtra] = useState<AuditRow[]>([]);
  const [cursor, setCursor] = useState<number | null | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState<{ rows: number; truncated: boolean } | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const [attempts, setAttempts] = useState(0);
  const [announce, setAnnounce] = useState('');

  const rows = useRequest(async () => {
    setExtra([]);
    setCursor(undefined);
    return api.get<AuditPageData>('/audit', { ...clean(applied), limit: PAGE });
  }, [api, applied]);

  const verify = useRequest<VerifyResult | null>(
    () => (isAdmin ? api.get<VerifyResult>('/audit/verify') : Promise.resolve(null)),
    [api, isAdmin],
  );

  useEffect(() => {
    if (attempts > 0) summaryRef.current?.focus();
  }, [attempts]);

  const first = rows.state.status === 'ready' ? rows.state.data : null;
  const next = cursor === undefined ? (first?.nextBeforeSeq ?? null) : cursor;
  const items: AuditRow[] = first ? [...first.items, ...extra] : [];

  function applyFilters(event: FormEvent) {
    event.preventDefault();
    const next: { user?: string; range?: string } = {};
    if (draft.actorUserId && !UUID.test(draft.actorUserId.trim()))
      next.user = t('audit:filters.userInvalid');
    if (draft.from && draft.to && draft.from > draft.to)
      next.range = t('audit:filters.rangeInvalid');
    setErrors(next);
    if (next.user || next.range) {
      setAttempts((n) => n + 1);
      return;
    }
    setApplied({ ...draft, actorUserId: draft.actorUserId.trim() });
    setExportNote(null);
    setAnnounce(t('audit:filters.applied'));
  }

  function clearFilters() {
    setDraft(EMPTY);
    setApplied(EMPTY);
    setErrors({});
    setExportNote(null);
    setAnnounce(t('audit:filters.cleared'));
  }

  async function loadMore() {
    if (next === null) return;
    setLoadingMore(true);
    try {
      const page = await api.get<AuditPageData>('/audit', {
        ...clean(applied),
        limit: PAGE,
        beforeSeq: next,
      });
      setExtra((e) => [...e, ...page.items]);
      setCursor(page.nextBeforeSeq);
    } catch (err) {
      toast.push({ kind: 'blocked', title: errorText(t, err) });
    } finally {
      setLoadingMore(false);
    }
  }

  async function exportCsv() {
    setExporting(true);
    try {
      const file = await api.download('/audit/export', clean(applied));
      const url = URL.createObjectURL(file.blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setExportNote({ rows: file.rows, truncated: file.truncated });
      toast.push({ kind: 'clear', title: t('audit:export.done', { count: file.rows }) });
    } catch (err) {
      toast.push({ kind: 'blocked', title: t('audit:export.failed'), message: errorText(t, err) });
    } finally {
      setExporting(false);
    }
  }

  const summary: FormError[] = [
    ...(errors.user ? [{ fieldId: 'audit-user', message: errors.user }] : []),
    ...(errors.range ? [{ fieldId: 'audit-from', message: errors.range }] : []),
  ];

  const short = (id: string | null | undefined) => (id ? `${id.slice(0, 8)}…` : '—');
  const columns: Column<AuditRow>[] = [
    { key: 'seq', header: t('audit:columns.seq'), render: (r) => String(r.seq), align: 'right' },
    {
      key: 'ts',
      header: t('audit:columns.time'),
      render: (r) => formatDateTime(r.ts, i18n.language),
    },
    {
      key: 'action',
      header: t('audit:columns.action'),
      render: (r) => t(`audit:actions.${r.action}`, { defaultValue: r.action }),
    },
    ...(isAdmin
      ? ([
          {
            key: 'actor',
            header: t('audit:columns.user'),
            render: (r: AuditRow) =>
              r.actorUserId ? (
                <span className="flex flex-wrap items-center gap-2">
                  <span>
                    {r.actorRole
                      ? t(`shell:role.${r.actorRole}`, { defaultValue: r.actorRole })
                      : ''}{' '}
                    <code className="text-xs">{short(r.actorUserId)}</code>
                  </span>
                  <button
                    type="button"
                    className="min-h-11 rounded-sm px-2 text-sm font-semibold text-ink underline"
                    aria-label={t('audit:columns.filterUser', { id: short(r.actorUserId) })}
                    onClick={() => {
                      const id = r.actorUserId as string;
                      setDraft((d) => ({ ...d, actorUserId: id }));
                      setApplied((a) => ({ ...a, actorUserId: id }));
                    }}
                  >
                    {t('audit:columns.filterThis')}
                  </button>
                </span>
              ) : (
                (r.actorRole ?? '—')
              ),
          },
        ] satisfies Column<AuditRow>[])
      : [
          {
            key: 'role',
            header: t('audit:columns.role'),
            render: (r: AuditRow) => r.actorRole ?? '—',
          },
        ]),
    { key: 'resource', header: t('audit:columns.resource'), render: (r) => r.resourceType ?? '—' },
    ...(isAdmin
      ? ([
          {
            key: 'resourceId',
            header: t('audit:columns.resourceId'),
            render: (r: AuditRow) => <code className="text-xs">{short(r.resourceId)}</code>,
          },
        ] satisfies Column<AuditRow>[])
      : []),
  ];

  const verifyBadge =
    verify.state.status === 'loading' ? (
      <span role="status" className="text-sm text-body">
        {t('audit:verify.checking')}
      </span>
    ) : verify.state.status === 'error' ? (
      <StateBadge state="acknowledge" label={t('audit:verify.failedToRun')} />
    ) : verify.state.data?.ok ? (
      <StateBadge state="clear" label={t('audit:verify.ok')} />
    ) : (
      <StateBadge
        state="blocked"
        label={t('audit:verify.broken', { seq: verify.state.data?.firstBrokenSeq ?? 0 })}
      />
    );

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold text-ink">{t('audit:title')}</h1>
          <p className="mt-1 text-base text-body">
            {isAdmin ? t('audit:introAdmin') : t('audit:introResearcher')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {isAdmin ? (
            <>
              {verifyBadge}
              <Button icon={ShieldCheck} onClick={verify.reload}>
                {t('audit:verify.again')}
              </Button>
            </>
          ) : (
            <p className="text-sm text-body">{t('audit:verify.adminOnly')}</p>
          )}
        </div>
      </header>

      <form
        onSubmit={applyFilters}
        noValidate
        aria-label={t('audit:filters.heading')}
        className="flex flex-col gap-4 rounded-lg border border-line bg-card p-4"
      >
        <h2 className="text-lg font-semibold text-ink">{t('audit:filters.heading')}</h2>
        <ErrorSummary ref={summaryRef} title={t('audit:filters.errorSummary')} errors={summary} />
        <div className="grid gap-4 md:grid-cols-4">
          {isAdmin ? (
            <Input
              id="audit-user"
              label={t('audit:filters.user')}
              hint={t('audit:filters.userHint')}
              autoComplete="off"
              value={draft.actorUserId}
              onChange={(e) => setDraft({ ...draft, actorUserId: e.target.value })}
              {...(errors.user ? { error: errors.user } : {})}
            />
          ) : null}
          <Select
            label={t('audit:filters.action')}
            value={draft.action}
            onChange={(e) => setDraft({ ...draft, action: e.target.value })}
            options={[
              { value: '', label: t('audit:filters.anyAction') },
              ...AUDIT_ACTIONS.map((a) => ({ value: a, label: t(`audit:actions.${a}`) })),
            ]}
          />
          <Input
            id="audit-from"
            label={t('audit:filters.from')}
            type="date"
            value={draft.from}
            onChange={(e) => setDraft({ ...draft, from: e.target.value })}
            {...(errors.range ? { error: errors.range } : {})}
          />
          <Input
            label={t('audit:filters.to')}
            type="date"
            value={draft.to}
            onChange={(e) => setDraft({ ...draft, to: e.target.value })}
          />
        </div>
        <div className="flex flex-wrap gap-3">
          <Button type="submit" variant="primary" icon={Funnel}>
            {t('audit:filters.apply')}
          </Button>
          <Button icon={FilterX} onClick={clearFilters}>
            {t('audit:filters.clear')}
          </Button>
          {isAdmin ? (
            <Button icon={Download} loading={exporting} onClick={() => void exportCsv()}>
              {t('audit:export.button')}
            </Button>
          ) : null}
        </div>
        <p role="status" className="sr-only">
          {announce}
        </p>
      </form>

      {exportNote?.truncated ? (
        <Banner kind="acknowledge" live title={t('audit:export.truncatedTitle')}>
          {t('audit:export.truncatedBody', { count: exportNote.rows })}
        </Banner>
      ) : null}
      {isAdmin ? <p className="text-xs text-body">{t('audit:export.note')}</p> : null}

      {rows.state.status === 'loading' ? (
        <Skeleton lines={6} label={t('audit:loading')} />
      ) : rows.state.status === 'error' ? (
        <Banner
          kind="blocked"
          live
          actions={<Button onClick={rows.reload}>{t('common:action.retry')}</Button>}
        >
          {errorText(t, rows.state.error)}
        </Banner>
      ) : (
        <>
          <Table
            caption={t('audit:caption')}
            columns={columns}
            rows={items}
            getRowId={(r) => String(r.seq)}
            emptyText={
              Object.keys(clean(applied)).length > 0 ? t('audit:emptyFiltered') : t('audit:empty')
            }
          />
          {next !== null ? (
            <div>
              <Button loading={loadingMore} onClick={() => void loadMore()}>
                {t('common:action.loadMore')}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
