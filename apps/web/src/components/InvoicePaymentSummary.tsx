import { t } from '@barghsa/i18n/app';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { stateI18nKey, type CustomerInvoiceNode } from '../lib/customer-invoices.js';
import { WalletInvoicePaymentPanel } from './WalletInvoicePaymentPanel.js';

const payableStates = new Set(['Unpaid', 'PaymentUnderReview', 'PartiallyFunded', 'Overdue']);
const walletStates = new Set(['Unpaid', 'PartiallyFunded', 'Overdue']);

/** Calculate a display percentage without converting IRR amounts to floating point. */
export function invoicePaymentProgress(totalAmount: string, paidAmount: string) {
  if (!/^\d+$/.test(totalAmount) || !/^\d+$/.test(paidAmount)) return null;
  const total = BigInt(totalAmount);
  const paid = BigInt(paidAmount);
  if (paid > total) return null;
  return {
    remainingAmount: (total - paid).toString(),
    percent: total === 0n ? 100 : Number((paid * 100n) / total),
  };
}

export function InvoicePaymentSummary({
  invoice,
  onRefreshDetails,
}: {
  invoice: CustomerInvoiceNode;
  onRefreshDetails: () => Promise<void>;
}) {
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  if (invoice.adjustmentKind === 'credit') return null;
  const progress = invoicePaymentProgress(invoice.totalAmount, invoice.paidAmount);
  if (!progress) return null;
  const payable = payableStates.has(invoice.state);
  const walletEligible = walletStates.has(invoice.state);

  return (
    <section
      id="invoice-payment-summary"
      aria-labelledby="invoice-payment-summary-heading"
      className="space-y-4"
    >
      <div className="rounded-lg border border-border bg-card p-4 text-card-foreground">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="invoice-payment-summary-heading" className="text-lg font-semibold">
            {t('invoices.payment.title', locale)}
          </h2>
          <span className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">
            {t(stateI18nKey(invoice.state), locale)}
          </span>
        </div>
        <dl className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">{t('invoices.details.total', locale)}</dt>
            <dd className="font-semibold">{numbers.money(invoice.totalAmount)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('invoices.details.paid', locale)}</dt>
            <dd className="font-semibold text-success">{numbers.money(invoice.paidAmount)}</dd>
          </div>
          {payable || invoice.state === 'Paid' ? (
            <div>
              <dt className="text-muted-foreground">{t('invoices.payment.remaining', locale)}</dt>
              <dd
                className={
                  progress.remainingAmount !== '0'
                    ? 'font-semibold text-destructive'
                    : 'font-semibold text-success'
                }
              >
                {numbers.money(progress.remainingAmount)}
              </dd>
            </div>
          ) : null}
        </dl>
        <div
          role="progressbar"
          aria-label={t('invoices.payment.progress', locale)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress.percent}
          aria-valuetext={`${numbers.money(invoice.paidAmount)} / ${numbers.money(invoice.totalAmount)}`}
          className="mt-4 h-2 overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full rounded-full bg-success"
            style={{ width: `${progress.percent}%` }}
          />
        </div>
        {!payable && invoice.state === 'Cancelled' ? (
          <p className="mt-3 text-sm text-muted-foreground">
            {t('invoices.payment.cancelled', locale)}
          </p>
        ) : null}
      </div>
      <WalletInvoicePaymentPanel
        key={invoice.invoiceId}
        invoiceId={invoice.invoiceId}
        eligible={walletEligible}
        onRefreshDetails={onRefreshDetails}
      />
    </section>
  );
}
