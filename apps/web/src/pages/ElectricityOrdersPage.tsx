import { ListPage } from '@barghsa/ui';
import {
  useHistoryFilterDraft,
  type HistoryFilterSelection,
} from '../hooks/useHistoryFilterDraft.js';
import { useListView } from '../hooks/useListView.js';
import { HistoryTable, type HistoryColumn } from '../components/HistoryTable.js';
import type { HistoryFilterKey } from '../lib/history-filter-state.js';
import { HistoryFilterPanel } from '../components/HistoryFilterPanel.js';
import { Link } from '@tanstack/react-router';
import { t } from '@barghsa/i18n/app';
import {
  Button,
  Card,
  CardContent,
  StatusFilter,
  DualStatusDisplay,
  ListViewToggle,
} from '@barghsa/ui';
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
            href: `/contracts?contractId=${encodeURIComponent(order.contractId)}`,
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
  const columns: HistoryColumn<ListedOrder>[] = [
    {
      id: 'reference',
      label: t('historySearch.reference', locale),
      render: (order) => (
        <Link
          to="/electricity/orders/$orderId"
          params={{ orderId: order.orderId }}
          className="break-all font-semibold text-primary underline underline-offset-4"
        >
          {t('electricity.orders.view', locale)} · <bdi dir="ltr">{order.orderId}</bdi>
        </Link>
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
      render: (order) => <bdi className="whitespace-nowrap">{numbers.money(order.totalIrR)}</bdi>,
    },
    {
      id: 'quantity',
      label: t('electricity.order.quantity', locale),
      render: (order) => <bdi>{numbers.irrDigits(order.totalKwh)} kWh</bdi>,
    },
    { id: 'period', label: t('electricity.order.period.selection', locale), render: formatPeriod },
    {
      id: 'submitted',
      label: t('historyView.submitted', locale),
      render: (order) => (
        <time dateTime={order.submittedAt}>
          {time.format(order.submittedAt, { year: 'numeric', month: '2-digit', day: '2-digit' })}
        </time>
      ),
    },
    {
      id: 'action',
      label: t('electricity.order.nextAction', locale),
      render: (order) => {
        const action = nextActionLink(order);
        return (
          <div className="min-w-44 space-y-2">
            <p className="text-muted-foreground">
              {t(`electricity.order.nextAction.${order.nextAction}`, locale)}
            </p>
            {action && (
              <a
                className="font-medium text-primary underline underline-offset-4"
                href={action.href}
              >
                {t(action.label, locale)}
              </a>
            )}
          </div>
        );
      },
    },
  ];
  return (
    <main
      className={`container mx-auto min-w-0 space-y-6 px-4 py-8 ${view === 'table' ? 'max-w-7xl' : 'max-w-4xl'}`}
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t('electricity.orders.title', locale)}</h1>
          <p className="text-sm text-muted-foreground">
            {t('electricity.orders.description', locale)}
          </p>
        </div>
        <Link
          to="/electricity/order"
          className="rounded-md border px-4 py-2 text-sm text-primary underline underline-offset-4"
        >
          {t('electricity.orders.new', locale)}
        </Link>
      </header>
      <nav className="flex gap-4 text-sm" aria-label={t('electricity.orders.title', locale)}>
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
          className="text-primary underline underline-offset-4"
          aria-current={
            pendingOnly || statuses.length || dateRange.from || dateRange.to || query.q
              ? undefined
              : 'page'
          }
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
          className="text-primary underline underline-offset-4"
          aria-current={pendingOnly ? 'page' : undefined}
        >
          {t('electricity.orders.pending', locale)}
        </Link>
      </nav>
      <ListPage>
        <ListPage.Toolbar
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
          loadingView={<p role="status">{t('electricity.orders.loading', locale)}</p>}
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
            <p>
              {t(
                !noProfile && (statuses.length || dateRange.from || dateRange.to || query.q)
                  ? 'historyDates.empty'
                  : pendingOnly
                    ? 'electricity.orders.pendingEmpty'
                    : 'electricity.orders.empty',
                locale
              )}
            </p>
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
            <div className="space-y-3">
              {orders.map((order) => {
                const action = nextActionLink(order);
                return (
                  <Card key={order.orderId}>
                    <CardContent className="space-y-3 pt-6">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Link
                          to="/electricity/orders/$orderId"
                          params={{ orderId: order.orderId }}
                          className="break-all font-semibold text-primary underline underline-offset-4"
                        >
                          {t('electricity.orders.view', locale)} · <bdi>{order.orderId}</bdi>
                        </Link>
                        <span className="text-sm text-muted-foreground">
                          {time.format(order.submittedAt, {
                            year: 'numeric',
                            month: '2-digit',
                            day: '2-digit',
                          })}
                        </span>
                      </div>
                      <p className="text-sm">
                        {formatPeriod(order)} · {numbers.irrDigits(order.totalKwh)} kWh ·{' '}
                        {numbers.money(order.totalIrR)}
                      </p>
                      {status(order)}
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/50 p-3 text-sm">
                        <p className="text-muted-foreground">
                          {t(`electricity.order.nextAction.${order.nextAction}`, locale)}
                        </p>
                        {action ? (
                          <a
                            className="font-medium text-primary underline underline-offset-4"
                            href={action.href}
                          >
                            {t(action.label, locale)}
                          </a>
                        ) : null}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
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
    </main>
  );
}
