import { parseBankReceiptBankName } from './bank-receipt-bank-name.js';
import { z } from 'zod';
import type { FinancialReviewSnapshot } from './review-snapshot.js';

const dataSchema = z
  .object({
    profileId: z.string().uuid(),
    amountIrR: z.string().regex(/^[1-9]\d*$/),
    paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    payerReference: z.string().min(1),
    attachmentKey: z.string().min(1),
    fileName: z.string().min(1),
    fileSizeBytes: z.string().regex(/^\d+$/).nullable(),
    customerNote: z.string().nullable(),
    bankName: z
      .string()
      .refine((name) => parseBankReceiptBankName(name) === name && name.length > 0)
      .nullable()
      .optional(),
    stateAfterSubmission: z.literal('Pending'),
    creditRule: z.literal('after_finance_confirmation'),
  })
  .strict();

export type BankReceiptTopUpReviewData = z.infer<typeof dataSchema>;
export type BankReceiptTopUpReview = FinancialReviewSnapshot<BankReceiptTopUpReviewData>;

const schema = z
  .object({
    schemaVersion: z.literal(1),
    scope: z
      .object({
        action: z.literal('wallet.bank-receipt-topup-submission'),
        profileId: z.string().uuid(),
        resourceId: z.string().uuid(),
      })
      .strict(),
    data: dataSchema,
    hash: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict()
  .refine(
    (review) =>
      review.scope.profileId === review.data.profileId &&
      review.scope.resourceId === review.data.profileId
  );

export function parseBankReceiptTopUpReview(value: unknown): BankReceiptTopUpReview | null {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
