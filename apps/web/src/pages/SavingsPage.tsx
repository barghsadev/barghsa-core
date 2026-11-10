import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { tSaving } from '@barghsa/i18n/saving';
import { LoadingStatus, Button, Card, CardContent, ListPage } from '@barghsa/ui';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useManualServerRead } from '../hooks/useServerQuery.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { queryKeys } from '../lib/query-keys.js';
import { ServerQueryError } from '../lib/server-query-client.js';
import {
  parseSavingCatalogue,
  type SavingPlan,
  type SavingProduct,
} from '../lib/customer-saving-catalogue.js';

export function SavingsPage() {
  const locale = useLocale();
  const accountId = useAccountUser();
  const profileRevision = useProfileContextRevision();
  const read = useManualServerRead();
  const numbers = useNumberFormatting(locale);
  const copy = (key: string) => tSaving(key, locale);
  const [plans, setPlans] = useState<SavingPlan[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'denied'>('loading');
  const [revision, setRevision] = useState(0);
  const title = (product: SavingProduct) =>
    product.title[locale] || product.title.en || product.title.fa;
  const description = (product: SavingProduct) =>
    product.description?.[locale] || product.description?.en || product.description?.fa || '';
  const price = (value: string | null) =>
    value && BigInt(value) > 0n ? numbers.money(value) : copy('unpriced');

  useEffect(() => {
    const controller = new AbortController();
    setState('loading');
    const path = '/api/saving/plans';
    const key = queryKeys.saving.list(
      { context: 'account', ownerId: accountId ?? 'session', accountId, revision: profileRevision },
      new URLSearchParams({ endpoint: path })
    );
    void read(key, controller.signal, async (signal) => {
      const response = await fetch(path, { credentials: 'include', signal });
      if (!response.ok) throw new ServerQueryError(response.status);
      const plans = parseSavingCatalogue(await response.json());
      if (!plans) throw new Error('Invalid saving catalogue');
      return plans;
    })
      .then((validatedPlans) => {
        if (!controller.signal.aborted) {
          setPlans(validatedPlans);
          setState('ready');
        }
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        if (cause instanceof ServerQueryError && (cause.status === 401 || cause.status === 403)) {
          setPlans([]);
          setState('denied');
        } else setState('error');
      });
    return () => controller.abort();
  }, [revision, profileRevision, accountId, read]);

  return (
    <div
      className="mx-auto w-full max-w-5xl space-y-6 p-4 md:p-8"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">{copy('title')}</h1>
        <p className="max-w-2xl text-muted-foreground">{copy('introduction')}</p>
      </header>
      <ListPage>
        <ListPage.Toolbar
          actions={
            <Button
              variant="outline"
              disabled={state === 'loading'}
              onClick={() => setRevision((value) => value + 1)}
            >
              {copy('refresh')}
            </Button>
          }
        />
        <ListPage.Content
          loading={state === 'loading'}
          error={state === 'error' || state === 'denied'}
          empty={!plans.length}
          retainContent={!!plans.length && state !== 'denied'}
          loadingView={<LoadingStatus>{copy('loading')}</LoadingStatus>}
          errorView={
            state === 'denied' ? (
              <p role="alert">{copy('catalogueDenied')}</p>
            ) : (
              <div className="space-y-2">
                <p role="alert">{copy('error')}</p>
                <Button variant="outline" onClick={() => setRevision((value) => value + 1)}>
                  {copy('retry')}
                </Button>
              </div>
            )
          }
          emptyView={<p>{copy('empty')}</p>}
        >
          <div className="grid gap-5 lg:grid-cols-2">
            {plans.map((plan) => (
              <Card key={plan.id}>
                <CardContent className="space-y-5 pt-6">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-xl font-semibold">{title(plan)}</h2>
                      {description(plan) && (
                        <p className="mt-1 text-sm text-muted-foreground">{description(plan)}</p>
                      )}
                    </div>
                    <span className="shrink-0 rounded-full bg-muted px-3 py-1 text-xs">
                      {copy(plan.available ? 'available' : 'unavailable')}
                    </span>
                  </div>
                  <p>
                    <span className="text-muted-foreground">{copy('planPrice')}:</span>{' '}
                    <bdi className="font-semibold">{price(plan.price)}</bdi>
                  </p>
                  <section className="space-y-2">
                    <h3 className="font-medium">{copy('equipment')}</h3>
                    <ul className="divide-y rounded-md border px-3">
                      {plan.hardware.map((item) => (
                        <li key={item.id} className="py-3">
                          <div className="flex flex-wrap justify-between gap-3">
                            <span className="font-medium">{title(item)}</span>
                            <bdi>{price(item.price)}</bdi>
                          </div>
                          {description(item) && (
                            <p className="mt-1 text-sm text-muted-foreground">
                              {description(item)}
                            </p>
                          )}
                          {item.status !== 'active' && (
                            <p className="text-xs text-muted-foreground">{copy('inactive')}</p>
                          )}
                          <p className="text-xs text-muted-foreground">
                            {item.stock_tracking
                              ? (item.available_count ?? 0) > 0
                                ? copy('inStock')
                                : copy('outOfStock')
                              : copy('subjectToConfirmation')}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </section>
                  {plan.agreement ? (
                    <details className="rounded-md border p-3">
                      <summary className="cursor-pointer font-medium wrap-anywhere pointer-coarse:min-h-11 pointer-coarse:py-2">
                        {copy('agreement')}: <bdi>{plan.agreement.title}</bdi>
                      </summary>
                      <p dir="auto" className="mt-3 whitespace-break-spaces wrap-anywhere text-sm">
                        {plan.agreement.body}
                      </p>
                    </details>
                  ) : (
                    <p className="text-sm text-muted-foreground">{copy('noAgreement')}</p>
                  )}
                  {state === 'ready' && plan.available && (
                    <Link
                      to="/savings/order"
                      className="touch-action inline-flex min-h-11 items-center rounded-md bg-primary px-4 text-primary-foreground hover:shadow-md"
                    >
                      {copy('startOrder')}
                    </Link>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </ListPage.Content>
      </ListPage>
      <Link
        to="/savings/orders"
        className="touch-action inline-block text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        {copy('orders')}
      </Link>
    </div>
  );
}
