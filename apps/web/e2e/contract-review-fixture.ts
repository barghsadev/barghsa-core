import type { ContractFinancialReview } from '@barghsa/shared/finance';
export const ORIGINAL = '44444444-4444-4444-8444-444444444444';
export const SIGNED = '55555555-5555-4555-8555-555555555555';
export const REQUEST = '66666666-6666-4666-8666-666666666666';
export function contractReview(
  action: 'acceptance' | 'request' | 'record',
  requested = false
): ContractFinancialReview {
  const contractId = '11111111-1111-4111-8111-111111111111';
  const profileId = '22222222-2222-4222-8222-222222222222';
  const versionId = '33333333-3333-4333-8333-333333333333';
  const document = {
    id: ORIGINAL,
    contractId,
    versionId,
    originalName: 'original.pdf',
    checksum: 'b'.repeat(64),
    state: 'Approved' as const,
  };
  return {
    schemaVersion: 1,
    hash: (action === 'acceptance' ? 'a' : action === 'request' ? 'b' : 'c').repeat(64),
    scope: {
      action:
        action === 'acceptance'
          ? 'contract.acceptance'
          : action === 'request'
            ? 'contract.signature-request'
            : 'contract.signature-record',
      profileId,
      resourceId: contractId,
    },
    data: {
      currency: 'IRR',
      profile: { id: profileId, title: 'Customer', type: 'LEGAL' },
      contract: {
        id: contractId,
        versionId,
        versionNumber: 2,
        serviceType: 'electricity',
        state:
          action === 'acceptance'
            ? 'AwaitingCustomerAcceptance'
            : requested
              ? 'AwaitingSignature'
              : 'Accepted',
        publishedAt: '2026-09-21T00:00:00.000Z',
        content: { text: 'Published terms', price: '9007199254740993' },
      },
      activation: {
        ruleRevision: 1,
        signatureRequired: true,
        paymentRequired: true,
        serviceStartRequired: false,
        serviceStartsAt: null,
        serviceEndsAt: null,
        initialInvoiceId: null,
      },
      initialInvoice: null,
      payment: { source: 'none', amount: '0' },
      cancellationRefund: 'full_wallet',
      signature:
        action === 'acceptance'
          ? null
          : {
              requestId: requested ? REQUEST : null,
              requestNumber: requested ? 1 : null,
              originalDocument: document,
              signedDocument:
                action === 'record'
                  ? {
                      ...document,
                      id: SIGNED,
                      originalName: 'signed.pdf',
                      checksum: 'd'.repeat(64),
                    }
                  : null,
            },
    },
  };
}
