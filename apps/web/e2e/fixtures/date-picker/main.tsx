import '@barghsa/ui/styles.css';
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { DatePicker } from '../../../../../packages/ui/src/components/base-ui/date-picker';

function Fixture() {
  const params = new URLSearchParams(location.search);
  const dst = params.has('dst');
  const [locale, setLocale] = React.useState<'en' | 'fa'>(params.has('fa') ? 'fa' : 'en');
  const [date, setDate] = React.useState<Date | undefined>(
    dst
      ? new Date('2026-03-07T05:00:00Z')
      : params.has('timezone')
        ? new Date('2026-03-20T21:00:00Z')
        : new Date(2026, 2, 22, 12)
  );
  const [range, setRange] = React.useState<{ from: Date | undefined; to?: Date } | undefined>({
    from: params.has('empty') ? undefined : date,
  });
  const shared = {
    locale,
    numerals: params.has('latin') ? ('latn' as const) : undefined,
    timezone: dst ? 'America/New_York' : (params.get('timezone') ?? undefined),
    minDate: dst
      ? new Date('2026-03-07T05:00:00Z')
      : params.has('timezone')
        ? new Date('2026-03-20T20:30:00Z')
        : new Date(2026, 2, 21, 12),
    maxDate: dst
      ? new Date('2026-03-09T04:00:00Z')
      : params.has('timezone')
        ? new Date('2026-03-22T20:30:00Z')
        : new Date(2026, 2, 23, 12),
    label: 'Delivery date',
    disabled: params.has('disabled'),
    error: params.has('error') ? 'Choose an allowed date' : undefined,
  };
  return (
    <main dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <button onClick={() => setLocale(locale === 'en' ? 'fa' : 'en')}>Switch language</button>
      {params.has('range') ? (
        <DatePicker {...shared} calendarMode="range" value={range} onChange={setRange} />
      ) : (
        <DatePicker {...shared} value={date} onChange={setDate} />
      )}
      <output aria-label="Stored value">
        {JSON.stringify(
          params.has('range')
            ? {
                from: range?.from && new Date(range.from.getTime()),
                to: range?.to && new Date(range.to.getTime()),
              }
            : date && new Date(date.getTime())
        )}
      </output>
      <DatePicker locale={locale} />
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Fixture />);
