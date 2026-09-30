import {
  useHistoryFilterDraft,
  type HistoryFilterSelection,
} from '../hooks/useHistoryFilterDraft.js';
import { useListView } from '../hooks/useListView.js';
import { HistoryTable, type HistoryColumn } from '../components/HistoryTable.js';
import type { HistoryFilterKey } from '../lib/history-filter-state.js';
import { HistoryFilterPanel } from '../components/HistoryFilterPanel.js';
import { HistoryListControls } from '../components/HistoryListControls.js';
import { DEFAULT_HISTORY_SORT, type HistoryQuery } from '@barghsa/shared/validation';
import { t } from '@barghsa/i18n/app';
import { HistoryDateFilter } from '../components/HistoryDateFilter.js';
import type { DateRangeFilterValue } from '@barghsa/shared/validation';
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Button, Card, CardContent, StatusFilter, StatusBadge, ListViewToggle } from '@barghsa/ui';
import { SAVING_ORDER_STATUSES } from '@barghsa/shared/validation';
import { useCursorHistory } from '../hooks/useCursorHistory.js';
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

export function SavingOrdersPage({
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
  const rangeKey = `${dateRange.from ?? ''}:${dateRange.to ?? ''}`;
  const {
    items: orders,
    before,
    nextBefore,
    acceptPage,
    loadMore,
  } = useCursorHistory<SavingOrderRow>(
    `${pendingOnly}:${statusesKey}:${rangeKey}:${query.q}:${query.sort}`
  );
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  useEffect(() => {
    const controller = new AbortController();
    setState('loading');
    void (async () => {
      try {
        const profileResponse = await fetch('/api/profiles', { signal: controller.signal });
        if (!profileResponse.ok) throw new Error('profile');
        const profile = (await profileResponse.json()) as { activeProfileId: string | null };
        if (!profile.activeProfileId) {
          if (!controller.signal.aborted) {
            acceptPage([], null);
            setState('ready');
          }
          return;
        }
        const params = new URLSearchParams({ profileId: profile.activeProfileId });
        if (before) params.set('before', before);
        if (pendingOnly) params.set('status', 'pending');
        if (statusesKey) params.set('statuses', statusesKey);
        if (dateRange.from) params.set('from', dateRange.from);
        if (dateRange.to) params.set('to', dateRange.to);
        if (query.q) params.set('q', query.q);
        if (query.sort !== DEFAULT_HISTORY_SORT) params.set('sort', query.sort);
        const response = await fetch(`/api/saving/orders?${params}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('orders');
        const result = (await response.json()) as {
          orders: SavingOrderRow[];
          nextBefore: string | null;
        };
        if (!controller.signal.aborted) {
          acceptPage(result.orders, result.nextBefore);
          setState('ready');
        }
      } catch {
        if (!controller.signal.aborted) setState('error');
      }
    })();
    return () => controller.abort();
  }, [
    before,
    pendingOnly,
    statusesKey,
    dateRange.from,
    dateRange.to,
    query.q,
    query.sort,
    acceptPage,
  ]);
  const columns: HistoryColumn<SavingOrderRow>[] = [
    {
      id: 'reference',
      label: t('historySearch.reference', locale),
      render: (order) => (
        <Link
          to="/savings/orders/$orderId"
          params={{ orderId: order.id }}
          className="text-primary underline underline-offset-4"
        >
          <bdi dir="ltr" className="break-all">
            {order.id}
          </bdi>
        </Link>
      ),
    },
    {
      id: 'plan',
      label: copy('stepPlan'),
      render: (order) => (
        <div className="min-w-44 space-y-1">
          <p className="font-medium" dir="auto">
            {order.plan_title[locale]}
          </p>
          <p className="text-muted-foreground" dir="auto">
            {order.hardware_title[locale]}
          </p>
        </div>
      ),
    },
    {
      id: 'status',
      label: t('historyView.status', locale),
      render: (order) => (
        <StatusBadge
          label={
            statusOptions.find((option) => option.value === order.status)?.label ?? order.status
          }
          tone={statusFilterTone(order.status)}
        />
      ),
    },
    {
      id: 'amount',
      label: t('historyView.amount', locale),
      render: (order) => (
        <bdi className="whitespace-nowrap">{numbers.money(order.total_amount)}</bdi>
      ),
    },
    {
      id: 'financial',
      label: copy('financialStatus'),
      render: (order) => copy('financial.' + order.financial_status),
    },
    {
      id: 'bill',
      label: copy('billIdentifier'),
      render: (order) => <bdi dir="ltr">{order.bill_identifier}</bdi>,
    },
    {
      id: 'submitted',
      label: copy('submittedAt'),
      render: (order) => (
        <time dateTime={order.submitted_at}>
          {time.format(order.submitted_at, { year: 'numeric', month: '2-digit', day: '2-digit' })}
        </time>
      ),
    },
    {
      id: 'action',
      label: copy('nextAction'),
      render: (order) => {
        const action = savingNextAction(order);
        return action.href ? (
          <Link className="font-medium text-primary underline underline-offset-4" to={action.href}>
            {copy('action.' + action.kind)}
          </Link>
        ) : (
          copy('action.' + action.kind)
        );
      },
    },
  ];
  return (
    <main
      className={`mx-auto w-full min-w-0 space-y-6 p-4 md:p-8 ${view === 'table' ? 'max-w-7xl' : 'max-w-4xl'}`}
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      <header className="space-y-2">
        <Link to="/savings" className="text-sm text-primary hover:underline">
          {copy('title')}
        </Link>
        <h1 className="text-3xl font-semibold">{copy('orders')}</h1>
      </header>
      <nav className="flex gap-4 text-sm" aria-label={copy('orders')}>
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
          className="text-primary underline underline-offset-4"
          aria-current={
            pendingOnly || statuses.length || dateRange.from || dateRange.to || query.q
              ? undefined
              : 'page'
          }
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
          className="text-primary underline underline-offset-4"
          aria-current={pendingOnly ? 'page' : undefined}
        >
          {copy('pendingOrders')}
        </Link>
      </nav>
      <ListViewToggle
        value={view}
        onChange={setView}
        labels={{
          group: t('historyView.group', locale),
          table: t('historyView.table', locale),
          card: t('historyView.card', locale),
        }}
      />
      <HistoryFilterPanel
        query={query}
        statuses={statuses}
        dateRange={dateRange}
        onClear={onClearFilters}
        onOpen={filterDraft.begin}
        onApply={onApplyFilters ? filterDraft.apply : undefined}
        onRemoveFilter={onRemoveFilter}
        statusOptions={statusOptions}
        formatDate={(value) => time.format(value, { dateStyle: 'medium', timeStyle: 'short' })}
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
      {time.notice}
      {state === 'loading' && <p role="status">{copy('loading')}</p>}
      {state === 'error' && <p role="alert">{copy('error')}</p>}
      {state === 'ready' && orders.length === 0 && (
        <p>
          {dateRange.from || dateRange.to || query.q
            ? t('historyDates.empty', locale)
            : copy(
                statuses.length ? 'filteredEmpty' : pendingOnly ? 'noPendingOrders' : 'noOrders'
              )}
        </p>
      )}
      {view === 'table' && orders.length ? (
        <HistoryTable
          caption={copy('orders')}
          items={orders}
          columns={columns}
          rowKey={(order) => order.id}
        />
      ) : (
        <div className="space-y-3">
          {orders.map((order) => {
            const action = savingNextAction(order);
            return (
              <Card key={order.id}>
                <CardContent className="space-y-2 pt-6">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="font-semibold">{order.plan_title[locale]}</h2>
                      <p className="text-sm text-muted-foreground">
                        {order.hardware_title[locale]}
                      </p>
                    </div>
                    <span className="rounded-full bg-muted px-3 py-1 text-xs">
                      {copy(
                        order.status === 'awaiting_staff_review'
                          ? 'staffReview'
                          : order.status === 'in_progress'
                            ? 'inProgress'
                            : order.status
                      )}
                    </span>
                  </div>
                  <p className="text-sm">
                    <bdi>{order.bill_identifier}</bdi> ·{' '}
                    <time dateTime={order.submitted_at}>
                      {time.format(order.submitted_at, {
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                      })}
                    </time>
                  </p>
                  <p className="break-all text-xs text-muted-foreground">
                    {t('historySearch.reference', locale)}: <bdi>{order.id}</bdi>
                  </p>
                  <p className="font-medium">
                    <bdi>{numbers.money(order.total_amount)}</bdi>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {copy('financialStatus')}: {copy('financial.' + order.financial_status)}
                  </p>
                  <p className="text-sm">
                    {copy('nextAction')}:{' '}
                    {action.href ? (
                      <Link className="font-medium text-primary hover:underline" to={action.href}>
                        {copy('action.' + action.kind)}
                      </Link>
                    ) : (
                      <span>{copy('action.' + action.kind)}</span>
                    )}
                  </p>
                  <Link
                    to="/savings/orders/$orderId"
                    params={{ orderId: order.id }}
                    className="inline-block text-sm font-medium text-primary hover:underline"
                  >
                    {copy('orderDetail')}
                  </Link>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
      {nextBefore && state !== 'error' ? (
        <Button variant="outline" disabled={state === 'loading'} onClick={loadMore}>
          {copy('moreOrders')}
        </Button>
      ) : null}
    </main>
  );
}
