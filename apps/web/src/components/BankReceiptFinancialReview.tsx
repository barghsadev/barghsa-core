import { FinancialReviewSummary } from '@barghsa/ui';
import type { BankReceiptConfirmationReview } from '@barghsa/shared/finance';
import { tWalletReceipts as t } from '@barghsa/i18n/wallet-receipts';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { invoiceFinancialReviewRows } from './InvoiceFinancialReviewRows.js';

export function BankReceiptFinancialReview({
  review,
  formatDate,
  formatPaymentDate,
}: {
  review: BankReceiptConfirmationReview;
  formatDate: (value: string) => string;
  formatPaymentDate: (value: string | null) => string;
}) {
  const locale = useLocale(),
    numbers = useNumberFormatting(locale),
    data = review.data;
  const text = (key: string) => t(`admin.walletReceipts.${key}`, locale);
  return (
    <FinancialReviewSummary
      title={text('review.title')}
      rows={[
        ...(data.invoice
          ? invoiceFinancialReviewRows(data.invoice, locale, numbers, formatDate)
          : [
              {
                id: 'profile',
                label: text('review.profile'),
                value: data.profile.title || data.profile.id,
              },
            ]),
        { id: 'source', label: text('review.source'), value: text('review.bank') },
        {
          id: 'receipt',
          label: text('paymentDate'),
          value: formatPaymentDate(data.receipt.paymentDate),
        },
        {
          id: 'reference',
          label: text('payerReference'),
          value: data.receipt.payerReference ?? text('none'),
        },
        {
          id: 'submitted',
          label: text('submittedAt'),
          value: formatDate(data.receipt.submittedAt),
        },
        {
          id: 'invoiceAllocation',
          label: text('invoiceAllocation'),
          value: numbers.money(data.allocation.invoiceAmount),
        },
        {
          id: 'walletCredit',
          label: text(data.invoice ? 'overpaymentCredit' : 'review.walletCredit'),
          value: numbers.money(data.allocation.walletCredit),
        },
        {
          id: 'before',
          label: text('review.before'),
          value: numbers.money(data.wallet.availableBefore),
        },
        {
          id: 'after',
          label: text('review.after'),
          value: numbers.money(data.wallet.availableAfter),
        },
        {
          id: 'approval',
          label: text('review.approval'),
          value: text(data.approval.required ? 'review.twoPeople' : 'review.onePerson'),
        },
        ...(data.approval.thresholdAmount === null
          ? []
          : [
              {
                id: 'threshold',
                label: text('review.threshold'),
                value: numbers.money(data.approval.thresholdAmount),
              },
            ]),
      ]}
      total={{ label: text('review.total'), value: numbers.money(data.receipt.amount) }}
      notice={`${data.invoice && BigInt(data.allocation.walletCredit) > 0n ? text('overpaymentPreview') + ' ' : ''}${text('review.notice')}`}
    />
  );
}
