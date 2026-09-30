import { DateRangeFilter, type DateRangeValue } from '@barghsa/ui';
import { t } from '@barghsa/i18n/app';
import type { useAccountTime } from '../hooks/useAccountTime.js';

export function HistoryDateFilter({
  value,
  onChange,
  locale,
  time,
}: {
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
  locale: 'en' | 'fa';
  time: Pick<ReturnType<typeof useAccountTime>, 'timezone' | 'status'>;
}) {
  const copy = (key: string) => t(`historyDates.${key}`, locale);
  return (
    <DateRangeFilter
      value={value}
      onChange={onChange}
      locale={locale}
      timezone={time.timezone}
      disabled={time.status !== 'ready'}
      labels={{
        label: copy('label'),
        preset: copy('preset'),
        today: copy('today'),
        last7: copy('last7'),
        thisMonth: copy('thisMonth'),
        lastMonth: copy('lastMonth'),
        custom: copy('custom'),
        start: copy('start'),
        end: copy('end'),
        apply: copy('apply'),
        clear: copy('clear'),
        invalid: copy('invalid'),
      }}
    />
  );
}
