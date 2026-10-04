'use client';

import * as React from 'react';
import { ChevronUpIcon, ChevronDownIcon, ChevronsUpDownIcon } from 'lucide-react';

import { cn } from '../../lib/utils';
import { Checkbox } from '../ui/checkbox';
import { dataTableLabels } from './data-table.labels';

// ─── Types ──────────────────────────────────────────────────────────────────

type SortDirection = 'asc' | 'desc' | false;

interface SortState {
  column: string;
  direction: SortDirection;
}

interface ColumnDef<T> {
  id: string;
  header: string | React.ReactNode;
  accessorKey?: keyof T | string;
  cell?: (row: T, index: number) => React.ReactNode;
  sortable?: boolean;
  className?: string;
  headerClassName?: string;
  cellClassName?: string;
  enableHiding?: boolean;
}

interface DataTableProps<T> {
  locale?: 'en' | 'fa';
  numerals?: 'latn' | 'arabext';
  columns: ColumnDef<T>[];
  data: T[];
  keyExtractor: (row: T) => string | number;
  selectable?: boolean;
  selectedRows?: Set<string | number>;
  onSelectionChange?: (selected: Set<string | number>) => void;
  sortable?: boolean;
  initialSortColumn?: string;
  initialSortDirection?: SortDirection;
  onSortChange?: (sort: SortState | null) => void;
  loading?: boolean;
  emptyMessage?: string;
  className?: string;
  tableClassName?: string;
  headerClassName?: string;
  rowClassName?: string | ((row: T, index: number) => string);
  caption?: string;
  stickyHeader?: boolean;
  rowLabel?: (row: T, index: number) => string;
  renderExpandedRow?: (row: T) => React.ReactNode;
  canExpandRow?: (row: T) => boolean;
  expandedRows?: Set<string | number>;
  onExpansionChange?: (expanded: Set<string | number>) => void;
  /** Providing a card renderer switches to cards below the md breakpoint. */
  renderCard?: (row: T, index: number) => React.ReactNode;
}

interface CardListViewProps<T> {
  data: T[];
  keyExtractor: (row: T) => string | number;
  renderCard: (row: T, index: number) => React.ReactNode;
  locale?: 'en' | 'fa';
  loading?: boolean;
  emptyMessage?: string;
  label?: string;
  className?: string;
}

function CardListView<T>({
  data,
  keyExtractor,
  renderCard,
  locale = 'en',
  loading = false,
  emptyMessage,
  label,
  className,
}: CardListViewProps<T>) {
  const labels = dataTableLabels[locale];
  return (
    // eslint-disable-next-line jsx-a11y/no-redundant-roles -- Safari drops list semantics after the global list-marker reset.
    <ol
      role="list"
      data-slot="card-list-view"
      lang={locale}
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
      aria-label={label ?? labels.records}
      aria-busy={loading}
      className={cn('space-y-3', className)}
    >
      {loading || !data.length ? (
        <li className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
          {loading ? labels.loading : (emptyMessage ?? labels.empty)}
        </li>
      ) : (
        data.map((row, index) => (
          <li key={keyExtractor(row)} className="min-w-0 rounded-lg border bg-card p-4">
            {renderCard(row, index)}
          </li>
        ))
      )}
    </ol>
  );
}

/** Keep native Tab/Enter/Space behavior; arrows move only between sort controls. */
function moveSortFocus(event: React.KeyboardEvent<HTMLElement>, locale: 'en' | 'fa') {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (!(event.target instanceof HTMLButtonElement) || !event.target.hasAttribute('data-table-sort'))
    return;
  const group = event.currentTarget.closest('[data-table-sort-group]');
  if (!group) return;
  const buttons = [...group.querySelectorAll<HTMLButtonElement>('[data-table-sort]')];
  const index = buttons.indexOf(event.target);
  let next: number;
  if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = buttons.length - 1;
  else if (event.key === 'ArrowRight') next = index + (locale === 'fa' ? -1 : 1);
  else if (event.key === 'ArrowLeft') next = index + (locale === 'fa' ? 1 : -1);
  else return;
  event.preventDefault();
  buttons[(next + buttons.length) % buttons.length]?.focus();
}

// ─── Hooks ──────────────────────────────────────────────────────────────────

function useTableSort<T>(
  data: T[],
  columns: ColumnDef<T>[],
  initialSort?: { column: string; direction: SortDirection },
  onSortChange?: (sort: SortState | null) => void,
  locale: 'en' | 'fa' = 'en',
  enabled = true
) {
  const [sort, setSort] = React.useState<SortState | null>(
    initialSort?.direction ? (initialSort as SortState) : null
  );

  const sortedData = React.useMemo(() => {
    if (!enabled || !sort || !sort.direction) return data;
    const col = columns.find((c) => c.id === sort.column);
    if (!col || col.sortable === false) return data;

    return [...data].sort((a, b) => {
      const aVal = col.accessorKey ? (a as Record<string, unknown>)[col.accessorKey as string] : '';
      const bVal = col.accessorKey ? (b as Record<string, unknown>)[col.accessorKey as string] : '';

      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;

      let cmp = 0;
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        cmp = aVal - bVal;
      } else if (aVal instanceof Date && bVal instanceof Date) {
        cmp = aVal.getTime() - bVal.getTime();
      } else {
        cmp = String(aVal).localeCompare(String(bVal), locale, {
          numeric: true,
        });
      }

      return sort.direction === 'desc' ? -cmp : cmp;
    });
  }, [data, sort, columns, locale, enabled]);

  const toggleSort = React.useCallback(
    (columnId: string) => {
      const next: SortState | null =
        sort?.column !== columnId
          ? { column: columnId, direction: 'asc' }
          : sort.direction === 'asc'
            ? { column: columnId, direction: 'desc' }
            : null;
      setSort(next);
      onSortChange?.(next);
    },
    [sort, onSortChange]
  );

  return { sortedData, sort, toggleSort };
}

function useTableSelection<T>(
  data: T[],
  keyExtractor: (row: T) => string | number,
  controlledSelected?: Set<string | number>,
  onSelectionChange?: (selected: Set<string | number>) => void
) {
  const [internalSelected, setSelected] = React.useState<Set<string | number>>(new Set());
  const selected = controlledSelected ?? internalSelected;

  const currentKeys = React.useMemo(() => new Set(data.map(keyExtractor)), [data, keyExtractor]);

  const allSelected = data.length > 0 && data.every((row) => selected.has(keyExtractor(row)));

  const someSelected = !allSelected && data.some((row) => selected.has(keyExtractor(row)));

  const commitSelection = React.useCallback(
    (next: Set<string | number>) => {
      if (controlledSelected === undefined) setSelected(next);
      onSelectionChange?.(next);
    },
    [controlledSelected, onSelectionChange]
  );

  const toggleRow = React.useCallback(
    (key: string | number) => {
      const next = new Set(selected);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      commitSelection(next);
    },
    [selected, commitSelection]
  );

  const toggleAll = React.useCallback(() => {
    const next = new Set(selected);
    for (const key of currentKeys) {
      if (allSelected) next.delete(key);
      else next.add(key);
    }
    commitSelection(next);
  }, [selected, allSelected, currentKeys, commitSelection]);

  return { selected, allSelected, someSelected, toggleRow, toggleAll };
}

// ─── Component ──────────────────────────────────────────────────────────────

function SortIcon({ columnId, currentSort }: { columnId: string; currentSort: SortState | null }) {
  if (currentSort?.column !== columnId) {
    return (
      <ChevronsUpDownIcon
        aria-hidden="true"
        className="ms-1 size-3.5 shrink-0 text-muted-foreground/50"
      />
    );
  }
  if (currentSort.direction === 'asc') {
    return <ChevronUpIcon aria-hidden="true" className="ms-1 size-3.5 shrink-0" />;
  }
  return <ChevronDownIcon aria-hidden="true" className="ms-1 size-3.5 shrink-0" />;
}

function DataTable<T extends object>({
  locale = 'en',
  numerals,
  columns,
  data,
  keyExtractor,
  selectable = false,
  selectedRows: controlledSelected,
  onSelectionChange,
  sortable: enableSort = true,
  initialSortColumn,
  initialSortDirection,
  onSortChange,
  loading = false,
  emptyMessage,
  className,
  tableClassName,
  headerClassName,
  rowClassName,
  caption,
  stickyHeader = true,
  rowLabel,
  renderExpandedRow,
  canExpandRow,
  expandedRows,
  onExpansionChange,
  renderCard,
}: DataTableProps<T>) {
  const labels = dataTableLabels[locale];
  const rowNumbers = React.useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        numberingSystem: numerals ?? (locale === 'fa' ? 'arabext' : 'latn'),
      }),
    [locale, numerals]
  );
  const { sortedData, sort, toggleSort } = useTableSort(
    data,
    columns,
    initialSortColumn
      ? { column: initialSortColumn, direction: initialSortDirection ?? false }
      : undefined,
    onSortChange,
    locale,
    enableSort
  );

  const { selected, allSelected, someSelected, toggleRow, toggleAll } = useTableSelection(
    data,
    keyExtractor,
    controlledSelected,
    onSelectionChange
  );

  const visibleColumns = columns;
  const [internalExpanded, setExpanded] = React.useState<Set<string | number>>(new Set());
  const expanded = expandedRows ?? internalExpanded;
  const instance = React.useId();
  const canExpand = (row: T) => !!renderExpandedRow && (canExpandRow?.(row) ?? true);
  const detailId = (row: T, mode: string) =>
    `${instance}-${mode}-${typeof keyExtractor(row)}-${encodeURIComponent(String(keyExtractor(row)))}`;
  const toggleExpanded = (row: T) => {
    if (loading || !canExpand(row)) return;
    const next = new Set(expanded);
    const key = keyExtractor(row);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    if (expandedRows === undefined) setExpanded(next);
    onExpansionChange?.(next);
  };
  const expander = (row: T, index: number, mode: string) => {
    if (!canExpand(row)) return null;
    const open = expanded.has(keyExtractor(row));
    const name = rowLabel?.(row, index) ?? rowNumbers.format(index + 1);
    return (
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? detailId(row, mode) : undefined}
        aria-label={open ? labels.collapseRow(name) : labels.expandRow(name)}
        onClick={() => toggleExpanded(row)}
        className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-md border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        {open ? (
          <ChevronUpIcon aria-hidden="true" className="size-4" />
        ) : (
          <ChevronDownIcon aria-hidden="true" className="size-4" />
        )}
      </button>
    );
  };
  const span = visibleColumns.length + Number(selectable) + Number(!!renderExpandedRow);

  return (
    <>
      <p role="status" className="sr-only">
        {loading ? labels.loading : labels.rowCount(rowNumbers.format(sortedData.length))}
      </p>
      <div
        lang={locale}
        dir={locale === 'fa' ? 'rtl' : 'ltr'}
        className={cn(
          'relative w-full overflow-auto rounded-lg border',
          renderCard && 'hidden md:block',
          className
        )}
      >
        <table aria-busy={loading} className={cn('w-full caption-bottom text-sm', tableClassName)}>
          <caption className="sr-only">{caption ?? labels.records}</caption>
          <thead
            data-table-sort-group=""
            className={cn(
              '[&_tr]:border-b',
              stickyHeader && 'sticky top-0 z-10 bg-card',
              headerClassName
            )}
          >
            <tr className="border-b transition-colors">
              {renderExpandedRow && (
                <th scope="col" className="w-12 px-2">
                  <span className="sr-only">{labels.details}</span>
                </th>
              )}
              {selectable && (
                <th className="h-10 w-10 px-2 text-start align-middle">
                  <Checkbox
                    disabled={loading || data.length === 0}
                    checked={allSelected}
                    indeterminate={someSelected}
                    onCheckedChange={toggleAll}
                    aria-label={allSelected ? labels.deselectAll : labels.selectAll}
                  />
                </th>
              )}
              {visibleColumns.map((col) => (
                <th
                  scope="col"
                  key={col.id}
                  className={cn(
                    'h-10 px-3 text-start align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pe-0',
                    col.sortable !== false && enableSort && 'cursor-pointer select-none',
                    col.headerClassName
                  )}
                  aria-sort={
                    col.sortable !== false && enableSort
                      ? sort?.column === col.id
                        ? sort.direction === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : 'none'
                      : undefined
                  }
                >
                  {col.sortable !== false && enableSort ? (
                    <button
                      type="button"
                      data-table-sort=""
                      onKeyDown={(event) => moveSortFocus(event, locale)}
                      onClick={() => toggleSort(col.id)}
                      className="inline-flex items-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {col.header}
                      <SortIcon columnId={col.id} currentSort={sort} />
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="[&_tr:last-child]:border-0">
            {loading ? (
              <tr>
                <td colSpan={span} className="h-24 px-3 text-center text-muted-foreground">
                  {labels.loading}
                </td>
              </tr>
            ) : sortedData.length === 0 ? (
              <tr>
                <td colSpan={span} className="h-24 px-3 text-center text-muted-foreground">
                  {emptyMessage ?? labels.empty}
                </td>
              </tr>
            ) : (
              sortedData.map((row, index) => {
                const key = keyExtractor(row);
                return (
                  <React.Fragment key={key}>
                    <tr
                      className={cn(
                        'border-b transition-colors hover:bg-muted/50 data-[state-selected]:bg-muted/50',
                        typeof rowClassName === 'function' ? rowClassName(row, index) : rowClassName
                      )}
                      data-state-selected={selected.has(key) ? 'selected' : undefined}
                      aria-selected={selectable ? selected.has(key) : undefined}
                    >
                      {renderExpandedRow && (
                        <td className="px-2 py-2 align-middle">{expander(row, index, 'table')}</td>
                      )}
                      {selectable && (
                        <td className="w-10 px-2 py-2 align-middle">
                          <Checkbox
                            checked={selected.has(key)}
                            onCheckedChange={() => toggleRow(key)}
                            aria-label={labels.selectRow(rowNumbers.format(index + 1))}
                          />
                        </td>
                      )}
                      {visibleColumns.map((col) => (
                        <td
                          key={col.id}
                          className={cn('px-3 py-2 align-middle', col.cellClassName)}
                        >
                          {col.cell
                            ? col.cell(row as T, index)
                            : col.accessorKey
                              ? (((row as Record<string, unknown>)[
                                  col.accessorKey as string
                                ] as React.ReactNode) ?? '-')
                              : '-'}
                        </td>
                      ))}
                    </tr>
                    {canExpand(row) && expanded.has(key) && (
                      <tr>
                        <td colSpan={span} className="border-t bg-muted/30 p-4">
                          <div id={detailId(row, 'table')}>{renderExpandedRow?.(row)}</div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {renderCard && (
        <div lang={locale} dir={locale === 'fa' ? 'rtl' : 'ltr'} className="space-y-3 md:hidden">
          {enableSort && (
            <div
              role="group"
              aria-label={labels.sortBy}
              data-table-sort-group=""
              className="flex flex-wrap gap-2"
            >
              {visibleColumns
                .filter((col) => col.sortable !== false)
                .map((col) => (
                  <button
                    key={col.id}
                    type="button"
                    data-table-sort=""
                    onKeyDown={(event) => moveSortFocus(event, locale)}
                    onClick={() => toggleSort(col.id)}
                    className="inline-flex min-h-9 items-center gap-1 rounded-md border bg-card px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    aria-pressed={sort?.column === col.id}
                  >
                    {col.header}
                    <SortIcon columnId={col.id} currentSort={sort} />
                    <span className="sr-only">
                      {sort?.column === col.id
                        ? sort.direction === 'asc'
                          ? labels.ascending
                          : labels.descending
                        : labels.unsorted}
                    </span>
                  </button>
                ))}
            </div>
          )}
          {selectable && (
            <div className="flex items-center gap-3 px-3 py-2 text-sm">
              <Checkbox
                disabled={loading || !data.length}
                checked={allSelected}
                indeterminate={someSelected}
                onCheckedChange={toggleAll}
                aria-label={allSelected ? labels.deselectAll : labels.selectAll}
              />
              <span>{allSelected ? labels.deselectAll : labels.selectAll}</span>
            </div>
          )}
          <CardListView
            data={sortedData}
            keyExtractor={keyExtractor}
            locale={locale}
            loading={loading}
            {...(emptyMessage !== undefined ? { emptyMessage } : {})}
            {...(caption !== undefined ? { label: caption } : {})}
            renderCard={(row, index) => (
              <div className="space-y-3 [overflow-wrap:anywhere]">
                {(selectable || canExpand(row)) && (
                  <div className="flex items-center justify-between gap-3">
                    {selectable && (
                      <Checkbox
                        checked={selected.has(keyExtractor(row))}
                        onCheckedChange={() => toggleRow(keyExtractor(row))}
                        aria-label={labels.selectRow(rowNumbers.format(index + 1))}
                      />
                    )}
                    {expander(row, index, 'card')}
                  </div>
                )}
                {renderCard(row, index)}
                {canExpand(row) && expanded.has(keyExtractor(row)) && (
                  <div id={detailId(row, 'card')} className="border-t pt-3">
                    {renderExpandedRow?.(row)}
                  </div>
                )}
              </div>
            )}
          />
        </div>
      )}
    </>
  );
}

export { DataTable, CardListView, useTableSort, useTableSelection, SortIcon };
export type { ColumnDef, SortState, SortDirection, DataTableProps, CardListViewProps };
