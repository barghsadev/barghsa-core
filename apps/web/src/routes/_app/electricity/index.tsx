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
  PageLoading,
  buttonVariants,
} from '@barghsa/ui';
import { t } from '@barghsa/i18n/app';
import { useLocale } from '../../../hooks/useLocale.js';
import { useNumberFormatting } from '../../../hooks/useNumberFormatting.js';

type ElectricityProduct = {
  id: string | null;
  systemKey: 'thermal' | 'green' | 'free_market' | 'energy_saving';
  title: Record<string, string> | null;
  description: Record<string, string> | null;
  status: 'active' | 'inactive' | 'archived' | 'missing';
  price: string | null;
  limits: { minKwh: string; maxKwh: string };
  orderable: boolean;
  simpleOrderable: boolean;
  simpleOrderBlockReasons: string[];
};

const systemKeys = ['thermal', 'green', 'free_market', 'energy_saving'];

function isCatalogue(value: unknown): value is ElectricityProduct[] {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every(
      (item, index) =>
        item &&
        typeof item === 'object' &&
        item.systemKey === systemKeys[index] &&
        (item.id === null || typeof item.id === 'string') &&
        (item.title === null || (typeof item.title === 'object' && !Array.isArray(item.title))) &&
        (item.description === null ||
          (typeof item.description === 'object' && !Array.isArray(item.description))) &&
        ['active', 'inactive', 'archived', 'missing'].includes(item.status) &&
        (item.price === null || (typeof item.price === 'string' && /^\d+$/.test(item.price))) &&
        typeof item.limits?.minKwh === 'string' &&
        /^\d+$/.test(item.limits.minKwh) &&
        typeof item.limits?.maxKwh === 'string' &&
        /^\d+$/.test(item.limits.maxKwh) &&
        typeof item.orderable === 'boolean' &&
        typeof item.simpleOrderable === 'boolean' &&
        Array.isArray(item.simpleOrderBlockReasons) &&
        item.simpleOrderBlockReasons.every((reason: unknown) => typeof reason === 'string')
    )
  );
}

function ElectricityIndexPage() {
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const [products, setProducts] = useState<ElectricityProduct[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const abort = new AbortController();
    setState('loading');
    void fetch('/api/products/electricity', { signal: abort.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Catalogue unavailable');
        const data: unknown = await response.json();
        if (!isCatalogue(data)) throw new Error('Invalid catalogue');
        if (!abort.signal.aborted) {
          setProducts(data);
          setState('ready');
        }
      })
      .catch(() => {
        if (!abort.signal.aborted) setState('error');
      });
    return () => abort.abort();
  }, [revision]);

  if (state === 'loading')
    return <PageLoading label={t('electricity.catalogue.loading', locale)} />;
  if (state === 'error')
    return (
      <EmptyState
        title={t('electricity.catalogue.error', locale)}
        description={t('electricity.catalogue.errorDescription', locale)}
        action={
          <Button onClick={() => setRevision((current) => current + 1)}>
            {t('electricity.order.retry', locale)}
          </Button>
        }
      />
    );

  return (
    <main className="flex flex-col gap-8" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t('electricity.catalogue.title', locale)}
        </h1>
        <p className="text-muted-foreground">{t('electricity.catalogue.description', locale)}</p>
        <Link
          to="/electricity/orders"
          className="w-fit text-sm text-primary underline underline-offset-4"
        >
          {t('electricity.orders.title', locale)}
        </Link>
        <Link to="/electricity/advanced" className={buttonVariants({ variant: 'outline' })}>
          {t('electricity.catalogue.advancedOrder', locale)}
        </Link>
      </header>
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
              <CardContent className="flex flex-1 flex-col gap-2 text-sm">
                <p>
                  <span className="text-muted-foreground">
                    {t('electricity.catalogue.price', locale)}:{' '}
                  </span>
                  {product.price !== null
                    ? numbers.money(product.price)
                    : t('electricity.catalogue.priceUnavailable', locale)}
                </p>
                <p className="text-muted-foreground">
                  {t('electricity.catalogue.limits', locale)}:{' '}
                  {product.limits.minKwh === '0' && product.limits.maxKwh === '0'
                    ? t('electricity.catalogue.noLimits', locale)
                    : `${numbers.irrDigits(product.limits.minKwh)}–${product.limits.maxKwh === '0' ? '∞' : numbers.irrDigits(product.limits.maxKwh)} kWh`}
                </p>
              </CardContent>
              {product.systemKey === 'thermal' && product.orderable && !product.simpleOrderable ? (
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
    </main>
  );
}

export const Route = createFileRoute('/_app/electricity/')({ component: ElectricityIndexPage });
