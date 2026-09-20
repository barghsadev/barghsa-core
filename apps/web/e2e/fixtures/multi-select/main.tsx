import '@barghsa/ui/styles.css';
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import {
  MultiSelect,
  MultiSelectInput,
  MultiSelectPopup,
  MultiSelectItem,
  MultiSelectChips,
  MultiSelectChip,
} from '../../../../../packages/ui/src/components/base-ui/multi-select';

function Fixture() {
  const params = new URLSearchParams(location.search);
  const fa = params.has('fa');
  const fruits = fa ? ['سیب', 'موز', 'گیلاس'] : ['Apple', 'Banana', 'Cherry'];
  const [selected, setSelected] = React.useState<string[]>([fruits[0]!]);
  return (
    <main lang={fa ? 'fa' : 'en'} dir={fa ? 'rtl' : 'ltr'}>
      <MultiSelect
        multiple
        items={fruits}
        value={selected}
        onValueChange={setSelected}
        disabled={params.has('disabled')}
        readOnly={params.has('readonly')}
      >
        <label htmlFor="fruits">{fa ? 'میوه' : 'Fruit'}</label>
        <MultiSelectChips>
          {selected.map((fruit) => (
            <MultiSelectChip key={fruit} removeLabel={fa ? `حذف ${fruit}` : `Remove ${fruit}`}>
              {fruit}
            </MultiSelectChip>
          ))}
          <MultiSelectInput id="fruits" />
        </MultiSelectChips>
        <MultiSelectPopup>
          {(fruit: string) => (
            <MultiSelectItem key={fruit} value={fruit}>
              {fruit}
            </MultiSelectItem>
          )}
        </MultiSelectPopup>
      </MultiSelect>
      <output aria-label="Selected values">{selected.join(',')}</output>
      <button>After control</button>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<Fixture />);
