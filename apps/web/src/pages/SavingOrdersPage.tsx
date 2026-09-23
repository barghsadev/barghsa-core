import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Button, Card, CardContent } from '@barghsa/ui';
import { tSaving } from '@barghsa/i18n/saving';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { savingNextAction, type SavingActionContext } from '../lib/saving-next-action.js';

interface SavingOrderRow extends SavingActionContext {
  bill_identifier: string;
  submitted_at: string;
  plan_title: { fa: string; en: string };
  hardware_title: { fa: string; en: string };
  total_amount: string;
}

export function SavingOrdersPage({ pendingOnly = false }: { pendingOnly?: boolean }) {
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const copy = (key: string) => tSaving(key, locale);
  const [orders, setOrders] = useState<SavingOrderRow[]>([]);
  const [before, setBefore] = useState<string | null>(null);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
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
            setOrders([]);
            setNextBefore(null);
            setState('ready');
          }
          return;
        }
        const params = new URLSearchParams({ profileId: profile.activeProfileId });
        if (before) params.set('before', before);
        if (pendingOnly) params.set('status', 'pending');
        const response = await fetch(`/api/saving/orders?${params}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('orders');
        const result = (await response.json()) as {
          orders: SavingOrderRow[];
          nextBefore: string | null;
        };
        if (!controller.signal.aborted) {
          setOrders((current) => {
            if (!before) return result.orders;
            const shown = new Set(current.map((order) => order.id));
            return [...current, ...result.orders.filter((order) => !shown.has(order.id))];
          });
          setNextBefore(result.nextBefore);
          setState('ready');
        }
      } catch {
        if (!controller.signal.aborted) setState('error');
      }
    })();
    return () => controller.abort();
  }, [before, pendingOnly]);
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
      <nav className="flex gap-4 text-sm" aria-label={copy('orders')}>
        <Link
          to="/savings/orders"
          search={{ status: undefined }}
          className="text-primary underline underline-offset-4"
          aria-current={pendingOnly ? undefined : 'page'}
        >
          {copy('allOrders')}
        </Link>
        <Link
          to="/savings/orders"
          search={{ status: 'pending' }}
          className="text-primary underline underline-offset-4"
          aria-current={pendingOnly ? 'page' : undefined}
        >
          {copy('pendingOrders')}
        </Link>
      </nav>
      {state === 'loading' && <p role="status">{copy('loading')}</p>}
      {state === 'error' && <p role="alert">{copy('error')}</p>}
      {state === 'ready' && orders.length === 0 && (
        <p>{copy(pendingOnly ? 'noPendingOrders' : 'noOrders')}</p>
      )}
      <div className="space-y-3">
        {orders.map((order) => {
          const action = savingNextAction(order);
          return (
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
      {nextBefore && state !== 'error' ? (
        <Button
          variant="outline"
          disabled={state === 'loading'}
          onClick={() => setBefore(nextBefore)}
        >
          {copy('moreOrders')}
        </Button>
      ) : null}
    </main>
  );
}
