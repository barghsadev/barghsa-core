import { expect, it } from 'vitest';
import { parseConsultationPaidFeeReview } from './consultation-paid-fee-review.js';

const id = '11111111-1111-4111-8111-111111111111';
const base = {
  schemaVersion: 1,
  scope: { action: 'consultation.paid-fee-adjustment', profileId: id, resourceId: id },
  data: {
    serviceTitle: { fa: 'مشاوره', en: 'Consultation' },
    profileName: 'Example Customer',
    scope: 'Feasibility study',
    deliverables: 'Written report',
    previousFee: '500000',
    revisedFee: '600000',
    difference: '100000',
    adjustmentAmount: '100000',
    reason: 'More work',
    validUntil: '2099-01-01T00:00:00.000Z',
    paidInvoice: { id, state: 'Paid', totalAmount: '500000', paidAmount: '500000' },
    refundPlan: [],
    outcome: 'charge_invoice',
  },
  hash: 'a'.repeat(64),
};

it('reconciles a charge or credit with the revised fee and exact refund allocation', () => {
  expect(parseConsultationPaidFeeReview(base)).not.toBeNull();
  const credit = {
    ...base,
    data: {
      ...base.data,
      revisedFee: '450000',
      difference: '-50000',
      adjustmentAmount: '50000',
      outcome: 'credit_and_wallet_refund',
      refundPlan: [{ invoiceId: id, amount: '50000', availableBefore: '100000' }],
    },
  };
  expect(parseConsultationPaidFeeReview(credit)).not.toBeNull();
  expect(
    parseConsultationPaidFeeReview({
      ...credit,
      data: {
        ...credit.data,
        refundPlan: [{ invoiceId: id, amount: '40000', availableBefore: '100000' }],
      },
    })
  ).toBeNull();
  expect(
    parseConsultationPaidFeeReview({ ...base, data: { ...base.data, difference: '99999' } })
  ).toBeNull();
});
