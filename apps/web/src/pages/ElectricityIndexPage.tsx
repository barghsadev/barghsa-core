import { readWithDeadline, ServerQueryError } from '../lib/server-query-client.js';
import {
  isElectricityCatalogue,
  type ElectricityCatalogueProduct,
} from '../lib/electricity-catalogue.js';
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Badge, Button, ListPage, PageHeader, buttonVariants } from '@barghsa/ui';
import { t } from '@barghsa/i18n/workspace';
import { shellText } from '@barghsa/i18n/shell';
import { useLocale } from '../hooks/useLocale.js';
import { useNavigation } from '../hooks/useNavigation.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import ElectricityCompanyProfileNotice from '../components/ElectricityCompanyProfileNotice.js';
import { RecordListSkeleton } from '../components/RecordListSkeleton.js';

export default function ElectricityIndexPage() {
  const locale = useLocale();
  const navigation = useNavigation();
  const companyProfileRequired = !!navigation && navigation.profileType !== 'LEGAL';
  const numbers = useNumberFormatting(locale);
  const [products, setProducts] = useState<ElectricityCatalogueProduct[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'denied'>('loading');
  const [revision, setRevision] = useState(0);
  const offersStandardOrder = products.some((product) => product.simpleOrderable);

  useEffect(() => {
    const abort = new AbortController();
    setState('loading');
    void readWithDeadline(abort.signal, async (signal) => {
      const response = await fetch('/api/products/electricity', { signal });
      if (!response.ok) throw new ServerQueryError(response.status);
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
        if (cause instanceof ServerQueryError && (cause.status === 401 || cause.status === 403)) {
          setProducts([]);
          setState('denied');
        } else setState('error');
      });
    return () => abort.abort();
  }, [revision]);

  return (
    <div
      className="mx-auto flex w-full max-w-5xl flex-col gap-6"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      <PageHeader
        title={shellText('buyElectricity', locale)}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {!companyProfileRequired && offersStandardOrder && state === 'ready' && (
              <Link
                to="/electricity/orders/new"
                className={buttonVariants({ className: 'min-h-11' })}
              >
                {t('electricity.catalogue.createDraft', locale)}
              </Link>
            )}
            {!companyProfileRequired && offersStandardOrder && state === 'loading' && (
              <Button disabled className="min-h-11">
                {t('electricity.catalogue.createDraft', locale)}
              </Button>
            )}
            {!companyProfileRequired && (
              <Link
                to="/electricity/orders/new/advanced"
                className={buttonVariants({ variant: 'outline', className: 'min-h-11' })}
              >
                {t('electricity.catalogue.advancedOrder', locale)}
              </Link>
            )}
            <Link
              to="/electricity/orders"
              className={buttonVariants({ variant: 'ghost', className: 'min-h-11' })}
            >
              {t('electricity.orders.title', locale)}
            </Link>
          </div>
        }
      />
      {companyProfileRequired && <ElectricityCompanyProfileNotice heading="h2" />}
      <ListPage role="region" aria-labelledby="electricity-comparison">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="electricity-comparison" className="text-xl font-semibold">
            {t('electricity.catalogue.title', locale)}
          </h2>
          {state !== 'error' && (
            <Button
              variant="ghost"
              className="min-h-11"
              disabled={state === 'loading'}
              onClick={() => setRevision((value) => value + 1)}
            >
              {t('electricity.catalogue.refresh', locale)}
            </Button>
          )}
        </div>
        <ListPage.Content
          loading={state === 'loading'}
          error={state === 'error' || state === 'denied'}
          empty={false}
          emptyView={null}
          retainContent={!!products.length && state !== 'denied'}
          loadingView={
            <RecordListSkeleton
              label={t('electricity.catalogue.loading', locale)}
              view="card"
              headings={[]}
            />
          }
          errorView={
            state === 'denied' ? (
              <p role="alert">{t('electricity.catalogue.denied', locale)}</p>
            ) : (
              <div
                role="alert"
                className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4"
              >
                <p>{t('electricity.catalogue.error', locale)}</p>
                <Button variant="outline" onClick={() => setRevision((value) => value + 1)}>
                  {t('electricity.order.retry', locale)}
                </Button>
              </div>
            )
          }
        >
          <ul className="divide-y rounded-xl border bg-card">
            {products.map((product) => {
              const title =
                product.title?.[locale] ||
                product.title?.en ||
                product.title?.fa ||
                t(`electricity.catalogue.${product.systemKey}`, locale);
              const description =
                product.description?.[locale] || product.description?.en || product.description?.fa;
              return (
                <li
                  key={product.systemKey}
                  className="grid gap-x-8 gap-y-3 p-4 sm:p-5 lg:grid-cols-2"
                >
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                      <h3 className="text-base font-semibold" dir="auto">
                        {title}
                      </h3>
                      <Badge variant={product.orderable ? 'success' : 'outline'}>
                        {t(
                          product.orderable
                            ? 'electricity.catalogue.available'
                            : 'electricity.catalogue.unavailable',
                          locale
                        )}
                      </Badge>
                    </div>
                    {description && (
                      <p
                        dir="auto"
                        className="text-sm text-muted-foreground [overflow-wrap:anywhere]"
                      >
                        {description}
                      </p>
                    )}
                    {product.systemKey === 'thermal' &&
                      product.orderable &&
                      !product.simpleOrderable && (
                        <p className="text-sm text-muted-foreground">
                          {t('electricity.catalogue.greenRuleBlocked', locale)}
                        </p>
                      )}
                  </div>
                  <dl className="grid grid-cols-2 gap-3 border-t pt-3 text-sm lg:border-s lg:border-t-0 lg:ps-5 lg:pt-0">
                    <div className="min-w-0 space-y-1">
                      <dt className="text-muted-foreground">
                        {t('electricity.catalogue.price', locale)}
                      </dt>
                      <dd className="font-semibold tabular-nums [overflow-wrap:anywhere]">
                        {product.price !== null ? (
                          <bdi>{numbers.money(product.price)}</bdi>
                        ) : (
                          t('electricity.catalogue.priceUnavailable', locale)
                        )}
                      </dd>
                    </div>
                    <div className="min-w-0 space-y-1">
                      <dt className="text-muted-foreground">
                        {t('electricity.catalogue.limits', locale)}
                      </dt>
                      <dd className="tabular-nums [overflow-wrap:anywhere]">
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
                </li>
              );
            })}
          </ul>
        </ListPage.Content>
      </ListPage>
    </div>
  );
}
