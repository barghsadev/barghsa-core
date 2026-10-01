export const receiptId = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa';
export const secondReceiptId = 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb';
export const paymentProfileId = '11111111-1111-7111-8111-111111111111';
export const paymentInvoiceId = '22222222-2222-7222-8222-222222222222';
export const paymentReceipt = {
  transactionId: receiptId,
  walletId: paymentProfileId,
  amount: '250000',
  currency: 'IRR',
  state: 'Pending',
  paymentDate: '2026-08-15',
  payerReference: 'TRK-primary',
  attachmentKey: null,
  attachmentUrl: null,
  customerNote: 'Branch transfer',
  submittedAt: '2026-09-01T10:00:00.000Z',
  canDecide: true,
  staffDecision: null,
  creditTransactionId: null,
  overpayment: null,
};
export const reconciliationItem = {
  id: '10000000-0000-4000-8000-000000000001',
  description: 'Ledger mismatch',
  exceptionType: 'wallet_mismatch',
  status: 'open',
  severity: 'high',
  createdAt: '2026-09-01T00:00:00Z',
  details: { ledger: '9007199254740993' },
  assignedToUsername: null,
  resolvedByUsername: null,
  resolutionNote: null,
};
