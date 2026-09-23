import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { tSaving } from '@barghsa/i18n/saving';
import { Button, Card, CardContent } from '@barghsa/ui';
import { useLocale } from '../../hooks/useLocale.js';
import { useNumberFormatting } from '../../hooks/useNumberFormatting.js';

interface Product {
  id: string;
  title: { fa: string; en: string };
  description: { fa: string; en: string } | null;
  price: string | null;
  status: string;
}
interface SavingPlan extends Product {
  hardware: Product[];
  agreement: { versionId: string; title: string; body: string; effectiveFrom: string } | null;
  available: boolean;
}

export function SavingsPage() {
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const copy = (key: string) => tSaving(key, locale);
  const [plans, setPlans] = useState<SavingPlan[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [revision, setRevision] = useState(0);
  const title = (product: Product) => product.title[locale] || product.title.en || product.title.fa;
  const description = (product: Product) =>
    product.description?.[locale] || product.description?.en || product.description?.fa || '';
  const price = (value: string | null) =>
    value && BigInt(value) > 0n ? numbers.money(value) : copy('unpriced');

  useEffect(() => {
    const controller = new AbortController();
    setState('loading');
    void fetch('/api/saving/plans', { credentials: 'include', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Saving plans unavailable');
        return response.json() as Promise<{ plans: SavingPlan[] }>;
      })
      .then((result) => {
        if (!controller.signal.aborted) {
          setPlans(result.plans);
          setState('ready');
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setState('error');
      });
    return () => controller.abort();
  }, [revision]);

  return (
    <main
      className="mx-auto w-full max-w-5xl space-y-6 p-4 md:p-8"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">{copy('title')}</h1>
        <p className="max-w-2xl text-muted-foreground">{copy('introduction')}</p>
      </header>
      {state === 'loading' && <p role="status">{copy('loading')}</p>}
      {state === 'error' && (
        <div role="alert" className="flex items-center gap-3">
          <span>{copy('error')}</span>
          <Button variant="outline" onClick={() => setRevision((value) => value + 1)}>
            {copy('retry')}
          </Button>
        </div>
      )}
      {state === 'ready' && plans.length === 0 && <p>{copy('empty')}</p>}
      {state === 'ready' && (
        <div className="grid gap-5 lg:grid-cols-2">
          {plans.map((plan) => (
            <Card key={plan.id} className={plan.available ? '' : 'opacity-75'}>
              <CardContent className="space-y-5 pt-6">
                <div className="flex items-start justify-between gap-3">
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
                        <div className="flex justify-between gap-3">
                          <span className="font-medium">{title(item)}</span>
                          <bdi>{price(item.price)}</bdi>
                        </div>
                        {description(item) && (
                          <p className="mt-1 text-sm text-muted-foreground">{description(item)}</p>
                        )}
                        {item.status !== 'active' && (
                          <p className="text-xs text-muted-foreground">{copy('inactive')}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
                {plan.agreement ? (
                  <details className="rounded-md border p-3">
                    <summary className="cursor-pointer font-medium">
                      {copy('agreement')}: {plan.agreement.title}
                    </summary>
                    <p className="mt-3 whitespace-pre-wrap text-sm">{plan.agreement.body}</p>
                  </details>
                ) : (
                  <p className="text-sm text-muted-foreground">{copy('noAgreement')}</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}

export const Route = createFileRoute('/_app/savings')({ component: SavingsPage });
