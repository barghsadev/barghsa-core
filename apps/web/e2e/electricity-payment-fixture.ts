import { createHash } from 'node:crypto';
import type { WalletPaymentReviewData } from '@barghsa/shared/finance';

interface ElectricityPaymentInput {
  profileId: string;
  orderId: string;
  invoiceId: string;
  contractId: string;
  versionId: string;
  transactionId: string;
  amount: string;
  availableBalance: string;
  submittedAt: string;
}

export function electricityPaymentReview(input: ElectricityPaymentInput) {
  const data: WalletPaymentReviewData = {
    currency: 'IRR',
    profile: { id: input.profileId, title: 'Buyer', type: 'LEGAL' },
    invoice: {
      id: input.invoiceId,
      state: 'Unpaid',
      orderId: input.orderId,
      serviceType: 'electricity',
      issuedAt: input.submittedAt,
      payableFrom: input.submittedAt,
      dueAt: '2026-09-30T10:00:00.000Z',
      totalAmount: input.amount,
      paidAmount: '0',
      remainingAmount: input.amount,
    },
    lines: [
      {
        id: input.transactionId,
        description: 'Electricity',
        quantity: 1,
        unitPrice: input.amount,
        discount: '0',
        subtotal: input.amount,
        vatRate: 0,
        vatAmount: '0',
        taxable: false,
      },
    ],
    totals: { subtotal: input.amount, discount: '0', vat: '0' },
    payment: {
      source: 'wallet',
      availableBefore: input.availableBalance,
      availableAfter: String(BigInt(input.availableBalance) - BigInt(input.amount)),
    },
    contracts: [
      {
        id: input.contractId,
        versionId: input.versionId,
        state: 'AwaitingPayment',
        serviceType: 'electricity',
        ruleRevision: 1,
        signatureRequired: false,
        paymentRequired: true,
        initialInvoice: true,
        serviceStartRequired: false,
        serviceStartsAt: null,
        serviceEndsAt: null,
        cancellationRefund: 'full_wallet',
      },
    ],
    cancellation: 'separate_review_required',
  };
  return {
    schemaVersion: 1,
    scope: {
      action: 'invoice.wallet-payment' as const,
      profileId: input.profileId,
      resourceId: input.invoiceId,
    },
    data,
    hash: createHash('sha256').update(JSON.stringify(data)).digest('hex'),
  };
}
