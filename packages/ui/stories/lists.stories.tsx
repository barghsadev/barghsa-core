import { useContext, useState } from 'react';
import type { Story } from '@ladle/react';
import * as UI from '../src/index';
import { StoryLocale, useStoryText } from './story-context';
export const Filters: Story = () => {
  const locale = useContext(StoryLocale),
    text = useStoryText();
  const [search, setSearch] = useState('');
  const [choice, setChoice] = useState('');
  const [multiple, setMultiple] = useState<string[]>([]);
  const [status, setStatus] = useState<string[]>([]);
  const [range, setRange] = useState<Parameters<typeof UI.NumberFilter>[0]['value']>({});
  const [dates, setDates] = useState<UI.DateRangeValue>({});
  const options = [
    { value: 'one', label: text('گزینه یک', 'Option one') },
    { value: 'two', label: text('گزینه دو', 'Option two') },
  ];
  return (
    <div className="max-w-2xl space-y-5">
      <UI.ListFilterPanel
        activeCount={Number(!!search) + multiple.length}
        countLabel={String(Number(!!search) + multiple.length)}
        onClear={() => {
          setSearch('');
          setMultiple([]);
          setChoice('');
          setStatus([]);
          setRange({});
          setDates({});
        }}
        labels={{
          filters: text('فیلترها', 'Filters'),
          clear: text('پاک کردن', 'Clear'),
          activeCount: text('فیلترهای فعال', 'Active filters'),
          selected: text('انتخاب شده', 'Selected'),
          remove: text('حذف {filter}', 'Remove {filter}'),
        }}
      >
        <UI.TextFilter value={search} onChange={setSearch} label={text('جستجو', 'Search')} />
        <UI.SelectFilter
          value={choice}
          onChange={setChoice}
          options={options}
          label={text('انتخاب', 'Selection')}
          allLabel={text('همه', 'All')}
          emptyLabel={text('نتیجه‌ای یافت نشد', 'No results')}
        />
        <UI.MultiSelectFilter
          value={multiple}
          onChange={setMultiple}
          options={options}
          label={text('چند انتخاب', 'Multiple selections')}
          emptyLabel={text('نتیجه‌ای یافت نشد', 'No results')}
          clearLabel={text('پاک کردن انتخاب‌ها', 'Clear selections')}
          removeLabel={(label) => text('حذف ', 'Remove ') + label}
        />
        <UI.StatusFilter
          value={status}
          onChange={setStatus}
          options={[
            { value: 'ready', label: text('آماده', 'Ready'), tone: 'success' },
            { value: 'pending', label: text('در انتظار', 'Pending'), tone: 'warning' },
          ]}
          label={text('وضعیت', 'Status')}
          clearLabel={text('پاک کردن وضعیت', 'Clear status')}
          countLabel={String(status.length)}
        />
        <UI.NumberFilter
          value={range}
          onChange={setRange}
          parseRange={(min, max) => {
            if (
              (min && !/^[0-9]+$/.test(min)) ||
              (max && !/^[0-9]+$/.test(max)) ||
              (min && max && BigInt(min) > BigInt(max))
            )
              return null;
            return { min: min || undefined, max: max || undefined };
          }}
          labels={{
            label: text('مبلغ', 'Amount'),
            min: text('حداقل', 'Minimum'),
            max: text('حداکثر', 'Maximum'),
            apply: text('اعمال', 'Apply'),
            clear: text('پاک کردن مبلغ', 'Clear amount'),
            invalid: text('بازه نامعتبر', 'Invalid range'),
          }}
        />
        <UI.DateRangeFilter
          locale={locale}
          timezone="Asia/Tehran"
          value={dates}
          onChange={setDates}
          labels={{
            label: text('بازه تاریخ', 'Date range'),
            preset: text('بازه آماده', 'Preset'),
            today: text('امروز', 'Today'),
            last7: text('هفت روز گذشته', 'Last seven days'),
            thisMonth: text('این ماه', 'This month'),
            lastMonth: text('ماه گذشته', 'Last month'),
            custom: text('سفارشی', 'Custom'),
            start: text('شروع', 'Start'),
            end: text('پایان', 'End'),
            apply: text('اعمال تاریخ', 'Apply dates'),
            clear: text('پاک کردن تاریخ', 'Clear dates'),
            invalid: text('بازه نامعتبر', 'Invalid range'),
          }}
        />
      </UI.ListFilterPanel>
      <output>{JSON.stringify({ search, choice, multiple, status, range, dates })}</output>
    </div>
  );
};
export const ListLayout: Story = () => {
  const text = useStoryText();
  const [mode, setMode] = useState('ready');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('name');
  const [page, setPage] = useState(1);
  return (
    <UI.ListPage>
      <UI.ListPage.Toolbar
        search={
          <UI.TextFilter value={search} onChange={setSearch} label={text('جستجو', 'Search')} />
        }
        sort={
          <UI.ListSortDropdown
            value={sort}
            onChange={setSort}
            label={text('ترتیب', 'Sort')}
            options={[
              { value: 'name', label: text('نام', 'Name') },
              { value: 'date', label: text('تاریخ', 'Date') },
            ]}
          />
        }
        actions={
          <UI.NativeSelect
            aria-label={text('وضعیت فهرست', 'List state')}
            value={mode}
            onChange={(e) => setMode(e.target.value)}
          >
            {['ready', 'loading', 'error', 'empty'].map((v) => (
              <UI.NativeSelectOption key={v}>{v}</UI.NativeSelectOption>
            ))}
          </UI.NativeSelect>
        }
      />
      <UI.ListPage.Content
        loading={mode === 'loading'}
        error={mode === 'error'}
        empty={mode === 'empty'}
        loadingView={<UI.PageLoading label={text('در حال دریافت', 'Loading')} />}
        errorView={
          <UI.ErrorState
            title={text('دریافت نشد', 'Could not load')}
            description={text('دوباره تلاش کنید.', 'Try again.')}
            retryLabel={text('تلاش دوباره', 'Retry')}
            onRetry={() => setMode('ready')}
            supportContact={<a href="#support">{text('پشتیبانی', 'Support')}</a>}
          />
        }
        emptyView={
          <UI.EmptyState
            title={text('رکوردی نیست', 'No records')}
            description={text('فیلتر را تغییر دهید', 'Change the filter')}
          />
        }
      >
        <UI.Card>
          <UI.CardContent>
            {text('رکورد نمونه', 'Sample record')} · {page}
          </UI.CardContent>
        </UI.Card>
      </UI.ListPage.Content>
      <UI.ListPage.Pagination
        kind="cursor"
        hasMore={page < 3}
        loading={false}
        onNext={() => setPage((n) => n + 1)}
        label={text('صفحه‌بندی', 'Pagination')}
        nextLabel={text('بعدی', 'Next')}
        previous={{
          enabled: page > 1,
          label: text('قبلی', 'Previous'),
          onClick: () => setPage((n) => n - 1),
        }}
      />
    </UI.ListPage>
  );
};
export const Cells: Story = () => {
  const locale = useContext(StoryLocale),
    text = useStoryText();
  const [count, setCount] = useState(0);
  return (
    <div className="grid max-w-2xl gap-5 sm:grid-cols-2">
      <UI.TextCell value={text('نام نمونه', 'Sample name')} />
      <UI.TextCell value={null} />
      <UI.NumberCell value={1234.5} locale={locale} />
      <UI.NumberCell value={9007199254740993123n} locale={locale} />
      <UI.DateCell
        value="2026-10-08T08:00:00Z"
        format={(value) =>
          new Intl.DateTimeFormat(locale, { timeZone: 'Asia/Tehran', dateStyle: 'medium' }).format(
            new Date(value)
          )
        }
      />
      <UI.CurrencyCell
        amount="9007199254740993123"
        format={(amount) => new Intl.NumberFormat(locale).format(BigInt(amount)) + ' IRR'}
      />
      <UI.StatusCell tone="success" label={text('پرداخت شد', 'Paid')} />
      <UI.AvatarCell name={text('کاربر نمونه', 'Sample user')} />
      <UI.LinkCell href="#record">{text('رکورد', 'Record')}</UI.LinkCell>
      <UI.ActionCell
        label={text('اقدام‌ها', 'Actions')}
        actions={[
          { id: 'view', label: text('مشاهده', 'View'), onSelect: () => setCount((n) => n + 1) },
          {
            id: 'remove',
            label: text('حذف', 'Remove'),
            destructive: true,
            onSelect: () => setCount((n) => n + 1),
          },
        ]}
      />
      <output>{count}</output>
    </div>
  );
};
