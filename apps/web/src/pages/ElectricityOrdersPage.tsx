import { useListView } from '../hooks/useListView.js';
import { HistoryTable, type HistoryColumn } from '../components/HistoryTable.js';
import type { HistoryFilterKey } from '../lib/history-filter-state.js';
import { HistoryFilterPanel } from '../components/HistoryFilterPanel.js';
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { t } from '@barghsa/i18n/app';
import { Button, Card, CardContent, StatusFilter, StatusBadge, ListViewToggle } from '@barghsa/ui';
import {
  ELECTRICITY_ORDER_STATUSES,
  DEFAULT_HISTORY_SORT,
  type DateRangeFilterValue,
  type HistoryQuery,
} from '@barghsa/shared/validation';
import { HistoryDateFilter } from '../components/HistoryDateFilter.js';
import { HistoryListControls } from '../components/HistoryListControls.js';
import { useCursorHistory } from '../hooks/useCursorHistory.js';
import { statusFilterTone } from '../lib/status-filter-tone.js';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { isInvoiceUuid } from '../lib/due-at-override.js';

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

export function ElectricityOrdersPage({
  pendingOnly = false,
  statuses = [],
  onStatusesChange,
  dateRange = {},
  onDateRangeChange,
  query = { q: '', sort: DEFAULT_HISTORY_SORT },
  onQueryChange,
  onClearFilters,
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
  onRemoveFilter?: (key: HistoryFilterKey, value?: string) => void;
}) {
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
  const {
    items: orders,
    before,
    nextBefore,
    acceptPage,
    loadMore,
  } = useCursorHistory<ListedOrder & { id: string }>(
    `${pendingOnly}:${statusesKey}:${dateRange.from ?? ''}:${dateRange.to ?? ''}:${query.q}:${query.sort}`
  );
  const [noProfile, setNoProfile] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError(false);
    void (async () => {
      const profileResponse = await fetch('/api/profiles/verification-status', {
        credentials: 'include',
        signal: abort.signal,
      });
      if (!profileResponse.ok) throw new Error('Profile unavailable');
      const profile = (await profileResponse.json()) as { activeProfileId: string | null };
      if (!profile.activeProfileId) {
        if (!abort.signal.aborted) {
          acceptPage([], null);
          setNoProfile(true);
        }
        return;
      }
      if (abort.signal.aborted) return;
      setNoProfile(false);
      const params = new URLSearchParams({ profileId: profile.activeProfileId });
      if (before) params.set('before', before);
      if (pendingOnly) params.set('status', 'pending');
      if (statusesKey) params.set('statuses', statusesKey);
      if (dateRange.from) params.set('from', dateRange.from);
      if (dateRange.to) params.set('to', dateRange.to);
      if (query.q) params.set('q', query.q);
      if (query.sort !== DEFAULT_HISTORY_SORT) params.set('sort', query.sort);
      const response = await fetch(`/api/electricity/orders?${params}`, {
        credentials: 'include',
        signal: abort.signal,
      });
      if (!response.ok) throw new Error('Orders unavailable');
      const result = (await response.json()) as {
        orders: ListedOrder[];
        nextBefore: string | null;
      };
      if (!Array.isArray(result.orders)) throw new Error('Invalid orders');
      if (!abort.signal.aborted) {
        acceptPage(
          result.orders.map((order) => ({ ...order, id: order.orderId })),
          result.nextBefore
        );
      }
    })()
      .catch(() => {
        if (!abort.signal.aborted) setError(true);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [
    before,
    pendingOnly,
    revision,
    statusesKey,
    dateRange.from,
    dateRange.to,
    query.q,
    query.sort,
    acceptPage,
  ]);

  const formatPeriod = (order: ListedOrder) =>
    `${time.format(order.periodStart, { year: 'numeric', month: '2-digit', day: '2-digit' })} – ${time.format(new Date(new Date(order.periodEnd).getTime() - 1), { year: 'numeric', month: '2-digit', day: '2-digit' })}`;
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
      render: (order) => (
        <div className="flex flex-wrap gap-2">
          <StatusBadge
            label={t(`electricity.order.status.${order.electricityStatus}`, locale)}
            tone={statusFilterTone(order.electricityStatus)}
          />
          <StatusBadge label={t(`electricity.order.financial.${order.financialStatus}`, locale)} />
        </div>
      ),
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
        onRemoveFilter={onRemoveFilter}
        statusOptions={statusOptions}
        formatDate={(value) => time.format(value, { dateStyle: 'medium', timeStyle: 'short' })}
      >
        {onQueryChange && (
          <HistoryListControls
            value={query}
            onChange={onQueryChange}
            locale={locale}
            domain="electricity"
          />
        )}
        {onDateRangeChange && (
          <HistoryDateFilter
            value={dateRange}
            onChange={onDateRangeChange}
            locale={locale}
            time={time}
          />
        )}
        {onStatusesChange && (
          <StatusFilter
            label={t('electricity.orders.filterStatus', locale)}
            clearLabel={t('electricity.orders.clearFilters', locale)}
            countLabel={numbers.number(statuses.length)}
            value={statuses}
            onChange={onStatusesChange}
            options={statusOptions}
          />
        )}
      </HistoryFilterPanel>
      {time.notice}
      {loading ? (
        <p role="status">{t('electricity.orders.loading', locale)}</p>
      ) : error ? (
        <div role="alert" className="space-y-2">
          <p>{t('electricity.orders.error', locale)}</p>
          <Button onClick={() => setRevision((value) => value + 1)}>
            {t('electricity.order.retry', locale)}
          </Button>
        </div>
      ) : noProfile || orders.length === 0 ? (
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
      ) : view === 'table' ? (
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
                  <div className="flex flex-wrap gap-2 text-sm">
                    <span className="rounded-full border px-3 py-1">
                      {t(`electricity.order.status.${order.electricityStatus}`, locale)}
                    </span>
                    <span className="rounded-full border px-3 py-1">
                      {t(`electricity.order.financial.${order.financialStatus}`, locale)}
                    </span>
                  </div>
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
      {nextBefore && !noProfile && !error ? (
        <Button variant="outline" disabled={loading} onClick={loadMore}>
          {t('electricity.orders.more', locale)}
        </Button>
      ) : null}
    </main>
  );
}
