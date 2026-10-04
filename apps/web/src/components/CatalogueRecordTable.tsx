import type { ReactNode } from 'react';
import { DataTable, TextCell } from '@barghsa/ui';
import type { Locale } from '@barghsa/i18n/app';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';

interface CatalogueRecord {
  id: string;
  title: string;
  description: string;
}

/** Query controls own ordering; this presentation never re-sorts a server result. */
export function CatalogueRecordTable<T extends CatalogueRecord>({
  rows,
  locale,
  caption,
  nameLabel,
  detailsLabel,
  actionsLabel,
  renderDetails,
  renderActions,
}: {
  rows: T[];
  locale: Locale;
  caption: string;
  nameLabel: string;
  detailsLabel: string;
  actionsLabel: string;
  renderDetails: (row: T) => ReactNode;
  renderActions: (row: T) => ReactNode;
}) {
  const { numberStyle } = useNumberFormatting(locale);
  const numerals =
    numberStyle === 'western'
      ? 'latn'
      : numberStyle === 'persian'
        ? 'arabext'
        : locale === 'fa'
          ? 'arabext'
          : 'latn';
  const name = (row: T) => (
    <div className="min-w-0 space-y-2">
      <h2 className="font-semibold">
        <TextCell value={row.title} />
      </h2>
      <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
        <TextCell value={row.description} />
      </p>
    </div>
  );
  const actions = (row: T) => <div className="flex flex-wrap gap-2">{renderActions(row)}</div>;
  return (
    <DataTable
      locale={locale}
      numerals={numerals}
      caption={caption}
      data={rows}
      keyExtractor={(row) => row.id}
      sortable={false}
      className="max-h-[32rem]"
      tableClassName="min-w-[42rem] table-fixed"
      columns={[
        {
          id: 'name',
          header: nameLabel,
          cell: name,
          headerClassName: 'w-[40%]',
          cellClassName: 'align-top p-4',
        },
        {
          id: 'details',
          header: detailsLabel,
          cell: renderDetails,
          headerClassName: 'w-[30%]',
          cellClassName: 'align-top p-4 [overflow-wrap:anywhere]',
        },
        {
          id: 'actions',
          header: actionsLabel,
          cell: actions,
          headerClassName: 'w-[30%]',
          cellClassName: 'align-top p-4',
        },
      ]}
      renderCard={(row) => (
        <div className="space-y-4">
          {name(row)}
          <div className="space-y-2 text-sm [overflow-wrap:anywhere]">{renderDetails(row)}</div>
          {actions(row)}
        </div>
      )}
    />
  );
}
