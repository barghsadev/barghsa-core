import type { ReactNode } from 'react';
import { Badge, DataTable, TextCell } from '@barghsa/ui';
import { geographyText } from '@barghsa/i18n/geography';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import type { Province } from '../lib/geography-api.js';

export function GeographyRecordTable<T extends Province>({
  rows,
  caption,
  emptyMessage,
  tableClassName,
  loading,
  error,
  renderActions,
  renderName,
  headingLevel = 2,
}: {
  rows: T[];
  caption: string;
  emptyMessage: string;
  tableClassName: string;
  loading: boolean;
  error: boolean;
  renderActions: (row: T) => ReactNode;
  renderName?: (row: T, name: ReactNode) => ReactNode;
  headingLevel?: 2 | 3;
}) {
  const locale = useLocale();
  const { numberStyle } = useNumberFormatting(locale);
  const t = (key: Parameters<typeof geographyText>[0]) => geographyText(key, locale);
  const Heading = headingLevel === 3 ? 'h3' : 'h2';
  const faName = (row: T) => (
    <span lang="fa" dir="rtl">
      <TextCell value={row.nameFa} />
    </span>
  );
  const enName = (row: T) => (
    <span lang="en" dir="ltr">
      <TextCell value={row.nameEn} />
    </span>
  );
  const primaryName = (row: T) => {
    const name = locale === 'fa' ? faName(row) : enName(row);
    return renderName ? renderName(row, name) : name;
  };
  const status = (row: T) => (
    <Badge variant={row.status === 'active' ? 'secondary' : 'outline'}>{t(row.status)}</Badge>
  );
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
        scrollLabel={t('tableScroll').replace('{name}', caption)}
        sortable={false}
        emptyMessage={loading || error ? '' : emptyMessage}
        className="max-h-[32rem] bg-card text-card-foreground"
        tableClassName={tableClassName}
        columns={[
          {
            id: 'nameFa',
            header: t('nameFa'),
            cell: locale === 'fa' ? primaryName : faName,
            rowHeader: locale === 'fa',
            cellClassName: 'p-3 align-top',
          },
          {
            id: 'nameEn',
            header: t('nameEn'),
            cell: locale === 'en' ? primaryName : enName,
            rowHeader: locale === 'en',
            cellClassName: 'p-3 align-top',
          },
          {
            id: 'status',
            header: t('status'),
            cell: status,
            cellClassName: 'p-3 align-top',
          },
          {
            id: 'actions',
            header: t('actions'),
            cell: renderActions,
            cellClassName: 'p-3 align-top',
          },
        ]}
        renderCard={(row) => (
          <div className="min-w-0 space-y-3 [overflow-wrap:anywhere]">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <Heading className="min-w-0 font-semibold">{primaryName(row)}</Heading>
              {status(row)}
            </div>
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="font-medium text-muted-foreground">
                  {t(locale === 'fa' ? 'nameEn' : 'nameFa')}
                </dt>
                <dd>{locale === 'fa' ? enName(row) : faName(row)}</dd>
              </div>
            </dl>
            {renderActions(row)}
          </div>
        )}
      />
    </div>
  );
}
