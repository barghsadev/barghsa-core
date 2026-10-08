import { useContext, useState } from 'react';
import type { Story } from '@ladle/react';
import * as UI from '../src/index';
import { StoryLocale, useStoryText } from './story-context';
export const Statuses: Story = () => {
  const text = useStoryText();
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-3">
        {(['default', 'success', 'warning', 'destructive', 'info', 'purple'] as const).map(
          (tone) => (
            <UI.StatusBadge key={tone} label={tone} tone={tone} />
          )
        )}
      </div>
      <UI.DualStatusDisplay
        commercialLabel={text('درخواست', 'Request')}
        commercialStatus={text('تأیید شده', 'Approved')}
        commercialTone="success"
        financialLabel={text('پرداخت', 'Payment')}
        financialStatus={text('در انتظار پرداخت', 'Awaiting payment')}
        financialTone="warning"
      />
    </div>
  );
};
export const HeadersAndProgress: Story = () => {
  const text = useStoryText();
  return (
    <div className="space-y-6">
      <UI.PageHeader
        title={text('درخواست نمونه', 'Sample request')}
        eyebrow="BARGHSA"
        description={text('مثال نمایشی بدون اتصال به سرور', 'Example without a server connection')}
        actions={<UI.Button>{text('جزئیات', 'Details')}</UI.Button>}
      />
      <UI.ProgressStepper
        label={text('مراحل', 'Stages')}
        steps={[
          {
            id: 'one',
            label: text('ثبت', 'Submitted'),
            state: 'complete',
            stateLabel: text('انجام شد', 'Completed'),
          },
          {
            id: 'two',
            label: text('بررسی', 'Review'),
            state: 'current',
            stateLabel: text('مرحله کنونی', 'Current stage'),
          },
          {
            id: 'three',
            label: text('تکمیل', 'Complete'),
            state: 'pending',
            stateLabel: text('در انتظار', 'Pending'),
          },
        ]}
      />
      <UI.Timeline
        label={text('تاریخچه', 'History')}
        items={[
          {
            id: 'one',
            title: text('ثبت شد', 'Submitted'),
            description: text('برای بررسی ارسال شد', 'Sent for review'),
            dateTime: '2026-10-08T08:00:00Z',
            dateLabel: '2026-10-08',
          },
        ]}
      />
    </div>
  );
};
export const MoneyReview: Story = () => {
  const text = useStoryText(),
    locale = useContext(StoryLocale);
  const money = (value: string) => new Intl.NumberFormat(locale).format(BigInt(value)) + ' IRR';
  return (
    <UI.FinancialReviewSummary
      title={text('پیش‌نمایش مالی', 'Financial preview')}
      rows={[
        { id: 'base', label: text('مبلغ پایه', 'Subtotal'), value: money('1000000') },
        { id: 'tax', label: text('مالیات', 'Tax'), value: money('100000') },
      ]}
      total={{ label: text('جمع', 'Total'), value: money('1100000') }}
      notice={text(
        'این داده نمایشی است؛ مبلغ واقعی باید از سرور دریافت شود.',
        'Sample data; actual amounts must come from the server.'
      )}
    />
  );
};
export const WaitingAndRecovery: Story = () => {
  const text = useStoryText();
  const [attempt, setAttempt] = useState(0);
  return (
    <div className="space-y-5">
      <UI.WaitingForBarghsa
        title={text('در انتظار بررسی', 'Awaiting review')}
        description={text(
          'تیم پشتیبانی درخواست را بررسی می‌کند.',
          'Support is reviewing the request.'
        )}
        submittedAt="2026-10-08"
        expectedResponse={text('مهلت نمایشی', 'Sample response time')}
        help={<a href="#support">{text('پشتیبانی', 'Support')}</a>}
      />
      <UI.NoDeadEndBanner
        title={text('اقدام لازم', 'Action required')}
        description={text('اطلاعات بیشتری لازم است.', 'More information is needed.')}
        responsibleTeam={text('تیم پشتیبانی', 'Support team')}
        action={
          <UI.Button onClick={() => setAttempt((n) => n + 1)}>
            {text('دوباره تلاش کنید', 'Retry')}
          </UI.Button>
        }
        help={<a href="#help">{text('راهنما', 'Help')}</a>}
      />
      <output>{attempt}</output>
    </div>
  );
};
export const PageStates: Story = () => {
  const text = useStoryText();
  const [mode, setMode] = useState('empty');
  return (
    <div className="space-y-5">
      <UI.NativeSelect
        aria-label={text('وضعیت صفحه', 'Page state')}
        value={mode}
        onChange={(e) => setMode(e.target.value)}
      >
        {['empty', 'loading', 'error', 'ready'].map((v) => (
          <UI.NativeSelectOption key={v}>{v}</UI.NativeSelectOption>
        ))}
      </UI.NativeSelect>
      <UI.AsyncView
        loading={mode === 'loading'}
        error={mode === 'error'}
        empty={mode === 'empty'}
        loadingView={<UI.PageLoading label={text('در حال دریافت', 'Loading')} />}
        errorView={
          <UI.ErrorState
            title={text('دریافت نشد', 'Could not load')}
            description={text('دوباره تلاش کنید', 'Try again')}
            retryLabel={text('تلاش دوباره', 'Retry')}
            supportContact={<a href="#support">{text('پشتیبانی', 'Support')}</a>}
            onRetry={() => setMode('ready')}
          />
        }
        emptyView={
          <UI.EmptyState
            title={text('رکوردی نیست', 'No records')}
            description={text('یک درخواست نمونه ایجاد کنید', 'Create a sample request')}
            action={
              <UI.Button onClick={() => setMode('ready')}>{text('ایجاد', 'Create')}</UI.Button>
            }
          />
        }
      >
        <p>{text('داده نمونه آماده است', 'Sample data is ready')}</p>
      </UI.AsyncView>
    </div>
  );
};
export const Skeletons: Story = () => (
  <div className="space-y-5">
    {(['detail', 'form', 'table', 'cards'] as const).map((variant) => (
      <section key={variant}>
        <h2 className="mb-3">{variant}</h2>
        <UI.LoadingSkeleton variant={variant} label={'Loading ' + variant} />
      </section>
    ))}
  </div>
);
export const EmptyContent: Story = () => (
  <UI.Empty>
    <UI.EmptyHeader>
      <UI.EmptyMedia variant="icon">?</UI.EmptyMedia>
      <UI.EmptyTitle>No records</UI.EmptyTitle>
      <UI.EmptyDescription>Change the filter or create a sample request.</UI.EmptyDescription>
    </UI.EmptyHeader>
    <UI.EmptyContent>
      <UI.Button>Create sample</UI.Button>
    </UI.EmptyContent>
  </UI.Empty>
);
export const Confirmation: Story = () => {
  const text = useStoryText();
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  return (
    <>
      <UI.Button onClick={() => setOpen(true)}>
        {text('بررسی اقدام نمایشی', 'Review sample action')}
      </UI.Button>
      <p role="status">{count}</p>
      <UI.ConfirmDialog
        open={open}
        onCancel={() => setOpen(false)}
        onConfirm={() => {
          setCount((n) => n + 1);
          setOpen(false);
        }}
        title={text('تأیید اقدام نمایشی', 'Confirm sample action')}
        description={text('هیچ درخواست سروری اجرا نمی‌شود.', 'No server request will be made.')}
        confirmLabel={text('تأیید', 'Confirm')}
        cancelLabel={text('انصراف', 'Cancel')}
        destructive
        confirmation={{
          phrase: 'CONFIRM',
          label: text('برای ادامه CONFIRM بنویسید', 'Type CONFIRM to continue'),
        }}
      />
    </>
  );
};
export const Jobs: Story = () => {
  const text = useStoryText();
  const [status, setStatus] = useState<UI.JobProgressStatus>('processing');
  const labels = {
    progress: text('پیشرفت', 'Progress'),
    queued: text('در صف', 'Queued'),
    processing: text('در حال پردازش', 'Processing'),
    completed: text('تکمیل شد', 'Completed'),
    failed: text('ناموفق', 'Failed'),
    loading: text('در حال دریافت', 'Loading'),
    loadError: text('دریافت نشد', 'Could not load'),
    failedDescription: text('تلاش ناموفق بود', 'Attempt failed'),
    retryLoad: text('تلاش برای دریافت', 'Retry loading'),
    retryJob: text('اجرای دوباره', 'Retry job'),
    openResult: text('مشاهده نتیجه', 'Open result'),
    estimateUnavailable: text('زمان تخمینی در دسترس نیست', 'Estimate unavailable'),
    estimate: (remaining: string) => remaining,
  };
  return (
    <div className="max-w-lg space-y-4">
      <UI.NativeSelect
        aria-label={text('وضعیت کار', 'Job status')}
        value={status}
        onChange={(e) => setStatus(e.target.value as UI.JobProgressStatus)}
      >
        {['queued', 'processing', 'completed', 'failed'].map((value) => (
          <UI.NativeSelectOption key={value}>{value}</UI.NativeSelectOption>
        ))}
      </UI.NativeSelect>
      <UI.JobProgressView
        status={status}
        progress={status === 'completed' ? 100 : 45}
        labels={labels}
        onRetry={() => setStatus('queued')}
        resultUrl="#sample-result"
      />
    </div>
  );
};
export const Fields: Story = () => {
  const text = useStoryText();
  return (
    <UI.FieldSet className="max-w-lg">
      <UI.FieldLegend>{text('مشخصات نمونه', 'Sample details')}</UI.FieldLegend>
      <UI.FieldDescription>
        {text('این فرم داده واقعی ندارد.', 'This form has no live data.')}
      </UI.FieldDescription>
      <UI.FieldGroup>
        <UI.Field>
          <UI.FieldLabel htmlFor="field-name">{text('نام', 'Name')}</UI.FieldLabel>
          <UI.Input id="field-name" />
          <UI.FieldDescription>{text('راهنمای فیلد', 'Field guidance')}</UI.FieldDescription>
        </UI.Field>
        <UI.FieldSeparator />
        <UI.Field data-invalid>
          <UI.FieldLabel htmlFor="field-error">{text('شناسه', 'Identifier')}</UI.FieldLabel>
          <UI.Input id="field-error" aria-invalid aria-describedby="field-error-text" />
          <UI.FieldError id="field-error-text">
            {text('مقدار نامعتبر', 'Invalid value')}
          </UI.FieldError>
        </UI.Field>
      </UI.FieldGroup>
    </UI.FieldSet>
  );
};
export const DependentFields: Story = () => {
  const text = useStoryText();
  const [region, setRegion] = useState('north');
  const [city, setCity] = useState('');
  return (
    <div className="max-w-sm space-y-3">
      <UI.Label htmlFor="region">{text('منطقه', 'Region')}</UI.Label>
      <UI.NativeSelect
        id="region"
        value={region}
        onChange={(e) => {
          setRegion(e.target.value);
          setCity('');
        }}
      >
        <UI.NativeSelectOption value="north">North</UI.NativeSelectOption>
        <UI.NativeSelectOption value="south">South</UI.NativeSelectOption>
      </UI.NativeSelect>
      <UI.Label htmlFor="city">{text('شهر', 'City')}</UI.Label>
      <UI.DependentSelect
        id="city"
        dependencyValue={region}
        value={city}
        placeholder={text('انتخاب شهر', 'Choose city')}
        onChange={(e) => setCity(e.target.value)}
        options={[
          { value: 'alpha', label: 'Alpha', dependencyValue: 'north' },
          { value: 'beta', label: 'Beta', dependencyValue: 'south' },
        ]}
      />
      <output>{city}</output>
    </div>
  );
};
export const DynamicFields: Story = () => {
  const text = useStoryText();
  const [items, setItems] = useState([
    { id: 'one', name: 'Alpha' },
    { id: 'two', name: 'Beta' },
  ]);
  return (
    <UI.DynamicFieldArray
      value={items}
      onChange={setItems}
      getItemKey={(item) => item.id}
      createItem={() => ({ id: crypto.randomUUID(), name: '' })}
      addLabel={text('افزودن', 'Add')}
      removeLabel={(item) => text('حذف ', 'Remove ') + item.name}
      moveUpLabel={(item) => text('انتقال بالا ', 'Move up ') + item.name}
      moveDownLabel={(item) => text('انتقال پایین ', 'Move down ') + item.name}
      maxItems={5}
      renderItem={(item, index, actions) => (
        <div className="flex flex-wrap gap-3">
          <UI.Input
            aria-label={text('نام ', 'Name ') + (index + 1)}
            value={item.name}
            onChange={(e) =>
              setItems(
                items.map((row) => (row.id === item.id ? { ...row, name: e.target.value } : row))
              )
            }
          />
          {actions}
        </div>
      )}
    />
  );
};
export const PaginationAndViews: Story = () => {
  const text = useStoryText(),
    locale = useContext(StoryLocale);
  const [page, setPage] = useState(5);
  const [view, setView] = useState<UI.ListView>('table');
  return (
    <div className="space-y-5">
      <UI.Pagination
        page={page}
        pageCount={20}
        onPageChange={setPage}
        label={text('صفحه‌بندی', 'Pagination')}
        previousLabel={text('قبلی', 'Previous')}
        nextLabel={text('بعدی', 'Next')}
        pageLabel={(page) => text('صفحه ', 'Page ') + page}
        formatPage={(page) => new Intl.NumberFormat(locale).format(page)}
      />
      <UI.ListViewToggle
        value={view}
        onChange={setView}
        labels={{
          group: text('نمایش', 'View'),
          table: text('جدول', 'Table'),
          card: text('کارت', 'Cards'),
        }}
      />
      <output>
        {page} · {view}
      </output>
    </div>
  );
};

function RenderFailure({ fail }: { fail: boolean }) {
  if (fail) throw new Error('Owned catalogue example failure');
  return <p>Sample content is ready.</p>;
}
export const BoundaryRecovery: Story = () => {
  const text = useStoryText();
  const [fail, setFail] = useState(false);
  return (
    <div className="space-y-4">
      <UI.Button onClick={() => setFail(true)}>
        {text('نمایش خطای نمونه', 'Show sample error')}
      </UI.Button>
      <UI.ErrorBoundary
        title={text('نمایش انجام نشد', 'Could not display')}
        description={text('دوباره تلاش کنید', 'Try again')}
        retryLabel={text('تلاش دوباره', 'Retry')}
        supportContact={<a href="#support">{text('پشتیبانی', 'Support')}</a>}
        onReset={() => setFail(false)}
      >
        <RenderFailure fail={fail} />
      </UI.ErrorBoundary>
    </div>
  );
};
