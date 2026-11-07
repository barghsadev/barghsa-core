import type { HistoryColumn } from './HistoryTable.js';

/** Use the same record projections in cards and desktop cells. */
export function RecordFields<Item>({
  item,
  columns,
}: {
  item: Item;
  columns: readonly HistoryColumn<Item>[];
}) {
  return (
    <dl className="space-y-2 text-sm [overflow-wrap:anywhere]">
      {columns.map((column) => (
        <div key={column.id}>
          <dt className="font-medium text-muted-foreground">{column.label}</dt>
          <dd>{column.render(item)}</dd>
        </div>
      ))}
    </dl>
  );
}
