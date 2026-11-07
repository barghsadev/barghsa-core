import { confirmationText } from '@barghsa/i18n/confirmation';
import { FinancialConfirmDialog, FinancialReviewSummary } from '@barghsa/ui';
import type { InvoiceBankReceiptSubmissionReview } from '@barghsa/shared/finance';
import { t } from '@barghsa/i18n/workspace';
import { useFinancialFormatting } from '../hooks/useFinancialFormatting.js';

export default function InvoiceBankReceiptSubmissionReviewDialog({
  review,
  locale,
  loading,
  onCancel,
  onConfirm,
}: {
  review: InvoiceBankReceiptSubmissionReview;
  locale: 'fa' | 'en';
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const numbers = useFinancialFormatting(locale);
  return (
    <FinancialConfirmDialog
      open
      scope={review}
      acknowledgement={confirmationText('acknowledge', locale)}
      onCancel={onCancel}
      onConfirm={onConfirm}
      title={t('invoices.details.receiptReviewTitle', locale)}
      description={t('invoices.details.receiptReviewDescription', locale)}
      confirmLabel={t('invoices.details.receiptReviewConfirm', locale)}
      cancelLabel={t('invoices.details.receiptReviewCancel', locale)}
      loading={loading}
    >
      <FinancialReviewSummary
        title={t('invoices.details.receiptReviewSummary', locale)}
        rows={[
          {
            id: 'invoice',
            label: t('invoices.details.receiptReviewInvoice', locale),
            value: review.data.invoiceId,
          },
          {
            id: 'profile',
            label: t('invoices.details.receiptReviewProfile', locale),
            value: review.data.profileId,
          },
          {
            id: 'total',
            label: t('invoices.details.receiptReviewTotal', locale),
            value: numbers.reviewMoney(review.data.invoiceTotalIrR),
          },
          {
            id: 'paid',
            label: t('invoices.details.receiptReviewPaid', locale),
            value: numbers.reviewMoney(review.data.invoicePaidIrR),
          },
          {
            id: 'remaining',
            label: t('invoices.details.receiptReviewRemaining', locale),
            value: numbers.reviewMoney(review.data.invoiceRemainingIrR),
          },
          {
            id: 'date',
            label: t('invoices.details.receiptDateLabel', locale),
            value: review.data.paymentDate,
          },
          {
            id: 'reference',
            label: t('invoices.details.receiptPayerRefLabel', locale),
            value: review.data.payerReference,
          },
          ...(review.data.bankName
            ? [
                {
                  id: 'bank',
                  label: t('invoices.details.receiptBankNameLabel', locale),
                  value: review.data.bankName,
                },
              ]
            : []),
          {
            id: 'file',
            label: t('invoices.details.receiptFileLabel', locale),
            value: review.data.fileName,
          },
          ...(review.data.customerNote
            ? [
                {
                  id: 'note',
                  label: t('invoices.details.receiptNoteLabel', locale),
                  value: review.data.customerNote,
                },
              ]
            : []),
        ]}
        total={{
          label: t('invoices.details.receiptAmountLabel', locale),
          value: numbers.reviewMoney(review.data.amountIrR),
        }}
        notice={<p>{t('invoices.details.receiptReviewSettlementRule', locale)}</p>}
      />
    </FinancialConfirmDialog>
  );
}
