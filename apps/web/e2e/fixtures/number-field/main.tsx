import '@barghsa/ui/styles.css';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  NumberField,
  NumberFieldGroup,
  NumberFieldInput,
  NumberFieldIncrement,
  NumberFieldDecrement,
} from '@barghsa/ui';

function Fixture() {
  const params = new URLSearchParams(location.search);
  const [locale, setLocale] = useState(params.get('locale') ?? 'fa-IR');
  const [value, setValue] = useState<number | null>(1);
  document.documentElement.classList.toggle('dark', params.get('theme') === 'dark');
  return (
    <main className="p-8">
      <NumberField locale={locale} value={value} min={0} max={2} onValueChange={setValue}>
        <NumberFieldGroup>
          <NumberFieldDecrement />
          <NumberFieldInput aria-label={locale.startsWith('fa') ? 'تعداد' : 'Quantity'} />
          <NumberFieldIncrement
            {...(params.has('custom') ? { 'aria-label': 'Add one unit' } : {})}
          />
        </NumberFieldGroup>
      </NumberField>
      <output aria-label="Stored value">{value}</output>
      <button onClick={() => setLocale(locale.startsWith('fa') ? 'en-US' : 'fa-IR')}>
        Switch language
      </button>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<Fixture />);
