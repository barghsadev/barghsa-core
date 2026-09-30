import { ListPage } from '@barghsa/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Loader2Icon, ReceiptText } from 'lucide-react';
import { Button, MultiSelectFilter, ListViewToggle } from '@barghsa/ui';
import { BANK_RECEIPT_STATUSES } from '@barghsa/shared/validation';
import { t } from '@barghsa/i18n/app';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useListView } from '../hooks/useListView.js';
import { HistoryTable } from '../components/HistoryTable.js';
import { HistoryFilterPanel } from '../components/HistoryFilterPanel.js';
import { useHistoryFilterDraft } from '../hooks/useHistoryFilterDraft.js';
import {
  fetchBankReceiptPage,
  type CustomerBankReceiptListItem,
  type CustomerBankReceiptPage,
} from '../lib/customer-invoices.js';

type ReceiptState = CustomerBankReceiptListItem['state'];

export function BankReceiptsPage({
  statuses = [],
  onStatusesChange,
  onApplyFilters,
}: {
  statuses?: readonly ReceiptState[];
  onStatusesChange?: (statuses: ReceiptState[]) => void;
  onApplyFilters?: (statuses: ReceiptState[]) => void;
}) {
  const filterKey = statuses.join(',');
  const stableStatuses = useMemo(
    () => (filterKey ? (filterKey.split(',') as ReceiptState[]) : []),
    [filterKey]
  );
  return (
    <ReceiptHistory
      statuses={stableStatuses}
      onStatusesChange={onStatusesChange}
      onApplyFilters={onApplyFilters}
    />
  );
}

function ReceiptHistory({
  statuses,
  onStatusesChange,
  onApplyFilters,
}: {
  statuses: readonly ReceiptState[];
  onStatusesChange: ((statuses: ReceiptState[]) => void) | undefined;
  onApplyFilters: ((statuses: ReceiptState[]) => void) | undefined;
}) {
  const filterDraft = useHistoryFilterDraft(
    { query: { q: '' }, statuses, dateRange: {} },
    onApplyFilters ? (selection) => onApplyFilters(selection.statuses as ReceiptState[]) : undefined
  );
  const filterStatuses = onApplyFilters ? filterDraft.draft.statuses : statuses;
  const locale = useLocale();
  const time = useAccountTime(locale);
  const numbers = useNumberFormatting(locale);
  const { view, setView } = useListView('bank-receipts');
  const [items, setItems] = useState<CustomerBankReceiptListItem[]>([]);
  const [cursor, setCursor] = useState<CustomerBankReceiptPage['nextCursor']>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(false);
  const [revision, setRevision] = useState(0);
  const moreRequest = useRef<AbortController | null>(null);
  const label = (key: string) => t(`invoices.receipts.${key}`, locale);
  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR-u-ca-gregory' : 'en-US', {
        dateStyle: 'medium',
        timeZone: 'UTC',
      }),
    [locale]
  );

  useEffect(() => {
    const request = new AbortController();
    moreRequest.current?.abort();
    setLoadState('loading');
    setItems([]);
    setCursor(null);
    setLoadingMore(false);
    setMoreError(false);
    void fetchBankReceiptPage({ statuses, signal: request.signal })
      .then((page) => {
        if (request.signal.aborted) return;
        setItems(page.items);
        setCursor(page.nextCursor);
        setLoadState('ready');
      })
      .catch(() => {
        if (!request.signal.aborted) setLoadState('error');
      });
    return () => {
      request.abort();
      moreRequest.current?.abort();
    };
  }, [statuses, revision]);

  function loadMore() {
    if (!cursor || loadingMore) return;
    const request = new AbortController();
    moreRequest.current = request;
    setLoadingMore(true);
    setMoreError(false);
    void fetchBankReceiptPage({
      statuses,
      cursor,
      signal: request.signal,
    })
      .then((page) => {
        if (request.signal.aborted) return;
        setItems((current) => [
          ...current,
          ...page.items.filter(
            (item) => !current.some((existing) => existing.receiptId === item.receiptId)
          ),
        ]);
        setCursor(page.nextCursor);
      })
      .catch(() => {
        if (!request.signal.aborted) setMoreError(true);
      })
      .finally(() => {
        if (!request.signal.aborted) setLoadingMore(false);
      });
  }

  const paymentDate = (value: string) => dateFormatter.format(new Date(`${value}T00:00:00Z`));

  return (
    <div className="mx-auto max-w-7xl space-y-5" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      {time.notice}
      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <ReceiptText className="h-6 w-6" aria-hidden="true" />
          <h1 className="text-2xl font-bold">{label('title')}</h1>
        </div>
        <p className="text-sm text-muted-foreground">{label('description')}</p>
      </header>
      <nav aria-label={label('title')} className="text-sm">
        <Link
          to="/invoices"
          search={{ status: undefined }}
          className="text-primary underline underline-offset-4"
        >
          {label('backToInvoices')}
        </Link>
      </nav>
      <ListPage>
        <ListPage.Toolbar
          filters={
            <HistoryFilterPanel
              query={{ q: '' }}
              statuses={statuses}
              dateRange={{}}
              onClear={onApplyFilters ? () => onApplyFilters([]) : undefined}
              onRemoveFilter={
                onApplyFilters
                  ? (_key, value) => onApplyFilters(statuses.filter((status) => status !== value))
                  : undefined
              }
              onOpen={filterDraft.begin}
              onApply={onApplyFilters ? filterDraft.apply : undefined}
              statusOptions={BANK_RECEIPT_STATUSES.map((value) => ({
                value,
                label: t(`invoices.activity.state.${value}`, locale),
              }))}
            >
              <MultiSelectFilter
                value={filterStatuses}
                onChange={(values) =>
                  onApplyFilters
                    ? filterDraft.setStatuses(values)
                    : onStatusesChange?.(values as ReceiptState[])
                }
                options={BANK_RECEIPT_STATUSES.map((value) => ({
                  value,
                  label: t(`invoices.activity.state.${value}`, locale),
                }))}
                label={label('filter')}
                emptyLabel={label('empty')}
                clearLabel={t('historyFilters.clearAll', locale)}
                removeLabel={(value) =>
                  t('historyFilters.remove', locale).replace('{filter}', value)
                }
              />
            </HistoryFilterPanel>
          }
          actions={
            <ListViewToggle
              value={view}
              onChange={setView}
              labels={{
                group: t('historyView.group', locale),
                table: t('historyView.table', locale),
                card: t('historyView.card', locale),
              }}
            />
          }
        />
        <ListPage.Content
          loading={loadState === 'loading' || loadingMore}
          error={loadState === 'error' || moreError}
          empty={items.length === 0}
          retainContent={items.length > 0}
          loadingView={
            <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2Icon className="h-4 w-4 animate-spin" aria-hidden="true" />
              {label('loading')}
            </p>
          }
          errorView={
            <div className="space-y-2">
              <p role="alert">{label(moreError ? 'moreError' : 'error')}</p>
              <Button
                variant="outline"
                onClick={() => (moreError ? loadMore() : setRevision((value) => value + 1))}
              >
                {label('retry')}
              </Button>
            </div>
          }
          emptyView={<p>{label('empty')}</p>}
        >
          {items.length ? (
            view === 'table' ? (
              <HistoryTable
                caption={label('title')}
                items={items}
                rowKey={(item) => item.receiptId}
                columns={[
                  {
                    id: 'receipt',
                    label: label('receipt'),
                    render: (item) => (
                      <Link
                        to="/invoices/$invoiceId"
                        params={{ invoiceId: item.invoiceId }}
                        hash={`bank-receipt-${item.receiptId}`}
                        className="text-primary underline underline-offset-4"
                      >
                        <bdi dir="ltr">{item.receiptId}</bdi>
                      </Link>
                    ),
                  },
                  {
                    id: 'invoice',
                    label: label('invoice'),
                    render: (item) => <bdi dir="ltr">{item.invoiceId}</bdi>,
                  },
                  {
                    id: 'amount',
                    label: t('historyView.amount', locale),
                    render: (item) => numbers.money(item.amount),
                  },
                  {
                    id: 'bank',
                    label: label('bank'),
                    render: (item) => item.bankName ?? label('bankUnknown'),
                  },
                  {
                    id: 'deposit',
                    label: label('depositDate'),
                    render: (item) => (
                      <time dateTime={item.paymentDate}>{paymentDate(item.paymentDate)}</time>
                    ),
                  },
                  {
                    id: 'state',
                    label: label('filter'),
                    render: (item) => t(`invoices.activity.state.${item.state}`, locale),
                  },
                  {
                    id: 'submitted',
                    label: label('submittedAt'),
                    render: (item) => (
                      <time dateTime={item.submittedAt}>{time.format(item.submittedAt)}</time>
                    ),
                  },
                ]}
              />
            ) : (
              <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {items.map((item) => (
                  <li key={item.receiptId} className="rounded-lg border border-border p-3">
                    <Link
                      to="/invoices/$invoiceId"
                      params={{ invoiceId: item.invoiceId }}
                      hash={`bank-receipt-${item.receiptId}`}
                      className="group block space-y-2 rounded-md p-2 hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <strong className="text-base">{numbers.money(item.amount)}</strong>
                        <span className="text-sm font-medium">
                          {t(`invoices.activity.state.${item.state}`, locale)}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {label('invoice')}:{' '}
                        <bdi dir="ltr" className="break-all">
                          {item.invoiceId}
                        </bdi>
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {label('receipt')}:{' '}
                        <bdi dir="ltr" className="break-all">
                          {item.receiptId}
                        </bdi>
                      </p>
                      <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
                        <span>
                          {label('bank')}: {item.bankName ?? label('bankUnknown')}
                        </span>
                        <span>
                          {label('depositDate')}: {paymentDate(item.paymentDate)}
                        </span>
                        <span>
                          {label('submittedAt')}: {time.format(item.submittedAt)}
                        </span>
                      </div>
                      <span className="text-sm text-primary underline underline-offset-4 group-hover:no-underline">
                        {label('openDetail')}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </ListPage.Content>
        <ListPage.Pagination
          kind="cursor"
          hasMore={!!cursor && loadState === 'ready' && !moreError}
          loading={loadingMore}
          onNext={loadMore}
          label={t('historyPagination.label', locale)}
          nextLabel={label('older')}
        />
      </ListPage>
    </div>
  );
}
