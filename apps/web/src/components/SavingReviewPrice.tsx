import { confirmationText } from '@barghsa/i18n/confirmation';
import { formatToman } from '@barghsa/i18n/numbers';
import { tSaving } from '@barghsa/i18n/saving';
import { tSavingChange } from '@barghsa/i18n/saving-change';
import { ChevronDownIcon } from 'lucide-react';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';

interface SavingReviewQuote {
  totalIrR: string;
  subtotalIrR: string;
  discountIrR: string;
  vatIrR: string;
  lines: readonly {
    title: { en: string; fa: string };
    amountIrR: string;
    discountIrR: string;
    vatIrR: string;
  }[];
}

/** Display the exact totals and breakdown supplied by the reviewed quote. */
export function SavingReviewPrice({
  quote,
  currentTotal,
}: {
  quote: SavingReviewQuote;
  currentTotal?: string;
}) {
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const copy = (key: string) => tSaving(key, locale);
  const rials = numbers.money(quote.totalIrR);
  const priceRows = [
    ...quote.lines.map((line, index) => ({
      id: `line-${index}`,
      label: line.title[locale],
      amount: line.amountIrR,
      adjustment:
        line.discountIrR !== '0' || line.vatIrR !== '0'
          ? `−${numbers.money(line.discountIrR)} · +${numbers.money(line.vatIrR)} ${copy('vat')}`
          : null,
    })),
    { id: 'subtotal', label: copy('subtotal'), amount: quote.subtotalIrR },
    { id: 'discount', label: copy('discount'), amount: quote.discountIrR },
    { id: 'vat', label: copy('vat'), amount: quote.vatIrR },
  ];
  return (
    <>
      <dl className="rounded-lg bg-primary/5">
        <div className="px-4 py-3">
          <dt className="text-sm font-semibold">
            {currentTotal === undefined
              ? copy('total')
              : tSavingChange('customerRevisedTotal', locale)}
          </dt>
          <dd className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 wrap-anywhere tabular-nums">
            <bdi className="min-w-0 text-xl font-semibold">{rials}</bdi>
            {rials !== '—' && (
              <bdi className="min-w-0 text-sm text-muted-foreground">
                {formatToman(quote.totalIrR, locale, { numberStyle: numbers.numberStyle })}{' '}
                {confirmationText('toman', locale)}
              </bdi>
            )}
          </dd>
        </div>
        {currentTotal !== undefined && (
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t px-4 py-2 text-sm">
            <dt className="text-muted-foreground">
              {tSavingChange('customerCurrentTotal', locale)}
            </dt>
            <dd className="min-w-0 wrap-anywhere tabular-nums">
              <bdi>{numbers.money(currentTotal)}</bdi>
            </dd>
          </div>
        )}
      </dl>
      <details className="group">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-md px-2 text-sm font-medium text-primary hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
          {copy('priceBreakdown')}
          <ChevronDownIcon
            aria-hidden="true"
            className="size-4 shrink-0 group-open:rotate-180 motion-safe:transition-transform"
          />
        </summary>
        <dl className="divide-y divide-border border-t px-2 text-sm">
          {priceRows.map((row) => (
            <div
              key={row.id}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2"
            >
              <dt>{row.label}</dt>
              <dd className="min-w-0 wrap-anywhere font-medium tabular-nums">
                <bdi>{numbers.money(row.amount)}</bdi>
                {'adjustment' in row && row.adjustment && (
                  <small className="block text-muted-foreground">{row.adjustment}</small>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </details>
    </>
  );
}
