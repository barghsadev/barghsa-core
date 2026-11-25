import type { ReactNode } from 'react';
import { t } from '@barghsa/i18n/workspace';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import type { PriceQuote } from '../pages/SimpleElectricityOrderPage.js';
import { ElectricityFinancialReviewSummary } from './ElectricityFinancialReviewSummary.js';
import { ElectricityContractTerms } from './ElectricityContractTerms.js';
import { OrderWalletBalance } from './OrderWalletBalance.js';
import { StepReviewPage } from './StepReviewPage.js';

interface Props {
  quote: PriceQuote | null;
  quoting: boolean;
  quoteErrorNotice: ReactNode;
  formatPeriod: (
    period: { start: string; end: string },
    locale: 'fa' | 'en'
  ) => { jalali: string; gregorian: string };
  calendarLabels: { jalali: string; gregorian: string };
  requestedKwh: string;
  appliedGiftCode: string;
  activeProfileName: string | null;
  activeProfileId: string | null;
  productName: string;
  deliveryAddress: string;
  postalCode: string;
  onEdit: (step: number) => void;
  editDisabled: boolean;
}
export default function SimpleElectricityReview({
  quote,
  quoting,
  quoteErrorNotice,
  formatPeriod,
  calendarLabels,
  requestedKwh,
  appliedGiftCode,
  activeProfileName,
  activeProfileId,
  productName,
  deliveryAddress,
  postalCode,
  onEdit,
  editDisabled,
}: Props) {
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const copy = (key: string) => t(`electricity.order.${key}`, locale);
  const quantity = quote?.totalKwh ?? (/^[1-9]\d*$/.test(requestedKwh) ? requestedKwh : '');
  const deliveryDates = quote
    ? formatPeriod({ start: quote.periodStart, end: quote.periodEnd }, locale)
    : null;
  const price = quoting ? (
    <p role="status">{copy('previewLoading')}</p>
  ) : quoteErrorNotice ? (
    quoteErrorNotice
  ) : quote ? (
    <>
      <ElectricityFinancialReviewSummary quote={quote} locale={locale} />
      {quote.greenRuleApplies && <p className="text-sm">{copy('mandatoryGreen')}</p>}
    </>
  ) : null;
  return (
    <div className="mb-4 min-w-0 space-y-3 lg:[&>section]:grid lg:[&>section]:grid-cols-2 lg:[&>section]:items-start lg:[&>section]:gap-3 lg:[&>section]:space-y-0 lg:[&>section>div]:col-span-full lg:[&_[data-review-section=price]]:row-span-3 lg:[&_[data-review-section=terms]]:col-span-full">
      <StepReviewPage
        title={copy('detail.title')}
        editLabel={copy('edit')}
        onEdit={onEdit}
        disabled={editDisabled}
        compact
        sections={[
          {
            id: 'quantity',
            title: copy('quantity'),
            step: 2,
            rows: [
              {
                label: copy('quantity'),
                value: quantity ? `${numbers.irrDigits(quantity)} kWh` : '—',
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
          },
          { id: 'price', title: copy('step3'), step: 3, content: price },
          {
            id: 'period',
            title: copy('period.selection'),
            step: 1,
            rows: [
              ...(deliveryDates
                ? [
                    {
                      label: calendarLabels.jalali,
                      value: (
                        <bdi lang="fa" dir="rtl">
                          {deliveryDates.jalali}
                        </bdi>
                      ),
                      fullWidth: true,
                    },
                    {
                      label: calendarLabels.gregorian,
                      value: deliveryDates.gregorian,
                      fullWidth: true,
                    },
                  ]
                : []),
              { label: copy('product'), value: productName },
            ],
          },
          {
            id: 'address',
            title: copy('deliveryAddress'),
            step: 5,
            rows: [
              { label: copy('deliveryAddress'), value: deliveryAddress || '—' },
              { label: copy('postalCode'), value: postalCode || '—' },
            ],
          },
          {
            id: 'profile',
            title: copy('profile'),
            rows: [{ label: copy('profile'), value: activeProfileName || activeProfileId }],
          },
          {
            id: 'gift',
            title: copy('giftCode'),
            step: 4,
            content: appliedGiftCode ? (
              <p className="text-sm">
                <bdi>{appliedGiftCode}</bdi>
              </p>
            ) : null,
          },
          {
            id: 'terms',
            title: copy('contractPreview'),
            content: (
              <>
                <ElectricityContractTerms template={quote?.contractTemplate} />
                <h4 className="font-medium">{copy('cancellationRules')}</h4>
                <p className="text-sm">{copy('cancellationRulesText')}</p>
                <p className="text-sm">{copy('quotePaymentTiming')}</p>
              </>
            ),
          },
        ]}
      />
      {activeProfileId && (
        <div className="rounded-lg border bg-card p-3">
          <OrderWalletBalance
            profileId={activeProfileId}
            total={quote?.totalIrR ?? '0'}
            checkout={{
              label: copy('walletBalance'),
              balanceField: 'balance',
              unavailable: copy('walletUnavailable'),
            }}
          />
        </div>
      )}
    </div>
  );
}
