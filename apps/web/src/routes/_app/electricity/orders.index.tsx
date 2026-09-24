import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { t } from '@barghsa/i18n/app';
import { Button, Card, CardContent } from '@barghsa/ui';
import { useLocale } from '../../../hooks/useLocale.js';
import { useAccountTime } from '../../../hooks/useAccountTime.js';
import { useNumberFormatting } from '../../../hooks/useNumberFormatting.js';
import { isInvoiceUuid } from '../../../lib/due-at-override.js';

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

export function ElectricityOrdersPage({ pendingOnly = false }: { pendingOnly?: boolean }) {
  const locale = useLocale();
  const time = useAccountTime(locale);
  const numbers = useNumberFormatting(locale);
  const [orders, setOrders] = useState<ListedOrder[]>([]);
  const [before, setBefore] = useState<string | null>(null);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
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
          setOrders([]);
          setNextBefore(null);
        }
        return;
      }
      const params = new URLSearchParams({ profileId: profile.activeProfileId });
      if (before) params.set('before', before);
      if (pendingOnly) params.set('status', 'pending');
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
        setOrders((current) => {
          if (!before) return result.orders;
          const shown = new Set(current.map((order) => order.orderId));
          return [...current, ...result.orders.filter((order) => !shown.has(order.orderId))];
        });
        setNextBefore(result.nextBefore);
      }
    })()
      .catch(() => {
        if (!abort.signal.aborted) setError(true);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [before, pendingOnly, revision]);

  return (
    <main
      className="container mx-auto max-w-4xl space-y-6 px-4 py-8"
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
          search={{ status: undefined }}
          className="text-primary underline underline-offset-4"
          aria-current={pendingOnly ? undefined : 'page'}
        >
          {t('electricity.orders.all', locale)}
        </Link>
        <Link
          to="/electricity/orders"
          search={{ status: 'pending' }}
          className="text-primary underline underline-offset-4"
          aria-current={pendingOnly ? 'page' : undefined}
        >
          {t('electricity.orders.pending', locale)}
        </Link>
      </nav>
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
      ) : orders.length === 0 ? (
        <p>
          {t(pendingOnly ? 'electricity.orders.pendingEmpty' : 'electricity.orders.empty', locale)}
        </p>
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
                      className="font-semibold text-primary underline underline-offset-4"
                    >
                      {t('electricity.orders.view', locale)} · {order.orderId}
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
                    {time.format(order.periodStart, {
                      year: 'numeric',
                      month: '2-digit',
                      day: '2-digit',
                    })}{' '}
                    –{' '}
                    {time.format(new Date(new Date(order.periodEnd).getTime() - 1), {
                      year: 'numeric',
                      month: '2-digit',
                      day: '2-digit',
                    })}{' '}
                    · {numbers.irrDigits(order.totalKwh)} kWh · {numbers.money(order.totalIrR)}
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
      {nextBefore ? (
        <Button variant="outline" onClick={() => setBefore(nextBefore)}>
          {t('electricity.orders.more', locale)}
        </Button>
      ) : null}
    </main>
  );
}

function ElectricityOrdersRoute() {
  const { status } = Route.useSearch();
  return <ElectricityOrdersPage key={status ?? 'all'} pendingOnly={status === 'pending'} />;
}

export const Route = createFileRoute('/_app/electricity/orders/')({
  validateSearch: (search: Record<string, unknown>) => ({
    status: search.status === 'pending' ? ('pending' as const) : undefined,
  }),
  component: ElectricityOrdersRoute,
});
