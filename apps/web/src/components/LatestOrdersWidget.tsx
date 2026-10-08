import { Link } from '@tanstack/react-router';
import { t, type Locale } from '@barghsa/i18n/workspace';
import { dashboardText } from '@barghsa/i18n/dashboard';
import { formatCurrencyIrr } from '@barghsa/i18n/numbers';
import { tSaving } from '@barghsa/i18n/saving';
import type { useAccountTime } from '../hooks/useAccountTime.js';

export interface RecentOrder {
  kind: 'electricity' | 'saving';
  orderId: string;
  status: string;
  submittedAt: string;
  amountIrR: string | null;
}

const savingStatuses = new Set([
  'submitted',
  'approved',
  'completed',
  'cancelled',
  'rejected',
  'pending',
]);

function orderStatus(order: RecentOrder, locale: Locale) {
  if (order.kind === 'electricity') {
    const key = `electricity.order.status.${order.status}`;
    const label = t(key, locale);
    return label === key ? t('electricity.order.status.unknown', locale) : label;
  }
  const key =
    order.status === 'awaiting_staff_review'
      ? 'staffReview'
      : order.status === 'in_progress'
        ? 'inProgress'
        : order.status;
  return savingStatuses.has(key) || key === 'staffReview' || key === 'inProgress'
    ? tSaving(key, locale)
    : t('electricity.order.status.unknown', locale);
}

export function LatestOrdersWidget({
  orders,
  locale,
  time,
  embedded = false,
}: {
  orders: RecentOrder[];
  locale: Locale;
  time: ReturnType<typeof useAccountTime>;
  embedded?: boolean;
}) {
  const Frame = embedded ? 'div' : 'section';
  return (
    <Frame
      className={embedded ? 'space-y-4' : 'space-y-4 rounded-xl border bg-card p-5'}
      aria-labelledby={embedded ? undefined : 'recent-orders-title'}
    >
      {!embedded && (
        <h2 id="recent-orders-title" className="text-lg font-semibold">
          {dashboardText('orders.title', locale)}
        </h2>
      )}
      {orders.length === 0 ? (
        <p className="text-sm text-muted-foreground">{dashboardText('orders.empty', locale)}</p>
      ) : (
        <ul className="divide-y">
          {orders.map((order) => (
            <li
              key={`${order.kind}-${order.orderId}`}
              className="flex flex-wrap items-center justify-between gap-4 py-4 first:pt-0 last:pb-0"
            >
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-medium">
                  {dashboardText(`orders.${order.kind}`, locale)} ·{' '}
                  <bdi>{order.orderId.slice(0, 8).toUpperCase()}</bdi>
                </p>
                <p className="text-sm text-muted-foreground">
                  {orderStatus(order, locale)} ·{' '}
                  <time dateTime={order.submittedAt}>
                    {time.format(order.submittedAt, {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </time>
                </p>
                <p className="text-sm font-semibold tabular-nums">
                  {order.amountIrR === null
                    ? dashboardText('orders.amountUnavailable', locale)
                    : formatCurrencyIrr(order.amountIrR, locale)}
                </p>
              </div>
              {order.kind === 'electricity' ? (
                <Link
                  to="/electricity/orders/$orderId"
                  params={{ orderId: order.orderId }}
                  className="text-sm font-medium text-primary underline underline-offset-4"
                  aria-label={`${dashboardText('orders.view', locale)} · ${order.orderId}`}
                >
                  {dashboardText('orders.view', locale)}
                </Link>
              ) : (
                <Link
                  to="/savings/orders/$orderId"
                  params={{ orderId: order.orderId }}
                  className="text-sm font-medium text-primary underline underline-offset-4"
                  aria-label={`${dashboardText('orders.view', locale)} · ${order.orderId}`}
                >
                  {dashboardText('orders.view', locale)}
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-x-5 gap-y-2 border-t pt-4 text-sm font-medium">
        <Link to="/electricity/orders" className="text-primary underline underline-offset-4">
          {dashboardText('orders.viewAllElectricity', locale)}
        </Link>
        <Link to="/savings/orders" className="text-primary underline underline-offset-4">
          {dashboardText('orders.viewAllSaving', locale)}
        </Link>
      </div>
    </Frame>
  );
}
