import { FinancialReviewSummary } from '@barghsa/ui';
import type { WalletPaymentReview } from '@barghsa/shared/finance';
import { tWalletInvoicePayment as t } from '@barghsa/i18n/wallet-invoice-payment';
import { invoiceFinancialReviewRows } from './InvoiceFinancialReviewRows.js';
import { useLocale } from '../hooks/useLocale.js';
import { useFinancialFormatting } from '../hooks/useFinancialFormatting.js';

export function WalletPaymentReviewSummary({
  review,
  formatDate,
}: {
  review: WalletPaymentReview;
  formatDate: (value: string) => string;
}) {
  const locale = useLocale(),
    numbers = useFinancialFormatting(locale);
  const text = (key: Parameters<typeof t>[0]) => t(key, locale);
  const data = review.data;
  const rows = [
    ...invoiceFinancialReviewRows(data, locale, numbers, formatDate),
    { id: 'source', label: text('source'), value: text('wallet') },
    {
      id: 'available',
      label: text('available'),
      value: numbers.reviewMoney(data.payment.availableBefore),
    },
    { id: 'after', label: text('after'), value: numbers.reviewMoney(data.payment.availableAfter) },
  ];
  return (
    <FinancialReviewSummary
      title={text('reviewTitle')}
      rows={rows}
      total={{
        label: text('paymentTotal'),
        value: numbers.reviewMoney(data.invoice.remainingAmount),
      }}
      notice={text('cancellationNotice')}
    />
  );
}
