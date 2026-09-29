import { expect, it } from 'vitest';
import { parseConsultationOfferReview } from './consultation-offer-review.js';

const profileId = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';
const invoiceId = '33333333-3333-4333-8333-333333333333';

const accepted = {
  schemaVersion: 1,
  scope: { action: 'consultation.offer-accept', profileId, resourceId: requestId },
  data: {
    decision: 'accept',
    serviceTitle: { fa: 'مشاوره برق', en: 'Electricity consultation' },
    scope: 'Supply assessment',
    deliverables: 'Written report',
    fee: '500000',
    previousFee: '0',
    validUntil: '2030-01-01T12:30:00.000Z',
    acceptedAt: null,
    invoice: {
      id: invoiceId,
      state: 'Unpaid',
      totalAmount: '500000',
      paidAmount: '0',
      adjustmentKind: null,
    },
    outcome: 'payment_required',
  },
  hash: 'a'.repeat(64),
};

it('accepts a reconciled offer and rejects mismatched amount or decision consequences', () => {
  expect(parseConsultationOfferReview(accepted)).not.toBeNull();
  expect(
    parseConsultationOfferReview({
      ...accepted,
      data: { ...accepted.data, invoice: { ...accepted.data.invoice, totalAmount: '1' } },
    })
  ).toBeNull();
  expect(
    parseConsultationOfferReview({
      ...accepted,
      data: { ...accepted.data, decision: 'decline', outcome: 'cancel_unpaid_invoice' },
    })
  ).toBeNull();
  expect(
    parseConsultationOfferReview({
      ...accepted,
      scope: { ...accepted.scope, action: 'consultation.offer-decline' },
      data: { ...accepted.data, decision: 'decline', outcome: 'cancel_unpaid_invoice' },
    })
  ).not.toBeNull();
  expect(
    parseConsultationOfferReview({
      ...accepted,
      data: {
        ...accepted.data,
        fee: '600000',
        previousFee: '500000',
        invoice: { ...accepted.data.invoice, totalAmount: '100000', adjustmentKind: 'charge' },
      },
    })
  ).not.toBeNull();
});
