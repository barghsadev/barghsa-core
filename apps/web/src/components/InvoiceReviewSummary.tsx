import { confirmationText } from '@barghsa/i18n/confirmation';
import { formatToman } from '@barghsa/i18n/numbers';
import { ChevronDownIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';

interface Row {
  id: string;
  label: string;
  value: ReactNode;
  fullWidth?: boolean;
}

export function InvoiceReviewSummary({
  label,
  amount,
  facts,
  details,
  detailsLabel,
}: {
  label: string;
  amount: string;
  facts: Row[];
  details: Row[];
  detailsLabel: string;
}) {
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const rials = numbers.money(amount);
  return (
    <section className="min-w-0 space-y-3 rounded-lg border p-3">
      <dl className="rounded-md bg-primary/5 p-3">
        <dt className="text-sm font-semibold">{label}</dt>
        <dd className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 wrap-anywhere tabular-nums">
          <bdi className="min-w-0 text-xl font-semibold">{rials}</bdi>
          {rials !== '—' && (
            <bdi className="min-w-0 text-sm text-muted-foreground">
              {formatToman(amount, locale, { numberStyle: numbers.numberStyle })}{' '}
              {confirmationText('toman', locale)}
            </bdi>
          )}
        </dd>
      </dl>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-1 text-sm">
        {facts.map(({ id, label, value, fullWidth }) => (
          <div key={id} className={fullWidth ? 'col-span-full min-w-0' : 'min-w-0'}>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="mt-1 font-medium whitespace-pre-line wrap-anywhere">
              <bdi>{value}</bdi>
            </dd>
          </div>
        ))}
      </dl>
      <details className="group border-t">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-md px-1 text-sm font-medium text-primary hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
          {detailsLabel}
          <ChevronDownIcon
            aria-hidden="true"
            className="size-4 shrink-0 group-open:rotate-180 motion-safe:transition-transform"
          />
        </summary>
        <dl className="divide-y divide-border px-1 text-sm">
          {details.map(({ id, label, value }) => (
            <div key={id} className="min-w-0 px-1 py-2">
              <dt dir="auto" className="font-medium text-muted-foreground wrap-anywhere">
                {label}
              </dt>
              <dd className="mt-1 min-w-0 px-1">
                <bdi dir="auto" className="block text-start whitespace-pre-line wrap-anywhere">
                  {value}
                </bdi>
              </dd>
            </div>
          ))}
        </dl>
      </details>
    </section>
  );
}
