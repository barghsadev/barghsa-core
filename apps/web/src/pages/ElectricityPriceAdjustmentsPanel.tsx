import { useEffect, useState } from 'react';
import { t } from '@barghsa/i18n/app';
import { formatInTimezone } from '@barghsa/i18n/date-time';
import { Button, Card, CardContent } from '@barghsa/ui';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';

interface PriceComponent {
  source: 'original_invoice' | 'quantity_increase' | 'price_adjustment';
  invoiceId: string;
  basisIrR: string;
  oldFutureIrR: string;
  changeIrR: string;
  eligibleFrom: string;
}
interface PriceAdjustment {
  adjustmentId: string;
  status: 'proposed' | 'finalized' | 'cancelled';
  effectiveFrom: string;
  percentageBps: string;
  reason: string;
  contractualBasis: string;
  adjustmentAmountIrR: string;
  adjustmentInvoiceId: string | null;
  calculation: {
    quote: { oldFutureIrR: string; newFutureIrR: string; components: PriceComponent[] };
  };
}

export function ElectricityPriceAdjustmentsPanel({
  contractId,
  formatTimestamp,
}: {
  contractId: string;
  formatTimestamp?: (value: string) => string;
}) {
  const locale = useLocale();
  const timestamp =
    formatTimestamp ?? ((value: string) => formatInTimezone(value, 'Asia/Tehran', locale));
  const numbers = useNumberFormatting(locale);
  const [adjustments, setAdjustments] = useState<PriceAdjustment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const copy = (key: string) => t(`electricity.priceAdjustment.${key}`, locale);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    void fetch(`/api/electricity/contracts/${encodeURIComponent(contractId)}/price-adjustments`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('Price history unavailable');
        return response.json() as Promise<{ adjustments: PriceAdjustment[] }>;
      })
      .then((result) => {
        if (!Array.isArray(result.adjustments)) throw new Error('Invalid price history');
        if (!controller.signal.aborted) setAdjustments(result.adjustments);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [contractId, revision]);

  if (!loading && !error && adjustments.length === 0) return null;
  return (
    <Card>
      <CardContent className="space-y-4 pt-6 text-sm">
        <h2 className="font-semibold">{copy('title')}</h2>
        {loading ? <p role="status">{copy('loading')}</p> : null}
        {error ? (
          <div role="alert" className="flex items-center gap-3">
            <span>{copy('error')}</span>
            <Button variant="outline" onClick={() => setRevision((value) => value + 1)}>
              {copy('retry')}
            </Button>
          </div>
        ) : null}
        {adjustments.map((adjustment) => {
          const credit = BigInt(adjustment.adjustmentAmountIrR) < 0n;
          const amount = credit
            ? (-BigInt(adjustment.adjustmentAmountIrR)).toString()
            : adjustment.adjustmentAmountIrR;
          return (
            <section key={adjustment.adjustmentId} className="space-y-3 border-t pt-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-medium">{copy(credit ? 'credit' : 'charge')}</h3>
                <span className="rounded-full bg-muted px-3 py-1 text-xs">
                  {copy(`status.${adjustment.status}`)}
                </span>
              </div>
              <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">{copy('reason')}</dt>
                  <dd>{adjustment.reason}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{copy('basis')}</dt>
                  <dd>{adjustment.contractualBasis}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{copy('effective')}</dt>
                  <dd>{timestamp(adjustment.effectiveFrom)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{copy('percentage')}</dt>
                  <dd>{numbers.number(Number(adjustment.percentageBps) / 100)}%</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{copy('oldFuture')}</dt>
                  <dd>{numbers.irrDigits(adjustment.calculation.quote.oldFutureIrR)} IRR</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{copy('newFuture')}</dt>
                  <dd>{numbers.irrDigits(adjustment.calculation.quote.newFutureIrR)} IRR</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">
                    {copy(credit ? 'creditAmount' : 'amount')}
                  </dt>
                  <dd>{numbers.irrDigits(amount)} IRR</dd>
                </div>
              </dl>
              <details className="rounded-md border p-3">
                <summary className="cursor-pointer font-medium">{copy('calculation')}</summary>
                <ul className="mt-2 space-y-2">
                  {adjustment.calculation.quote.components.map((component) => (
                    <li key={component.invoiceId} className="border-t pt-2">
                      <strong>{copy(`source.${component.source}`)}</strong>
                      <p>
                        {copy('baseValue')}: {numbers.irrDigits(component.basisIrR)} IRR
                      </p>
                      <p>
                        {copy('componentStart')}: {timestamp(component.eligibleFrom)}
                      </p>
                      <p>
                        {copy('componentChange')}: {numbers.irrDigits(component.oldFutureIrR)} IRR
                        {' → '}
                        {numbers.irrDigits(component.changeIrR)} IRR
                      </p>
                    </li>
                  ))}
                </ul>
              </details>
              {adjustment.status === 'proposed' ? <p>{copy('beforeFinalization')}</p> : null}
              {adjustment.adjustmentInvoiceId ? (
                <a
                  className="text-primary underline"
                  href={`/invoices/${encodeURIComponent(adjustment.adjustmentInvoiceId)}`}
                >
                  {copy(credit ? 'viewCredit' : 'viewInvoice')}
                </a>
              ) : null}
            </section>
          );
        })}
      </CardContent>
    </Card>
  );
}
