import { expect, it } from 'vitest';
import {
  matchedConsultationResolutionReceipt,
  matchedConsultationResolutionReview,
} from './consultation-resolution-form.js';
import {
  resolutionSource,
  resolutionReview,
  resolutionReceipt,
  firstWork,
  olderWork,
} from '../test/consultation-resolution-fixtures.js';

it.each(['cancel', 'reject', 'recover_refund'] as const)(
  'accepts complete actual %s review and receipt with JSONB object order',
  (intent) => {
    const source = resolutionSource(intent === 'recover_refund' ? 'recovery' : 'closure');
    const review = resolutionReview(source, intent);
    const jsonb = (value: unknown): unknown =>
      Array.isArray(value)
        ? value.map(jsonb)
        : value && typeof value === 'object'
          ? Object.fromEntries(
              Object.entries(value)
                .reverse()
                .map(([key, child]) => [key, jsonb(child)])
            )
          : value;
    expect(matchedConsultationResolutionReview(review, source, intent, review.data.reason)).toEqual(
      review
    );
    expect(matchedConsultationResolutionReceipt(jsonb(resolutionReceipt(review)), review)).toBe(
      true
    );
  }
);
it('binds cancellation of a pending unpaid charge independently from the paid original allocation', () => {
  const source = resolutionSource('pending_charge');
  const review = resolutionReview(source);
  expect(matchedConsultationResolutionReview(review, source, 'cancel', review.data.reason)).toEqual(
    review
  );
  const receipt = resolutionReceipt(review);
  expect(matchedConsultationResolutionReceipt(receipt, review)).toBe(true);
  expect(
    matchedConsultationResolutionReceipt({ ...receipt, cancelledInvoiceId: null }, review)
  ).toBe(false);
});
it.each([
  'profile',
  'resource',
  'name',
  'title',
  'status',
  'invoice',
  'invoiceState',
  'reason',
  'credit',
  'cancelInvoice',
  'allocationState',
  'duplicateAllocation',
] as const)('rejects a preview with foreign or impossible %s context', (field) => {
  const source = resolutionSource();
  const expected = resolutionReview(source);
  const changed = structuredClone(expected);
  switch (field) {
    case 'profile':
      changed.scope.profileId = olderWork;
      break;
    case 'resource':
      changed.scope.resourceId = olderWork;
      break;
    case 'name':
      changed.data.profileName = 'Foreign profile';
      break;
    case 'title':
      changed.data.serviceTitle.en = 'Foreign service';
      break;
    case 'status':
      changed.data.currentStatus = 'completed';
      break;
    case 'invoice':
      changed.data.currentInvoice!.id = olderWork;
      break;
    case 'invoiceState':
      changed.data.currentInvoice!.state = 'Unpaid';
      break;
    case 'reason':
      changed.data.reason = 'Another reason';
      break;
    case 'credit':
      changed.data.uncoveredCreditBefore = '100000';
      break;
    case 'cancelInvoice':
      changed.data.cancelInvoiceId = firstWork;
      break;
    case 'allocationState':
      changed.data.refundAllocations[0]!.state = 'Unpaid';
      break;
    case 'duplicateAllocation':
      changed.data.refundAllocations.push({ ...changed.data.refundAllocations[0]!, amount: '1' });
      changed.data.totalCredit = changed.data.totalRefund = '500001';
      break;
  }
  expect(
    matchedConsultationResolutionReview(changed, source, 'cancel', expected.data.reason)
  ).toBeNull();
});
it.each([
  'request',
  'status',
  'cancelInvoice',
  'refundId',
  'refundCount',
  'creditId',
  'creditCount',
  'reviewSameHash',
  'extra',
] as const)('rejects malformed or foreign closure receipt %s', (field) => {
  const review = resolutionReview(resolutionSource());
  const receipt: Record<string, unknown> = resolutionReceipt(review);
  switch (field) {
    case 'request':
      receipt.requestId = olderWork;
      break;
    case 'status':
      receipt.status = 'completed';
      break;
    case 'cancelInvoice':
      receipt.cancelledInvoiceId = firstWork;
      break;
    case 'refundId':
      receipt.refundIds = ['invalid'];
      break;
    case 'refundCount':
      receipt.refundIds = [];
      break;
    case 'creditId':
      receipt.creditInvoiceIds = ['invalid'];
      break;
    case 'creditCount':
      receipt.creditInvoiceIds = [];
      break;
    case 'reviewSameHash':
      receipt.financialReview = {
        ...review,
        data: { ...review.data, reason: 'Different reviewed reason' },
      };
      break;
    case 'extra':
      receipt.privateData = 'not public';
      break;
  }
  expect(matchedConsultationResolutionReceipt(receipt, review)).toBe(false);
});
it('requires unique refund and credit identifiers and ordered full allocation equality', () => {
  const review = resolutionReview(resolutionSource());
  review.data.refundAllocations[0]!.amount = '250000';
  review.data.refundAllocations.push({
    invoiceId: olderWork,
    state: 'PartiallyRefunded',
    amount: '250000',
    availableBefore: '300000',
  });
  const receipt = resolutionReceipt(review);
  expect(matchedConsultationResolutionReceipt(receipt, review)).toBe(false);
  const valid = { ...receipt, creditInvoiceIds: [firstWork, olderWork] };
  expect(matchedConsultationResolutionReceipt(valid, review)).toBe(true);
  expect(
    matchedConsultationResolutionReceipt({ ...valid, refundIds: [firstWork, firstWork] }, review)
  ).toBe(false);
  expect(
    matchedConsultationResolutionReceipt(
      {
        ...valid,
        financialReview: {
          ...review,
          data: { ...review.data, refundAllocations: [...review.data.refundAllocations].reverse() },
        },
      },
      review
    )
  ).toBe(false);
});
it('recovery requires its four actual fields and preserves captured service status', () => {
  const review = resolutionReview(resolutionSource('recovery'), 'recover_refund');
  const receipt = resolutionReceipt(review);
  expect(matchedConsultationResolutionReceipt(receipt, review)).toBe(true);
  expect(
    matchedConsultationResolutionReceipt({ ...receipt, cancelledInvoiceId: null }, review)
  ).toBe(false);
  expect(matchedConsultationResolutionReceipt({ ...receipt, status: 'cancelled' }, review)).toBe(
    false
  );
});
