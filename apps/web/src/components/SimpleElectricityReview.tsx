import { Card, CardContent } from '@barghsa/ui';
import { t } from '@barghsa/i18n/app';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import type { PriceQuote } from '../routes/_app/electricity/order.js';
import { ElectricityQuoteErrorNotice } from './ElectricityQuoteErrorNotice.js';
import { ElectricityFinancialReviewSummary } from './ElectricityFinancialReviewSummary.js';
import { ElectricityContractTerms } from './ElectricityContractTerms.js';
import { WalletFundingPrompt } from './WalletFundingPrompt.js';
import { StepReviewPage } from './StepReviewPage.js';

interface Props {
  step: 3 | 5;
  quote: PriceQuote | null;
  quoting: boolean;
  quoteError: string;
  periodLabel: string;
  appliedGiftCode: string;
  activeProfileName: string | null;
  activeProfileId: string | null;
  productName: string;
  deliveryAddress: string;
  postalCode: string;
  walletBalance: string | null;
  onEdit: (step: number) => void;
  editDisabled: boolean;
}
export default function SimpleElectricityReview({
  step,
  quote,
  quoting,
  quoteError,
  periodLabel,
  appliedGiftCode,
  activeProfileName,
  activeProfileId,
  productName,
  deliveryAddress,
  postalCode,
  walletBalance,
  onEdit,
  editDisabled,
}: Props) {
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const copy = (key: string) => t(`electricity.order.${key}`, locale);
  const price = quoting ? (
    <p role="status">{copy('previewLoading')}</p>
  ) : quoteError ? (
    <ElectricityQuoteErrorNotice message={quoteError} />
  ) : quote ? (
    <>
      {quote.greenRuleApplies && <p>{copy('mandatoryGreen')}</p>}
      <ElectricityFinancialReviewSummary
        title={step === 5 ? copy('total') : copy('step3')}
        quote={quote}
        locale={locale}
        formatMoney={numbers.money}
        formatQuantity={numbers.irrDigits}
      />
    </>
  ) : null;
  return (
    <Card className="mb-6">
      <CardContent className="space-y-4 pt-6">
        {step === 3 ? (
          <>
            <h2 className="text-lg font-semibold">{copy('step3')}</h2>
            <p className="text-sm">
              {copy('period.selection')}: {periodLabel}
            </p>
            {quote && (
              <p className="text-sm">
                {copy('averagePower')}: {numbers.irrDigits(quote.averagePowerKw)} kW
              </p>
            )}
            {price}
          </>
        ) : (
          <>
            <StepReviewPage
              title={copy('review')}
              editLabel={copy('edit')}
              onEdit={onEdit}
              disabled={editDisabled}
              sections={[
                {
                  id: 'period',
                  title: copy('period.selection'),
                  step: 1,
                  rows: [
                    { label: copy('period.selection'), value: periodLabel },
                    { label: copy('product'), value: productName },
                  ],
                },
                {
                  id: 'quantity',
                  title: copy('quantity'),
                  step: 2,
                  rows: [
                    {
                      label: copy('quantity'),
                      value: quote ? `${numbers.irrDigits(quote.totalKwh)} kWh` : '—',
                    },
                    {
                      label: copy('averagePower'),
                      value: quote ? `${numbers.irrDigits(quote.averagePowerKw)} kW` : '—',
                    },
                  ],
                },
                { id: 'price', title: copy('step3'), step: 3, content: price },
                {
                  id: 'gift',
                  title: copy('giftCode'),
                  step: 4,
                  rows: [{ label: copy('giftCode'), value: appliedGiftCode || '—' }],
                },
                {
                  id: 'address',
                  title: copy('deliveryAddress'),
                  step: 4,
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
                  id: 'terms',
                  title: copy('contractPreview'),
                  content: (
                    <>
                      <ElectricityContractTerms template={quote?.contractTemplate} />
                      <h4 className="font-medium">{copy('cancellationRules')}</h4>
                      <p className="text-sm">{copy('cancellationRulesText')}</p>
                      <p className="text-sm">{copy('paymentAfterSubmit')}</p>
                    </>
                  ),
                },
              ]}
            />
            <p className="text-sm">
              {copy('walletBalance')}:{' '}
              {walletBalance === null ? copy('walletUnavailable') : numbers.money(walletBalance)}
            </p>
            {quote && <WalletFundingPrompt balance={walletBalance} total={quote.totalIrR} />}
          </>
        )}
      </CardContent>
    </Card>
  );
}
