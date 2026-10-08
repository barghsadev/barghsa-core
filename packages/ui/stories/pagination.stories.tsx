import { useContext, useState } from 'react';
import type { Story } from '@ladle/react';
import * as UI from '../src/index';
import { StoryLocale, useStoryText } from './story-context';

export const Offset: Story = () => {
  const text = useStoryText(),
    locale = useContext(StoryLocale),
    number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const [page, setPage] = useState(5),
    [size, setSize] = useState<UI.PaginationSize>(10),
    [total, setTotal] = useState(154),
    [busy, setBusy] = useState(false),
    [changes, setChanges] = useState(0);
  const start = total ? (page - 1) * size + 1 : 0,
    end = Math.min(page * size, total);
  return (
    <div className="space-y-4">
      <UI.PaginationSummary>
        {text('نمایش ', 'Showing ') +
          number(start) +
          '–' +
          number(end) +
          text(' از ', ' of ') +
          number(total)}
      </UI.PaginationSummary>
      <UI.ListPage.Pagination
        kind="page"
        page={page}
        pageCount={Math.ceil(total / size)}
        disabled={busy}
        onPageChange={(value) => {
          setPage(value);
          setChanges((count) => count + 1);
        }}
        label={text('صفحه‌بندی', 'Pagination')}
        previousLabel={text('قبلی', 'Previous')}
        nextLabel={text('بعدی', 'Next')}
        pageLabel={(value) => text('صفحه ', 'Page ') + number(value)}
        formatPage={number}
      />
      <UI.PaginationPageSize
        value={size}
        label={text('تعداد در صفحه', 'Page size')}
        formatSize={number}
        disabled={busy}
        onChange={(value) => {
          setSize(value);
          setPage(1);
          setChanges((count) => count + 1);
        }}
      />
      <UI.Button onClick={() => setBusy((value) => !value)}>
        {text('تغییر انتظار', 'Toggle pending')}
      </UI.Button>
      <UI.Button
        onClick={() => {
          setTotal(0);
          setPage(1);
        }}
      >
        {text('نمایش خالی', 'Show empty')}
      </UI.Button>
      <output aria-label={text('تعداد تغییرها', 'Change count')}>{changes}</output>
    </div>
  );
};

export const Cursor: Story = () => {
  const text = useStoryText();
  const [page, setPage] = useState(0),
    [busy, setBusy] = useState(false),
    [changes, setChanges] = useState(0);
  return (
    <div className="space-y-4">
      <UI.PaginationSummary>{text('بخش ', 'Batch ') + (page + 1)}</UI.PaginationSummary>
      <UI.ListPage.Pagination
        kind="cursor"
        hasMore={page < 2}
        loading={busy}
        onNext={() => {
          setPage((value) => value + 1);
          setChanges((value) => value + 1);
        }}
        previous={{
          enabled: page > 0,
          label: text('قبلی', 'Previous'),
          onClick: () => {
            setPage((value) => value - 1);
            setChanges((value) => value + 1);
          },
        }}
        label={text('صفحه‌بندی نشانگر', 'Cursor pagination')}
        nextLabel={text('بعدی', 'Next')}
      />
      <UI.Button onClick={() => setBusy((value) => !value)}>
        {text('تغییر انتظار', 'Toggle pending')}
      </UI.Button>
      <output aria-label={text('تعداد تغییرها', 'Change count')}>{changes}</output>
    </div>
  );
};
