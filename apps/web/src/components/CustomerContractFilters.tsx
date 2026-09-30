import type { HistoryFilterKey } from '../lib/history-filter-state.js';
import { HistoryFilterPanel } from './HistoryFilterPanel.js';
import { t } from '@barghsa/i18n/app';
import { contractText } from '@barghsa/i18n/contracts';
import { ListSortDropdown, SelectFilter, StatusFilter, TextFilter } from '@barghsa/ui';
import {
  CUSTOMER_CONTRACT_STATUSES,
  CONTRACT_SERVICE_TYPES,
  type ContractListQuery,
  type DateRangeFilterValue,
} from '@barghsa/shared/validation';
import { HistoryDateFilter } from './HistoryDateFilter.js';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';

export interface CustomerContractHistoryControls {
  query: ContractListQuery;
  statuses: readonly string[];
  dateRange: DateRangeFilterValue;
  onQueryChange: (query: ContractListQuery) => void;
  onClear?: (() => void) | undefined;
  onRemoveFilter?: ((key: HistoryFilterKey, value?: string) => void) | undefined;
  onStatusesChange: (statuses: string[]) => void;
  onDateRangeChange: (range: DateRangeFilterValue) => void;
}

export function CustomerContractFilters({ history }: { history: CustomerContractHistoryControls }) {
  const locale = useLocale(),
    time = useAccountTime(locale),
    numbers = useNumberFormatting(locale);
  const copy = (key: string) => t(`contractHistory.${key}`, locale);
  const statusOptions: Parameters<typeof StatusFilter>[0]['options'] =
    CUSTOMER_CONTRACT_STATUSES.map((value) => ({
      value,
      label: contractText(value, locale),
      tone:
        value === 'Active' || value === 'Completed'
          ? 'success'
          : value === 'Cancelled'
            ? 'destructive'
            : 'warning',
    }));
  return (
    <HistoryFilterPanel
      query={history.query}
      statuses={history.statuses}
      dateRange={history.dateRange}
      onClear={history.onClear}
      onRemoveFilter={history.onRemoveFilter}
      statusOptions={statusOptions}
      formatDate={(value) => time.format(value, { dateStyle: 'medium', timeStyle: 'short' })}
      dateLabel={copy('published')}
      serviceLabel={
        contractText('serviceType', locale) +
        ': ' +
        contractText(history.query.serviceType ?? 'all', locale)
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <TextFilter
          label={t('historySearch.label', locale)}
          placeholder={copy('search')}
          value={history.query.q}
          onChange={(q) => history.onQueryChange({ ...history.query, q })}
        />
        <ListSortDropdown
          label={t('historySearch.sort', locale)}
          value={history.query.sort}
          onChange={(sort) =>
            history.onQueryChange({ ...history.query, sort: sort as ContractListQuery['sort'] })
          }
          options={(['published_at:desc', 'published_at:asc'] as const).map((value) => ({
            value,
            label: copy(value.endsWith('desc') ? 'newest' : 'oldest'),
          }))}
        />
      </div>
      <SelectFilter
        label={contractText('serviceType', locale)}
        allLabel={contractText('all', locale)}
        emptyLabel={copy('noOptions')}
        value={history.query.serviceType ?? ''}
        onChange={(serviceType) =>
          history.onQueryChange({
            ...history.query,
            serviceType: serviceType
              ? (serviceType as ContractListQuery['serviceType'])
              : undefined,
          })
        }
        options={CONTRACT_SERVICE_TYPES.map((value) => ({
          value,
          label: contractText(value, locale),
        }))}
      />
      <HistoryDateFilter
        value={history.dateRange}
        onChange={history.onDateRangeChange}
        locale={locale}
        time={time}
        label={copy('published')}
      />
      <StatusFilter
        label={copy('state')}
        clearLabel={copy('clearState')}
        countLabel={numbers.number(history.statuses.length)}
        value={history.statuses}
        onChange={history.onStatusesChange}
        options={statusOptions}
      />
    </HistoryFilterPanel>
  );
}
