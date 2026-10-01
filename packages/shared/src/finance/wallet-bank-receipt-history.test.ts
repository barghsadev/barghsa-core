import { describe, expect, it } from 'vitest';
import { readWalletBankReceiptHistory } from './wallet-bank-receipt-history.js';

const submittedAt = '2026-09-01T12:00:00.123456Z';
const decidedAt = '2026-09-02T12:00:00.000Z';
const approval = {
  requestId: 'approval',
  initiatorId: 'staff',
  fingerprint: 'hash',
  invoiceId: null,
  requestedAt: '2026-09-01T16:00:00.000Z',
};
const receipt = {
  paymentDate: '2026-09-01',
  payerReference: 'TRK',
  bankName: ' Bank A ',
  customerNote: 'Branch transfer',
  attachmentKey: 'private/key',
};
const metadata = {
  channel: 'bank_receipt',
  receipt,
  sessionId: 'private-session',
  financialReview: { secret: true },
};
const row = { type: 'topup', state: 'Pending', createdAt: submittedAt, metadata };
function decision(name = 'confirmed', overrides: Record<string, unknown> = {}) {
  return {
    decision: name,
    actorUserId: 'private-actor',
    decidedAt,
    reason: 'Missing deposit reference',
    customerVisible: name === 'rejected',
    creditTransactionId: 'credit',
    ...overrides,
  };
}

describe('wallet receipt history projection', () => {
  it('allows only customer receipt fields and records the original submission microseconds', () => {
    expect(readWalletBankReceiptHistory(row)).toEqual({
      paymentDate: '2026-09-01',
      payerReference: 'TRK',
      bankName: 'Bank A',
      customerNote: 'Branch transfer',
      rejectionReason: null,
      timeline: { events: [{ state: 'submitted', occurredAt: submittedAt }], awaiting: 'review' },
    });
  });
  it('records requested second approval without claiming funds were applied', () => {
    const result = readWalletBankReceiptHistory({
      ...row,
      metadata: { ...metadata, dualApproval: approval },
    });
    expect(result?.timeline).toEqual({
      events: [
        { state: 'submitted', occurredAt: submittedAt },
        { state: 'approval_requested', occurredAt: approval.requestedAt },
      ],
      awaiting: 'second_approval',
    });
    expect(JSON.stringify(result)).not.toMatch(
      /private|initiator|fingerprint|requestId|financialReview|creditTransactionId/
    );
  });
  it('shows final confirmation for the original receipt', () => {
    const state = 'Released';
    const result = readWalletBankReceiptHistory({
      ...row,
      state,
      metadata: { ...metadata, dualApproval: approval, staffDecision: decision() },
    });
    expect(result?.timeline.events.at(-1)).toEqual({ state: 'confirmed', occurredAt: decidedAt });
    expect(result?.timeline.awaiting).toBeNull();
    expect(result?.rejectionReason).toBeNull();
  });
  it('exposes the explicitly customer-visible rejection reason', () => {
    const result = readWalletBankReceiptHistory({
      ...row,
      state: 'Rejected',
      metadata: { ...metadata, staffDecision: decision('rejected') },
    });
    expect(result?.rejectionReason).toBe('Missing deposit reference');
    expect(result?.timeline.events.at(-1)).toEqual({ state: 'rejected', occurredAt: decidedAt });
  });
  it.each([false, undefined, 'true'])(
    'never exposes an internal rejection reason: %s',
    (customerVisible) => {
      expect(
        readWalletBankReceiptHistory({
          ...row,
          state: 'Rejected',
          metadata: { ...metadata, staffDecision: decision('rejected', { customerVisible }) },
        })?.rejectionReason
      ).toBeNull();
    }
  );
  it.each(['confirmed', 'rejected'])(
    'does not turn inconsistent metadata into a decision: %s',
    (name) => {
      const result = readWalletBankReceiptHistory({
        ...row,
        metadata: { ...metadata, staffDecision: decision(name) },
      });
      expect(result?.timeline.events).toHaveLength(1);
      expect(result?.rejectionReason).toBeNull();
    }
  );
  it('shows missing legacy dates explicitly and does not borrow timestamps from the opposite decision', () => {
    const legacyApproval = {
      requestId: 'approval',
      initiatorId: 'staff',
      fingerprint: 'hash',
      invoiceId: null,
    };
    const result = readWalletBankReceiptHistory({
      ...row,
      state: 'Rejected',
      metadata: { ...metadata, dualApproval: legacyApproval, staffDecision: decision('confirmed') },
    });
    expect(result?.timeline.events).toEqual([
      { state: 'submitted', occurredAt: submittedAt },
      { state: 'approval_requested', occurredAt: null },
      { state: 'rejected', occurredAt: null },
    ]);
  });
  it('drops invalid dates and malformed receipt metadata without failing wallet history', () => {
    const result = readWalletBankReceiptHistory({
      ...row,
      state: 'Released',
      metadata: {
        ...metadata,
        receipt: { paymentDate: '2026-02-30', payerReference: 123, bankName: {}, customerNote: [] },
        dualApproval: { ...approval, requestedAt: 'tomorrow' },
        staffDecision: decision('confirmed', { decidedAt: '2026-02-30T12:00:00Z' }),
      },
    });
    expect(result?.timeline.events.slice(1)).toEqual([
      { state: 'approval_requested', occurredAt: null },
      { state: 'confirmed', occurredAt: null },
    ]);
    expect(result?.paymentDate).toBeNull();
    expect(result?.payerReference).toBeNull();
    expect(result?.customerNote).toBeNull();
    expect(result?.bankName).toBeNull();
  });
  it.each([
    null,
    [],
    { channel: 'online' },
    { ...metadata, pendingTransactionId: 'original-receipt' },
  ])('does not expose nonreceipt or separate settlement-credit metadata: %s', (input) => {
    expect(readWalletBankReceiptHistory({ ...row, metadata: input })).toBeNull();
  });
  it('does not expose a bank receipt on unrelated transaction types', () => {
    expect(readWalletBankReceiptHistory({ ...row, type: 'payment' })).toBeNull();
  });
});

it('does not relabel a Completed bank credit as a submitted receipt, even when legacy credit metadata lacks its source ID', () => {
  expect(readWalletBankReceiptHistory({ ...row, state: 'Completed' })).toBeNull();
});
