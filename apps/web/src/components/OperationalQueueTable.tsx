import type { ReactNode } from 'react';
import type { Locale } from '@barghsa/i18n/app';
import { DataTable } from '@barghsa/ui';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';

export function OperationalQueueTable<T extends { id: string }>({
  locale,
  rows,
  caption,
  scrollLabel,
  nameHeader,
  renderName,
  fields,
  actionHeader,
  renderActions,
  selectionHeader,
  renderSelection,
  cardHeading: CardHeading = 'h3',
  loading,
  emptyMessage,
  tableClassName = 'min-w-[60rem]',
}: {
  locale: Locale;
  rows: T[];
  caption: string;
  scrollLabel: string;
  nameHeader: string;
  renderName: (row: T) => ReactNode;
  fields: { id: string; label: string; render: (row: T) => ReactNode }[];
  actionHeader?: string;
  renderActions?: (row: T) => ReactNode;
  cardHeading?: 'h2' | 'h3';
  selectionHeader?: string;
  renderSelection?: (row: T) => ReactNode;
  loading: boolean;
  emptyMessage: string;
  tableClassName?: string;
}) {
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
          ...(renderSelection
            ? [
                {
                  id: 'select',
                  header: selectionHeader,
                  cell: renderSelection,
                  cellClassName: 'p-3 align-top',
                },
              ]
            : []),
          {
            id: 'name',
            header: nameHeader,
            cell: renderName,
            rowHeader: true,
            cellClassName: 'p-3 align-top font-medium',
          },
          ...fields.map((field) => ({
            id: field.id,
            header: field.label,
            cell: field.render,
            cellClassName: 'p-3 align-top',
          })),
          ...(renderActions
            ? [
                {
                  id: 'actions',
                  header: actionHeader,
                  cell: renderActions,
                  cellClassName: 'p-3 align-top',
                },
              ]
            : []),
        ]}
        renderCard={(row) => (
          <div className="min-w-0 space-y-3 [overflow-wrap:anywhere]">
            <div className="flex items-start justify-between gap-3">
              <CardHeading className="min-w-0 font-semibold">{renderName(row)}</CardHeading>
              {renderSelection?.(row)}
            </div>
            <dl className="space-y-3 text-sm">
              {fields.map((field) => (
                <div key={field.id}>
                  <dt className="font-medium text-muted-foreground">{field.label}</dt>
                  <dd>{field.render(row)}</dd>
                </div>
              ))}
            </dl>
            {renderActions?.(row)}
          </div>
        )}
      />
    </div>
  );
}

export function QueueRecordDetails({
  open,
  onToggle,
  label,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
  children: ReactNode;
}) {
  return (
    <details open={open} className="mt-2 font-sans">
      <summary
        className="cursor-pointer text-muted-foreground"
        onClick={(event) => {
          event.preventDefault();
          onToggle();
        }}
      >
        {label}
      </summary>
      {children}
    </details>
  );
}
