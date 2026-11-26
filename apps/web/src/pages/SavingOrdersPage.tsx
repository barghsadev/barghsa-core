import { HistoryStatusEmpty } from '../components/QueueEmptyState.js';
import { ListPage, cn } from '@barghsa/ui';
import { RecordListSkeleton } from '../components/RecordListSkeleton.js';
import {
  useHistoryFilterDraft,
  type HistoryFilterSelection,
} from '../hooks/useHistoryFilterDraft.js';
import { useListView } from '../hooks/useListView.js';
import { HistoryTable, type HistoryColumn } from '../components/HistoryTable.js';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import type { HistoryFilterKey } from '../lib/history-filter-state.js';
import { HistoryFilterPanel } from '../components/HistoryFilterPanel.js';
import { HistoryListControls } from '../components/HistoryListControls.js';
import { DEFAULT_HISTORY_SORT, type HistoryQuery } from '@barghsa/shared/validation';
import { t } from '@barghsa/i18n/app';
import { HistoryDateFilter } from '../components/HistoryDateFilter.js';
import type { DateRangeFilterValue } from '@barghsa/shared/validation';
import { Link } from '@tanstack/react-router';
import { Button, StatusFilter, DualStatusDisplay, ListViewToggle, statusTone } from '@barghsa/ui';
import { SAVING_ORDER_STATUSES } from '@barghsa/shared/validation';
import { useCustomerServiceHistory } from '../hooks/useCustomerServiceHistory.js';
import { statusFilterTone } from '../lib/status-filter-tone.js';
import { tSaving } from '@barghsa/i18n/saving';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { savingNextAction, type SavingActionContext } from '../lib/saving-next-action.js';

interface SavingOrderRow extends SavingActionContext {
  bill_identifier: string;
  submitted_at: string;
  plan_title: { fa: string; en: string };
  hardware_title: { fa: string; en: string };
  total_amount: string;
}

const identifyHistoryRow = (row: SavingOrderRow) => row.id;

export function SavingOrdersPage({
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

  const { view, setView } = useListView('saving-orders');
  const locale = useLocale();
  const time = useAccountTime(locale);
  const numbers = useNumberFormatting(locale);
  const copy = (key: string) => tSaving(key, locale);
  const statusOptions: Parameters<typeof StatusFilter>[0]['options'] = SAVING_ORDER_STATUSES.map(
    (value) => ({
      value,
      label: copy(
        value === 'awaiting_staff_review'
          ? 'staffReview'
          : value === 'in_progress'
            ? 'inProgress'
            : value
      ),
      tone: statusFilterTone(value),
    })
  );
  const statusesKey = statuses.join(',');
  const params = new URLSearchParams();
  if (pendingOnly) params.set('status', 'pending');
  if (statusesKey) params.set('statuses', statusesKey);
  if (dateRange.from) params.set('from', dateRange.from);
  if (dateRange.to) params.set('to', dateRange.to);
  if (query.q) params.set('q', query.q);
  if (query.sort !== DEFAULT_HISTORY_SORT) params.set('sort', query.sort);
  const history = useCustomerServiceHistory<SavingOrderRow>({
    resource: 'saving',
    endpoint: '/api/saving/orders',
    profileEndpoint: '/api/profiles',
    query: params.toString(),
    itemsKey: 'orders',
    identify: identifyHistoryRow,
  });
  const { items: orders, nextBefore, loadMore } = history;
  const state = history.loading ? 'loading' : history.error ? 'error' : 'ready';

  const allSelected =
    !pendingOnly && !statuses.length && !dateRange.from && !dateRange.to && !query.q;
  const scopeClass = (selected: boolean) =>
    cn(
      'touch-action rounded-md px-3 hover:bg-muted',
      selected ? 'bg-primary/10 font-semibold text-primary' : 'text-muted-foreground'
    );
  const identity = (order: SavingOrderRow) => (
    <div className="min-w-0 space-y-1">
      <Link
        to="/savings/orders/$orderId"
        params={{ orderId: order.id }}
        className="touch-action font-semibold text-primary hover:underline underline-offset-4"
      >
        <bdi>{order.plan_title[locale]}</bdi>
      </Link>
      <p className="text-sm font-normal text-muted-foreground">
        <bdi>{order.hardware_title[locale]}</bdi>
      </p>
      <p className="text-xs font-normal text-muted-foreground">
        <bdi className="wrap-anywhere">{order.id}</bdi>
      </p>
    </div>
  );
  const status = (order: SavingOrderRow) => (
    <DualStatusDisplay
      commercialLabel={t('historyView.status', locale)}
      commercialStatus={
        statusOptions.find((option) => option.value === order.status)?.label ?? order.status
      }
      commercialTone={statusFilterTone(order.status)}
      financialLabel={copy('financialStatus')}
      financialStatus={copy('financial.' + order.financial_status)}
      financialTone={statusTone(order.financial_status)}
    />
  );
  const submitted = (order: SavingOrderRow) => (
    <time dateTime={order.submitted_at}>
      {time.format(order.submitted_at, { year: 'numeric', month: '2-digit', day: '2-digit' })}
    </time>
  );
  const nextStep = (order: SavingOrderRow) => {
    const action = savingNextAction(order);
    const label = copy('action.' + action.kind);
    return action.href ? (
      <Link
        to={action.href}
        className="touch-action font-medium text-primary hover:underline underline-offset-4"
      >
        {label}
      </Link>
    ) : (
      <span className="text-muted-foreground">{label}</span>
    );
  };
  const columns: (HistoryColumn<SavingOrderRow> & { label: string })[] = [
    {
      id: 'plan',
      label: copy('stepPlan'),
      render: (order) => (
        <div className="space-y-2">
          {identity(order)}
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs font-normal text-muted-foreground">
            <span>
              {copy('billIdentifier')} <bdi>{order.bill_identifier}</bdi>
            </span>
            <span>
              {copy('submittedAt')} {submitted(order)}
            </span>
          </div>
        </div>
      ),
    },
    {
      id: 'status',
      label: t('historyView.status', locale),
      render: (order) => <div className="max-w-64">{status(order)}</div>,
    },
    {
      id: 'amount',
      label: t('historyView.amount', locale),
      render: (order) => (
        <bdi className="font-semibold whitespace-nowrap">{numbers.money(order.total_amount)}</bdi>
      ),
    },
    {
      id: 'action',
      actions: true,
      label: copy('nextAction'),
      render: (order) => <div className="min-w-32 text-start">{nextStep(order)}</div>,
    },
  ];
  return (
    <div
      className="mx-auto w-full max-w-5xl min-w-0 space-y-4"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      <header className="space-y-2">
        <Link
          to="/savings"
          className="touch-action inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline underline-offset-4"
        >
          <ArrowLeft aria-hidden="true" className="size-4 rtl:hidden" />
          <ArrowRight aria-hidden="true" className="hidden size-4 rtl:block" />
          {copy('title')}
        </Link>
        <h1 className="text-3xl font-semibold">{copy('orders')}</h1>
      </header>
      <nav className="flex flex-wrap gap-2 text-sm" aria-label={copy('orders')}>
        <Link
          to="/savings/orders"
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
          {copy('allOrders')}
        </Link>
        <Link
          to="/savings/orders"
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
          {copy('pendingOrders')}
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
                  domain="saving"
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
                  label={copy('filterStatus')}
                  clearLabel={copy('clearFilters')}
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
          loading={state === 'loading'}
          error={state === 'error'}
          empty={orders.length === 0}
          retainContent={orders.length > 0}
          loadingView={
            orders.length ? (
              <p role="status" className="sr-only">
                {copy('loading')}
              </p>
            ) : (
              <RecordListSkeleton
                label={copy('loading')}
                view={view}
                headings={columns.map((column) => column.label)}
              />
            )
          }
          errorView={
            <div className="space-y-2">
              <p role="alert">
                {history.error === 'denied'
                  ? t('historyPagination.accessDenied', locale)
                  : copy('error')}
              </p>
              <Button variant="outline" onClick={history.retry}>
                {t('historyPagination.retry', locale)}
              </Button>
            </div>
          }
          emptyView={
            <HistoryStatusEmpty
              locale={locale}
              probe={history.statusProbe}
              showAll={onShowAllStatuses}
              message={
                dateRange.from || dateRange.to || query.q
                  ? t('historyDates.empty', locale)
                  : copy(
                      statuses.length
                        ? 'filteredEmpty'
                        : pendingOnly
                          ? 'noPendingOrders'
                          : 'noOrders'
                    )
              }
            />
          }
        >
          {view === 'table' && orders.length ? (
            <HistoryTable
              caption={copy('orders')}
              items={orders}
              columns={columns}
              rowKey={(order) => order.id}
            />
          ) : (
            <ul className="grid gap-3">
              {orders.map((order) => (
                <li key={order.id} className="min-w-0 space-y-3 rounded-xl border bg-card p-4">
                  {identity(order)}
                  {status(order)}
                  <dl className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="text-xs text-muted-foreground">
                        {t('historyView.amount', locale)}
                      </dt>
                      <dd className="font-semibold">
                        <bdi>{numbers.money(order.total_amount)}</bdi>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">{copy('billIdentifier')}</dt>
                      <dd>
                        <bdi>{order.bill_identifier}</bdi>
                      </dd>
                    </div>
                  </dl>
                  <div className="flex flex-wrap items-baseline justify-between gap-2 border-t pt-3 text-sm">
                    {nextStep(order)}
                    <span className="text-xs text-muted-foreground">
                      {copy('submittedAt')} {submitted(order)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </ListPage.Content>
        <ListPage.Pagination
          kind="cursor"
          hasMore={!!nextBefore && state !== 'error'}
          loading={state === 'loading'}
          onNext={loadMore}
          label={t('historyPagination.label', locale)}
          nextLabel={copy('moreOrders')}
        />
      </ListPage>
    </div>
  );
}
