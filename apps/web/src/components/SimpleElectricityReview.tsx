import { Button, Card, CardContent } from '@barghsa/ui';
import { t } from '@barghsa/i18n/app';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import type { PriceQuote } from '../routes/_app/electricity/order.js';
import { ElectricityQuoteErrorNotice } from './ElectricityQuoteErrorNotice.js';
import { ElectricityFinancialReviewSummary } from './ElectricityFinancialReviewSummary.js';
import { ElectricityContractTerms } from './ElectricityContractTerms.js';
import { WalletFundingPrompt } from './WalletFundingPrompt.js';

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
  walletBalance: string | null;
  onEdit: (step: number) => void;
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
  walletBalance,
  onEdit,
}: Props) {
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  return (
    <Card className="mb-6">
      <CardContent className="pt-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">
            {t(step === 3 ? 'electricity.order.step3' : 'electricity.order.review', locale)}
          </h2>
          {step === 5 && (
            <Button variant="link" size="sm" onClick={() => onEdit(3)}>
              {t('electricity.order.edit', locale)}
            </Button>
          )}
        </div>

        <div className="space-y-3 text-sm">
          {quoting ? (
            <p role="status">{t('electricity.order.previewLoading', locale)}</p>
          ) : quoteError ? (
            <ElectricityQuoteErrorNotice message={quoteError} />
          ) : quote ? (
            <div className="space-y-2 border-b pb-4">
              <p className="flex flex-wrap items-center gap-2">
                {t('electricity.order.period.selection', locale)}: {periodLabel}
                {step === 5 && (
                  <Button variant="link" size="sm" onClick={() => onEdit(1)}>
                    {t('electricity.order.edit', locale)}
                  </Button>
                )}
              </p>
              {step === 5 && (
                <p className="flex items-center gap-2">
                  {t('electricity.order.quantity', locale)}: {quote.totalKwh} kWh
                  <Button variant="link" size="sm" onClick={() => onEdit(2)}>
                    {t('electricity.order.edit', locale)}
                  </Button>
                </p>
              )}
              <p>
                {t('electricity.order.averagePower', locale)}: {quote.averagePowerKw} kW
              </p>
              {quote.greenRuleApplies && (
                <p className="font-medium text-amber-800">
                  {t('electricity.order.mandatoryGreen', locale)}
                </p>
              )}
              {step === 5 ? (
                <ElectricityFinancialReviewSummary
                  quote={quote}
                  locale={locale}
                  formatMoney={numbers.money}
                  formatQuantity={numbers.irrDigits}
                />
              ) : (
                <>
                  {quote.lines.map((line) => (
                    <div key={line.systemKey} className="flex flex-wrap justify-between gap-2">
                      <span>
                        {line.systemKey === 'thermal'
                          ? t('electricity.order.thermal', locale)
                          : t('electricity.order.green', locale)}{' '}
                        · {line.quantityKwh} kWh × {numbers.money(line.unitPriceIrR)}
                      </span>
                      <span className="text-end">
                        <strong>
                          {t('electricity.order.lineTotal', locale)}: {numbers.money(line.totalIrR)}
                        </strong>
                        {(line.discountIrR !== '0' || line.vatIrR !== '0') && (
                          <small className="block text-muted-foreground">
                            {numbers.money(line.subtotalIrR)} · −{numbers.money(line.discountIrR)} ·
                            +{numbers.money(line.vatIrR)} {t('electricity.order.vat', locale)}
                          </small>
                        )}
                      </span>
                    </div>
                  ))}
                  <div className="flex justify-between">
                    <span>{t('electricity.order.discount', locale)}</span>
                    <span>{numbers.money(quote.discountIrR)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>{t('electricity.order.vat', locale)}</span>
                    <span>{numbers.money(quote.vatIrR)}</span>
                  </div>
                  <div className="flex justify-between text-base font-semibold">
                    <span>{t('electricity.order.total', locale)}</span>
                    <span>{numbers.money(quote.totalIrR)}</span>
                  </div>
                </>
              )}
              {step === 5 && (
                <div className="flex items-center justify-between gap-2">
                  <span>
                    {t('electricity.order.giftCode', locale)}: {appliedGiftCode || '—'}
                  </span>
                  <Button variant="link" size="sm" onClick={() => onEdit(4)}>
                    {t('electricity.order.edit', locale)}
                  </Button>
                </div>
              )}
            </div>
          ) : null}
          {step === 5 && (
            <>
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  {t('electricity.order.profile', locale)}:
                </span>
                <span className="max-w-[60%] text-end">
                  <strong className="block font-medium" dir="auto">
                    {activeProfileName || activeProfileId}
                  </strong>
                  {activeProfileName ? (
                    <small className="block break-all text-muted-foreground" dir="ltr">
                      {activeProfileId}
                    </small>
                  ) : null}
                </span>
              </div>
              {/* Selected product */}
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">
                  {t('electricity.order.product', locale)}:
                </span>
                <span className="font-medium">{productName || '—'}</span>
                <Button variant="link" size="sm" onClick={() => onEdit(1)}>
                  {t('electricity.order.edit', locale)}
                </Button>
              </div>

              {/* Selected address */}
              <div className="flex justify-between items-start">
                <span className="text-muted-foreground">
                  {t('electricity.order.deliveryAddress', locale)}:
                </span>
                <span className="font-medium text-right max-w-[60%]">{deliveryAddress || '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  {t('electricity.order.walletBalance', locale)}:
                </span>
                <span>
                  {walletBalance === null
                    ? t('electricity.order.walletUnavailable', locale)
                    : numbers.money(walletBalance)}
                </span>
              </div>
              {quote && <WalletFundingPrompt balance={walletBalance} total={quote.totalIrR} />}
              <div className="space-y-2 border-t pt-4 text-muted-foreground">
                <h3 className="font-medium text-foreground">
                  {t('electricity.order.contractPreview', locale)}
                </h3>
                {quote && (
                  <div className="rounded-lg border bg-muted/30 p-3 text-foreground">
                    <p>
                      {t('electricity.order.quantity', locale)}: {quote.totalKwh} kWh
                    </p>
                    <p>
                      {t('electricity.order.period.selection', locale)}: {periodLabel}
                    </p>
                    <p>
                      {t('electricity.order.total', locale)}: {numbers.money(quote.totalIrR)}
                    </p>
                  </div>
                )}
                <ElectricityContractTerms template={quote?.contractTemplate} />
                <h3 className="font-medium text-foreground">
                  {t('electricity.order.cancellationRules', locale)}
                </h3>
                <p>{t('electricity.order.cancellationRulesText', locale)}</p>
                <p>{t('electricity.order.paymentAfterSubmit', locale)}</p>
              </div>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
