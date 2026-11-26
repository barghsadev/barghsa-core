import { t } from '@barghsa/i18n/app';
import type { ReactNode } from 'react';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useLocale } from '../hooks/useLocale.js';
import type { AdvancedElectricityQuote } from '../pages/AdvancedElectricityOrderPage.js';
import { ElectricityContractTerms } from './ElectricityContractTerms.js';
import { ElectricityFinancialReviewSummary } from './ElectricityFinancialReviewSummary.js';
import { StepReviewPage, type ReviewSection } from './StepReviewPage.js';

type SystemKey = AdvancedElectricityQuote['lines'][number]['systemKey'];

export function AdvancedElectricityReview({
  quote,
  quantities,
  quantitiesValid,
  periodRows,
  address,
  giftCode,
  profile,
  quoteStatus,
  editDisabled,
  onEdit,
}: {
  quote: AdvancedElectricityQuote | null;
  quantities: Record<SystemKey, string>;
  quantitiesValid: boolean;
  periodRows: NonNullable<ReviewSection['rows']>;
  address: { fullAddress: string; postalCode: string } | undefined;
  giftCode: string;
  profile: string | null;
  quoteStatus: ReactNode;
  editDisabled: boolean;
  onEdit: (step: number) => void;
}) {
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const copy = (key: string) => t(`electricity.order.${key}`, locale);
  const requested = quantitiesValid
    ? Object.entries(quantities)
        .filter(([, quantity]) => BigInt(quantity) > 0n)
        .map(([systemKey, quantityKwh]) => ({ systemKey, quantityKwh }))
    : [];
  const lines = quote?.lines ?? requested;
  const quantity =
    quote?.totalKwh ?? requested.reduce((sum, line) => sum + BigInt(line.quantityKwh), 0n);
  return (
    <div className="lg:[&>section]:grid lg:[&>section]:grid-cols-2 lg:[&>section]:gap-3 lg:[&>section]:space-y-0 lg:[&>section>div]:col-span-full lg:[&_[data-review-section=price]]:row-span-2 lg:[&_[data-review-section=price]]:self-start lg:[&_[data-review-section=terms]]:col-span-full">
      <StepReviewPage
        compact
        title={copy('review')}
        editLabel={copy('edit')}
        disabled={editDisabled}
        onEdit={onEdit}
        sections={[
          {
            id: 'price',
            title: t('electricity.advanced.stepPrice', locale),
            content: quote ? (
              <ElectricityFinancialReviewSummary quote={quote} locale={locale} expandable />
            ) : (
              quoteStatus
            ),
          },
          {
            id: 'products',
            title: t('electricity.advanced.stepProducts', locale),
            step: 2,
            rows: [
              ...lines.map((line) => ({
                label: t(`electricity.catalogue.${line.systemKey}`, locale),
                value: `${numbers.irrDigits(line.quantityKwh)} kWh`,
              })),
              {
                label: copy('quantity'),
                value: quote || quantitiesValid ? `${numbers.irrDigits(quantity)} kWh` : null,
              },
              ...(quote
                ? [
                    {
                      label: copy('averagePower'),
                      value: <bdi dir="ltr">{quote.averagePowerKw} kW</bdi>,
                    },
                  ]
                : []),
            ],
            content: quote?.greenRuleApplies ? (
              <p className="text-sm">{copy('mandatoryGreen')}</p>
            ) : null,
          },
          {
            id: 'period',
            title: t('electricity.advanced.stepDates', locale),
            step: 1,
            rows: periodRows,
          },
          {
            id: 'address',
            title: copy('deliveryAddress'),
            step: 4,
            rows: [
              { label: copy('deliveryAddress'), value: address?.fullAddress, fullWidth: true },
              { label: copy('postalCode'), value: address?.postalCode },
            ],
          },
          {
            id: 'profile',
            title: copy('profile'),
            rows: [{ label: copy('profile'), value: profile }],
          },
          ...(giftCode
            ? [
                {
                  id: 'gift',
                  title: copy('giftCode'),
                  step: 4,
                  content: (
                    <p className="text-sm wrap-anywhere">
                      <bdi>{giftCode}</bdi>
                    </p>
                  ),
                },
              ]
            : []),
          ...(quote
            ? [
                {
                  id: 'terms',
                  title: copy('contractPreview'),
                  content: (
                    <>
                      <ElectricityContractTerms template={quote.contractTemplate} />
                      <h4 className="font-medium">{copy('cancellationRules')}</h4>
                      <p className="text-sm">{copy('cancellationRulesText')}</p>
                      <p className="text-sm">{copy('paymentAfterSubmit')}</p>
                    </>
                  ),
                },
              ]
            : []),
        ]}
      />
    </div>
  );
}
