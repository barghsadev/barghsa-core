import type { ConsultationFeeSource } from '../lib/consultation-fee-form.js';
import { consultationWork, firstWork, olderWork } from './staff-business-fixtures.js';
export const feeInvoice = '83000000-0000-4000-8000-000000000011';
export const feeAdjustment = '83000000-0000-4000-8000-000000000012';
export const feeRefund = '83000000-0000-4000-8000-000000000013';
export function feeSource(mode: 'initial' | 'replacement' | 'paid' = 'initial', id = firstWork) {
  return {
    ...consultationWork(id),
    status:
      mode === 'paid'
        ? 'offer_accepted'
        : mode === 'replacement'
          ? 'offer_pending'
          : 'under_review',
    invoice_id: mode === 'initial' ? null : feeInvoice,
    invoice_state: mode === 'initial' ? null : mode === 'paid' ? 'Paid' : 'Unpaid',
    has_paid_invoice: mode === 'paid',
    fee: mode === 'paid' ? '500000' : '100000',
    offer_valid_until: '2099-01-01T12:30:27.123+00:00',
  };
}
export function feeReview(
  source: ConsultationFeeSource,
  terms: { fee: string; validUntil: string; scope?: string; deliverables?: string; reason?: string }
) {
  const paid = source.status === 'offer_accepted';
  const difference = BigInt(terms.fee!) - BigInt(source.fee!);
  return {
    schemaVersion: 1,
    scope: {
      action: paid ? 'consultation.paid-fee-adjustment' : 'consultation.fee-offer',
      profileId: source.profile_id,
      resourceId: source.id,
    },
    data: paid
      ? {
          serviceTitle: source.product_snapshot.title,
          profileName: source.profile_name,
          scope: source.scope,
          deliverables: source.deliverables,
          previousFee: source.fee,
          revisedFee: terms.fee,
          difference: String(difference),
          adjustmentAmount: String(difference < 0n ? -difference : difference),
          reason: terms.reason,
          validUntil: terms.validUntil,
          paidInvoice: {
            id: source.invoice_id,
            state: source.invoice_state,
            totalAmount: '500000',
            paidAmount: '500000',
          },
          refundPlan:
            difference > 0n
              ? []
              : [{ invoiceId: feeInvoice, amount: String(-difference), availableBefore: '500000' }],
          outcome: difference > 0n ? 'charge_invoice' : 'credit_and_wallet_refund',
        }
      : {
          serviceTitle: source.product_snapshot.title,
          profileName: source.profile_name,
          scope: terms.scope,
          deliverables: terms.deliverables,
          fee: terms.fee,
          validUntil: terms.validUntil,
          reason: terms.reason ?? null,
          previousInvoice: source.invoice_id
            ? { id: source.invoice_id, state: source.invoice_state, totalAmount: '100000' }
            : null,
          outcome: source.invoice_id ? 'replace_unpaid_invoice' : 'issue_invoice',
        },
    hash: (paid ? 'b' : 'a').repeat(64),
  };
}
export function feeReceipt(review: ReturnType<typeof feeReview>) {
  return review.scope.action === 'consultation.fee-offer'
    ? {
        requestId: review.scope.resourceId,
        status: 'offer_pending',
        invoiceId: feeAdjustment,
        financialReview: review,
      }
    : {
        requestId: review.scope.resourceId,
        status: review.data.outcome === 'charge_invoice' ? 'offer_pending' : 'offer_accepted',
        invoiceId: review.data.outcome === 'charge_invoice' ? feeAdjustment : feeInvoice,
        adjustmentInvoiceId: feeAdjustment,
        refundIds: review.data.outcome === 'charge_invoice' ? [] : [feeRefund],
        financialReview: review,
      };
}
export { firstWork, olderWork };
