import { expect, it } from 'vitest';
import { parseConsultationPaidResolutionReview } from './consultation-paid-resolution-review.js';

const id = '11111111-1111-4111-8111-111111111111';
const closure = {
  schemaVersion: 1,
  scope: { action: 'consultation.paid-resolution', profileId: id, resourceId: id },
  data: {
    action: 'cancel',
    serviceTitle: { fa: 'مشاوره', en: 'Consultation' },
    profileName: 'Example Customer',
    currentStatus: 'offer_accepted',
    resultingStatus: 'cancelled',
    reason: 'Customer request',
    currentInvoice: { id, state: 'Paid', paidAmount: '500000', adjustmentKind: null },
    cancelInvoiceId: null,
    uncoveredCreditBefore: '0',
    refundAllocations: [
      { invoiceId: id, state: 'Paid', amount: '500000', availableBefore: '500000' },
    ],
    totalCredit: '500000',
    totalRefund: '500000',
  },
  hash: 'a'.repeat(64),
};

it('reconciles paid closure credits and uncovered refund recovery', () => {
  expect(parseConsultationPaidResolutionReview(closure)).not.toBeNull();
  expect(
    parseConsultationPaidResolutionReview({
      ...closure,
      data: { ...closure.data, totalCredit: '400000' },
    })
  ).toBeNull();
  const recovery = {
    ...closure,
    data: {
      ...closure.data,
      action: 'recover_refund',
      resultingStatus: 'offer_accepted',
      uncoveredCreditBefore: '500000',
      totalCredit: '0',
    },
  };
  expect(parseConsultationPaidResolutionReview(recovery)).not.toBeNull();
  expect(
    parseConsultationPaidResolutionReview({
      ...recovery,
      data: { ...recovery.data, totalRefund: '400000' },
    })
  ).toBeNull();
});
