import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { DatePicker } from '../../../../../packages/ui/src/components/base-ui/date-picker';

function Fixture() {
  const params = new URLSearchParams(location.search);
  const [locale, setLocale] = React.useState<'en' | 'fa'>('en');
  const [date, setDate] = React.useState<Date | undefined>(new Date(2026, 2, 22, 12));
  const [range, setRange] = React.useState<{ from: Date | undefined; to?: Date } | undefined>({
    from: date,
  });
  const shared = {
    locale,
    minDate: new Date(2026, 2, 21, 12),
    maxDate: new Date(2026, 2, 23, 12),
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
        {JSON.stringify(params.has('range') ? range : date)}
      </output>
      <DatePicker locale={locale} />
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Fixture />);
