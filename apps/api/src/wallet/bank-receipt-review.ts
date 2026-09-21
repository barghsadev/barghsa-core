import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  DUAL_APPROVAL_THRESHOLD_CONFIG_KEY,
  allocateReceiptAgainstInvoice,
  invoiceBankReceiptRequiresDualApproval,
  isBankReceiptInvoiceLinkAllowedState,
  parseBankReceiptConfirmationReview,
  readInvoiceBankReceiptDualApprovalThreshold,
  remainingForBankReceiptSettlement,
  type BankReceiptConfirmationReviewData,
  type BankReceiptTopUpDetails,
} from '@barghsa/shared/finance';
import { readInvoiceFinancialDetails } from '../finance/invoice-review.js';
import { ReviewSnapshotService } from '../finance/review-snapshot.service.js';
import type { WalletQueryClient } from './wallet.service.js';

export const bankReceiptReviewScope = (transactionId: string, profileId: string) => ({
  action: 'wallet.bank-receipt-confirmation',
  profileId,
  resourceId: transactionId,
});

/** Caller holds the exclusive profile lock, threshold lock and receipt lock.
 * This takes wallet then invoice locks, retained through confirmation/approval. */
export async function readBankReceiptConfirmationReview(
  client: WalletQueryClient,
  input: {
    id: string;
    profileId: string;
    amount: bigint;
    submittedAt: Date;
    receipt: BankReceiptTopUpDetails | null;
    attachmentKey: string | null;
    invoiceId: string | null;
    approvalRequired?: boolean;
  }
) {
  const profile = (
    await client.query(
      `SELECT p.id,p.profile_type,
      COALESCE(NULLIF(p.title,''),NULLIF(concat_ws(' ',p.first_name,p.last_name),''),'') AS title,
      w.posted_balance,w.reserved_balance
     FROM profiles p JOIN wallets w ON w.profile_id=p.id WHERE p.id=$1 FOR UPDATE OF w`,
      [input.profileId]
    )
  ).rows[0] as
    | {
        id: string;
        profile_type: string;
        title: string;
        posted_balance: string;
        reserved_balance: string;
      }
    | undefined;
  if (!profile) throw new NotFoundException();
  const available = BigInt(profile.posted_balance) - BigInt(profile.reserved_balance);
  let invoice: BankReceiptConfirmationReviewData['invoice'] = null;
  let invoiceAmount = 0n,
    walletCredit = input.amount;
  if (input.invoiceId) {
    const row = (
      await client.query(
        'SELECT id,profile_id,state,total_amount,paid_amount FROM invoices WHERE id=$1 FOR UPDATE',
        [input.invoiceId]
      )
    ).rows[0] as
      | { id: string; profile_id: string; state: string; total_amount: string; paid_amount: string }
      | undefined;
    if (!row || row.profile_id !== input.profileId) throw new NotFoundException();
    if (!isBankReceiptInvoiceLinkAllowedState(row.state))
      throw new ConflictException('Invoice cannot receive this receipt');
    const remaining = remainingForBankReceiptSettlement({
      totalAmount: BigInt(row.total_amount),
      paidAmount: BigInt(row.paid_amount),
      state: row.state,
    });
    const allocation = allocateReceiptAgainstInvoice({ receiptAmount: input.amount, remaining });
    invoiceAmount = allocation.invoiceAllocation;
    walletCredit = allocation.walletCreditAmount;
    invoice = await readInvoiceFinancialDetails(
      client,
      input.invoiceId,
      input.profileId,
      remaining
    );
  }
  const config = (
    await client.query('SELECT value FROM app_config WHERE key=$1', [
      DUAL_APPROVAL_THRESHOLD_CONFIG_KEY,
    ])
  ).rows[0] as { value: unknown } | undefined;
  const threshold = readInvoiceBankReceiptDualApprovalThreshold(config?.value);
  if (threshold.status === 'corrupt')
    throw new ConflictException('Dual-approval threshold configuration is invalid');
  const data: BankReceiptConfirmationReviewData = {
    currency: 'IRR',
    profile: { id: profile.id, title: profile.title, type: profile.profile_type },
    receipt: {
      id: input.id,
      amount: input.amount.toString(),
      submittedAt: input.submittedAt.toISOString(),
      paymentDate: input.receipt?.paymentDate ?? null,
      payerReference: input.receipt?.payerReference ?? null,
      attachmentKey: input.attachmentKey,
      customerNote: input.receipt?.customerNote ?? null,
    },
    invoice,
    allocation: { invoiceAmount: invoiceAmount.toString(), walletCredit: walletCredit.toString() },
    wallet: {
      availableBefore: available.toString(),
      availableAfter: (available + walletCredit).toString(),
    },
    approval: {
      required:
        input.approvalRequired === true ||
        invoiceBankReceiptRequiresDualApproval(threshold, input.amount),
      thresholdAmount: threshold.status === 'enabled' ? threshold.thresholdIrR.toString() : null,
    },
    source: 'bank_receipt',
  };
  const review = new ReviewSnapshotService().create(
    bankReceiptReviewScope(input.id, input.profileId),
    data
  );
  if (!parseBankReceiptConfirmationReview(review))
    throw new ConflictException('Receipt review requires reconciliation');
  return review;
}
