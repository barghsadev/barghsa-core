import { expect, it } from 'vitest';
import {
  cancellationSnapshot,
  type CancellationSnapshotRow,
} from './contract-cancellation-snapshot.js';
const base: CancellationSnapshotRow = {
  id: 'contract',
  profile_id: 'profile',
  current_version_id: 'version',
  service_type: 'electricity',
  state: 'Active',
  archived: false,
  association_conflict: false,
  ambiguous_order_invoices: false,
  invoices: [],
};
const invoice = {
  id: 'invoice',
  state: 'Paid',
  totalAmount: '9007199254740999',
  paidAmount: '9007199254740999',
  refundedAmount: '3',
  pendingRefunds: [],
};
it('keeps full bigint precision and distinguishes reserved from outstanding refunds', () => {
  const snapshot = cancellationSnapshot({
    ...base,
    invoices: [
      {
        ...invoice,
        pendingRefunds: [{ id: 'refund', amount: '5', state: 'Failed', destination: 'wallet' }],
      },
    ],
  });
  expect(snapshot).toMatchObject({
    refundableAmount: '9007199254740996',
    availableRefundAmount: '9007199254740991',
    mandatoryWalletReturn: true,
    blockers: ['refund_in_progress'],
  });
});
it('binds the version, state and all financial facts while ignoring row ordering', () => {
  const row = { ...base, invoices: [invoice, { ...invoice, id: 'another' }] };
  const first = cancellationSnapshot(row).fingerprint;
  expect(cancellationSnapshot({ ...row, invoices: [...row.invoices].reverse() }).fingerprint).toBe(
    first
  );
  for (const changed of [
    { ...row, current_version_id: 'new' },
    { ...row, state: 'Signed' },
    {
      ...row,
      invoices: [
        { ...invoice, refundedAmount: '4' },
        { ...invoice, id: 'another' },
      ],
    },
  ])
    expect(cancellationSnapshot(changed).fingerprint).not.toBe(first);
});
it('preserves unresolved payment and terminal guards even when no funds are available', () => {
  expect(
    cancellationSnapshot({
      ...base,
      state: 'Completed',
      archived: true,
      invoices: [{ ...invoice, state: 'PaymentUnderReview', paidAmount: '0', refundedAmount: '0' }],
    })
  ).toMatchObject({
    mandatoryWalletReturn: false,
    blockers: ['profile_archived', 'terminal_contract', 'payment_under_review'],
  });
});
it('does not make wallet return mandatory for other services', () => {
  expect(
    cancellationSnapshot({ ...base, service_type: 'solar', invoices: [invoice] })
      .mandatoryWalletReturn
  ).toBe(false);
});
it('requires invoice associations to be reconciled before a decision', () => {
  expect(
    cancellationSnapshot({ ...base, association_conflict: true, ambiguous_order_invoices: true })
      .blockers
  ).toEqual(['invoice_identity_conflict', 'ambiguous_order_invoices']);
});
it('refuses inconsistent paid/refunded/reserved balances', () => {
  expect(() =>
    cancellationSnapshot({
      ...base,
      invoices: [{ ...invoice, paidAmount: '1', refundedAmount: '2' }],
    })
  ).toThrow('reconciliation');
});
