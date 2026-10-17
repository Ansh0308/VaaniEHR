// PG-12 Medicine master (admin). A sortable table of the shared medicine list: filter by category, show retired rows,
// see where each row comes from (PDF page and printed page) and whether anyone has reviewed it clinically.
// Add, edit, retire and restore go through the admin API. There is deliberately NO CSV upload here: NLEM rows are
// loaded by the importer script, and the page says so (docs/PRD_ERRATA.md).
import { Archive, Pill, Plus, RotateCcw, Pencil, Search } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { errorText } from '../api/errorText';
import { formatDate } from '../api/format';
import {
  pageLabel,
  type Medicine,
  type MedicineCategory,
  type MedicineList,
  type MedicineSort,
} from '../api/medicines';
import { useRequest } from '../api/useRequest';
import { useAuth } from '../auth/AuthContext';
import { MedicineFormDialog } from '../components/clinical/MedicineFormDialog';
import { Badge } from '../components/ui/Badge';
import { Banner } from '../components/ui/Banner';
import { Button, IconButton } from '../components/ui/Button';
import { EmptyState, Skeleton } from '../components/ui/Feedback';
import { Input, Select } from '../components/ui/Field';
import { Modal } from '../components/ui/Overlay';
import { Switch } from '../components/ui/Switch';
import { Table, type Column, type SortState } from '../components/ui/Table';
import { useToast } from '../components/ui/Toast';

const PAGE = 25;

export function MedicinesPage() {
  const { t, i18n } = useTranslation('medicines');
  const { api } = useAuth();
  const toast = useToast();

  const [draftQuery, setDraftQuery] = useState('');
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [showRetired, setShowRetired] = useState(false);
  const [sort, setSort] = useState<SortState>({ key: 'name', direction: 'ascending' });
  const [extra, setExtra] = useState<Medicine[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [announce, setAnnounce] = useState('');
  const [editing, setEditing] = useState<Medicine | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [retiring, setRetiring] = useState<Medicine | null>(null);
  const [retireBusy, setRetireBusy] = useState(false);

  const query = (offset: number) => ({
    q: q || undefined,
    category: category || undefined,
    sort: (sort?.key ?? 'name') as MedicineSort,
    order: sort?.direction === 'descending' ? 'desc' : 'asc',
    includeRetired: showRetired ? 'true' : undefined,
    limit: PAGE,
    offset,
  });

  const categories = useRequest(
    async () =>
      (await api.get<{ categories: MedicineCategory[] }>('/medicines/categories')).categories,
    [api],
  );
  const list = useRequest(async () => {
    setExtra([]);
    return api.get<MedicineList>('/medicines', query(0));
  }, [api, q, category, showRetired, sort?.key, sort?.direction]);

  // while a new sort or filter is loading, the previous rows stay on screen so the sort button keeps keyboard focus
  const lastReady = useRef<MedicineList | null>(null);
  if (list.state.status === 'ready') lastReady.current = list.state.data;
  const first =
    list.state.status === 'ready'
      ? list.state.data
      : list.state.status === 'loading'
        ? lastReady.current
        : null;
  const items = first ? [...first.items, ...extra] : [];
  const total = first?.total ?? 0;

  useEffect(() => {
    if (first) setAnnounce(t('medicines:filters.shown', { shown: items.length, total }));
    // the announcement follows the result, not every keystroke
  }, [first, extra.length]);

  function search(event: FormEvent) {
    event.preventDefault();
    setQ(draftQuery.trim());
  }

  function onSort(key: string) {
    setSort((current) =>
      current?.key === key
        ? { key, direction: current.direction === 'ascending' ? 'descending' : 'ascending' }
        : { key, direction: 'ascending' },
    );
  }

  async function loadMore() {
    setLoadingMore(true);
    try {
      const page = await api.get<MedicineList>('/medicines', query(items.length));
      setExtra((e) => [...e, ...page.items]);
    } catch (err) {
      toast.push({ kind: 'blocked', title: errorText(t, err) });
    } finally {
      setLoadingMore(false);
    }
  }

  async function restore(medicine: Medicine) {
    try {
      await api.post(`/medicines/${medicine.id}/restore`);
      toast.push({ kind: 'clear', title: t('medicines:retire.restored') });
      list.reload();
    } catch (err) {
      toast.push({
        kind: 'blocked',
        title: t('medicines:retire.failed'),
        message: errorText(t, err),
      });
    }
  }

  async function confirmRetire() {
    if (!retiring) return;
    setRetireBusy(true);
    try {
      await api.post(`/medicines/${retiring.id}/retire`);
      toast.push({ kind: 'clear', title: t('medicines:retire.done') });
      setRetiring(null);
      list.reload();
    } catch (err) {
      toast.push({
        kind: 'blocked',
        title: t('medicines:retire.failed'),
        message: errorText(t, err),
      });
    } finally {
      setRetireBusy(false);
    }
  }

  const columns: Column<Medicine>[] = [
    {
      key: 'name',
      header: t('medicines:table.name'),
      sortable: true,
      render: (m) => (
        <span className="flex flex-col">
          <span className="font-semibold">{m.genericName}</span>
          {m.brands.length > 0 ? (
            <span className="text-sm font-normal text-body">
              {t('medicines:table.brandLine', {
                brand: m.brands
                  .slice(0, 3)
                  .map((b) => b.brandName)
                  .join(', '),
              })}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'strength',
      header: t('medicines:table.strength'),
      sortable: true,
      render: (m) => m.strength ?? '—',
    },
    {
      key: 'form',
      header: t('medicines:table.form'),
      sortable: true,
      render: (m) => m.doseForm ?? '—',
    },
    {
      key: 'category',
      header: t('medicines:table.category'),
      sortable: true,
      render: (m) => <span className="text-sm">{m.therapeuticCategory ?? '—'}</span>,
    },
    {
      key: 'page',
      header: t('medicines:table.source'),
      sortable: true,
      render: (m) => (
        <span className="flex flex-col text-sm">
          <span>{m.source}</span>
          {pageLabel(m.sourcePage, m.sourcePagePrinted, t) ? (
            <span className="text-body">{pageLabel(m.sourcePage, m.sourcePagePrinted, t)}</span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'reviewed',
      header: t('medicines:table.status'),
      sortable: true,
      render: (m) => (
        <span className="flex flex-wrap gap-1.5">
          {m.reviewStatus === 'reviewed' ? (
            <Badge>
              {t('medicines:status.reviewed', {
                date: m.reviewedOn ? formatDate(m.reviewedOn, i18n.language) : '',
              })}
            </Badge>
          ) : (
            <Badge className="border-dashed">{t('medicines:status.notReviewed')}</Badge>
          )}
          {m.retired ? <Badge className="bg-sunken">{t('medicines:status.retired')}</Badge> : null}
        </span>
      ),
    },
    {
      key: 'actions',
      header: t('medicines:table.actions'),
      render: (m) => (
        <span className="flex gap-1">
          <IconButton
            icon={Pencil}
            label={t('medicines:actions.edit', { name: m.genericName })}
            onClick={() => {
              setEditing(m);
              setFormOpen(true);
            }}
          />
          {m.retired ? (
            <IconButton
              icon={RotateCcw}
              label={t('medicines:actions.restore', { name: m.genericName })}
              onClick={() => void restore(m)}
            />
          ) : (
            <IconButton
              icon={Archive}
              label={t('medicines:actions.retire', { name: m.genericName })}
              onClick={() => setRetiring(m)}
            />
          )}
        </span>
      ),
    },
  ];

  const filtered = q !== '' || category !== '' || showRetired;
  const noRows = first !== null && first.total === 0 && !filtered;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold text-ink">{t('medicines:title')}</h1>
          <p className="mt-1 text-base text-body">{t('medicines:intro')}</p>
        </div>
        <Button
          variant="primary"
          icon={Plus}
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          {t('medicines:actions.add')}
        </Button>
      </header>

      <Banner>{t('medicines:importHelp')}</Banner>

      <form
        onSubmit={search}
        aria-label={t('medicines:filters.heading')}
        className="flex flex-col gap-4 rounded-lg border border-line bg-card p-4"
      >
        <h2 className="text-lg font-semibold text-ink">{t('medicines:filters.heading')}</h2>
        <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <Input
                label={t('medicines:filters.search')}
                type="search"
                autoComplete="off"
                maxLength={80}
                value={draftQuery}
                onChange={(e) => setDraftQuery(e.target.value)}
              />
            </div>
            <Button type="submit" icon={Search}>
              {t('medicines:filters.searchButton')}
            </Button>
          </div>
          <Select
            label={t('medicines:filters.category')}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            options={[
              { value: '', label: t('medicines:filters.allCategories') },
              ...(categories.state.status === 'ready' ? categories.state.data : []).map((c) => ({
                value: c.name,
                label: `${c.name} (${c.count})`,
              })),
            ]}
          />
        </div>
        <Switch
          label={t('medicines:filters.showRetired')}
          checked={showRetired}
          onChange={setShowRetired}
          onText={t('common:state.on')}
          offText={t('common:state.off')}
        />
        {q !== '' ? <p className="text-xs text-body">{t('medicines:filters.searchNote')}</p> : null}
        <p role="status" className="text-sm text-body">
          {announce}
        </p>
      </form>

      {list.state.status === 'loading' && first === null ? (
        <Skeleton lines={6} label={t('medicines:table.loading')} />
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
          icon={Pill}
          title={t('medicines:empty.title')}
          description={t('medicines:empty.description')}
          action={
            <Button
              variant="primary"
              icon={Plus}
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              {t('medicines:actions.add')}
            </Button>
          }
        />
      ) : (
        <>
          <Table
            caption={t('medicines:table.caption')}
            columns={columns}
            rows={items}
            getRowId={(m) => m.id}
            sort={q === '' ? sort : null}
            onSort={onSort}
            emptyText={t('medicines:table.empty')}
          />
          {items.length < total ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button loading={loadingMore} onClick={() => void loadMore()}>
                {t('common:action.loadMore')}
              </Button>
              <span className="text-sm text-body">
                {t('medicines:filters.shown', { shown: items.length, total })}
              </span>
            </div>
          ) : null}
        </>
      )}

      <MedicineFormDialog
        open={formOpen}
        medicine={editing}
        onClose={() => setFormOpen(false)}
        onSaved={(_saved, created) => {
          setFormOpen(false);
          toast.push({
            kind: 'clear',
            title: created ? t('medicines:form.created') : t('medicines:form.updated'),
          });
          list.reload();
          categories.reload();
        }}
      />

      <Modal
        open={retiring !== null}
        onClose={() => setRetiring(null)}
        title={t('medicines:retire.title', { name: retiring?.genericName ?? '' })}
        description={t('medicines:retire.body')}
        footer={
          <>
            <Button onClick={() => setRetiring(null)}>{t('common:action.cancel')}</Button>
            <Button variant="primary" loading={retireBusy} onClick={() => void confirmRetire()}>
              {t('medicines:retire.confirm')}
            </Button>
          </>
        }
      >
        <p className="text-base text-ink">
          {retiring
            ? [retiring.genericName, retiring.strength, retiring.doseForm]
                .filter(Boolean)
                .join(' · ')
            : ''}
        </p>
      </Modal>
    </div>
  );
}
