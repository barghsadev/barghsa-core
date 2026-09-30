import { describe, expect, it } from 'vitest';
import { parseConsultationFeeReview } from './consultation-fee-review.js';

const id = '11111111-1111-4111-8111-111111111111';
const base = {
  schemaVersion: 1,
  scope: { action: 'consultation.fee-offer', profileId: id, resourceId: id },
  data: {
    serviceTitle: { fa: 'مشاوره', en: 'Consultation' },
    profileName: 'Example Customer',
    scope: 'Feasibility study',
    deliverables: 'Written report',
    fee: '500000',
    validUntil: '2099-01-01T00:00:00.000Z',
    reason: null,
    previousInvoice: null,
    outcome: 'issue_invoice',
  },
  hash: 'a'.repeat(64),
};

describe('consultation fee review', () => {
  it('requires the invoice outcome and replacement reason to agree', () => {
    expect(parseConsultationFeeReview(base)).not.toBeNull();
    expect(
      parseConsultationFeeReview({
        ...base,
        data: {
          ...base.data,
          outcome: 'replace_unpaid_invoice',
          reason: 'Revised scope',
          previousInvoice: { id, state: 'Unpaid', totalAmount: '400000' },
        },
      })
    ).not.toBeNull();
    expect(
      parseConsultationFeeReview({
        ...base,
        data: { ...base.data, outcome: 'replace_unpaid_invoice' },
      })
    ).toBeNull();
    expect(parseConsultationFeeReview({ ...base, data: { ...base.data, fee: '-1' } })).toBeNull();
  });
});
