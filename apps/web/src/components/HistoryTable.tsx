import type { ReactNode } from 'react';
import { cn, ScrollArea } from '@barghsa/ui';
import type { LucideIcon } from 'lucide-react';

export function TableCellDetails({
  fields,
  icon: Icon,
}: {
  fields: readonly { id: string; label: string; value: ReactNode }[];
  icon?: LucideIcon | undefined;
}) {
  return (
    <div data-slot="table-cell-details" className="flex min-w-36 items-start gap-2.5">
      {Icon && <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
      <dl className="min-w-0 space-y-1">
        {fields.map(({ id, label, value }) => (
          <div key={id} className="flex flex-wrap items-baseline gap-x-2">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="min-w-0 wrap-anywhere">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export interface HistoryColumn<Item> {
  id: string;
  label: string;
  render: (item: Item) => ReactNode;
  actions?: boolean;
}

/** URL filters/sorting own the data; this table only presents the loaded cursor pages. */
export function HistoryTable<Item>({
  caption,
  items,
  columns,
  rowKey,
}: {
  caption: string;
  items: readonly Item[];
  columns: readonly HistoryColumn<Item>[];
  rowKey: (item: Item) => string;
}) {
  const orderedColumns = [
    ...columns.filter((column) => !column.actions),
    ...columns.filter((column) => column.actions),
  ];
  return (
    <ScrollArea
      role="region"
      aria-label={caption}
      scrollbarOrientation="horizontal"
      className="min-w-0 max-w-full rounded-xl border bg-card"
    >
      <table className="w-full text-start text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="border-b bg-muted/40">
          <tr>
            {orderedColumns.map((column) => (
              <th
                key={column.id}
                scope="col"
                data-table-actions={column.actions ? '' : undefined}
                className="whitespace-nowrap px-4 py-3 text-start font-medium"
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {items.map((item) => (
            <tr key={rowKey(item)} className="hover:bg-muted/40 focus-within:bg-muted/40">
              {orderedColumns.map((column, index) => {
                const Cell = index === 0 ? 'th' : 'td';
                return (
                  <Cell
                    key={column.id}
                    scope={index === 0 ? 'row' : undefined}
                    data-table-actions={column.actions ? '' : undefined}
                    className={cn(
                      'min-w-28 px-4 py-3 text-start align-top',
                      index === 0 && 'font-semibold'
                    )}
                  >
                    {column.render(item)}
                  </Cell>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollArea>
  );
}
