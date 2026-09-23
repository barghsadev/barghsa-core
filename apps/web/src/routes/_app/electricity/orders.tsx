import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { t } from '@barghsa/i18n/app';
import { Button, Card, CardContent } from '@barghsa/ui';
import { useLocale } from '../../../hooks/useLocale.js';
import { useNumberFormatting } from '../../../hooks/useNumberFormatting.js';

interface ListedOrder {
  orderId: string;
  electricityStatus: string;
  financialStatus: string;
  nextAction: string;
  submittedAt: string;
  periodStart: string;
  periodEnd: string;
  totalKwh: string;
  totalIrR: string;
}

export function ElectricityOrdersPage() {
  const locale = useLocale();
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
        setOrders(result.orders);
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
  }, [before, revision]);

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
        <a
          href="/electricity/order"
          className="rounded-md border px-4 py-2 text-sm text-primary underline underline-offset-4"
        >
          {t('electricity.orders.new', locale)}
        </a>
      </header>
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
        <p>{t('electricity.orders.empty', locale)}</p>
      ) : (
        <div className="space-y-3">
          {orders.map((order) => (
            <Card key={order.orderId}>
              <CardContent className="space-y-3 pt-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <a
                    href={`/electricity/orders/${encodeURIComponent(order.orderId)}`}
                    className="font-semibold text-primary underline underline-offset-4"
                  >
                    {t('electricity.orders.view', locale)} · {order.orderId}
                  </a>
                  <span className="text-sm text-muted-foreground">
                    {new Date(order.submittedAt).toLocaleDateString(locale)}
                  </span>
                </div>
                <p className="text-sm">
                  {new Date(order.periodStart).toLocaleDateString(locale)} –{' '}
                  {new Date(order.periodEnd).toLocaleDateString(locale)} ·{' '}
                  {numbers.irrDigits(order.totalKwh)} kWh · {numbers.money(order.totalIrR)}
                </p>
                <div className="flex flex-wrap gap-2 text-sm">
                  <span className="rounded-full border px-3 py-1">
                    {t(`electricity.order.status.${order.electricityStatus}`, locale)}
                  </span>
                  <span className="rounded-full border px-3 py-1">
                    {t(`electricity.order.financial.${order.financialStatus}`, locale)}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  {t(`electricity.order.nextAction.${order.nextAction}`, locale)}
                </p>
              </CardContent>
            </Card>
          ))}
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

export const Route = createFileRoute('/_app/electricity/orders')({
  component: ElectricityOrdersPage,
});
