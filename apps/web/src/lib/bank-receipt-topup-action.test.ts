import { afterEach, expect, it, vi } from 'vitest';
import {
  loadBankReceiptTopUpReview,
  submitReviewedBankReceiptTopUp,
} from './bank-receipt-topup-action.js';
import { parseBankReceiptTopUpReview } from '@barghsa/shared/finance';
const profileId = '11111111-1111-4111-8111-111111111111';
const details = {
  profileId,
  amountIrR: '250000',
  paymentDate: '2026-08-15',
  payerReference: 'TRK',
  attachmentKey: 'receipt.pdf',
  customerNote: null,
  idempotencyKey: 'retry-1',
};
const snapshot = {
  schemaVersion: 1 as const,
  scope: { action: 'wallet.bank-receipt-topup-submission', profileId, resourceId: profileId },
  data: {
    profileId,
    amountIrR: details.amountIrR,
    paymentDate: details.paymentDate,
    payerReference: details.payerReference,
    attachmentKey: details.attachmentKey,
    customerNote: details.customerNote,
    fileName: 'receipt.pdf',
    fileSizeBytes: null,
    stateAfterSubmission: 'Pending',
    creditRule: 'after_finance_confirmation',
  },
  hash: 'a'.repeat(64),
};
afterEach(() => vi.unstubAllGlobals());
it.each([undefined, 'بانک ملی'])(
  'submits exactly the reviewed bank metadata (%s)',
  async (bankName) => {
    const data = { ...snapshot.data, ...(bankName ? { bankName } : {}) };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...snapshot, data })))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ transactionId: 'tx-1', amount: details.amountIrR, state: 'Pending' })
        )
      );
    vi.stubGlobal('fetch', fetchMock);
    const result = await loadBankReceiptTopUpReview({
      ...details,
      ...(bankName ? { bankName } : {}),
    });
    expect(result.kind).toBe('success');
    if (result.kind !== 'success') throw new Error('Expected review');
    expect(await submitReviewedBankReceiptTopUp(result.value, details.idempotencyKey)).toEqual({
      kind: 'success',
      value: 'tx-1',
    });
    for (const [, init] of fetchMock.mock.calls) {
      const body = JSON.parse(init.body);
      if (bankName) expect(body.bankName).toBe(bankName);
      else expect(body).not.toHaveProperty('bankName');
    }
  }
);
it('rejects a bank name that does not match the customer draft', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(
      new Response(
        JSON.stringify({ ...snapshot, data: { ...snapshot.data, bankName: 'Other bank' } })
      )
    );
  vi.stubGlobal('fetch', fetchMock);
  expect(await loadBankReceiptTopUpReview({ ...details, bankName: 'بانک ملی' })).toEqual({
    kind: 'error',
    status: 409,
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it.each(['x'.repeat(129), 'Bank\nName', ' padded '])(
  'rejects invalid bank names in returned snapshots (%s)',
  (bankName) => {
    expect(
      parseBankReceiptTopUpReview({ ...snapshot, data: { ...snapshot.data, bankName } })
    ).toBeNull();
  }
);
