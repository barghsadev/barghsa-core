import type { BankReceiptConfirmationReview } from '@barghsa/shared/finance';

export function bankReceiptReview(
  transactionId: string,
  invoiceId: string | null = null,
  profileId = '11111111-1111-7111-8111-111111111111'
): BankReceiptConfirmationReview {
  const profile = { id: profileId, title: 'Customer profile', type: 'LEGAL' };
  return {
    schemaVersion: 1,
    hash: 'a'.repeat(64),
    scope: {
      action: 'wallet.bank-receipt-confirmation',
      profileId: profileId,
      resourceId: transactionId,
    },
    data: {
      currency: 'IRR',
      profile,
      receipt: {
        id: transactionId,
        amount: '250000',
        paymentDate: '2026-08-15',
        payerReference: 'TRK',
        attachmentKey: null,
        customerNote: null,
        submittedAt: '2026-09-01T10:00:00.000Z',
      },
      invoice: invoiceId
        ? {
            currency: 'IRR',
            profile,
            invoice: {
              id: invoiceId,
              state: 'Unpaid',
              orderId: null,
              serviceType: null,
              issuedAt: null,
              payableFrom: null,
              dueAt: null,
              totalAmount: '100000',
              paidAmount: '0',
              remainingAmount: '100000',
            },
            lines: [],
            totals: null,
            contracts: [],
            cancellation: 'separate_review_required',
          }
        : null,
      allocation: {
        invoiceAmount: invoiceId ? '100000' : '0',
        walletCredit: invoiceId ? '150000' : '250000',
      },
      wallet: { availableBefore: '0', availableAfter: invoiceId ? '150000' : '250000' },
      approval: { required: false, thresholdAmount: null },
      source: 'bank_receipt',
    },
  };
}
