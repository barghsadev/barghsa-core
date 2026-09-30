import { z } from 'zod';
import type { FinancialReviewSnapshot } from './review-snapshot.js';

const amount = z.string().regex(/^\d+$/);

const dataSchema = z
  .object({
    invoiceId: z.string().uuid(),
    profileId: z.string().uuid(),
    invoiceState: z.string().min(1),
    invoiceTotalIrR: amount,
    invoicePaidIrR: amount,
    invoiceRemainingIrR: amount,
    amountIrR: z.string().regex(/^[1-9]\d*$/),
    paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    payerReference: z.string().min(1),
    bankName: z.string().nullable(),
    attachmentKey: z.string().min(1),
    fileName: z.string().min(1),
    fileSizeBytes: amount.nullable(),
    customerNote: z.string().nullable(),
    stateAfterSubmission: z.literal('Submitted'),
    settlementRule: z.literal('after_finance_confirmation'),
    excessRule: z.literal('confirmed_excess_to_wallet'),
  })
  .strict();

export type InvoiceBankReceiptSubmissionReviewData = z.infer<typeof dataSchema>;
export type InvoiceBankReceiptSubmissionReview =
  FinancialReviewSnapshot<InvoiceBankReceiptSubmissionReviewData>;

const schema = z
  .object({
    schemaVersion: z.literal(1),
    scope: z
      .object({
        action: z.literal('invoice.bank-receipt-submission'),
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
      review.scope.resourceId === review.data.invoiceId
  );

export function parseInvoiceBankReceiptSubmissionReview(
  value: unknown
): InvoiceBankReceiptSubmissionReview | null {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
