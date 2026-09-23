import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Card, CardContent } from '@barghsa/ui';
import { tSaving } from '@barghsa/i18n/saving';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';

interface SavingOrderRow {
  id: string;
  bill_identifier: string;
  status: string;
  submitted_at: string;
  plan_title: { fa: string; en: string };
  hardware_title: { fa: string; en: string };
  invoice_state: string;
  total_amount: string;
}

export function SavingOrdersPage() {
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const copy = (key: string) => tSaving(key, locale);
  const [orders, setOrders] = useState<SavingOrderRow[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const profileResponse = await fetch('/api/profiles', { signal: controller.signal });
        if (!profileResponse.ok) throw new Error('profile');
        const profile = (await profileResponse.json()) as { activeProfileId: string | null };
        if (!profile.activeProfileId) {
          setState('ready');
          return;
        }
        const response = await fetch(`/api/saving/orders?profileId=${profile.activeProfileId}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('orders');
        const result = (await response.json()) as { orders: SavingOrderRow[] };
        if (!controller.signal.aborted) {
          setOrders(result.orders);
          setState('ready');
        }
      } catch {
        if (!controller.signal.aborted) setState('error');
      }
    })();
    return () => controller.abort();
  }, []);
  return (
    <main
      className="mx-auto w-full max-w-4xl space-y-6 p-4 md:p-8"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      <header className="space-y-2">
        <Link to="/savings" className="text-sm text-primary hover:underline">
          {copy('title')}
        </Link>
        <h1 className="text-3xl font-semibold">{copy('orders')}</h1>
      </header>
      {state === 'loading' && <p role="status">{copy('loading')}</p>}
      {state === 'error' && <p role="alert">{copy('error')}</p>}
      {state === 'ready' && orders.length === 0 && <p>{copy('noOrders')}</p>}
      <div className="space-y-3">
        {orders.map((order) => (
          <Card key={order.id}>
            <CardContent className="space-y-2 pt-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold">{order.plan_title[locale]}</h2>
                  <p className="text-sm text-muted-foreground">{order.hardware_title[locale]}</p>
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
                  {new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-US').format(
                    new Date(order.submitted_at)
                  )}
                </time>
              </p>
              <p className="font-medium">
                <bdi>{numbers.money(order.total_amount)}</bdi>
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
        ))}
      </div>
    </main>
  );
}
