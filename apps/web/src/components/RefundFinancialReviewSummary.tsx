import type { RefundDecisionReview, RefundRequestReview } from '@barghsa/shared/finance';
import { FinancialReviewSummary } from '@barghsa/ui';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { invoiceFinancialReviewRows } from './InvoiceFinancialReviewRows.js';

export default function RefundFinancialReviewSummary({
  review,
  word,
}: {
  review: RefundDecisionReview | RefundRequestReview;
  word: (key: string) => string;
}) {
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const decision = 'decision' in review.data ? review.data.decision : null;
  const refund = review.data.refund;
  return (
    <FinancialReviewSummary
      title={word('review')}
      rows={[
        ...invoiceFinancialReviewRows(review.data, locale, numbers, (value) =>
          new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-US', {
            dateStyle: 'medium',
            timeStyle: 'short',
          }).format(new Date(value))
        ),
        ...('state' in refund
          ? [{ id: 'state', label: word('state'), value: word(`state.${refund.state}`) }]
          : []),
        ...(decision
          ? [
              {
                id: 'target',
                label: word('targetState'),
                value: word(`state.${decision.targetState}`),
              },
            ]
          : []),
        ...(['refunded', 'reserved', 'available', 'availableAfter'] as const).map((key) => ({
          id: key,
          label: word(key),
          value: numbers.money(
            refund[
              key === 'refunded'
                ? 'refundedBefore'
                : key === 'reserved'
                  ? 'reservedBefore'
                  : key === 'available'
                    ? 'availableBefore'
                    : 'availableAfter'
            ]
          ),
        })),
        {
          id: 'approval',
          label: word('approvalRule'),
          value: word(
            refund.approvalRequired === null
              ? 'approvalNotApplicable'
              : refund.approvalRequired
                ? 'approvalRequired'
                : 'approvalNotRequired'
          ),
        },
        ...('reason' in refund
          ? [{ id: 'reason', label: word('reason'), value: refund.reason }]
          : decision?.reason
            ? [{ id: 'reason', label: word('reason'), value: decision.reason }]
            : []),
        ...(decision?.bankReference
          ? [{ id: 'bank', label: word('bankReference'), value: decision.bankReference }]
          : []),
      ]}
      total={{ label: word('requestAmount'), value: numbers.money(refund.amount) }}
    />
  );
}
