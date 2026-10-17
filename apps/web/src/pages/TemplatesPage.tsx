// PG-13 Prescription templates (doctor, admin): the list. Personal templates are the owner's alone; clinic-wide ones
// are shared with the clinic and can be edited by their owner or by an admin. "Load" shows the lines as the later
// prescription builder will receive them.
import { Archive, ClipboardList, FileDown, Pencil, Plus, RotateCcw } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { errorText } from '../api/errorText';
import { formatDateTime } from '../api/format';
import type { ScopeFilter, TemplateList, TemplateSummary } from '../api/templates';
import { useRequest } from '../api/useRequest';
import { useAuth } from '../auth/AuthContext';
import { TemplateLoadDialog } from '../components/clinical/TemplateLoadDialog';
import { Badge } from '../components/ui/Badge';
import { Banner } from '../components/ui/Banner';
import { Button, IconButton } from '../components/ui/Button';
import { EmptyState, Skeleton } from '../components/ui/Feedback';
import { Select } from '../components/ui/Field';
import { Modal } from '../components/ui/Overlay';
import { Switch } from '../components/ui/Switch';
import { Table, type Column } from '../components/ui/Table';
import { useToast } from '../components/ui/Toast';
import { NeedsReview } from '../components/NeedsReview';

const PAGE = 25;

export function TemplatesPage() {
  const { t, i18n } = useTranslation('templates');
  const { api } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [scope, setScope] = useState<ScopeFilter>('all');
  const [showRetired, setShowRetired] = useState(false);
  const [extra, setExtra] = useState<TemplateSummary[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadFor, setLoadFor] = useState<TemplateSummary | null>(null);
  const [retiring, setRetiring] = useState<TemplateSummary | null>(null);
  const [retireBusy, setRetireBusy] = useState(false);

  const query = (offset: number) => ({
    scope,
    includeRetired: showRetired ? 'true' : undefined,
    limit: PAGE,
    offset,
  });
  const list = useRequest(async () => {
    setExtra([]);
    return api.get<TemplateList>('/templates', query(0));
  }, [api, scope, showRetired]);

  // while a new filter is loading, the previous rows stay on screen
  const lastReady = useRef<TemplateList | null>(null);
  if (list.state.status === 'ready') lastReady.current = list.state.data;
  const first =
    list.state.status === 'ready'
      ? list.state.data
      : list.state.status === 'loading'
        ? lastReady.current
        : null;
  const items = first ? [...first.items, ...extra] : [];
  const total = first?.total ?? 0;

  async function loadMore() {
    setLoadingMore(true);
    try {
      const page = await api.get<TemplateList>('/templates', query(items.length));
      setExtra((e) => [...e, ...page.items]);
    } catch (err) {
      toast.push({ kind: 'blocked', title: errorText(t, err) });
    } finally {
      setLoadingMore(false);
    }
  }

  async function change(template: TemplateSummary, verb: 'retire' | 'restore') {
    try {
      await api.post(`/templates/${template.id}/${verb}`);
      toast.push({
        kind: 'clear',
        title: verb === 'retire' ? t('templates:retire.done') : t('templates:retire.restored'),
      });
      list.reload();
    } catch (err) {
      toast.push({
        kind: 'blocked',
        title: t('templates:retire.failed'),
        message: errorText(t, err),
      });
    }
  }

  async function confirmRetire() {
    if (!retiring) return;
    setRetireBusy(true);
    await change(retiring, 'retire');
    setRetireBusy(false);
    setRetiring(null);
  }

  const columns: Column<TemplateSummary>[] = [
    {
      key: 'name',
      header: t('templates:list.name'),
      render: (r) => (
        <Link
          to={`/admin/templates/${r.id}`}
          aria-label={t('templates:actions.view', { name: r.name })}
          className="inline-flex min-h-11 items-center rounded-sm font-semibold text-ink underline"
        >
          {r.name}
        </Link>
      ),
    },
    {
      key: 'visibility',
      header: t('templates:list.visibility'),
      render: (r) => (
        <span className="flex flex-wrap gap-1.5">
          <Badge>{t(`templates:visibility.${r.visibility}`)}</Badge>
          {r.retired ? (
            <Badge className="bg-sunken">{t('templates:list.retiredBadge')}</Badge>
          ) : null}
        </span>
      ),
    },
    {
      key: 'owner',
      header: t('templates:list.owner'),
      render: (r) =>
        r.ownedByMe
          ? t('templates:list.ownerYou')
          : (r.ownerName ?? t('templates:list.ownerUnknown')),
    },
    {
      key: 'items',
      header: t('templates:list.items'),
      align: 'right',
      render: (r) => String(r.itemCount),
    },
    {
      key: 'updated',
      header: t('templates:list.updated'),
      render: (r) => <span className="text-sm">{formatDateTime(r.updatedAt, i18n.language)}</span>,
    },
    {
      key: 'actions',
      header: t('templates:list.actions'),
      render: (r) => (
        <span className="flex gap-1">
          {!r.retired ? (
            <IconButton
              icon={FileDown}
              label={t('templates:actions.load', { name: r.name })}
              onClick={() => setLoadFor(r)}
            />
          ) : null}
          {r.canEdit && !r.retired ? (
            <IconButton
              icon={Pencil}
              label={t('templates:actions.edit', { name: r.name })}
              onClick={() => navigate(`/admin/templates/${r.id}`)}
            />
          ) : null}
          {r.canEdit ? (
            r.retired ? (
              <IconButton
                icon={RotateCcw}
                label={t('templates:actions.restore', { name: r.name })}
                onClick={() => void change(r, 'restore')}
              />
            ) : (
              <IconButton
                icon={Archive}
                label={t('templates:actions.retire', { name: r.name })}
                onClick={() => setRetiring(r)}
              />
            )
          ) : null}
        </span>
      ),
    },
  ];

  const newButton = (
    <Button variant="primary" icon={Plus} onClick={() => navigate('/admin/templates/new')}>
      {t('templates:actions.new')}
    </Button>
  );
  const noRows = first !== null && first.total === 0 && scope === 'all' && !showRetired;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold text-ink">{t('templates:title')}</h1>
          <p className="mt-1 text-base text-body">{t('templates:intro')}</p>
          {i18n.language === 'gu' ? <NeedsReview /> : null}
        </div>
        {newButton}
      </header>

      <section
        aria-label={t('templates:list.filters')}
        className="flex flex-col gap-4 rounded-lg border border-line bg-card p-4"
      >
        <div className="max-w-sm">
          <Select
            label={t('templates:list.scope')}
            value={scope}
            onChange={(e) => setScope(e.target.value as ScopeFilter)}
            options={[
              { value: 'all', label: t('templates:list.scopeAll') },
              { value: 'mine', label: t('templates:list.scopeMine') },
              { value: 'clinic', label: t('templates:list.scopeClinic') },
            ]}
          />
        </div>
        <Switch
          label={t('templates:list.showRetired')}
          checked={showRetired}
          onChange={setShowRetired}
          onText={t('common:state.on')}
          offText={t('common:state.off')}
        />
      </section>

      {list.state.status === 'loading' && first === null ? (
        <Skeleton lines={5} label={t('templates:list.loading')} />
      ) : list.state.status === 'error' ? (
        <Banner
          kind="blocked"
          live
          actions={<Button onClick={list.reload}>{t('common:action.retry')}</Button>}
        >
          {errorText(t, list.state.error)}
        </Banner>
      ) : noRows ? (
        <EmptyState
          icon={ClipboardList}
          title={t('templates:list.emptyTitle')}
          description={t('templates:list.emptyDescription')}
          action={newButton}
        />
      ) : (
        <>
          <Table
            caption={t('templates:list.caption')}
            columns={columns}
            rows={items}
            getRowId={(r) => r.id}
            emptyText={t('templates:list.empty')}
          />
          {items.length < total ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button loading={loadingMore} onClick={() => void loadMore()}>
                {t('templates:list.loadMore')}
              </Button>
              <span className="text-sm text-body">
                {t('templates:list.shown', { shown: items.length, total })}
              </span>
            </div>
          ) : null}
        </>
      )}

      <TemplateLoadDialog
        templateId={loadFor?.id ?? null}
        name={loadFor?.name ?? ''}
        onClose={() => setLoadFor(null)}
      />

      <Modal
        open={retiring !== null}
        onClose={() => setRetiring(null)}
        title={t('templates:retire.title', { name: retiring?.name ?? '' })}
        description={t('templates:retire.body')}
        footer={
          <>
            <Button onClick={() => setRetiring(null)}>{t('common:action.cancel')}</Button>
            <Button variant="primary" loading={retireBusy} onClick={() => void confirmRetire()}>
              {t('templates:retire.confirm')}
            </Button>
          </>
        }
      >
        <p className="text-base text-ink">{retiring?.name}</p>
      </Modal>
    </div>
  );
}
