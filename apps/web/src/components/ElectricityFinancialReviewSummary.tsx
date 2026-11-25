import { ChevronDownIcon } from 'lucide-react';
import { t } from '@barghsa/i18n/workspace';
import type { Locale } from '@barghsa/i18n/auth';
import { confirmationText } from '@barghsa/i18n/confirmation';
import { formatToman } from '@barghsa/i18n/numbers';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';

type ElectricityLine = {
  systemKey: string;
  quantityKwh: string;
  unitPriceIrR: string;
  subtotalIrR: string;
  discountIrR: string;
  vatIrR: string;
  totalIrR: string;
};

type ElectricityPrice = {
  lines: ElectricityLine[];
  discountIrR: string;
  vatIrR: string;
  totalIrR: string;
};

function electricityPriceRows(
  quote: ElectricityPrice,
  locale: Locale,
  formatMoney: (value: string) => string,
  formatQuantity: (value: string) => string
) {
  return [
    ...quote.lines.map((line) => ({
      id: line.systemKey,
      label: `${t(`electricity.catalogue.${line.systemKey}`, locale)} · ${formatQuantity(line.quantityKwh)} kWh × ${formatMoney(line.unitPriceIrR)}`,
      value: (
        <>
          {t('electricity.order.lineTotal', locale)}: {formatMoney(line.totalIrR)}
          {(line.discountIrR !== '0' || line.vatIrR !== '0') && (
            <small className="block text-muted-foreground">
              {formatMoney(line.subtotalIrR)} · −{formatMoney(line.discountIrR)} · +
              {formatMoney(line.vatIrR)} {t('electricity.order.vat', locale)}
            </small>
          )}
        </>
      ),
    })),
    {
      id: 'discount',
      label: t('electricity.order.discount', locale),
      value: formatMoney(quote.discountIrR),
    },
    {
      id: 'vat',
      label: t('electricity.order.vat', locale),
      value: formatMoney(quote.vatIrR),
    },
  ];
}

export function ElectricityFinancialReviewSummary({
  quote,
  locale,
  expandable = false,
}: {
  quote: ElectricityPrice;
  locale: Locale;
  expandable?: boolean;
}) {
  const numbers = useNumberFormatting(locale);
  const rials = numbers.money(quote.totalIrR);
  const rows = (
    <dl className="divide-y divide-border px-4 text-sm">
      {electricityPriceRows(quote, locale, numbers.money, numbers.irrDigits).map((row) => (
        <div
          key={row.id}
          className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2"
        >
          <dt className="min-w-0 wrap-anywhere">{row.label}</dt>
          <dd className="min-w-0 break-words font-medium tabular-nums">
            <bdi>{row.value}</bdi>
          </dd>
        </div>
      ))}
    </dl>
  );
  const totalLabel = t('electricity.order.total', locale);
  return (
    <section aria-label={totalLabel} className="rounded-xl border bg-card">
      <dl className="rounded-lg bg-primary/5 px-4 py-3">
        <dt className="text-sm font-semibold">{totalLabel}</dt>
        <dd className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 wrap-anywhere tabular-nums">
          <bdi className="min-w-0 text-xl font-semibold">{rials}</bdi>
          {rials !== '—' && (
            <bdi className="min-w-0 text-sm text-muted-foreground">
              {formatToman(quote.totalIrR, locale, { numberStyle: numbers.numberStyle })}{' '}
              {confirmationText('toman', locale)}
            </bdi>
          )}
        </dd>
      </dl>
      <div className="border-t">
        {expandable ? (
          <details className="group">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-b-xl px-4 text-sm font-medium text-primary hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
              {t('electricity.order.detail.lines', locale)}
              <ChevronDownIcon
                aria-hidden="true"
                className="size-4 shrink-0 group-open:rotate-180 motion-safe:transition-transform"
              />
            </summary>
            <div className="border-t">{rows}</div>
          </details>
        ) : (
          rows
        )}
      </div>
    </section>
  );
}
