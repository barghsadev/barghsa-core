"use client"

import * as React from "react"
import {
  ChevronUpIcon,
  ChevronDownIcon,
  ChevronsUpDownIcon,
} from "lucide-react"

import { cn } from "../../lib/utils"
import { Checkbox } from "../ui/checkbox"

// ─── Types ──────────────────────────────────────────────────────────────────

type SortDirection = "asc" | "desc" | false

interface SortState {
  column: string
  direction: SortDirection
}

interface ColumnDef<T> {
  id: string
  header: string | React.ReactNode
  accessorKey?: keyof T | string
  cell?: (row: T, index: number) => React.ReactNode
  sortable?: boolean
  className?: string
  headerClassName?: string
  cellClassName?: string
  enableHiding?: boolean
}

interface DataTableProps<T> {
  columns: ColumnDef<T>[]
  data: T[]
  keyExtractor: (row: T) => string | number
  selectable?: boolean
  selectedRows?: Set<string | number>
  onSelectionChange?: (selected: Set<string | number>) => void
  sortable?: boolean
  initialSortColumn?: string
  initialSortDirection?: SortDirection
  onSortChange?: (sort: SortState | null) => void
  loading?: boolean
  emptyMessage?: string
  className?: string
  tableClassName?: string
  headerClassName?: string
  rowClassName?: string | ((row: T, index: number) => string)
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
  )

  const sortedData = React.useMemo(() => {
    if (!sort || !sort.direction) return data
    const col = columns.find((c) => c.id === sort.column)
    if (!col || col.sortable === false) return data

    return [...data].sort((a, b) => {
      const aVal = col.accessorKey
        ? (a as Record<string, unknown>)[col.accessorKey as string]
        : ""
      const bVal = col.accessorKey
        ? (b as Record<string, unknown>)[col.accessorKey as string]
        : ""

      if (aVal == null) return 1
      if (bVal == null) return -1

      let cmp = 0
      if (typeof aVal === "number" && typeof bVal === "number") {
        cmp = aVal - bVal
      } else if (aVal instanceof Date && bVal instanceof Date) {
        cmp = aVal.getTime() - bVal.getTime()
      } else {
        cmp = String(aVal).localeCompare(String(bVal), undefined, {
          numeric: true,
        })
      }

      return sort.direction === "desc" ? -cmp : cmp
    })
  }, [data, sort, columns])

  const toggleSort = React.useCallback(
    (columnId: string) => {
      setSort((prev) => {
        let next: SortState | null

        if (prev?.column !== columnId) {
          next = { column: columnId, direction: "asc" }
        } else if (prev.direction === "asc") {
          next = { column: columnId, direction: "desc" }
        } else {
          next = null
        }

        onSortChange?.(next)
        return next
      })
    },
    [onSortChange]
  )

  return { sortedData, sort, toggleSort }
}

function useTableSelection<T>(
  data: T[],
  keyExtractor: (row: T) => string | number,
  initialSelected?: Set<string | number>,
  onSelectionChange?: (selected: Set<string | number>) => void
) {
  const [selected, setSelected] = React.useState<Set<string | number>>(
    initialSelected ?? new Set()
  )

  const currentKeys = React.useMemo(
    () => new Set(data.map(keyExtractor)),
    [data, keyExtractor]
  )

  const allSelected =
    data.length > 0 && data.every((row) => selected.has(keyExtractor(row)))

  const someSelected =
    !allSelected && data.some((row) => selected.has(keyExtractor(row)))

  const toggleRow = React.useCallback(
    (key: string | number) => {
      setSelected((prev) => {
        const next = new Set(prev)
        if (next.has(key)) {
          next.delete(key)
        } else {
          next.add(key)
        }
        onSelectionChange?.(next)
        return next
      })
    },
    [onSelectionChange]
  )

  const toggleAll = React.useCallback(() => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allSelected) {
        for (const key of currentKeys) next.delete(key)
      } else {
        for (const key of currentKeys) next.add(key)
      }
      onSelectionChange?.(next)
      return next
    })
  }, [allSelected, currentKeys, onSelectionChange])

  return { selected, allSelected, someSelected, toggleRow, toggleAll }
}

// ─── Component ──────────────────────────────────────────────────────────────

function SortIcon({
  columnId,
  currentSort,
}: {
  columnId: string
  currentSort: SortState | null
}) {
  if (currentSort?.column !== columnId) {
    return (
      <ChevronsUpDownIcon className="ml-1 size-3.5 shrink-0 text-muted-foreground/50" />
    )
  }
  if (currentSort.direction === "asc") {
    return <ChevronUpIcon className="ml-1 size-3.5 shrink-0" />
  }
  return <ChevronDownIcon className="ml-1 size-3.5 shrink-0" />
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
  emptyMessage = "No results",
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
  )

  const { selected, allSelected, someSelected, toggleRow, toggleAll } =
    useTableSelection(
      data,
      keyExtractor,
      controlledSelected,
      onSelectionChange
    )

  const visibleColumns = columns.filter((col) => col.enableHiding !== false)

  return (
    <div
      className={cn("relative w-full overflow-auto rounded-lg border", className)}
    >
      <table
        className={cn("w-full caption-bottom text-sm", tableClassName)}
      >
        <thead className={cn("[&_tr]:border-b", headerClassName)}>
          <tr className="border-b transition-colors">
            {selectable && (
              <th className="h-10 w-10 px-2 text-left align-middle">
                <Checkbox
                  checked={allSelected}
                  indeterminate={someSelected}
                  onCheckedChange={toggleAll}
                  aria-label={
                    allSelected ? "Deselect all rows" : "Select all rows"
                  }
                />
              </th>
            )}
            {visibleColumns.map((col) => (
              <th
                key={col.id}
                className={cn(
                  "h-10 px-3 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0",
                  col.sortable !== false &&
                    enableSort &&
                    "cursor-pointer select-none",
                  col.headerClassName
                )}
                onClick={() => {
                  if (col.sortable !== false && enableSort) {
                    toggleSort(col.id)
                  }
                }}
              >
                <div className="inline-flex items-center">
                  {col.header}
                  {col.sortable !== false && enableSort && (
                    <SortIcon columnId={col.id} currentSort={sort} />
                  )}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&_tr:last-child]:border-0">
          {loading ? (
            <tr>
              <td
                colSpan={
                  selectable
                    ? visibleColumns.length + 1
                    : visibleColumns.length
                }
                className="h-24 px-3 text-center text-muted-foreground"
              >
                Loading...
              </td>
            </tr>
          ) : sortedData.length === 0 ? (
            <tr>
              <td
                colSpan={
                  selectable
                    ? visibleColumns.length + 1
                    : visibleColumns.length
                }
                className="h-24 px-3 text-center text-muted-foreground"
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            sortedData.map((row, index) => {
              const key = keyExtractor(row)
              return (
                <tr
                  key={key}
                  className={cn(
                    "border-b transition-colors hover:bg-muted/50 data-[state-selected]:bg-muted/50",
                    typeof rowClassName === "function"
                      ? rowClassName(row, index)
                      : rowClassName
                  )}
                  data-state-selected={
                    selected.has(key) ? "selected" : undefined
                  }
                  aria-selected={
                    selectable ? selected.has(key) : undefined
                  }
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
                    <td
                      key={col.id}
                      className={cn("px-3 py-2 align-middle", col.cellClassName)}
                    >
                      {col.cell
                        ? col.cell(row as T, index)
                        : col.accessorKey
                          ? (row[col.accessorKey as string] as React.ReactNode) ??
                            "-"
                          : "-"}
                    </td>
                  ))}
                </tr>
              )
            })
          )}
        </tbody>
      </table>
    </div>
  )
}

export { DataTable, useTableSort, useTableSelection, SortIcon }
export type { ColumnDef, SortState, SortDirection, DataTableProps }