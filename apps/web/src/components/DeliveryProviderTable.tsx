import type { ReactNode } from 'react';
import { DataTable, TextCell } from '@barghsa/ui';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';

export function DeliveryProviderTable<T extends { id: string; label: string }>({
  rows,
  caption,
  scrollLabel,
  labelHeader,
  actionHeader,
  fields,
  renderActions,
  loading,
  emptyMessage,
  tableClassName,
}: {
  rows: T[];
  caption: string;
  scrollLabel: string;
  labelHeader: string;
  actionHeader: string;
  fields: { id: string; label: string; render: (row: T) => ReactNode }[];
  renderActions: (row: T) => ReactNode;
  loading: boolean;
  emptyMessage: string;
  tableClassName: string;
}) {
  const locale = useLocale();
  const { numberStyle } = useNumberFormatting(locale);
  return (
    <div aria-busy={loading || undefined}>
      <DataTable
        locale={locale}
        numerals={
          numberStyle === 'western'
            ? 'latn'
            : numberStyle === 'persian'
              ? 'arabext'
              : locale === 'fa'
                ? 'arabext'
                : 'latn'
        }
        data={rows}
        keyExtractor={(row) => row.id}
        caption={caption}
        scrollLabel={scrollLabel}
        sortable={false}
        emptyMessage={emptyMessage}
        className="max-h-[36rem] bg-card text-card-foreground"
        tableClassName={tableClassName}
        columns={[
          {
            id: 'label',
            header: labelHeader,
            cell: (row) => <TextCell value={row.label} />,
            rowHeader: true,
            cellClassName: 'p-3 align-top font-medium',
          },
          ...fields.map((field) => ({
            id: field.id,
            header: field.label,
            cell: field.render,
            cellClassName: 'p-3 align-top',
          })),
          {
            id: 'actions',
            header: actionHeader,
            cell: renderActions,
            cellClassName: 'p-3 align-top',
          },
        ]}
        renderCard={(row) => (
          <div className="min-w-0 space-y-3 [overflow-wrap:anywhere]">
            <h2 className="font-semibold">
              <TextCell value={row.label} />
            </h2>
            <dl className="space-y-3 text-sm">
              {fields.map((field) => (
                <div key={field.id}>
                  <dt className="font-medium text-muted-foreground">{field.label}</dt>
                  <dd>{field.render(row)}</dd>
                </div>
              ))}
            </dl>
            {renderActions(row)}
          </div>
        )}
      />
    </div>
  );
}
