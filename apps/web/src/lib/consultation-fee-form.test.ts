import { expect, it } from 'vitest';
import { consultationFeeSchema } from './consultation-fee-form-schemas.js';
import {
  consultationFeeTerms,
  matchedConsultationFeeReview,
  matchedConsultationFeeReceipt,
  consultationFeeFields,
  definitiveConsultationFeeRejection,
  type ConsultationFeeDraft,
} from './consultation-fee-form.js';
import {
  feeSource,
  feeReview,
  feeReceipt,
  feeInvoice,
  firstWork,
  olderWork,
} from '../test/consultation-fee-fixtures.js';
const messages = {
  fee: 'fee',
  scope: 'scope',
  deliverables: 'deliverables',
  validUntil: 'validUntil',
  reason: 'reason',
};
const draft: ConsultationFeeDraft = {
  fee: '600000',
  scope: ' Scope ',
  deliverables: ' Report ',
  validUntil: '2099-01-01T12:30',
  reason: ' Change ',
};
it.each([
  { mode: 'initial' as const, field: 'fee', value: '0' },
  { mode: 'initial' as const, field: 'fee', value: '9223372036854775808' },
  { mode: 'initial' as const, field: 'scope', value: 's'.repeat(4001) },
  { mode: 'initial' as const, field: 'deliverables', value: 'd'.repeat(4001) },
  { mode: 'replacement' as const, field: 'reason', value: 'r'.repeat(2001) },
  { mode: 'paid' as const, field: 'reason', value: 'r'.repeat(1001) },
  { mode: 'paid' as const, field: 'fee', value: '500000' },
  { mode: 'initial' as const, field: 'validUntil', value: '2020-01-01T12:30' },
])('rejects $mode $field boundary without normalizing the draft', ({ mode, field, value }) => {
  const raw = { ...draft, [field]: value };
  const result = consultationFeeSchema(feeSource(mode), 'UTC', messages).safeParse(raw);
  expect(result.success).toBe(false);
  if (!result.success) expect(result.error.issues.map((issue) => issue.path[0])).toContain(field);
  expect(raw[field as keyof ConsultationFeeDraft]).toBe(value);
});
it('accepts exact maximums and ignores unused initial/paid companion drafts', () => {
  expect(
    consultationFeeSchema(feeSource(), 'UTC', messages).safeParse({
      ...draft,
      fee: '9223372036854775807',
      scope: 's'.repeat(4000),
      deliverables: 'd'.repeat(4000),
      reason: 'r'.repeat(2001),
    }).success
  ).toBe(true);
  expect(
    consultationFeeSchema(feeSource('replacement'), 'UTC', messages).safeParse({
      ...draft,
      reason: 'r'.repeat(2000),
    }).success
  ).toBe(true);
  expect(
    consultationFeeSchema(feeSource('paid'), 'UTC', messages).safeParse({
      ...draft,
      scope: '',
      deliverables: '',
      reason: 'r'.repeat(1000),
    }).success
  ).toBe(true);
});
it('preserves the exact unchanged instant and converts an edited account wall time', () => {
  expect(
    consultationFeeTerms(
      { ...draft, validUntil: '2099-01-02T02:30' },
      feeSource(),
      'Pacific/Kiritimati'
    )?.validUntil
  ).toBe('2099-01-01T12:30:27.123Z');
  expect(
    consultationFeeTerms(
      { ...draft, validUntil: '2099-01-02T03:30' },
      feeSource(),
      'Pacific/Kiritimati'
    )?.validUntil
  ).toBe('2099-01-01T13:30:00.000Z');
  expect(consultationFeeTerms(draft, feeSource(), 'UTC')).not.toHaveProperty('reason');
  expect(consultationFeeSchema(feeSource(), null, messages).safeParse(draft).success).toBe(false);
});
it.each(['initial', 'replacement', 'paid'] as const)(
  'binds complete %s reviews and full JSONB receipts',
  (mode) => {
    const source = feeSource(mode),
      terms = consultationFeeTerms(draft, source, 'UTC')!;
    const raw = feeReview(source, terms),
      review = matchedConsultationFeeReview(raw, source, terms)!;
    expect(review).not.toBeNull();
    expect(
      matchedConsultationFeeReview(
        { ...raw, data: { ...raw.data, profileName: 'Another buyer' } },
        source,
        terms
      )
    ).toBeNull();
    const receipt = feeReceipt(raw);
    expect(matchedConsultationFeeReceipt(receipt, review)).toBe(true);
    expect(
      matchedConsultationFeeReceipt(
        {
          ...receipt,
          financialReview: { ...raw, data: { ...raw.data, scope: 'Changed with same hash' } },
        },
        review
      )
    ).toBe(false);
    expect(matchedConsultationFeeReceipt({ ...receipt, requestId: olderWork }, review)).toBe(false);
    if (mode !== 'initial')
      expect(matchedConsultationFeeReceipt({ ...receipt, invoiceId: feeInvoice }, review)).toBe(
        false
      );
    const reversed = Object.fromEntries(Object.entries(raw.data).reverse());
    expect(
      matchedConsultationFeeReceipt(
        { ...receipt, financialReview: { ...raw, data: reversed } },
        review
      )
    ).toBe(true);
  }
);
it('requires complete unique credit refunds while preserving an actual multi-invoice refund plan', () => {
  const source = feeSource('paid');
  source.fee = '700000';
  const terms = consultationFeeTerms({ ...draft, fee: '400000' }, source, 'UTC')!;
  const raw = feeReview(source, terms);
  raw.data.paidInvoice = {
    id: feeInvoice,
    state: 'Paid',
    totalAmount: '200000',
    paidAmount: '200000',
  };
  raw.data.refundPlan = [
    { invoiceId: feeInvoice, amount: '200000', availableBefore: '200000' },
    { invoiceId: olderWork, amount: '100000', availableBefore: '500000' },
  ];
  const review = matchedConsultationFeeReview(raw, source, terms)!;
  expect(review).not.toBeNull();
  const receipt = { ...feeReceipt(raw), refundIds: [firstWork, olderWork] };
  expect(matchedConsultationFeeReceipt(receipt, review)).toBe(true);
  expect(
    matchedConsultationFeeReceipt({ ...receipt, refundIds: [firstWork, firstWork] }, review)
  ).toBe(false);
  expect(
    matchedConsultationFeeReceipt({ ...receipt, adjustmentInvoiceId: feeInvoice }, review)
  ).toBe(false);
  expect(matchedConsultationFeeReceipt({ ...receipt, status: 'offer_pending' }, review)).toBe(
    false
  );
});
it('narrows only all-owned fields and complete recognized public rejections', () => {
  expect(consultationFeeFields(['fee', 'scope'], feeSource())).toEqual(['fee', 'scope']);
  expect(consultationFeeFields(['reason'], feeSource())).toBeNull();
  expect(consultationFeeFields(['fee', 'expectedReviewHash'], feeSource('paid'))).toBeNull();
  expect(consultationFeeFields(['scope'], feeSource('paid'))).toBeNull();
  const error = {
    error: {
      code: 'VALIDATION:INPUT:INVALID',
      message: 'PRIVATE',
      correlationId: firstWork,
      fields: ['fee'],
    },
  };
  expect(definitiveConsultationFeeRejection(error)).not.toBeNull();
  expect(
    definitiveConsultationFeeRejection({ error: { ...error.error, code: 'UNKNOWN' } })
  ).toBeNull();
  expect(
    definitiveConsultationFeeRejection({ error: { ...error.error, correlationId: 'invalid' } })
  ).toBeNull();
});
