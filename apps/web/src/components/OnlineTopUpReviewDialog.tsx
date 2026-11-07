import { confirmationText } from '@barghsa/i18n/confirmation';
import { FinancialConfirmDialog, FinancialReviewSummary } from '@barghsa/ui';
import type { OnlineTopUpReview } from '@barghsa/shared/finance';
import { t } from '@barghsa/i18n/workspace';
import { useFinancialFormatting } from '../hooks/useFinancialFormatting.js';

export default function OnlineTopUpReviewDialog({
  review,
  locale,
  loading,
  onCancel,
  onConfirm,
}: {
  review: OnlineTopUpReview;
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
      title={t('wallet.page.reviewTitle', locale)}
      description={t('wallet.page.reviewDescription', locale)}
      confirmLabel={t('wallet.page.confirmPayment', locale)}
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
            id: 'source',
            label: t('wallet.page.reviewSource', locale),
            value: t('wallet.page.reviewGateway', locale),
          },
          {
            id: 'limit',
            label: t('wallet.page.reviewLimit', locale),
            value: numbers.reviewMoney(review.data.onlineTopUpLimitIrR),
          },
        ]}
        total={{
          label: t('wallet.page.reviewAmount', locale),
          value: numbers.reviewMoney(review.data.amountIrR),
        }}
        notice={<p>{t('wallet.page.reviewCreditRule', locale)}</p>}
      />
    </FinancialConfirmDialog>
  );
}
