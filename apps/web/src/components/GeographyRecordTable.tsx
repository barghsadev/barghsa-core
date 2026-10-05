import type { ReactNode } from 'react';
import { DataTable, TextCell } from '@barghsa/ui';
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
  headingLevel = 2,
}: {
  rows: T[];
  caption: string;
  emptyMessage: string;
  tableClassName: string;
  loading: boolean;
  error: boolean;
  renderActions: (row: T) => ReactNode;
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
            cell: faName,
            rowHeader: locale === 'fa',
            cellClassName: 'p-3 align-top',
          },
          {
            id: 'nameEn',
            header: t('nameEn'),
            cell: enName,
            rowHeader: locale === 'en',
            cellClassName: 'p-3 align-top',
          },
          {
            id: 'status',
            header: t('status'),
            cell: (row) => t(row.status),
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
            <Heading className="font-semibold">
              {locale === 'fa' ? faName(row) : enName(row)}
            </Heading>
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="font-medium text-muted-foreground">
                  {t(locale === 'fa' ? 'nameEn' : 'nameFa')}
                </dt>
                <dd>{locale === 'fa' ? enName(row) : faName(row)}</dd>
              </div>
              <div>
                <dt className="font-medium text-muted-foreground">{t('status')}</dt>
                <dd>{t(row.status)}</dd>
              </div>
            </dl>
            {renderActions(row)}
          </div>
        )}
      />
    </div>
  );
}
