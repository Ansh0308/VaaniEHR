// Data table: semantic <table>, caption, scope="col", sortable headers with aria-sort, keyboard-reachable scroll region.
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from './cn';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  align?: 'left' | 'right';
  sortable?: boolean;
}

export type SortState = { key: string; direction: 'ascending' | 'descending' } | null;

export function Table<T>({
  caption,
  columns,
  rows,
  getRowId,
  sort = null,
  onSort,
  selectedId,
  emptyText,
}: {
  caption: string;
  columns: Column<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  sort?: SortState;
  onSort?: (key: string) => void;
  selectedId?: string | null;
  emptyText: string;
}) {
  const { t } = useTranslation('common');
  return (
    <div
      role="region"
      aria-label={caption}
      // a scrollable region must be focusable so keyboard users can scroll it
      tabIndex={0}
      className="relative overflow-x-auto rounded-lg border border-line bg-card"
    >
      <table className="w-full border-collapse text-left text-base">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-sunken">
          <tr>
            {columns.map((column) => {
              const active = sort?.key === column.key;
              const ariaSort = active ? sort?.direction : column.sortable ? 'none' : undefined;
              return (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={ariaSort}
                  className={cn(
                    'px-4 py-2 text-sm font-semibold text-ink',
                    column.align === 'right' && 'text-right',
                  )}
                >
                  {column.sortable && onSort ? (
                    <button
                      type="button"
                      onClick={() => onSort(column.key)}
                      className="inline-flex min-h-11 items-center gap-1.5 rounded-sm font-semibold text-ink"
                    >
                      {column.header}
                      {active ? (
                        sort?.direction === 'ascending' ? (
                          <ArrowUp aria-hidden="true" className="size-4" />
                        ) : (
                          <ArrowDown aria-hidden="true" className="size-4" />
                        )
                      ) : (
                        <ChevronsUpDown aria-hidden="true" className="size-4 text-muted" />
                      )}
                      <span className="sr-only">
                        {active
                          ? sort?.direction === 'ascending'
                            ? t('table.sortedAscending')
                            : t('table.sortedDescending')
                          : t('table.sortable')}
                      </span>
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-6 text-center text-body">
                {emptyText}
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const id = getRowId(row);
              const selected = id === selectedId;
              return (
                <tr key={id} className={cn('border-t border-line', selected && 'bg-selected')}>
                  {columns.map((column, index) => (
                    <td
                      key={column.key}
                      className={cn(
                        'min-h-11 px-4 py-2 align-middle text-ink',
                        column.align === 'right' && 'text-right',
                      )}
                    >
                      {index === 0 && selected ? (
                        <span className="sr-only">{t('status.selected')}: </span>
                      ) : null}
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
