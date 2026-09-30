import type { ReactNode } from 'react';
import { ScrollArea } from '@barghsa/ui';

export interface HistoryColumn<Item> {
  id: string;
  label: string;
  render: (item: Item) => ReactNode;
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
            {columns.map((column) => (
              <th
                key={column.id}
                scope="col"
                className="whitespace-nowrap px-4 py-3 text-start font-medium"
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {items.map((item) => (
            <tr key={rowKey(item)}>
              {columns.map((column) => (
                <td key={column.id} className="min-w-32 px-4 py-3 align-top">
                  {column.render(item)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollArea>
  );
}
