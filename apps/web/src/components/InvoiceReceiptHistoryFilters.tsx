import { TextFilter, ListToolbar, ListSortDropdown, NumberFilter } from '@barghsa/ui';
import { t } from '@barghsa/i18n/workspace';
import { tWorkspace as adminText } from '@barghsa/i18n/workspace-admin';
import {
  HISTORY_SORT_OPTIONS,
  parseNumberRange,
  type HistoryQuery,
} from '@barghsa/shared/validation';
import type { ListQueryBinding } from '../hooks/useListQuery.js';
import { useHistoryFilterDraft } from '../hooks/useHistoryFilterDraft.js';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { HistoryFilterPanel } from './HistoryFilterPanel.js';
import { HistoryDateFilter } from './HistoryDateFilter.js';

export function InvoiceReceiptHistoryFilters({ binding }: { binding: ListQueryBinding }) {
  const locale = useLocale();
  const time = useAccountTime(locale);
  const { filters, search, order } = binding.query;
  const applied = {
    query: { q: search, sort: `submitted_at:${order}` as HistoryQuery['sort'] },
    statuses: filters.state ? [filters.state] : [],
    dateRange: { from: filters.from || undefined, to: filters.to || undefined },
    amountRange: { min: filters.min || undefined, max: filters.max || undefined },
  };
  const draft = useHistoryFilterDraft(applied, (selection) =>
    binding.setQuery({
      search: selection.query.q,
      order: selection.query.sort.endsWith('asc') ? 'asc' : 'desc',
      filters: {
        from: selection.dateRange.from ?? '',
        to: selection.dateRange.to ?? '',
        min: selection.amountRange?.min ?? '',
        max: selection.amountRange?.max ?? '',
      },
    })
  );
  return (
    <HistoryFilterPanel
      {...applied}
      onClear={() =>
        binding.setQuery({
          search: '',
          filters: Object.fromEntries(Object.keys(filters).map((key) => [key, ''])),
        })
      }
      onOpen={draft.begin}
      onApply={draft.apply}
      onRemoveFilter={(key) =>
        binding.setQuery(
          key === 'search'
            ? { search: '' }
            : {
                filters:
                  key === 'status'
                    ? { state: '' }
                    : key === 'date'
                      ? { from: '', to: '' }
                      : { min: '', max: '' },
              }
        )
      }
      statusOptions={['Confirmed', 'Rejected'].map((value) => ({
        value,
        label: t(`invoices.activity.state.${value}`, locale),
      }))}
      dateLabel={adminText('admin.invoiceReceipts.submitted', locale)}
      formatDate={time.format}
      extraChips={
        filters.invoiceId
          ? [
              {
                id: 'invoice',
                label: `${adminText('admin.invoiceReceipts.invoice', locale)}: ${filters.invoiceId}`,
                onRemove: () => binding.setQuery({ filters: { invoiceId: '' } }),
              },
            ]
          : []
      }
    >
      <ListToolbar
        search={
          <TextFilter
            value={draft.draft.query.q}
            onChange={(q) => draft.setQuery({ ...draft.draft.query, q })}
            label={t('historySearch.label', locale)}
            placeholder={t('historySearch.receiptQueue', locale)}
          />
        }
        sort={
          <ListSortDropdown
            value={draft.draft.query.sort}
            onChange={(sort) =>
              draft.setQuery({ ...draft.draft.query, sort: sort as HistoryQuery['sort'] })
            }
            label={t('historySearch.sort', locale)}
            options={HISTORY_SORT_OPTIONS.map((value) => ({
              value,
              label: t(
                value.endsWith('asc') ? 'historySearch.oldest' : 'historySearch.newest',
                locale
              ),
            }))}
          />
        }
      />
      <HistoryDateFilter
        value={draft.draft.dateRange}
        onChange={draft.setDateRange}
        locale={locale}
        time={time}
        label={adminText('admin.invoiceReceipts.submitted', locale)}
      />
      <NumberFilter
        value={draft.draft.amountRange ?? {}}
        onChange={draft.setAmountRange}
        parseRange={parseNumberRange}
        labels={{
          label: t('invoices.filter.amount', locale),
          min: t('invoices.filter.min', locale),
          max: t('invoices.filter.max', locale),
          apply: t('invoices.filter.applyAmount', locale),
          clear: t('invoices.filter.clearAmount', locale),
          invalid: t('invoices.filter.invalidAmount', locale),
        }}
      />
    </HistoryFilterPanel>
  );
}
