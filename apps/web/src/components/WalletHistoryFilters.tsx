import { ListToolbar, TextFilter, ListSortDropdown, NumberFilter } from '@barghsa/ui';
import { t, type Locale } from '@barghsa/i18n/workspace';
import {
  HISTORY_SORT_OPTIONS,
  parseNumberRange,
  type HistoryQuery,
} from '@barghsa/shared/validation';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useHistoryFilterDraft } from '../hooks/useHistoryFilterDraft.js';
import type { ListQueryBinding } from '../hooks/useListQuery.js';
import { walletHistoryStates, walletHistoryTypes } from '../lib/wallet-history-query.js';
import { HistoryFilterPanel } from './HistoryFilterPanel.js';
import { lazy, Suspense } from 'react';

const HistoryDateFilter = lazy(() =>
  import('./HistoryDateFilter.js').then((module) => ({ default: module.HistoryDateFilter }))
);

export function WalletHistoryFilters({
  binding,
  locale,
}: {
  binding: ListQueryBinding;
  locale: Locale;
}) {
  const time = useAccountTime(locale);
  const { filters, search, order } = binding.query;
  const label = (key: string) => t(`wallet.history.${key}`, locale);
  const applied = {
    query: {
      q: search,
      sort: `submitted_at:${order}` as HistoryQuery['sort'],
      serviceType: filters.type || undefined,
    },
    statuses: filters.state ? [filters.state] : [],
    dateRange: { from: filters.from || undefined, to: filters.to || undefined },
    amountRange: { min: filters.min || undefined, max: filters.max || undefined },
  };
  const draft = useHistoryFilterDraft(applied, (selection) =>
    binding.setQuery({
      search: selection.query.q,
      order: selection.query.sort.endsWith('asc') ? 'asc' : 'desc',
      filters: {
        type: selection.query.serviceType ?? '',
        state: selection.statuses[0] ?? '',
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
      onOpen={draft.begin}
      onApply={draft.apply}
      onClear={() =>
        binding.setQuery({
          search: '',
          cursor: '',
          filters: Object.fromEntries(Object.keys(filters).map((key) => [key, ''])),
        })
      }
      onRemoveFilter={(key) =>
        binding.setQuery(
          key === 'search'
            ? { search: '' }
            : {
                filters:
                  key === 'status'
                    ? { state: '' }
                    : key === 'service'
                      ? { type: '' }
                      : key === 'date'
                        ? { from: '', to: '' }
                        : { min: '', max: '' },
              }
        )
      }
      serviceLabel={filters.type ? label(`type.${filters.type}`) : ''}
      statusOptions={walletHistoryStates.map((value) => ({
        value,
        label: label(`state.${value}`),
      }))}
      dateLabel={label('date')}
      formatDate={time.format}
    >
      <ListToolbar
        search={
          <TextFilter
            value={draft.draft.query.q}
            onChange={(q) => draft.setQuery({ ...draft.draft.query, q })}
            label={t('historySearch.label', locale)}
            placeholder={label('search')}
          />
        }
        sort={
          <ListSortDropdown
            value={draft.draft.query.sort}
            onChange={(sort) =>
              draft.setQuery({ ...draft.draft.query, sort: sort as HistoryQuery['sort'] })
            }
            label={label('sort')}
            options={HISTORY_SORT_OPTIONS.map((value) => ({
              value,
              label: label(value.endsWith('asc') ? 'oldest' : 'newest'),
            }))}
          />
        }
      />
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-sm">
          {label('type')}
          <select
            className="min-h-10 rounded-md border bg-background px-3"
            name="type"
            value={draft.draft.query.serviceType ?? ''}
            onChange={(event) =>
              draft.setQuery({ ...draft.draft.query, serviceType: event.target.value || undefined })
            }
          >
            <option value="">{label('all')}</option>
            {walletHistoryTypes.map((value) => (
              <option key={value} value={value}>
                {label(`type.${value}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {label('state')}
          <select
            className="min-h-10 rounded-md border bg-background px-3"
            name="state"
            value={draft.draft.statuses[0] ?? ''}
            onChange={(event) => draft.setStatuses(event.target.value ? [event.target.value] : [])}
          >
            <option value="">{label('all')}</option>
            {walletHistoryStates.map((value) => (
              <option key={value} value={value}>
                {label(`state.${value}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Suspense fallback={<p role="status">{label('loading')}</p>}>
        <HistoryDateFilter
          value={draft.draft.dateRange}
          onChange={draft.setDateRange}
          time={time}
          locale={locale}
          label={label('date')}
        />
      </Suspense>
      <NumberFilter
        value={draft.draft.amountRange ?? {}}
        onChange={draft.setAmountRange}
        parseRange={parseNumberRange}
        labels={{
          label: label('amountMagnitude'),
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
