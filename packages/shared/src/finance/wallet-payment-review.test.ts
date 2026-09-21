import { expect, it } from 'vitest';
import { parseWalletPaymentReview, type WalletPaymentReview } from './index.js';

const profileId = '01900000-0000-7000-8000-000000000001';
const invoiceId = '01900000-0000-7000-8000-000000000002';
function fixture(): WalletPaymentReview {
  return {
    schemaVersion: 1,
    scope: { action: 'invoice.wallet-payment', profileId, resourceId: invoiceId },
    hash: 'a'.repeat(64),
    data: {
      currency: 'IRR',
      profile: { id: profileId, title: 'Customer', type: 'LEGAL' },
      invoice: {
        id: invoiceId,
        state: 'Unpaid',
        orderId: null,
        serviceType: null,
        issuedAt: null,
        payableFrom: null,
        dueAt: null,
        totalAmount: '9007199254740993',
        paidAmount: '0',
        remainingAmount: '9007199254740993',
      },
      lines: [],
      totals: null,
      payment: { source: 'wallet', availableBefore: '9007199254741993', availableAfter: '1000' },
      contracts: [],
      cancellation: 'separate_review_required',
    },
  };
}
it('preserves amounts above the safe number range and explicit legacy breakdown absence', () => {
  const value = fixture();
  expect(parseWalletPaymentReview(value)).toEqual(value);
  expect(parseWalletPaymentReview(value)?.data.invoice.totalAmount).toBe('9007199254740993');
});
it.each(['garbage', '', '01', '-1', '1.2', '9223372036854775808', 100])(
  'rejects malformed or inexact money without throwing: %s',
  (amount) => {
    const value = fixture();
    Object.assign(value.data.invoice, { totalAmount: amount });
    expect(parseWalletPaymentReview(value)).toBeNull();
  }
);
it('rejects a review for a different invoice, profile or action', () => {
  for (const patch of [{ resourceId: profileId }, { profileId: invoiceId }, { action: 'refund' }]) {
    const value = fixture();
    Object.assign(value.scope, patch);
    expect(parseWalletPaymentReview(value)).toBeNull();
  }
});
it('rejects missing, unknown or invalid snapshot fields instead of silently hiding them', () => {
  expect(parseWalletPaymentReview(null)).toBeNull();
  expect(parseWalletPaymentReview({ ...fixture(), hash: 'bad' })).toBeNull();
  expect(parseWalletPaymentReview({ ...fixture(), schemaVersion: 2 })).toBeNull();
  expect(parseWalletPaymentReview({ ...fixture(), unexpected: true })).toBeNull();
  const value = fixture();
  value.data.invoice.dueAt = 'not-a-date';
  expect(parseWalletPaymentReview(value)).toBeNull();
});
