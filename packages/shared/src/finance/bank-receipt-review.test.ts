import { expect, it } from 'vitest';
import { parseBankReceiptConfirmationReview, type BankReceiptConfirmationReview } from './index.js';

const profileId = '01900000-0000-7000-8000-000000000001';
const receiptId = '01900000-0000-7000-8000-000000000002';
function fixture(): BankReceiptConfirmationReview {
  return {
    schemaVersion: 1,
    scope: { action: 'wallet.bank-receipt-confirmation', profileId, resourceId: receiptId },
    hash: 'a'.repeat(64),
    data: {
      currency: 'IRR',
      profile: { id: profileId, title: 'Customer', type: 'LEGAL' },
      receipt: {
        id: receiptId,
        amount: '9007199254740993',
        paymentDate: '2026-09-21',
        payerReference: 'bank-reference',
        attachmentKey: 'receipts/verified.pdf',
        customerNote: null,
        submittedAt: '2026-09-21T08:00:00.000Z',
      },
      invoice: null,
      allocation: { invoiceAmount: '0', walletCredit: '9007199254740993' },
      wallet: { availableBefore: '100', availableAfter: '9007199254741093' },
      approval: { required: true, thresholdAmount: '1000000' },
      source: 'bank_receipt',
    },
  };
}

it('preserves exact receipt and wallet amounts above Number.MAX_SAFE_INTEGER', () => {
  expect(parseBankReceiptConfirmationReview(fixture())).toEqual(fixture());
});

it.each(['scope', 'split', 'balance', 'unlinked', 'money', 'extra'])(
  'rejects an invalid %s review without throwing',
  (kind) => {
    const review = fixture();
    if (kind === 'scope') review.scope.profileId = receiptId;
    if (kind === 'split') review.data.allocation.walletCredit = '9007199254740992';
    if (kind === 'balance') review.data.wallet.availableAfter = '9007199254741092';
    if (kind === 'unlinked') {
      review.data.allocation.invoiceAmount = '1';
      review.data.allocation.walletCredit = '9007199254740992';
      review.data.wallet.availableAfter = '9007199254741092';
    }
    if (kind === 'money') review.data.receipt.amount = 'invalid';
    if (kind === 'extra') Object.assign(review.data, { unexpected: true });
    expect(parseBankReceiptConfirmationReview(review)).toBeNull();
  }
);

it('accepts only the exact invoice allocation and excess credit for the same profile', () => {
  const review = fixture();
  review.data.invoice = {
    currency: 'IRR',
    profile: review.data.profile,
    invoice: {
      id: receiptId,
      state: 'Unpaid',
      orderId: null,
      serviceType: null,
      issuedAt: null,
      payableFrom: null,
      dueAt: null,
      totalAmount: '1000',
      paidAmount: '0',
      remainingAmount: '1000',
    },
    lines: [],
    totals: null,
    contracts: [],
    cancellation: 'separate_review_required',
  };
  review.data.allocation = { invoiceAmount: '1000', walletCredit: '9007199254739993' };
  review.data.wallet.availableAfter = '9007199254740093';
  expect(parseBankReceiptConfirmationReview(review)).toEqual(review);
  review.data.allocation.invoiceAmount = '999';
  review.data.allocation.walletCredit = '9007199254739994';
  review.data.wallet.availableAfter = '9007199254740094';
  expect(parseBankReceiptConfirmationReview(review)).toBeNull();
});
