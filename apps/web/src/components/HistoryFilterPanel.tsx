import type { ReactNode } from 'react';
import { ListFilterPanel, type ListFilterChip } from '@barghsa/ui';
import { t } from '@barghsa/i18n/app';
import type { DateRangeFilterValue, NumberRangeValue } from '@barghsa/shared/validation';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import type { HistoryFilterKey } from '../lib/history-filter-state.js';

export function HistoryFilterPanel({
  query,
  statuses,
  dateRange,
  amountRange,
  onClear,
  onApply,
  onOpen,
  onRemoveFilter,
  statusOptions = [],
  dateLabel,
  formatDate = (value) => value,
  serviceLabel,
  children,
  extraChips = [],
}: {
  query: { q: string; serviceType?: string | undefined };
  statuses: readonly string[];
  dateRange: DateRangeFilterValue;
  amountRange?: NumberRangeValue | undefined;
  onClear?: (() => void) | undefined;
  onApply?: (() => void) | undefined;
  onOpen?: (() => void) | undefined;
  onRemoveFilter?: ((key: HistoryFilterKey, value?: string) => void) | undefined;
  statusOptions?: readonly { value: string; label: string }[];
  dateLabel?: string;
  formatDate?: (value: string) => string;
  serviceLabel?: string;
  children: ReactNode;
  extraChips?: readonly ListFilterChip[];
}) {
  const locale = useLocale();
  const profileRevision = useProfileContextRevision();
  const numbers = useNumberFormatting(locale);
  if (!onClear) return children;
  const activeCount =
    [
      query.q,
      query.serviceType,
      statuses.length,
      dateRange.from || dateRange.to,
      amountRange?.min || amountRange?.max,
    ].filter(Boolean).length + extraChips.length;
  const countLabel = numbers.number(activeCount);
  const chips: ListFilterChip[] = [...extraChips];
  const add = (id: string, label: string, key: HistoryFilterKey, value?: string) => {
    if (onRemoveFilter) chips.push({ id, label, onRemove: () => onRemoveFilter(key, value) });
  };
  if (query.q) add('search', `${t('historySearch.label', locale)}: ${query.q}`, 'search');
  for (const status of statuses)
    add(
      `status:${status}`,
      statusOptions.find((option) => option.value === status)?.label ?? status,
      'status',
      status
    );
  if (dateRange.from || dateRange.to) {
    const bounds = [
      dateRange.from && `${t('historyFilters.since', locale)} ${formatDate(dateRange.from)}`,
      dateRange.to && `${t('historyFilters.before', locale)} ${formatDate(dateRange.to)}`,
    ]
      .filter(Boolean)
      .join(' · ');
    add('date', `${dateLabel ?? t('historyDates.label', locale)}: ${bounds}`, 'date');
  }
  if (amountRange?.min || amountRange?.max) {
    const bounds = [
      amountRange.min && `${t('invoices.filter.min', locale)} ${numbers.money(amountRange.min)}`,
      amountRange.max && `${t('invoices.filter.max', locale)} ${numbers.money(amountRange.max)}`,
    ]
      .filter(Boolean)
      .join(' · ');
    add('amount', `${t('invoices.filter.amount', locale)}: ${bounds}`, 'amount');
  }
  if (query.serviceType) add('service', serviceLabel ?? query.serviceType, 'service');
  return (
    <ListFilterPanel
      activeCount={activeCount}
      countLabel={countLabel}
      labels={{
        filters: t('historyFilters.label', locale),
        clear: t('historyFilters.clearAll', locale),
        activeCount: t('historyFilters.activeCount', locale).replace('{count}', countLabel),
        selected: t('historyFilters.selected', locale),
        remove: t('historyFilters.remove', locale),
      }}
      drawer={
        onApply && onOpen
          ? {
              resetKey: JSON.stringify([
                profileRevision,
                query,
                statuses,
                dateRange,
                amountRange,
                extraChips.map(({ id, label }) => [id, label]),
              ]),
              onApply,
              onOpen,
              dir: locale === 'fa' ? 'rtl' : 'ltr',
              labels: {
                apply: t('historyFilters.apply', locale),
                cancel: t('historyFilters.cancel', locale),
                close: t('historyFilters.close', locale),
                description: t('historyFilters.description', locale),
              },
            }
          : undefined
      }
      onClear={onClear}
      chips={chips}
    >
      {children}
    </ListFilterPanel>
  );
}
