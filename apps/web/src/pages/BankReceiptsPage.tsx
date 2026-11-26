import { ListPage, ListToolbar, PageHeader, StatusBadge, buttonVariants } from '@barghsa/ui';
import { RecordListSkeleton } from '../components/RecordListSkeleton.js';
import { useEffect, useId, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys, type ServerQueryKey } from '../lib/query-keys.js';
import { readWithDeadline } from '../lib/server-query-client.js';
import { Link } from '@tanstack/react-router';
import {
  Button,
  MultiSelectFilter,
  ListViewToggle,
  TextFilter,
  ListSortDropdown,
  NumberFilter,
} from '@barghsa/ui';
import {
  BANK_RECEIPT_STATUSES,
  DEFAULT_HISTORY_SORT,
  HISTORY_SORT_OPTIONS,
  parseNumberRange,
  type HistoryQuery,
  type DateRangeFilterValue,
  type NumberRangeValue,
} from '@barghsa/shared/validation';
import { t } from '@barghsa/i18n/app';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useListView } from '../hooks/useListView.js';
import { HistoryTable, TableCellDetails, type HistoryColumn } from '../components/HistoryTable.js';
import { ReceiptDepositDate } from '../components/ReceiptDepositDate.js';
import { HistoryFilterPanel } from '../components/HistoryFilterPanel.js';
import {
  useHistoryFilterDraft,
  type HistoryFilterSelection,
} from '../hooks/useHistoryFilterDraft.js';
import {
  fetchBankReceiptPage,
  InvoiceRequestError,
  type CustomerBankReceiptListItem,
  type CustomerBankReceiptPage,
} from '../lib/customer-invoices.js';

import { HistoryDateFilter } from '../components/HistoryDateFilter.js';
import { getProfileContextRevision, useProfileContextRevision } from '../lib/profile-context.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import type { HistoryFilterKey } from '../lib/history-filter-state.js';
import type { ReceiptHistorySearch } from '../lib/receipt-history-search.js';

type ReceiptState = CustomerBankReceiptListItem['state'];

interface BankReceiptsPageProps {
  recordSearch?: ReceiptHistorySearch;
  statuses?: readonly ReceiptState[];
  onStatusesChange?: (statuses: ReceiptState[]) => void;
  query?: HistoryQuery;
  dateRange?: DateRangeFilterValue;
  amountRange?: NumberRangeValue;
  onApplyFilters?: (selection: HistoryFilterSelection<HistoryQuery>) => void;
  onClearFilters?: () => void;
  onRemoveFilter?: (key: HistoryFilterKey, value?: string) => void;
}

export function BankReceiptsPage(props: BankReceiptsPageProps) {
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  const scope = JSON.stringify([
    actor,
    revision,
    props.statuses,
    props.query,
    props.dateRange,
    props.amountRange,
  ]);
  return <ReceiptHistory scope={scope} profileRevision={revision} {...props} />;
}

function ReceiptHistory({
  scope,
  profileRevision,
  recordSearch,
  statuses = [],
  onStatusesChange,
  query = { q: '', sort: DEFAULT_HISTORY_SORT },
  dateRange = {},
  amountRange = {},
  onApplyFilters,
  onClearFilters,
  onRemoveFilter,
}: BankReceiptsPageProps & { scope: string; profileRevision: number }) {
  const actor = useAccountUser();
  const reader = useId();
  const client = useQueryClient();
  const readSequence = useRef(0);
  const statusesKey = statuses.join(',');
  const filterDraft = useHistoryFilterDraft(
    { query, statuses, dateRange, amountRange },
    onApplyFilters
  );
  const filterStatuses = onApplyFilters ? filterDraft.draft.statuses : statuses;
  const filterQuery = filterDraft.draft.query;
  const locale = useLocale();
  const time = useAccountTime(locale);
  const numbers = useNumberFormatting(locale);
  const { view, setView } = useListView('bank-receipts');
  const emptyResult = {
    scope,
    items: [] as CustomerBankReceiptListItem[],
    cursor: null as CustomerBankReceiptPage['nextCursor'],
    loadState: 'loading' as 'loading' | 'ready' | 'error',
    loadingMore: false,
    moreError: false,
    denied: false,
  };
  const [result, setResult] = useState(emptyResult);
  const { items, cursor, loadState, loadingMore, moreError, denied } =
    result.scope === scope ? result : emptyResult;
  const [revision, setRevision] = useState(0);
  const moreRequest = useRef<AbortController | null>(null);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const actions = useRef(0);
  const actionVersion = actions.current;
  const owner = useRef<{ scope: string; profile: string | null } | null>(null);
  const current = () =>
    currentScope.current === scope && getProfileContextRevision() === profileRevision;
  const fresh = (request: AbortController) => !request.signal.aborted && current();
  const accessDenied = (error: unknown) =>
    error instanceof InvoiceRequestError && [401, 403].includes(error.status);

  async function queryRead<T>(
    queryKey: ServerQueryKey,
    request: AbortController,
    read: (signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    if (!fresh(request)) throw new Error('Obsolete receipt read');
    const abort = () => void client.cancelQueries({ queryKey, exact: true });
    request.signal.addEventListener('abort', abort, { once: true });
    try {
      return await client.fetchQuery({
        queryKey,
        staleTime: 0,
        gcTime: 0,
        retry: false,
        queryFn: ({ signal }) => readWithDeadline(signal, read),
      });
    } finally {
      request.signal.removeEventListener('abort', abort);
    }
  }

  async function readPage(request: AbortController, next?: CustomerBankReceiptPage['nextCursor']) {
    const attempt = ++readSequence.current;
    const authorityKey = queryKeys.profiles.authority(
      {
        context: 'account',
        ownerId: actor?.trim() ? actor : reader,
        accountId: actor,
        revision: profileRevision,
      },
      JSON.stringify([reader, scope, next, attempt])
    );
    const profile = await queryRead(authorityKey, request, async (signal) => {
      const response = await fetch('/api/profiles', { credentials: 'include', signal });
      if (!fresh(request) || signal.aborted) throw new Error('Obsolete receipt read');
      if (!response.ok) throw new InvoiceRequestError(response.status, 'Could not load profiles');
      const profile: unknown = await response.json();
      if (!fresh(request) || signal.aborted) throw new Error('Obsolete receipt read');
      return profile;
    });
    if (!fresh(request)) throw new Error('Obsolete receipt read');
    if (
      !profile ||
      typeof profile !== 'object' ||
      Array.isArray(profile) ||
      !('activeProfileId' in profile) ||
      !(
        profile.activeProfileId === null ||
        (typeof profile.activeProfileId === 'string' && profile.activeProfileId.length > 0)
      )
    )
      throw new Error('Invalid receipt profile');
    const profileId = profile.activeProfileId as string | null;
    if (!profileId || (owner.current?.scope === scope && owner.current.profile !== profileId)) {
      actions.current += 1;
      setResult(emptyResult);
      next = null;
    }
    owner.current = { scope, profile: profileId };
    if (!profileId) return { items: [], nextCursor: null };
    const params = new URLSearchParams({ reader, scope });
    if (next) params.set('cursor', JSON.stringify([next.beforeAt, next.beforeId]));
    const pageKey = queryKeys.invoices.list(
      { context: 'customer', ownerId: profileId, accountId: actor, revision: profileRevision },
      params,
      attempt
    );
    return queryRead(pageKey, request, async (signal) => {
      const page = await fetchBankReceiptPage({
        statuses,
        ...query,
        ...dateRange,
        ...amountRange,
        ...(next ? { cursor: next } : {}),
        signal,
      });
      if (!fresh(request)) throw new Error('Obsolete receipt read');
      if (
        !Array.isArray(page.items) ||
        page.items.some((item) => !item || typeof item.receiptId !== 'string' || !item.receiptId) ||
        (page.nextCursor !== null &&
          (!page.nextCursor ||
            typeof page.nextCursor.beforeAt !== 'string' ||
            !page.nextCursor.beforeAt ||
            typeof page.nextCursor.beforeId !== 'string' ||
            !page.nextCursor.beforeId))
      )
        throw new Error('Invalid receipt page');
      return page;
    });
  }
  const label = (key: string) => t(`invoices.receipts.${key}`, locale);

  useEffect(() => {
    const request = new AbortController();
    moreRequest.current?.abort();
    actions.current += 1;
    setResult(emptyResult);
    void readPage(request)
      .then((page) => {
        if (!fresh(request)) return;
        actions.current += 1;
        setResult({
          ...emptyResult,
          items: page.items,
          cursor: page.nextCursor,
          loadState: 'ready',
        });
      })
      .catch((error: unknown) => {
        if (fresh(request)) {
          actions.current += 1;
          setResult({ ...emptyResult, loadState: 'error', denied: accessDenied(error) });
        }
      });
    return () => {
      request.abort();
      moreRequest.current?.abort();
    };
  }, [
    scope,
    statusesKey,
    query.q,
    query.sort,
    dateRange.from,
    dateRange.to,
    amountRange.min,
    amountRange.max,
    revision,
  ]);

  function loadMore() {
    if (
      !current() ||
      !cursor ||
      loadingMore ||
      loadState !== 'ready' ||
      (moreRequest.current && !moreRequest.current.signal.aborted) ||
      actions.current !== actionVersion
    )
      return;
    const request = new AbortController();
    moreRequest.current = request;
    actions.current += 1;
    setResult((value) =>
      value.scope === scope ? { ...value, loadingMore: true, moreError: false } : value
    );
    void readPage(request, cursor)
      .then((page) => {
        if (!fresh(request)) return;
        actions.current += 1;
        setResult((current) =>
          current.scope === scope
            ? {
                ...current,
                items: [
                  ...current.items,
                  ...page.items.filter(
                    (item) =>
                      !current.items.some((existing) => existing.receiptId === item.receiptId)
                  ),
                ],
                cursor: page.nextCursor,
                loadState: 'ready',
              }
            : current
        );
      })
      .catch((error: unknown) => {
        if (fresh(request)) {
          actions.current += 1;
          setResult((value) => {
            if (value.scope !== scope) return value;
            if (accessDenied(error) || value.loadState === 'loading')
              return { ...emptyResult, loadState: 'error', denied: accessDenied(error) };
            return { ...value, moreError: true };
          });
        }
      })
      .finally(() => {
        if (moreRequest.current === request) moreRequest.current = null;
        if (fresh(request))
          setResult((value) => (value.scope === scope ? { ...value, loadingMore: false } : value));
      });
  }

  const receiptState = (item: CustomerBankReceiptListItem) => (
    <StatusBadge
      state={item.state === 'Confirmed' ? 'approved' : item.state}
      label={t(`invoices.activity.state.${item.state}`, locale)}
    />
  );
  const receiptDates = (item: CustomerBankReceiptListItem) => (
    <TableCellDetails
      fields={[
        {
          id: 'deposit',
          label: label('depositDate'),
          value: <ReceiptDepositDate value={item.paymentDate} locale={locale} />,
        },
        {
          id: 'submitted',
          label: label('submittedAt'),
          value: <time dateTime={item.submittedAt}>{time.format(item.submittedAt)}</time>,
        },
      ]}
    />
  );
  const columns: (HistoryColumn<CustomerBankReceiptListItem> & { label: string })[] = [
    {
      id: 'receipt',
      label: label('receipt'),
      render: (item) => (
        <div className="min-w-0 space-y-1">
          <Link
            to="/invoices/$invoiceId/receipts/$receiptId"
            params={{ invoiceId: item.invoiceId, receiptId: item.receiptId }}
            search={recordSearch}
            className="touch-action text-primary underline-offset-4 hover:underline"
          >
            {item.bankName || label('openDetail')}
          </Link>
          <p className="text-xs font-normal text-muted-foreground">
            <bdi dir="ltr" className="wrap-anywhere">
              {item.receiptId}
            </bdi>
          </p>
        </div>
      ),
    },
    { id: 'state', label: t('historyView.status', locale), render: receiptState },
    {
      id: 'amount',
      label: t('historyView.amount', locale),
      render: (item) => (
        <bdi className="font-semibold whitespace-nowrap">{numbers.money(item.amount)}</bdi>
      ),
    },
    { id: 'activity', label: t('recordTable.activity', locale), render: receiptDates },
  ];

  return (
    <div
      className="mx-auto w-full max-w-5xl min-w-0 space-y-4"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      {time.notice}
      <PageHeader
        title={label('title')}
        actions={
          <Link
            to="/invoices"
            search={{ status: undefined }}
            className={buttonVariants({ variant: 'outline' })}
          >
            {label('backToInvoices')}
          </Link>
        }
      />
      <ListPage>
        <ListPage.Toolbar
          filters={
            <HistoryFilterPanel
              query={query}
              statuses={statuses}
              dateRange={dateRange}
              amountRange={amountRange}
              dateLabel={label('submittedAt')}
              formatDate={(value) => time.format(value)}
              onClear={onClearFilters}
              onRemoveFilter={onRemoveFilter}
              onOpen={filterDraft.begin}
              onApply={onApplyFilters ? filterDraft.apply : undefined}
              statusOptions={BANK_RECEIPT_STATUSES.map((value) => ({
                value,
                label: t(`invoices.activity.state.${value}`, locale),
              }))}
            >
              {onApplyFilters && (
                <>
                  <ListToolbar
                    search={
                      <TextFilter
                        value={filterQuery.q}
                        onChange={(q) => filterDraft.setQuery({ ...filterQuery, q })}
                        label={t('historySearch.label', locale)}
                        placeholder={label('search')}
                      />
                    }
                    sort={
                      <ListSortDropdown
                        value={filterQuery.sort}
                        onChange={(sort) =>
                          filterDraft.setQuery({
                            ...filterQuery,
                            sort: sort as HistoryQuery['sort'],
                          })
                        }
                        label={t('historySearch.sort', locale)}
                        options={HISTORY_SORT_OPTIONS.map((value) => ({
                          value,
                          label: t(
                            value.endsWith('desc')
                              ? 'historySearch.newest'
                              : 'historySearch.oldest',
                            locale
                          ),
                        }))}
                      />
                    }
                  />
                  <HistoryDateFilter
                    value={filterDraft.draft.dateRange}
                    onChange={filterDraft.setDateRange}
                    locale={locale}
                    time={time}
                    label={label('submittedAt')}
                  />
                  <NumberFilter
                    value={filterDraft.draft.amountRange ?? {}}
                    onChange={filterDraft.setAmountRange}
                    parseRange={parseNumberRange}
                    labels={{
                      label: t('invoices.filter.amount', locale),
                      min: t('invoices.filter.min', locale),
                      max: t('invoices.filter.max', locale),
                      apply: t('invoices.filter.applyAmount', locale),
                      clear: t('invoices.filter.clearAmount', locale),
                      invalid: t('invoices.filter.invalidAmount', locale),
                    }}
                  />
                </>
              )}
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
            <RecordListSkeleton
              label={label('loading')}
              view={view}
              headings={columns.map((column) => column.label)}
            />
          }
          errorView={
            <div className="space-y-2">
              <p role="alert">
                {denied
                  ? t('historyPagination.accessDenied', locale)
                  : label(moreError ? 'moreError' : 'error')}
              </p>
              <Button
                variant="outline"
                onClick={() => {
                  if (!current() || actions.current !== actionVersion) return;
                  if (moreError) loadMore();
                  else setRevision((value) => value + 1);
                }}
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
                columns={columns}
              />
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2">
                {items.map((item) => (
                  <li key={item.receiptId} className="space-y-3 rounded-xl border bg-card p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 space-y-1">
                        <Link
                          to="/invoices/$invoiceId/receipts/$receiptId"
                          params={{ invoiceId: item.invoiceId, receiptId: item.receiptId }}
                          search={recordSearch}
                          className="touch-action font-semibold text-primary underline-offset-4 hover:underline"
                        >
                          {item.bankName || label('openDetail')}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          <bdi dir="ltr" className="wrap-anywhere">
                            {item.receiptId}
                          </bdi>
                        </p>
                      </div>
                      {receiptState(item)}
                    </div>
                    <div className="space-y-1 border-t pt-3">
                      <p className="text-xs text-muted-foreground">
                        {t('historyView.amount', locale)}
                      </p>
                      <bdi className="text-lg font-semibold tabular-nums">
                        {numbers.money(item.amount)}
                      </bdi>
                    </div>
                    <div className="text-sm">{receiptDates(item)}</div>
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
          nextLabel={label(query.sort === 'submitted_at:asc' ? 'newer' : 'older')}
        />
      </ListPage>
    </div>
  );
}
