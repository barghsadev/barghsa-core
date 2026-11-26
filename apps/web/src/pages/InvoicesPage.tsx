import { HistoryStatusEmpty } from '../components/QueueEmptyState.js';
import { ListPage, ListToolbar, PageHeader, StatusBadge, buttonVariants } from '@barghsa/ui';
import { RecordListSkeleton } from '../components/RecordListSkeleton.js';
import {
  useHistoryFilterDraft,
  type HistoryFilterSelection,
} from '../hooks/useHistoryFilterDraft.js';
import type { HistoryFilterKey } from '../lib/history-filter-state.js';
import { useListView } from '../hooks/useListView.js';
import { HistoryTable, TableCellDetails, type HistoryColumn } from '../components/HistoryTable.js';
import { HistoryFilterPanel } from '../components/HistoryFilterPanel.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { Link } from '@tanstack/react-router';
import { t } from '@barghsa/i18n/app';
import { useLocale } from '../hooks/useLocale.js';
import {
  Button,
  TextFilter,
  ListSortDropdown,
  NumberFilter,
  StatusFilter,
  ListViewToggle,
} from '@barghsa/ui';
import {
  CUSTOMER_INVOICE_STATUSES,
  DEFAULT_INVOICE_LIST_SORT,
  parseNumberRange,
  type InvoiceListQuery,
  type DateRangeFilterValue,
  type NumberRangeValue,
} from '@barghsa/shared/validation';
import { HistoryDateFilter } from '../components/HistoryDateFilter.js';
import { useCustomerServiceHistory } from '../hooks/useCustomerServiceHistory.js';
import { formatInvoiceServicePeriod } from '../lib/invoice-service-period.js';
import {
  roleI18nKey,
  stateI18nKey,
  type CustomerInvoiceListItem,
} from '../lib/customer-invoices.js';

const identifyHistoryRow = (row: CustomerInvoiceListItem) => row.invoiceId;

/** Filtered, paginated invoices for the active profile, including corrections. */
export function InvoicesPage({
  unpaidOnly = false,
  statuses = [],
  onStatusesChange,
  dateRange = {},
  onDateRangeChange,
  query = { q: '', sort: DEFAULT_INVOICE_LIST_SORT },
  onQueryChange,
  onClearFilters,
  onShowAllStatuses,
  onApplyFilters,
  onRemoveFilter,
  amountRange = {},
  onAmountRangeChange,
}: {
  unpaidOnly?: boolean;
  statuses?: readonly string[];
  onStatusesChange?: (value: string[]) => void;
  dateRange?: DateRangeFilterValue;
  onDateRangeChange?: (value: DateRangeFilterValue) => void;
  query?: InvoiceListQuery;
  onQueryChange?: (value: InvoiceListQuery) => void;
  onClearFilters?: () => void;
  onShowAllStatuses?: () => void;
  onApplyFilters?: (selection: HistoryFilterSelection<InvoiceListQuery>) => void;
  onRemoveFilter?: (key: HistoryFilterKey, value?: string) => void;
  amountRange?: NumberRangeValue;
  onAmountRangeChange?: (value: NumberRangeValue) => void;
}) {
  const filterDraft = useHistoryFilterDraft(
    { query, statuses, dateRange, amountRange },
    onApplyFilters
  );
  const filterQuery = onApplyFilters ? filterDraft.draft.query : query;
  const filterStatuses = onApplyFilters ? filterDraft.draft.statuses : statuses;
  const filterDateRange = onApplyFilters ? filterDraft.draft.dateRange : dateRange;
  const onDraftQueryChange = onApplyFilters ? filterDraft.setQuery : onQueryChange;
  const onDraftStatusesChange = onApplyFilters ? filterDraft.setStatuses : onStatusesChange;
  const onDraftDateRangeChange = onApplyFilters ? filterDraft.setDateRange : onDateRangeChange;
  const filterAmountRange = onApplyFilters ? (filterDraft.draft.amountRange ?? {}) : amountRange;
  const onDraftAmountRangeChange = onApplyFilters
    ? filterDraft.setAmountRange
    : onAmountRangeChange;

  const { view, setView } = useListView('invoices');
  const time = useAccountTime();
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const isRtl = locale === 'fa';
  const statusOptions: Parameters<typeof StatusFilter>[0]['options'] =
    CUSTOMER_INVOICE_STATUSES.map((value) => ({
      value,
      label: t(stateI18nKey(value), locale),
      tone:
        value === 'Paid' || value === 'Refunded'
          ? 'success'
          : value === 'Cancelled' || value === 'Overdue'
            ? 'destructive'
            : 'warning',
    }));
  const statusesKey = statuses.join(',');
  const params = new URLSearchParams();
  if (unpaidOnly) params.set('status', 'unpaid');
  for (const [key, value] of Object.entries({
    statuses: statusesKey,
    ...dateRange,
    ...query,
    ...amountRange,
  })) {
    if (value && !(key === 'sort' && value === DEFAULT_INVOICE_LIST_SORT)) params.set(key, value);
  }
  const history = useCustomerServiceHistory<CustomerInvoiceListItem>({
    resource: 'invoices',
    endpoint: '/api/invoices',
    implicitProfile: true,
    query: params.toString(),
    itemsKey: 'invoices',
    identify: identifyHistoryRow,
  });
  const { items, nextBefore, loadMore, loading } = history;
  const error = !!history.error;
  const filtered = !!(
    statusesKey ||
    dateRange.from ||
    dateRange.to ||
    query.q ||
    amountRange.min ||
    amountRange.max
  );

  const invoiceType = (item: CustomerInvoiceListItem) => t(roleI18nKey(item.role), locale);
  const identity = (item: CustomerInvoiceListItem) => (
    <div className="min-w-0 space-y-1">
      <Link
        to="/invoices/$invoiceId"
        params={{ invoiceId: item.invoiceId }}
        className="touch-action font-semibold text-primary hover:underline underline-offset-4"
      >
        <bdi>{item.explanation || invoiceType(item)}</bdi>
      </Link>
      {item.explanation && (
        <p className="text-xs font-normal text-muted-foreground">{invoiceType(item)}</p>
      )}
      <p className="text-xs font-normal text-muted-foreground">
        <bdi className="wrap-anywhere">{item.invoiceId}</bdi>
      </p>
      {item.periodStart && item.periodEnd && (
        <p className="text-xs font-normal text-muted-foreground">
          {t('invoices.list.period', locale)}{' '}
          {formatInvoiceServicePeriod(item.periodStart, item.periodEnd, time.format)}
        </p>
      )}
    </div>
  );
  const state = (item: CustomerInvoiceListItem) => (
    <StatusBadge state={item.state} label={t(stateI18nKey(item.state), locale)} />
  );
  const columns: (HistoryColumn<CustomerInvoiceListItem> & { label: string })[] = [
    { id: 'reference', label: t('invoices.list.reference', locale), render: identity },
    { id: 'state', label: t('historyView.status', locale), render: state },
    {
      id: 'amount',
      label: t('historyView.amount', locale),
      render: (item) => (
        <TableCellDetails
          fields={[
            {
              id: 'amount',
              label: t('historyView.amount', locale),
              value: (
                <bdi className="font-semibold whitespace-nowrap">
                  {numbers.money(item.totalAmount)}
                </bdi>
              ),
            },
            {
              id: 'paid',
              label: t('invoices.list.paid', locale),
              value:
                item.paidAmount === undefined ? (
                  '—'
                ) : (
                  <bdi className="whitespace-nowrap">{numbers.money(item.paidAmount)}</bdi>
                ),
            },
          ]}
        />
      ),
    },
    {
      id: 'issued',
      label: t('recordTable.activity', locale),
      render: (item) => (
        <TableCellDetails
          fields={[
            {
              id: 'issued',
              label: t('invoices.list.issued', locale),
              value: time.format(item.issuedAt),
            },
            { id: 'due', label: t('invoices.list.due', locale), value: time.format(item.dueAt) },
          ]}
        />
      ),
    },
  ];
  const resetFilters = filtered && onClearFilters && (
    <Button
      variant="outline"
      onClick={(event) => {
        event.currentTarget.closest('main')?.focus();
        onClearFilters();
      }}
    >
      {t('historyFilters.clearAll', locale)}
    </Button>
  );
  return (
    <div className="mx-auto w-full max-w-5xl min-w-0 space-y-4" dir={isRtl ? 'rtl' : 'ltr'}>
      {time.notice}
      <PageHeader
        title={t('invoices.title', locale)}
        actions={
          <Link to="/invoices/receipts" className={buttonVariants({ variant: 'outline' })}>
            {t('invoices.receipts.title', locale)}
          </Link>
        }
      />
      <nav
        className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b pb-2 text-sm"
        aria-label={t('invoices.title', locale)}
      >
        <Link
          to="/invoices"
          search={{ status: undefined }}
          activeOptions={{ exact: true }}
          className="touch-action rounded-md px-3 py-2 font-medium text-muted-foreground hover:text-foreground aria-[current=page]:bg-sidebar-active aria-[current=page]:text-sidebar-active-foreground"
          aria-current={unpaidOnly ? undefined : 'page'}
        >
          {t('invoices.filter.all', locale)}
        </Link>
        <Link
          to="/invoices"
          search={{ status: 'unpaid' }}
          activeOptions={{ exact: true }}
          className="touch-action rounded-md px-3 py-2 font-medium text-muted-foreground hover:text-foreground aria-[current=page]:bg-sidebar-active aria-[current=page]:text-sidebar-active-foreground"
          aria-current={unpaidOnly ? 'page' : undefined}
        >
          {t('invoices.filter.unpaid', locale)}
        </Link>
      </nav>

      <ListPage>
        <ListPage.Toolbar
          className="rounded-xl border bg-card p-3"
          filters={
            <HistoryFilterPanel
              query={query}
              statuses={statuses}
              dateRange={dateRange}
              onClear={onClearFilters}
              onOpen={filterDraft.begin}
              onApply={onApplyFilters ? filterDraft.apply : undefined}
              onRemoveFilter={onRemoveFilter}
              statusOptions={statusOptions}
              formatDate={(value) =>
                time.format(value, { dateStyle: 'medium', timeStyle: 'short' })
              }
              dateLabel={t('invoices.filter.created', locale)}
              amountRange={amountRange}
            >
              {onDraftQueryChange && (
                <ListToolbar
                  search={
                    <TextFilter
                      value={filterQuery.q}
                      onChange={(q) => onDraftQueryChange({ ...filterQuery, q })}
                      label={t('historySearch.label', locale)}
                      placeholder={t('invoices.filter.search', locale)}
                    />
                  }
                  sort={
                    <ListSortDropdown
                      value={filterQuery.sort}
                      onChange={(sort) =>
                        onDraftQueryChange({
                          ...filterQuery,
                          sort: sort as InvoiceListQuery['sort'],
                        })
                      }
                      label={t('historySearch.sort', locale)}
                      options={(['created_at:desc', 'created_at:asc'] as const).map((value) => ({
                        value,
                        label: t(
                          value.endsWith('desc')
                            ? 'invoices.filter.newest'
                            : 'invoices.filter.oldest',
                          locale
                        ),
                      }))}
                    />
                  }
                />
              )}
              {onDraftDateRangeChange && (
                <HistoryDateFilter
                  value={filterDateRange}
                  onChange={onDraftDateRangeChange}
                  locale={locale}
                  time={time}
                  label={t('invoices.filter.created', locale)}
                />
              )}
              {onDraftAmountRangeChange && (
                <NumberFilter
                  value={filterAmountRange}
                  onChange={onDraftAmountRangeChange}
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
              )}
              {onDraftStatusesChange && (
                <StatusFilter
                  label={t('invoices.filter.state', locale)}
                  clearLabel={t('invoices.filter.clearState', locale)}
                  countLabel={numbers.number(filterStatuses.length)}
                  value={filterStatuses}
                  onChange={onDraftStatusesChange}
                  options={statusOptions}
                />
              )}
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
          loading={loading}
          error={error}
          empty={items.length === 0}
          retainContent={items.length > 0}
          loadingView={
            items.length ? (
              <p role="status" className="sr-only">
                {t('invoices.loading', locale)}
              </p>
            ) : (
              <RecordListSkeleton
                label={t('invoices.loading', locale)}
                view={view}
                headings={columns.map((column) => column.label)}
              />
            )
          }
          errorView={
            <div className="space-y-2" role="alert">
              <p className="text-destructive">
                {history.error === 'denied'
                  ? t('historyPagination.accessDenied', locale)
                  : t('invoices.error.load', locale)}
              </p>
              <Button onClick={history.retry}>{t('invoices.filter.retry', locale)}</Button>
            </div>
          }
          emptyView={
            history.statusProbe && onShowAllStatuses ? (
              <div className="space-y-3">
                <HistoryStatusEmpty
                  locale={locale}
                  probe={history.statusProbe}
                  showAll={onShowAllStatuses}
                  message={t(
                    filtered ? 'historyDates.empty' : 'invoices.filter.unpaidEmpty',
                    locale
                  )}
                />
                {resetFilters}
              </div>
            ) : (
              <div className="space-y-3 rounded-lg border border-dashed border-input bg-card p-8 text-center">
                <p className="text-sm text-muted-foreground">
                  {t(
                    filtered
                      ? 'historyDates.empty'
                      : unpaidOnly
                        ? 'invoices.filter.unpaidEmpty'
                        : 'invoices.empty',
                    locale
                  )}
                </p>
                {resetFilters}
              </div>
            )
          }
        >
          {view === 'table' ? (
            <HistoryTable
              caption={t('invoices.title', locale)}
              items={items}
              columns={columns}
              rowKey={(item) => item.invoiceId}
            />
          ) : (
            <ul className="grid gap-3">
              {items.map((item) => (
                <li
                  key={item.invoiceId}
                  className="min-w-0 space-y-3 rounded-xl border bg-card p-4"
                >
                  {identity(item)}
                  {state(item)}
                  <dl className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="text-xs text-muted-foreground">
                        {t('historyView.amount', locale)}
                      </dt>
                      <dd className="font-semibold">
                        <bdi>{numbers.money(item.totalAmount)}</bdi>
                      </dd>
                    </div>
                    {item.paidAmount !== undefined && (
                      <div>
                        <dt className="text-xs text-muted-foreground">
                          {t('invoices.list.paid', locale)}
                        </dt>
                        <dd>
                          <bdi>{numbers.money(item.paidAmount)}</bdi>
                        </dd>
                      </div>
                    )}
                  </dl>
                  <dl className="grid grid-cols-2 gap-3 border-t pt-3 text-xs">
                    <div>
                      <dt className="text-muted-foreground">{t('invoices.list.issued', locale)}</dt>
                      <dd>{time.format(item.issuedAt)}</dd>
                    </div>
                    {item.dueAt && (
                      <div>
                        <dt className="text-muted-foreground">{t('invoices.list.due', locale)}</dt>
                        <dd>{time.format(item.dueAt)}</dd>
                      </div>
                    )}
                  </dl>
                </li>
              ))}
            </ul>
          )}
        </ListPage.Content>
        <ListPage.Pagination
          kind="cursor"
          hasMore={!!nextBefore && !error}
          loading={loading}
          onNext={loadMore}
          label={t('historyPagination.label', locale)}
          nextLabel={t('invoices.filter.more', locale)}
        />
      </ListPage>
    </div>
  );
}
