export const financeContractId = '11111111-1111-4111-8111-111111111111';
export const financeProfileId = '22222222-2222-4222-8222-222222222222';
export const financeVersionId = '33333333-3333-4333-8333-333333333333';
export const financeCursor = '2026-10-01T00:00:00.123456Z';
export const cancellationRow = {
  id: '44444444-4444-4444-8444-444444444444',
  contractId: financeContractId,
  versionId: financeVersionId,
  reason: 'Please end electricity service',
  preferredDestination: 'external_bank' as const,
  status: 'Pending' as const,
  resolutionReason: null,
  contractState: 'Active',
  stale: false,
};
export const obligationRow = {
  id: '55555555-5555-4555-8555-555555555555',
  contractId: financeContractId,
  invoiceId: '66666666-6666-4666-8666-666666666666',
  amount: '9007199254740993',
  destination: 'external_bank',
  state: 'Approved',
  bankReference: null as string | null,
  nextAttemptAt: null,
  exhausted: false,
  orderId: null,
};
export const approvalRow = {
  id: '77777777-7777-4777-8777-777777777777',
  actionType: 'bank_payment_confirmation',
  amountIrR: '10000000000000001',
  initiatorId: 'initiator',
  initiatorUsername: 'finance@example.test',
  reason: 'Bank evidence reviewed',
  status: 'pending',
  reviewerId: null,
  reviewerUsername: null,
  reviewReason: null,
  details: { entityType: 'wallet_bank_receipt' },
};
export const financeVersion = {
  id: financeVersionId,
  versionNumber: 1,
  content: { text: 'Published electricity terms', price: '100' },
  changeDescription: 'Original',
  createdAt: '2026-09-21T00:00:00Z',
  acceptedAt: null,
};
export const financeContract = {
  id: financeContractId,
  profileId: financeProfileId,
  serviceType: 'electricity',
  state: 'Active',
  currentVersionId: financeVersionId,
  currentVersion: financeVersion,
};
