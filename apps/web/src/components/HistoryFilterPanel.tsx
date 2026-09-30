import type { ReactNode } from 'react';
import { ListFilterPanel } from '@barghsa/ui';
import { t } from '@barghsa/i18n/app';
import type { DateRangeFilterValue, NumberRangeValue } from '@barghsa/shared/validation';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';

export function HistoryFilterPanel({
  query,
  statuses,
  dateRange,
  amountRange,
  onClear,
  children,
}: {
  query: { q: string; serviceType?: string | undefined };
  statuses: readonly string[];
  dateRange: DateRangeFilterValue;
  amountRange?: NumberRangeValue | undefined;
  onClear?: (() => void) | undefined;
  children: ReactNode;
}) {
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  if (!onClear) return children;
  const activeCount = [
    query.q,
    query.serviceType,
    statuses.length,
    dateRange.from || dateRange.to,
    amountRange?.min || amountRange?.max,
  ].filter(Boolean).length;
  const countLabel = numbers.number(activeCount);
  return (
    <ListFilterPanel
      activeCount={activeCount}
      countLabel={countLabel}
      labels={{
        filters: t('historyFilters.label', locale),
        clear: t('historyFilters.clearAll', locale),
        activeCount: t('historyFilters.activeCount', locale).replace('{count}', countLabel),
      }}
      onClear={onClear}
    >
      {children}
    </ListFilterPanel>
  );
}
