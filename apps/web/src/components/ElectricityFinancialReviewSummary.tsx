import { FinancialReviewSummary } from '@barghsa/ui';
import { t } from '@barghsa/i18n/app';
import type { Locale } from '@barghsa/i18n/auth';

type ElectricityLine = {
  systemKey: string;
  quantityKwh: string;
  unitPriceIrR: string;
  subtotalIrR: string;
  discountIrR: string;
  vatIrR: string;
  totalIrR: string;
};

export function ElectricityFinancialReviewSummary({
  quote,
  locale,
  formatMoney,
  formatQuantity,
}: {
  quote: {
    lines: ElectricityLine[];
    discountIrR: string;
    vatIrR: string;
    totalIrR: string;
  };
  locale: Locale;
  formatMoney: (value: string) => string;
  formatQuantity: (value: string) => string;
}) {
  return (
    <FinancialReviewSummary
      title={t('electricity.order.review', locale)}
      rows={[
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
      ]}
      total={{ label: t('electricity.order.total', locale), value: formatMoney(quote.totalIrR) }}
    />
  );
}
