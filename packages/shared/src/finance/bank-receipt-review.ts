import { z } from 'zod';
import {
  financialReviewMoneySchema as money,
  invoiceFinancialDetailsSchema,
} from './wallet-payment-review.js';
import type { FinancialReviewSnapshot } from './review-snapshot.js';

const balance = z.string().regex(/^-?(0|[1-9]\d{0,19})$/);
const dataSchema = z
  .object({
    currency: z.literal('IRR'),
    profile: invoiceFinancialDetailsSchema.shape.profile,
    receipt: z
      .object({
        id: z.string().uuid(),
        amount: money,
        paymentDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullable(),
        payerReference: z.string().nullable(),
        attachmentKey: z.string().nullable(),
        customerNote: z.string().nullable(),
        submittedAt: z.string().datetime(),
      })
      .strict(),
    invoice: invoiceFinancialDetailsSchema.nullable(),
    allocation: z.object({ invoiceAmount: money, walletCredit: money }).strict(),
    wallet: z.object({ availableBefore: balance, availableAfter: balance }).strict(),
    approval: z.object({ required: z.boolean(), thresholdAmount: money.nullable() }).strict(),
    source: z.literal('bank_receipt'),
  })
  .strict()
  .refine((data) => {
    try {
      const invoiceAmount = BigInt(data.allocation.invoiceAmount);
      const walletCredit = BigInt(data.allocation.walletCredit);
      const receiptAmount = BigInt(data.receipt.amount);
      if (invoiceAmount + walletCredit !== receiptAmount || receiptAmount <= 0n) return false;
      if (BigInt(data.wallet.availableBefore) + walletCredit !== BigInt(data.wallet.availableAfter))
        return false;
      if (!data.invoice) return invoiceAmount === 0n;
      const remaining = BigInt(data.invoice.invoice.remainingAmount);
      return (
        data.invoice.profile.id === data.profile.id &&
        invoiceAmount === (remaining < receiptAmount ? remaining : receiptAmount)
      );
    } catch {
      return false;
    }
  });

export type BankReceiptConfirmationReviewData = z.infer<typeof dataSchema>;
export type BankReceiptConfirmationReview =
  FinancialReviewSnapshot<BankReceiptConfirmationReviewData>;

const schema = z
  .object({
    schemaVersion: z.literal(1),
    scope: z
      .object({
        action: z.literal('wallet.bank-receipt-confirmation'),
        profileId: z.string().uuid(),
        resourceId: z.string().uuid(),
      })
      .strict(),
    hash: z.string().regex(/^[a-f0-9]{64}$/),
    data: dataSchema,
  })
  .strict()
  .refine(
    (review) =>
      review.scope.profileId === review.data.profile.id &&
      review.scope.resourceId === review.data.receipt.id
  );

export function parseBankReceiptConfirmationReview(
  value: unknown
): BankReceiptConfirmationReview | null {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
