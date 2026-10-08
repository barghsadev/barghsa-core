import { ListPage, ListToolbar } from '@barghsa/ui';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys, type ServerQueryKey } from '../lib/query-keys.js';
import { Link } from '@tanstack/react-router';
import { Loader2Icon, ReceiptText } from 'lucide-react';
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
import { HistoryTable } from '../components/HistoryTable.js';
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

type ReceiptState = CustomerBankReceiptListItem['state'];

interface BankReceiptsPageProps {
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
        queryFn: ({ signal }) => read(signal),
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
            <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2Icon className="h-4 w-4 animate-spin" aria-hidden="true" />
              {label('loading')}
            </p>
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
          nextLabel={label(query.sort === 'submitted_at:asc' ? 'newer' : 'older')}
        />
      </ListPage>
    </div>
  );
}
