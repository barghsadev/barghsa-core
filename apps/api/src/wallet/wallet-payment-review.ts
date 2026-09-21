import type { WalletQueryClient } from './wallet.service.js';
import { ReviewSnapshotService } from '../finance/review-snapshot.service.js';
import { readInvoiceFinancialDetails } from '../finance/invoice-review.js';

export const walletPaymentReviewScope = (invoiceId: string, profileId: string) => ({
  action: 'invoice.wallet-payment',
  profileId,
  resourceId: invoiceId,
});

/** Caller holds the profile, wallet and invoice locks through commit. */
export async function readWalletPaymentReview(
  client: WalletQueryClient,
  invoiceId: string,
  profileId: string,
  remaining: bigint,
  available: bigint
) {
  const data = await readInvoiceFinancialDetails(client, invoiceId, profileId, remaining);
  return new ReviewSnapshotService().create(walletPaymentReviewScope(invoiceId, profileId), {
    ...data,
    payment: {
      source: 'wallet' as const,
      availableBefore: available.toString(),
      availableAfter: (available - remaining).toString(),
    },
  });
}
