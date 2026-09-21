import { FinancialReviewSummary } from '@barghsa/ui';
import type { WalletPaymentReview } from '@barghsa/shared/finance';
import { tWalletInvoicePayment as t } from '@barghsa/i18n/wallet-invoice-payment';
import { contractText } from '@barghsa/i18n/contracts';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useAccountTime } from '../hooks/useAccountTime.js';

export function WalletPaymentReviewSummary({ review }: { review: WalletPaymentReview }) {
  const locale = useLocale(),
    numbers = useNumberFormatting(locale),
    time = useAccountTime(locale);
  const text = (key: Parameters<typeof t>[0]) => t(key, locale);
  const data = review.data;
  const date = (value: string | null) => (value === null ? text('notSet') : time.format(value));
  const rows = [
    { id: 'profile', label: text('profile'), value: data.profile.title || data.profile.id },
    { id: 'invoice', label: text('invoice'), value: data.invoice.id },
    {
      id: 'service',
      label: text('service'),
      value: data.invoice.serviceType
        ? contractText(data.invoice.serviceType, locale)
        : text('notSet'),
    },
    { id: 'issued', label: text('issued'), value: date(data.invoice.issuedAt) },
    { id: 'payable', label: text('payable'), value: date(data.invoice.payableFrom) },
    { id: 'due', label: text('due'), value: date(data.invoice.dueAt) },
    ...data.lines.map((line) => ({
      id: line.id,
      label: line.description,
      value: (
        <span className="flex flex-col gap-1">
          <span>
            {numbers.number(line.quantity)} × {numbers.money(line.unitPrice)}
          </span>
          <span>
            {text('discount')}: {numbers.money(line.discount)}
          </span>
          <span>
            {text('subtotal')}: {numbers.money(line.subtotal)}
          </span>
          <span>
            {text('vat')}: {numbers.money(line.vatAmount)} ·{' '}
            {numbers.percent(line.taxable ? line.vatRate / 10_000 : 0)}
          </span>
        </span>
      ),
    })),
    ...(data.totals
      ? [
          { id: 'discount', label: text('discount'), value: numbers.money(data.totals.discount) },
          { id: 'subtotal', label: text('subtotal'), value: numbers.money(data.totals.subtotal) },
          { id: 'vat', label: text('vat'), value: numbers.money(data.totals.vat) },
        ]
      : [{ id: 'breakdown', label: text('breakdown'), value: text('legacyBreakdown') }]),
    {
      id: 'invoiceTotal',
      label: text('invoiceTotal'),
      value: numbers.money(data.invoice.totalAmount),
    },
    { id: 'paid', label: text('alreadyPaid'), value: numbers.money(data.invoice.paidAmount) },
    { id: 'source', label: text('source'), value: text('wallet') },
    {
      id: 'available',
      label: text('available'),
      value: numbers.money(data.payment.availableBefore),
    },
    { id: 'after', label: text('after'), value: numbers.money(data.payment.availableAfter) },
    ...data.contracts.map((contract) => ({
      id: contract.id,
      label: `${text('contract')} · ${contractText(contract.serviceType, locale)} · ${contract.id.slice(-8)}`,
      value: (
        <span className="flex flex-col gap-1">
          <span>{contractText(contract.state, locale)}</span>
          <span>
            {contract.initialInvoice && contract.paymentRequired
              ? text('initialPayment')
              : text('otherContractChecks')}
          </span>
          {contract.signatureRequired ? <span>{text('signatureRequired')}</span> : null}
          {contract.serviceStartRequired ? <span>{text('serviceStartRequired')}</span> : null}
          <span>
            {text('serviceStarts')}: {date(contract.serviceStartsAt)}
          </span>
          <span>
            {text('serviceEnds')}: {date(contract.serviceEndsAt)}
          </span>
          <span>
            {text(
              contract.cancellationRefund === 'full_wallet' ? 'fullWalletRefund' : 'staffRefund'
            )}
          </span>
        </span>
      ),
    })),
  ];
  return (
    <FinancialReviewSummary
      title={text('reviewTitle')}
      rows={rows}
      total={{ label: text('paymentTotal'), value: numbers.money(data.invoice.remainingAmount) }}
      notice={text('cancellationNotice')}
    />
  );
}
