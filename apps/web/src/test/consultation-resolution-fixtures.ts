import type { ConsultationPaidResolutionReview } from '@barghsa/shared/finance';
import type { ConsultationResolutionIntent } from '../lib/consultation-resolution-form.js';
import {
  feeSource,
  feeInvoice,
  feeAdjustment,
  feeRefund,
  firstWork,
  olderWork,
} from './consultation-fee-fixtures.js';

export const resolutionCredit = '83000000-0000-4000-8000-000000000014';
export function resolutionSource(mode: 'closure' | 'recovery' | 'pending_charge' = 'closure') {
  return {
    ...feeSource('paid'),
    ...(mode === 'pending_charge'
      ? { status: 'offer_pending', invoice_id: feeAdjustment, invoice_state: 'Unpaid' }
      : {}),
    invoice_id: mode === 'pending_charge' ? feeAdjustment : feeInvoice,
    invoice_state: mode === 'pending_charge' ? 'Unpaid' : 'Paid',
    uncovered_credit: mode === 'recovery' ? '100000' : '0',
  };
}
export function resolutionReview(
  source: ReturnType<typeof resolutionSource>,
  action: ConsultationResolutionIntent = 'cancel',
  reason = 'Resolution reason'
): ConsultationPaidResolutionReview {
  const recovery = action === 'recover_refund';
  const amount = recovery ? source.uncovered_credit : '500000';
  return {
    schemaVersion: 1,
    scope: {
      action: 'consultation.paid-resolution',
      profileId: source.profile_id,
      resourceId: source.id,
    },
    data: {
      action,
      serviceTitle: source.product_snapshot.title,
      profileName: source.profile_name,
      currentStatus: source.status,
      resultingStatus: recovery ? source.status : action === 'cancel' ? 'cancelled' : 'rejected',
      reason,
      currentInvoice: {
        id: source.invoice_id,
        state: source.invoice_state,
        paidAmount: source.invoice_state === 'Unpaid' ? '0' : '500000',
        adjustmentKind: source.invoice_state === 'Unpaid' ? 'charge' : null,
      },
      cancelInvoiceId: !recovery && source.invoice_state === 'Unpaid' ? source.invoice_id : null,
      uncoveredCreditBefore: source.uncovered_credit,
      refundAllocations: [
        { invoiceId: feeInvoice, state: 'Paid', amount, availableBefore: '500000' },
      ],
      totalCredit: recovery ? '0' : amount,
      totalRefund: amount,
    },
    hash: 'c'.repeat(64),
  };
}
export function resolutionReceipt(review: ConsultationPaidResolutionReview) {
  const common = {
    requestId: review.scope.resourceId,
    status: review.data.resultingStatus,
    refundIds: review.data.refundAllocations.map((_, index) =>
      index ? resolutionCredit : feeRefund
    ),
    financialReview: review,
  };
  return review.data.action === 'recover_refund'
    ? common
    : {
        ...common,
        cancelledInvoiceId: review.data.cancelInvoiceId,
        creditInvoiceIds: review.data.refundAllocations.map(() => resolutionCredit),
      };
}
export { feeInvoice, feeAdjustment, feeRefund, firstWork, olderWork };
