import '@barghsa/ui/styles.css';
import { DirectionProvider } from '@barghsa/ui/direction-provider';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ComboBox,
  ComboBoxInput,
  ComboBoxTrigger,
  ComboBoxPopup,
  ComboBoxItem,
  MultiSelect,
  MultiSelectInput,
  MultiSelectPopup,
  MultiSelectItem,
  MultiSelectChips,
  MultiSelectChip,
} from '@barghsa/ui';

const params = new URLSearchParams(location.search);
const fa = params.get('locale') === 'fa';
document.documentElement.lang = fa ? 'fa' : 'en';
document.documentElement.dir = fa ? 'rtl' : 'ltr';
document.documentElement.classList.toggle('dark', params.get('theme') === 'dark');
const items = fa ? ['عمومی', 'صورتحساب', 'سفارش‌ها'] : ['General', 'Billing', 'Orders'];
function Fixture() {
  const [selected, setSelected] = useState<string[]>([]);
  const [submitted, setSubmitted] = useState('');
  return (
    <DirectionProvider dir={fa ? 'rtl' : 'ltr'}>
      <main className="p-8 space-y-6">
        <h1>{fa ? 'آزمایش فرم' : 'Form checks'}</h1>
        <p id="font-sample">{fa ? 'متن فارسی' : 'English text'}</p>
        <p lang={fa ? 'en' : 'fa'} id="nested-language">
          {fa ? 'English text' : 'متن فارسی'}
        </p>
        <code className="font-mono">sample code</code>
        <form
          className="space-y-6"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            setSubmitted(
              JSON.stringify({ category: data.get('category'), topics: data.getAll('topics') })
            );
          }}
        >
          <ComboBox items={items} name="category" required>
            <label htmlFor="category">{fa ? 'دسته‌بندی' : 'Category'}</label>
            <ComboBoxInput id="category" />
            <ComboBoxTrigger
              aria-label={fa ? 'نمایش دسته‌ها' : 'Show categories'}
              render={<button type="button" data-custom-trigger="true" />}
            />
            <ComboBoxPopup>
              {(item: string) => (
                <ComboBoxItem key={item} value={item}>
                  {item}
                </ComboBoxItem>
              )}
            </ComboBoxPopup>
          </ComboBox>
          <MultiSelect
            multiple
            items={items}
            name="topics"
            required
            value={selected}
            onValueChange={setSelected}
          >
            <label htmlFor="topics">{fa ? 'موضوع‌ها' : 'Topics'}</label>
            <MultiSelectChips>
              {selected.map((item) => (
                <MultiSelectChip key={item} removeLabel={fa ? `حذف ${item}` : `Remove ${item}`}>
                  {item}
                </MultiSelectChip>
              ))}
              <MultiSelectInput id="topics" />
            </MultiSelectChips>
            <MultiSelectPopup>
              {(item: string) => (
                <MultiSelectItem key={item} value={item}>
                  {item}
                </MultiSelectItem>
              )}
            </MultiSelectPopup>
          </MultiSelect>
          <ComboBox items={items} name="disabled" disabled defaultValue={items[0]}>
            <ComboBoxInput aria-label={fa ? 'غیرفعال' : 'Disabled'} />
          </ComboBox>
          <button type="submit">{fa ? 'ارسال' : 'Submit'}</button>
        </form>
        <output aria-label="Submitted values">{submitted}</output>
        <button
          onClick={() => {
            document.documentElement.lang = fa ? 'en' : 'fa';
          }}
        >
          Switch language
        </button>
      </main>
    </DirectionProvider>
  );
}
createRoot(document.getElementById('root')!).render(<Fixture />);
