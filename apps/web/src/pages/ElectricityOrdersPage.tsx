import { HistoryStatusEmpty } from '../components/QueueEmptyState.js';
import { ListPage, buttonVariants, cn } from '@barghsa/ui';
import { RecordListSkeleton } from '../components/RecordListSkeleton.js';
import {
  useHistoryFilterDraft,
  type HistoryFilterSelection,
} from '../hooks/useHistoryFilterDraft.js';
import { useListView } from '../hooks/useListView.js';
import { HistoryTable, type HistoryColumn } from '../components/HistoryTable.js';
import { Plus } from 'lucide-react';
import type { HistoryFilterKey } from '../lib/history-filter-state.js';
import { HistoryFilterPanel } from '../components/HistoryFilterPanel.js';
import { Link } from '@tanstack/react-router';
import { t } from '@barghsa/i18n/app';
import { Button, StatusFilter, DualStatusDisplay, ListViewToggle, PageHeader } from '@barghsa/ui';
import {
  ELECTRICITY_ORDER_STATUSES,
  DEFAULT_HISTORY_SORT,
  type DateRangeFilterValue,
  type HistoryQuery,
} from '@barghsa/shared/validation';
import { HistoryDateFilter } from '../components/HistoryDateFilter.js';
import { HistoryListControls } from '../components/HistoryListControls.js';
import { useCustomerServiceHistory } from '../hooks/useCustomerServiceHistory.js';
import { statusFilterTone } from '../lib/status-filter-tone.js';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { isInvoiceUuid } from '../lib/due-at-override.js';
import {
  commercialStatusTone,
  financialStatusTone,
  electricityStatusKey,
} from '../lib/electricity-status-tone.js';

interface ListedOrder {
  orderId: string;
  invoiceId: string;
  contractId: string;
  electricityStatus: string;
  financialStatus: string;
  nextAction: string;
  submittedAt: string;
  periodStart: string;
  periodEnd: string;
  totalKwh: string;
  totalIrR: string;
}

function nextActionLink(order: ListedOrder): { href: string; label: string } | null {
  switch (order.nextAction) {
    case 'pay_invoice':
    case 'await_payment_review':
    case 'await_refund':
      return typeof order.invoiceId === 'string' && isInvoiceUuid(order.invoiceId)
        ? {
            href: `/invoices/${encodeURIComponent(order.invoiceId)}`,
            label:
              order.nextAction === 'pay_invoice'
                ? 'electricity.orders.payInvoice'
                : 'electricity.orders.viewInvoice',
          }
        : null;
    case 'accept_contract':
      return typeof order.contractId === 'string' && isInvoiceUuid(order.contractId)
        ? {
            href: `/contracts/${encodeURIComponent(order.contractId)}`,
            label: 'electricity.orders.reviewContract',
          }
        : null;
    case 'resubmit_changes':
      return {
        href: `/electricity/orders/${encodeURIComponent(order.orderId)}`,
        label: 'electricity.orders.reviewChanges',
      };
    case 'continue_order':
      return { href: '/electricity/order', label: 'electricity.orders.continueOrder' };
    case 'await_delivery':
      return {
        href: `/electricity/orders/${encodeURIComponent(order.orderId)}`,
        label: 'electricity.orders.trackOrder',
      };
    default:
      return null;
  }
}

const identifyHistoryRow = (row: ListedOrder) => row.orderId;

export function ElectricityOrdersPage({
  pendingOnly = false,
  statuses = [],
  onStatusesChange,
  dateRange = {},
  onDateRangeChange,
  query = { q: '', sort: DEFAULT_HISTORY_SORT },
  onQueryChange,
  onClearFilters,
  onShowAllStatuses,
  onApplyFilters,
  onRemoveFilter,
}: {
  pendingOnly?: boolean;
  statuses?: readonly string[];
  onStatusesChange?: (statuses: string[]) => void;
  dateRange?: DateRangeFilterValue;
  onDateRangeChange?: (range: DateRangeFilterValue) => void;
  query?: HistoryQuery;
  onQueryChange?: (query: HistoryQuery) => void;
  onClearFilters?: () => void;
  onShowAllStatuses?: () => void;
  onApplyFilters?: (selection: HistoryFilterSelection<HistoryQuery>) => void;
  onRemoveFilter?: (key: HistoryFilterKey, value?: string) => void;
}) {
  const filterDraft = useHistoryFilterDraft({ query, statuses, dateRange }, onApplyFilters);
  const filterQuery = onApplyFilters ? filterDraft.draft.query : query;
  const filterStatuses = onApplyFilters ? filterDraft.draft.statuses : statuses;
  const filterDateRange = onApplyFilters ? filterDraft.draft.dateRange : dateRange;
  const onDraftQueryChange = onApplyFilters ? filterDraft.setQuery : onQueryChange;
  const onDraftStatusesChange = onApplyFilters ? filterDraft.setStatuses : onStatusesChange;
  const onDraftDateRangeChange = onApplyFilters ? filterDraft.setDateRange : onDateRangeChange;

  const { view, setView } = useListView('electricity-orders');
  const locale = useLocale();
  const time = useAccountTime(locale);
  const numbers = useNumberFormatting(locale);
  const statusOptions: Parameters<typeof StatusFilter>[0]['options'] =
    ELECTRICITY_ORDER_STATUSES.map((value) => ({
      value,
      label: t(`electricity.order.status.${value}`, locale),
      tone: statusFilterTone(value),
    }));
  const statusesKey = statuses.join(',');
  const params = new URLSearchParams();
  if (pendingOnly) params.set('status', 'pending');
  if (statusesKey) params.set('statuses', statusesKey);
  if (dateRange.from) params.set('from', dateRange.from);
  if (dateRange.to) params.set('to', dateRange.to);
  if (query.q) params.set('q', query.q);
  if (query.sort !== DEFAULT_HISTORY_SORT) params.set('sort', query.sort);
  const history = useCustomerServiceHistory<ListedOrder>({
    resource: 'orders',
    endpoint: '/api/electricity/orders',
    profileEndpoint: '/api/profiles/verification-status',
    query: params.toString(),
    itemsKey: 'orders',
    identify: identifyHistoryRow,
  });
  const { items: orders, nextBefore, loadMore, loading, noProfile } = history;
  const error = !!history.error;
  const allSelected =
    !pendingOnly && !statuses.length && !dateRange.from && !dateRange.to && !query.q;
  const scopeClass = (selected: boolean) =>
    cn(
      'touch-action rounded-md px-3 hover:bg-muted',
      selected ? 'bg-primary/10 font-semibold text-primary' : 'text-muted-foreground'
    );

  const formatPeriod = (order: ListedOrder) =>
    `${time.format(order.periodStart, { year: 'numeric', month: '2-digit', day: '2-digit' })} – ${time.format(new Date(new Date(order.periodEnd).getTime() - 1), { year: 'numeric', month: '2-digit', day: '2-digit' })}`;
  const status = (order: ListedOrder) => (
    <DualStatusDisplay
      commercialLabel={t('electricity.order.commercialStatus', locale)}
      commercialStatus={t(electricityStatusKey(order.electricityStatus, 'commercial'), locale)}
      commercialTone={commercialStatusTone(order.electricityStatus)}
      financialLabel={t('electricity.order.financialStatus', locale)}
      financialStatus={t(electricityStatusKey(order.financialStatus, 'financial'), locale)}
      financialTone={financialStatusTone(order.financialStatus)}
    />
  );
  const submitted = (order: ListedOrder) => (
    <time dateTime={order.submittedAt}>
      {time.format(order.submittedAt, { year: 'numeric', month: '2-digit', day: '2-digit' })}
    </time>
  );
  const identity = (order: ListedOrder) => (
    <div className="min-w-0 space-y-1 text-start">
      <Link
        to="/electricity/orders/$orderId"
        params={{ orderId: order.orderId }}
        aria-label={`${t('electricity.orders.view', locale)} ${order.orderId}`}
        className="touch-action font-semibold text-primary hover:underline underline-offset-4"
      >
        {formatPeriod(order)}
      </Link>
      <p className="text-xs font-normal text-muted-foreground">
        <bdi className="wrap-anywhere">{order.orderId}</bdi>
      </p>
    </div>
  );
  const nextStep = (order: ListedOrder) => {
    const action = nextActionLink(order);
    return action ? (
      <a
        className="touch-action font-medium text-primary hover:underline underline-offset-4"
        href={action.href}
      >
        {t(action.label, locale)}
      </a>
    ) : (
      <span className="text-muted-foreground">
        {t(`electricity.order.nextAction.${order.nextAction}`, locale)}
      </span>
    );
  };
  const columns: (HistoryColumn<ListedOrder> & { label: string })[] = [
    {
      id: 'reference',
      label: t('recordTable.orderTerms', locale),
      render: (order) => (
        <div className="space-y-2">
          {identity(order)}
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs font-normal text-muted-foreground">
            <bdi>{numbers.irrDigits(order.totalKwh)} kWh</bdi>
            <span>
              {t('historyView.submitted', locale)} {submitted(order)}
            </span>
          </div>
        </div>
      ),
    },
    {
      id: 'status',
      label: t('historyView.status', locale),
      render: status,
    },
    {
      id: 'amount',
      label: t('electricity.order.total', locale),
      render: (order) => (
        <bdi className="font-semibold whitespace-nowrap">{numbers.money(order.totalIrR)}</bdi>
      ),
    },
    {
      id: 'action',
      actions: true,
      label: t('electricity.order.nextAction', locale),
      render: (order) => <div className="min-w-32 text-start">{nextStep(order)}</div>,
    },
  ];
  return (
    <div
      className="mx-auto w-full max-w-5xl min-w-0 space-y-4"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      <PageHeader
        title={t('electricity.orders.title', locale)}
        actions={
          <Link to="/electricity/order" className={buttonVariants()}>
            <Plus aria-hidden="true" data-icon="inline-start" />
            {t('electricity.orders.new', locale)}
          </Link>
        }
      />
      <nav
        className="flex flex-wrap gap-2 text-sm"
        aria-label={t('electricity.orders.title', locale)}
      >
        <Link
          to="/electricity/orders"
          search={{
            status: undefined,
            statuses: undefined,
            from: undefined,
            to: undefined,
            q: undefined,
            sort: undefined,
          }}
          className={scopeClass(allSelected)}
          aria-current={allSelected ? 'page' : undefined}
        >
          {t('electricity.orders.all', locale)}
        </Link>
        <Link
          to="/electricity/orders"
          search={{
            status: 'pending',
            statuses: undefined,
            from: undefined,
            to: undefined,
            q: undefined,
            sort: undefined,
          }}
          className={scopeClass(pendingOnly)}
          aria-current={pendingOnly ? 'page' : undefined}
        >
          {t('electricity.orders.pending', locale)}
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
            >
              {onDraftQueryChange && (
                <HistoryListControls
                  value={filterQuery}
                  onChange={onDraftQueryChange}
                  locale={locale}
                  domain="electricity"
                />
              )}
              {onDraftDateRangeChange && (
                <HistoryDateFilter
                  value={filterDateRange}
                  onChange={onDraftDateRangeChange}
                  locale={locale}
                  time={time}
                />
              )}
              {onDraftStatusesChange && (
                <StatusFilter
                  label={t('electricity.orders.filterStatus', locale)}
                  clearLabel={t('electricity.orders.clearFilters', locale)}
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
        {time.notice}
        <ListPage.Content
          loading={loading}
          error={error}
          empty={noProfile || orders.length === 0}
          retainContent={!noProfile && orders.length > 0}
          loadingView={
            orders.length && !noProfile ? (
              <p role="status" className="sr-only">
                {t('electricity.orders.loading', locale)}
              </p>
            ) : (
              <RecordListSkeleton
                label={t('electricity.orders.loading', locale)}
                view={view}
                headings={columns.map((column) => column.label)}
              />
            )
          }
          errorView={
            <div role="alert" className="space-y-2">
              <p>
                {history.error === 'denied'
                  ? t('historyPagination.accessDenied', locale)
                  : t('electricity.orders.error', locale)}
              </p>
              <Button onClick={history.retry}>{t('electricity.order.retry', locale)}</Button>
            </div>
          }
          emptyView={
            <HistoryStatusEmpty
              locale={locale}
              probe={history.statusProbe}
              showAll={onShowAllStatuses}
              message={t(
                !noProfile && (statuses.length || dateRange.from || dateRange.to || query.q)
                  ? 'historyDates.empty'
                  : pendingOnly
                    ? 'electricity.orders.pendingEmpty'
                    : 'electricity.orders.empty',
                locale
              )}
            />
          }
        >
          {view === 'table' ? (
            <HistoryTable
              caption={t('electricity.orders.title', locale)}
              items={orders}
              columns={columns}
              rowKey={(order) => order.orderId}
            />
          ) : (
            <ul className="grid gap-3">
              {orders.map((order) => (
                <li key={order.orderId} className="min-w-0 space-y-3 rounded-xl border bg-card p-4">
                  {identity(order)}
                  {status(order)}
                  <dl className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="text-xs text-muted-foreground">
                        {t('electricity.order.total', locale)}
                      </dt>
                      <dd className="font-semibold">
                        <bdi>{numbers.money(order.totalIrR)}</bdi>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">
                        {t('historyView.submitted', locale)}
                      </dt>
                      <dd>{submitted(order)}</dd>
                    </div>
                  </dl>
                  <div className="flex flex-wrap items-baseline justify-between gap-2 border-t pt-3 text-sm">
                    {nextStep(order)}
                    <bdi className="text-muted-foreground">
                      {numbers.irrDigits(order.totalKwh)} kWh
                    </bdi>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </ListPage.Content>
        <ListPage.Pagination
          kind="cursor"
          hasMore={!!nextBefore && !noProfile && !error}
          loading={loading}
          onNext={loadMore}
          label={t('historyPagination.label', locale)}
          nextLabel={t('electricity.orders.more', locale)}
        />
      </ListPage>
    </div>
  );
}
