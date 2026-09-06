'use client';

import * as React from 'react';
import { ChevronUpIcon, ChevronDownIcon, ChevronsUpDownIcon } from 'lucide-react';

import { cn } from '../../lib/utils';
import { Checkbox } from '../ui/checkbox';

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
}

// ─── Hooks ──────────────────────────────────────────────────────────────────

function useTableSort<T>(
  data: T[],
  columns: ColumnDef<T>[],
  initialSort?: { column: string; direction: SortDirection },
  onSortChange?: (sort: SortState | null) => void
) {
  const [sort, setSort] = React.useState<SortState | null>(
    initialSort?.direction ? (initialSort as SortState) : null
  );

  const sortedData = React.useMemo(() => {
    if (!sort || !sort.direction) return data;
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
        cmp = String(aVal).localeCompare(String(bVal), undefined, {
          numeric: true,
        });
      }

      return sort.direction === 'desc' ? -cmp : cmp;
    });
  }, [data, sort, columns]);

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
    return <ChevronsUpDownIcon className="ml-1 size-3.5 shrink-0 text-muted-foreground/50" />;
  }
  if (currentSort.direction === 'asc') {
    return <ChevronUpIcon className="ml-1 size-3.5 shrink-0" />;
  }
  return <ChevronDownIcon className="ml-1 size-3.5 shrink-0" />;
}

function DataTable<T extends Record<string, unknown>>({
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
  emptyMessage = 'No results',
  className,
  tableClassName,
  headerClassName,
  rowClassName,
}: DataTableProps<T>) {
  const { sortedData, sort, toggleSort } = useTableSort(
    data,
    columns,
    initialSortColumn
      ? { column: initialSortColumn, direction: initialSortDirection ?? false }
      : undefined,
    onSortChange
  );

  const { selected, allSelected, someSelected, toggleRow, toggleAll } = useTableSelection(
    data,
    keyExtractor,
    controlledSelected,
    onSelectionChange
  );

  const visibleColumns = columns;

  return (
    <div className={cn('relative w-full overflow-auto rounded-lg border', className)}>
      <table className={cn('w-full caption-bottom text-sm', tableClassName)}>
        <thead className={cn('[&_tr]:border-b', headerClassName)}>
          <tr className="border-b transition-colors">
            {selectable && (
              <th className="h-10 w-10 px-2 text-left align-middle">
                <Checkbox
                  checked={allSelected}
                  indeterminate={someSelected}
                  onCheckedChange={toggleAll}
                  aria-label={allSelected ? 'Deselect all rows' : 'Select all rows'}
                />
              </th>
            )}
            {visibleColumns.map((col) => (
              <th
                key={col.id}
                className={cn(
                  'h-10 px-3 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0',
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
              <td
                colSpan={selectable ? visibleColumns.length + 1 : visibleColumns.length}
                className="h-24 px-3 text-center text-muted-foreground"
              >
                Loading...
              </td>
            </tr>
          ) : sortedData.length === 0 ? (
            <tr>
              <td
                colSpan={selectable ? visibleColumns.length + 1 : visibleColumns.length}
                className="h-24 px-3 text-center text-muted-foreground"
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            sortedData.map((row, index) => {
              const key = keyExtractor(row);
              return (
                <tr
                  key={key}
                  className={cn(
                    'border-b transition-colors hover:bg-muted/50 data-[state-selected]:bg-muted/50',
                    typeof rowClassName === 'function' ? rowClassName(row, index) : rowClassName
                  )}
                  data-state-selected={selected.has(key) ? 'selected' : undefined}
                  aria-selected={selectable ? selected.has(key) : undefined}
                >
                  {selectable && (
                    <td className="w-10 px-2 py-2 align-middle">
                      <Checkbox
                        checked={selected.has(key)}
                        onCheckedChange={() => toggleRow(key)}
                        aria-label={`Select row ${index + 1}`}
                      />
                    </td>
                  )}
                  {visibleColumns.map((col) => (
                    <td key={col.id} className={cn('px-3 py-2 align-middle', col.cellClassName)}>
                      {col.cell
                        ? col.cell(row as T, index)
                        : col.accessorKey
                          ? ((row[col.accessorKey as string] as React.ReactNode) ?? '-')
                          : '-'}
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

export { DataTable, useTableSort, useTableSelection, SortIcon };
export type { ColumnDef, SortState, SortDirection, DataTableProps };
