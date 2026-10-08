import { ConfirmDialog, FinancialReviewSummary } from '@barghsa/ui';
import type { BankReceiptTopUpReview } from '@barghsa/shared/finance';
import { t } from '@barghsa/i18n/workspace';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';

export default function BankReceiptTopUpReviewDialog({
  review,
  locale,
  loading,
  onCancel,
  onConfirm,
}: {
  review: BankReceiptTopUpReview;
  locale: 'fa' | 'en';
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const numbers = useNumberFormatting(locale);
  return (
    <ConfirmDialog
      open
      onCancel={onCancel}
      onConfirm={onConfirm}
      title={t('wallet.page.receiptReviewTitle', locale)}
      description={t('wallet.page.receiptReviewDescription', locale)}
      confirmLabel={t('wallet.page.receiptReviewConfirm', locale)}
      cancelLabel={t('wallet.page.reviewCancel', locale)}
      loading={loading}
    >
      <FinancialReviewSummary
        title={t('wallet.page.reviewSummary', locale)}
        rows={[
          {
            id: 'destination',
            label: t('wallet.page.reviewDestination', locale),
            value: review.data.profileId,
          },
          {
            id: 'date',
            label: t('wallet.page.receiptDateLabel', locale),
            value: review.data.paymentDate,
          },
          {
            id: 'reference',
            label: t('wallet.page.receiptPayerRefLabel', locale),
            value: review.data.payerReference,
          },
          {
            id: 'file',
            label: t('wallet.page.receiptFileLabel', locale),
            value: review.data.fileName,
          },
          ...(review.data.bankName
            ? [
                {
                  id: 'bank',
                  label: t('invoices.activity.bankName', locale),
                  value: review.data.bankName,
                },
              ]
            : []),
          ...(review.data.customerNote
            ? [
                {
                  id: 'note',
                  label: t('wallet.page.receiptNoteLabel', locale),
                  value: review.data.customerNote,
                },
              ]
            : []),
        ]}
        total={{
          label: t('wallet.page.receiptAmountLabel', locale),
          value: numbers.money(review.data.amountIrR),
        }}
        notice={<p>{t('wallet.page.receiptReviewCreditRule', locale)}</p>}
      />
    </ConfirmDialog>
  );
}
