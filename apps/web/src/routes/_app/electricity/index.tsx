import { readWithDeadline } from '../../../lib/server-query-client.js';
import {
  isElectricityCatalogue,
  type ElectricityCatalogueProduct,
} from '../../../lib/electricity-catalogue.js';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  EmptyState,
  ListPage,
  PageHeader,
  PageLoading,
  buttonVariants,
} from '@barghsa/ui';
import { t } from '@barghsa/i18n/workspace';
import { useLocale } from '../../../hooks/useLocale.js';
import { useNumberFormatting } from '../../../hooks/useNumberFormatting.js';

function ElectricityIndexPage() {
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const [products, setProducts] = useState<ElectricityCatalogueProduct[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'denied'>('loading');
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const abort = new AbortController();
    setState('loading');
    void readWithDeadline(abort.signal, async (signal) => {
      const response = await fetch('/api/products/electricity', { signal });
      if (!response.ok) throw new Error(String(response.status));
      const data: unknown = await response.json();
      if (!isElectricityCatalogue(data)) throw new Error('Invalid catalogue');
      return data;
    })
      .then((data) => {
        if (!abort.signal.aborted) {
          setProducts(data);
          setState('ready');
        }
      })
      .catch((cause: unknown) => {
        if (abort.signal.aborted) return;
        if (cause instanceof Error && cause.message === '403') {
          setProducts([]);
          setState('denied');
        } else setState('error');
      });
    return () => abort.abort();
  }, [revision]);

  return (
    <div className="flex flex-col gap-6" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <PageHeader
        title={t('electricity.catalogue.title', locale)}
        description={t('electricity.catalogue.description', locale)}
        actions={
          <>
            <Link to="/electricity/advanced" className={buttonVariants({ variant: 'outline' })}>
              {t('electricity.catalogue.advancedOrder', locale)}
            </Link>
            <Link to="/electricity/orders" className={buttonVariants({ variant: 'ghost' })}>
              {t('electricity.orders.title', locale)}
            </Link>
          </>
        }
      />
      <ListPage>
        <ListPage.Toolbar
          actions={
            <Button
              variant="outline"
              disabled={state === 'loading'}
              onClick={() => setRevision((value) => value + 1)}
            >
              {t('electricity.catalogue.refresh', locale)}
            </Button>
          }
        />
        <ListPage.Content
          loading={state === 'loading'}
          error={state === 'error' || state === 'denied'}
          empty={false}
          emptyView={null}
          retainContent={!!products.length && state !== 'denied'}
          loadingView={<PageLoading label={t('electricity.catalogue.loading', locale)} />}
          errorView={
            state === 'denied' ? (
              <p role="alert">{t('electricity.catalogue.denied', locale)}</p>
            ) : (
              <div role="alert">
                <EmptyState
                  title={t('electricity.catalogue.error', locale)}
                  description={t('electricity.catalogue.errorDescription', locale)}
                  action={
                    <Button onClick={() => setRevision((value) => value + 1)}>
                      {t('electricity.order.retry', locale)}
                    </Button>
                  }
                />
              </div>
            )
          }
        >
          <div className="grid gap-4 md:grid-cols-2">
            {products.map((product) => {
              const title =
                product.title?.[locale] ||
                product.title?.en ||
                product.title?.fa ||
                t(`electricity.catalogue.${product.systemKey}`, locale);
              const description =
                product.description?.[locale] || product.description?.en || product.description?.fa;
              return (
                <Card key={product.systemKey} className="flex flex-col">
                  <CardHeader>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <CardTitle>{title}</CardTitle>
                      <Badge variant={product.orderable ? 'secondary' : 'outline'}>
                        {t(
                          product.orderable
                            ? 'electricity.catalogue.available'
                            : 'electricity.catalogue.unavailable',
                          locale
                        )}
                      </Badge>
                    </div>
                    {description ? <CardDescription>{description}</CardDescription> : null}
                  </CardHeader>
                  <CardContent className="flex-1 text-sm">
                    <dl className="flex flex-col gap-3 border-t pt-4">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                        <dt className="text-muted-foreground">
                          {t('electricity.catalogue.price', locale)}
                        </dt>
                        <dd className="font-semibold tabular-nums">
                          {product.price !== null ? (
                            <bdi>{numbers.money(product.price)}</bdi>
                          ) : (
                            t('electricity.catalogue.priceUnavailable', locale)
                          )}
                        </dd>
                      </div>
                      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                        <dt className="text-muted-foreground">
                          {t('electricity.catalogue.limits', locale)}
                        </dt>
                        <dd>
                          {product.limits.minKwh === '0' && product.limits.maxKwh === '0' ? (
                            t('electricity.catalogue.noLimits', locale)
                          ) : (
                            <bdi dir="ltr">
                              {numbers.irrDigits(product.limits.minKwh)}–
                              {product.limits.maxKwh === '0'
                                ? '∞'
                                : numbers.irrDigits(product.limits.maxKwh)}{' '}
                              kWh
                            </bdi>
                          )}
                        </dd>
                      </div>
                    </dl>
                  </CardContent>
                  {product.systemKey === 'thermal' &&
                  product.orderable &&
                  !product.simpleOrderable ? (
                    <CardFooter>
                      <p className="text-sm text-muted-foreground">
                        {t('electricity.catalogue.greenRuleBlocked', locale)}
                      </p>
                    </CardFooter>
                  ) : null}
                  {product.simpleOrderable ? (
                    <CardFooter>
                      <Link to="/electricity/order" className={buttonVariants()}>
                        {t('electricity.catalogue.createDraft', locale)}
                      </Link>
                    </CardFooter>
                  ) : null}
                </Card>
              );
            })}
          </div>
        </ListPage.Content>
      </ListPage>
    </div>
  );
}

export const Route = createFileRoute('/_app/electricity/')({ component: ElectricityIndexPage });
