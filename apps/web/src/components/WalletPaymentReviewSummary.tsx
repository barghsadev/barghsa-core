import { FinancialReviewSummary } from '@barghsa/ui';
import type { WalletPaymentReview } from '@barghsa/shared/finance';
import { tWalletInvoicePayment as t } from '@barghsa/i18n/wallet-invoice-payment';
import { invoiceFinancialReviewRows } from './InvoiceFinancialReviewRows.js';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';

export function WalletPaymentReviewSummary({
  review,
  formatDate,
}: {
  review: WalletPaymentReview;
  formatDate: (value: string) => string;
}) {
  const locale = useLocale(),
    numbers = useNumberFormatting(locale);
  const text = (key: Parameters<typeof t>[0]) => t(key, locale);
  const data = review.data;
  const rows = [
    ...invoiceFinancialReviewRows(data, locale, numbers, formatDate),
    { id: 'source', label: text('source'), value: text('wallet') },
    {
      id: 'available',
      label: text('available'),
      value: numbers.money(data.payment.availableBefore),
    },
    { id: 'after', label: text('after'), value: numbers.money(data.payment.availableAfter) },
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
