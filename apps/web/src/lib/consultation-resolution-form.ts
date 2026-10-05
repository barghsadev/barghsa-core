import {
  parseConsultationPaidResolutionReview,
  type ConsultationPaidResolutionReview,
} from '@barghsa/shared/finance';
import { consultationUuid } from './consultation-form.js';
import { sameConsultationFeeSnapshot } from './consultation-fee-form.js';

export interface ConsultationResolutionSource {
  id: string;
  profile_id: string;
  profile_name: string;
  status: string;
  product_snapshot: { title: { fa: string; en: string } };
  invoice_id: string | null;
  invoice_state: string | null;
  uncovered_credit: string;
}
export type ConsultationResolutionIntent = 'cancel' | 'reject' | 'recover_refund';

export function matchedConsultationResolutionReview(
  value: unknown,
  source: ConsultationResolutionSource,
  intent: ConsultationResolutionIntent,
  reason: string
): ConsultationPaidResolutionReview | null {
  const review = parseConsultationPaidResolutionReview(value);
  if (
    !review ||
    review.scope.resourceId !== source.id ||
    review.scope.profileId !== source.profile_id ||
    review.data.profileName !== source.profile_name ||
    !sameConsultationFeeSnapshot(review.data.serviceTitle, source.product_snapshot.title) ||
    review.data.action !== intent ||
    review.data.reason !== reason ||
    review.data.currentStatus !== source.status ||
    (review.data.currentInvoice?.id ?? null) !== source.invoice_id ||
    (review.data.currentInvoice?.state ?? null) !== source.invoice_state ||
    review.data.uncoveredCreditBefore !== source.uncovered_credit
  )
    return null;
  const invoice = review.data.currentInvoice;
  const cancelled =
    intent !== 'recover_refund' &&
    invoice?.paidAmount === '0' &&
    invoice.adjustmentKind !== 'credit';
  if (
    review.data.cancelInvoiceId !== (cancelled ? invoice.id : null) ||
    (cancelled && !['Draft', 'Unpaid', 'Overdue'].includes(invoice.state)) ||
    new Set(review.data.refundAllocations.map((item) => item.invoiceId)).size !==
      review.data.refundAllocations.length ||
    review.data.refundAllocations.some(
      (item) => !['Paid', 'PartiallyRefunded'].includes(item.state)
    )
  )
    return null;
  return review;
}

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
function identifiers(value: unknown, count: number): value is string[] {
  return (
    Array.isArray(value) &&
    value.length === count &&
    value.every((item) => typeof item === 'string' && consultationUuid(item)) &&
    new Set(value).size === value.length
  );
}
export function matchedConsultationResolutionReceipt(
  value: unknown,
  expected: ConsultationPaidResolutionReview
) {
  const allocationCount = expected.data.refundAllocations.length;
  if (
    !record(value) ||
    value.requestId !== expected.scope.resourceId ||
    value.status !== expected.data.resultingStatus ||
    !identifiers(value.refundIds, allocationCount)
  )
    return false;
  const actual = parseConsultationPaidResolutionReview(value.financialReview);
  if (!actual || !sameConsultationFeeSnapshot(actual, expected)) return false;
  return expected.data.action === 'recover_refund'
    ? Object.keys(value).length === 4
    : Object.keys(value).length === 6 &&
        value.cancelledInvoiceId === expected.data.cancelInvoiceId &&
        identifiers(value.creditInvoiceIds, allocationCount);
}
