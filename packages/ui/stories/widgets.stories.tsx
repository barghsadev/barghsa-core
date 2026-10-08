import { useContext, useState } from 'react';
import type { Story } from '@ladle/react';
import type { DateRange } from 'react-day-picker';
import { faIR, enUS } from 'react-day-picker/locale';
import * as UI from '../src/index';
import { StoryLocale, useStoryText } from './story-context';
export const BooleanControls: Story = () => {
  const text = useStoryText();
  const [checked, setChecked] = useState(false);
  const [on, setOn] = useState(false);
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <UI.Checkbox id="check" checked={checked} onCheckedChange={setChecked} />
        <UI.Label htmlFor="check">{text('نمایش جزئیات', 'Show details')}</UI.Label>
      </div>
      <div className="flex items-center gap-3">
        <UI.Checkbox id="mixed" indeterminate />
        <UI.Label htmlFor="mixed">{text('انتخاب بخشی', 'Partial selection')}</UI.Label>
      </div>
      <div className="flex items-center gap-3">
        <UI.Checkbox id="disabled-check" disabled />
        <UI.Label htmlFor="disabled-check">{text('غیرفعال', 'Disabled')}</UI.Label>
      </div>
      {(['sm', 'default'] as const).map((size) => (
        <div key={size} className="flex items-center gap-3">
          <UI.Switch id={'switch-' + size} size={size} checked={on} onCheckedChange={setOn} />
          <UI.Label htmlFor={'switch-' + size}>{size}</UI.Label>
        </div>
      ))}
      <UI.RadioGroup defaultValue="one" aria-label={text('انتخاب گزینه', 'Choose option')}>
        {['one', 'two', 'disabled'].map((value) => (
          <div key={value} className="flex items-center gap-3">
            <UI.RadioGroupItem
              value={value}
              id={'radio-' + value}
              disabled={value === 'disabled'}
            />
            <UI.Label htmlFor={'radio-' + value}>{value}</UI.Label>
          </div>
        ))}
      </UI.RadioGroup>
    </div>
  );
};
export const Sliders: Story = () => {
  const text = useStoryText();
  return (
    <div className="max-w-lg space-y-8">
      <UI.Slider defaultValue={35} step={5} aria-label={text('درصد', 'Percentage')} />
      <UI.Slider
        defaultValue={[20, 80]}
        thumbLabels={[text('شروع', 'Start'), text('پایان', 'End')]}
      />
      <UI.Slider disabled defaultValue={50} aria-label={text('غیرفعال', 'Disabled')} />
      <div className="h-48">
        <UI.Slider
          orientation="vertical"
          defaultValue={40}
          aria-label={text('عمودی', 'Vertical')}
        />
      </div>
    </div>
  );
};
export const Numbers: Story = () => {
  const locale = useContext(StoryLocale),
    text = useStoryText();
  const [value, setValue] = useState<number | null>(1234.5);
  return (
    <div className="max-w-sm space-y-5">
      <UI.Label htmlFor="number">{text('مقدار', 'Quantity')}</UI.Label>
      <UI.NumberField
        id="number"
        locale={locale === 'fa' ? 'fa-IR' : 'en-US'}
        value={value}
        onValueChange={setValue}
        min={0}
        max={5000}
        step={0.5}
        format={{ maximumFractionDigits: 2 }}
      >
        <UI.NumberFieldGroup>
          <UI.NumberFieldDecrement />
          <UI.NumberFieldInput />
          <UI.NumberFieldIncrement />
        </UI.NumberFieldGroup>
      </UI.NumberField>
      <output>{value}</output>
    </div>
  );
};
export const Choices: Story = () => {
  const text = useStoryText();
  const items = [text('تهران', 'Tehran'), text('شیراز', 'Shiraz'), text('تبریز', 'Tabriz')];
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <div className="max-w-sm space-y-5">
      <UI.ComboBox items={items} value={selected} onValueChange={setSelected}>
        <UI.ComboBoxLabel>{text('شهر', 'City')}</UI.ComboBoxLabel>
        <UI.ComboBoxInput aria-label={text('شهر', 'City')} />
        <UI.ComboBoxClear clearLabel={text('پاک‌کردن شهر', 'Clear city')} />
        <UI.ComboBoxPopup emptyMessage={text('نتیجه‌ای یافت نشد', 'No results')}>
          {(item: string) => (
            <UI.ComboBoxItem key={item} value={item}>
              {item}
            </UI.ComboBoxItem>
          )}
        </UI.ComboBoxPopup>
      </UI.ComboBox>
      <UI.NativeSelect aria-label={text('انتخاب بومی', 'Native select')}>
        <UI.NativeSelectOptGroup label={text('شهرها', 'Cities')}>
          {items.map((item) => (
            <UI.NativeSelectOption key={item}>{item}</UI.NativeSelectOption>
          ))}
        </UI.NativeSelectOptGroup>
      </UI.NativeSelect>
      <output>{selected}</output>
    </div>
  );
};
export const MultipleChoices: Story = () => {
  const text = useStoryText();
  const items = ['Thermal', 'Green', 'Saving'];
  const [values, setValues] = useState<string[]>(['Thermal']);
  return (
    <div className="max-w-md space-y-5">
      <UI.MultiSelect multiple items={items} value={values} onValueChange={setValues}>
        <UI.Label htmlFor="choices">{text('خدمات', 'Services')}</UI.Label>
        <UI.MultiSelectChips>
          {values.map((value) => (
            <UI.MultiSelectChip key={value} removeLabel={text('حذف ', 'Remove ') + value}>
              {value}
            </UI.MultiSelectChip>
          ))}
          <UI.MultiSelectInput id="choices" />
        </UI.MultiSelectChips>
        <UI.MultiSelectClear clearLabel={text('پاک‌کردن انتخاب‌ها', 'Clear choices')} />
        <UI.MultiSelectPopup emptyMessage={text('نتیجه‌ای یافت نشد', 'No results')}>
          {(item: string) => (
            <UI.MultiSelectItem key={item} value={item}>
              {item}
            </UI.MultiSelectItem>
          )}
        </UI.MultiSelectPopup>
      </UI.MultiSelect>
      <output>{values.join(', ')}</output>
    </div>
  );
};
export const Dates: Story = () => {
  const locale = useContext(StoryLocale),
    text = useStoryText();
  const [date, setDate] = useState<Date | undefined>(new Date('2026-10-08T08:00:00Z'));
  const [range, setRange] = useState<DateRange | undefined>();
  return (
    <div className="max-w-md space-y-5">
      <UI.DatePicker
        value={date}
        onChange={setDate}
        locale={locale}
        label={text('تاریخ', 'Date')}
      />
      <UI.DatePicker
        calendarMode="range"
        value={range}
        onChange={setRange}
        locale={locale}
        label={text('بازه تاریخ', 'Date range')}
      />
      <UI.DateTimePicker
        value={date}
        onChange={setDate}
        locale={locale}
        label={text('تاریخ و زمان', 'Date and time')}
      />
      <UI.DatePicker disabled locale={locale} label={text('غیرفعال', 'Disabled')} />
      <UI.DatePicker
        error={text('تاریخ نامعتبر', 'Invalid date')}
        locale={locale}
        label={text('خطا', 'Error')}
      />
    </div>
  );
};
const rows = [
  { id: 'two', name: 'Beta', amount: '1100000' },
  { id: 'one', name: 'Alpha', amount: '9007199254740993123' },
];
export const Tables: Story = () => {
  const locale = useContext(StoryLocale),
    text = useStoryText();
  const [selected, setSelected] = useState<Set<string | number>>(new Set());
  const [mode, setMode] = useState('rows');
  return (
    <div className="space-y-5">
      <UI.NativeSelect
        aria-label="Table state"
        value={mode}
        onChange={(e) => setMode(e.target.value)}
      >
        {['rows', 'empty', 'loading'].map((value) => (
          <UI.NativeSelectOption key={value}>{value}</UI.NativeSelectOption>
        ))}
      </UI.NativeSelect>
      <UI.DataTable
        locale={locale}
        data={mode === 'empty' ? [] : rows}
        loading={mode === 'loading'}
        selectable
        selectedRows={selected}
        onSelectionChange={setSelected}
        keyExtractor={(r) => r.id}
        caption={text('جدول نمونه', 'Sample records')}
        scrollLabel={text('رکوردها', 'Records')}
        emptyMessage={text('رکوردی یافت نشد', 'No records')}
        columns={[
          {
            id: 'name',
            header: text('نام', 'Name'),
            accessorKey: 'name',
            rowHeader: true,
            sortable: true,
          },
          {
            id: 'amount',
            header: text('مبلغ', 'Amount'),
            cell: (r) => (
              <UI.CurrencyCell
                amount={r.amount}
                format={(amount) => new Intl.NumberFormat(locale).format(BigInt(amount))}
              />
            ),
          },
        ]}
        renderExpandedRow={(r) => <p>{r.name} · details</p>}
        renderCard={(r) => (
          <UI.Card>
            <UI.CardContent>{r.name}</UI.CardContent>
          </UI.Card>
        )}
      />
      <output>{selected.size}</output>
    </div>
  );
};

export const Calendars: Story = () => {
  const locale = useContext(StoryLocale);
  const [date, setDate] = useState<Date | undefined>();
  const [range, setRange] = useState<DateRange | undefined>();
  return (
    <div className="flex flex-wrap gap-8">
      <UI.Calendar
        mode="single"
        selected={date}
        onSelect={setDate}
        locale={locale === 'fa' ? faIR : enUS}
        defaultMonth={new Date('2026-10-08T08:00:00Z')}
      />
      <UI.Calendar
        mode="range"
        selected={range}
        onSelect={setRange}
        locale={locale === 'fa' ? faIR : enUS}
        defaultMonth={new Date('2026-10-08T08:00:00Z')}
      />
    </div>
  );
};
