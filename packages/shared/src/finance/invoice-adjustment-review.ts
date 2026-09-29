import { z } from 'zod';
import type { FinancialReviewSnapshot } from './review-snapshot.js';
import {
  financialReviewMoneySchema as money,
  invoiceFinancialDetailsSchema,
} from './wallet-payment-review.js';

const dataSchema = invoiceFinancialDetailsSchema.extend({
  adjustment: z
    .object({
      direction: z.enum(['charge', 'credit']),
      amount: z.string().regex(/^-?[0-9]{1,19}$/),
      absoluteAmount: money,
      reason: z.string().min(1).max(1000),
      initiatorId: z.string().min(1),
      approvalRequired: z.boolean(),
      approvalThreshold: money.nullable(),
    })
    .strict(),
});

export type InvoiceAdjustmentReviewData = z.infer<typeof dataSchema>;
export type InvoiceAdjustmentReview = FinancialReviewSnapshot<InvoiceAdjustmentReviewData>;

const schema = z
  .object({
    schemaVersion: z.literal(1),
    scope: z
      .object({
        action: z.literal('invoice.adjustment.submit'),
        profileId: z.string().uuid(),
        resourceId: z.string().uuid(),
      })
      .strict(),
    data: dataSchema,
    hash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()
  .refine(
    (review) =>
      review.scope.profileId === review.data.profile.id &&
      review.scope.resourceId === review.data.invoice.id &&
      (review.data.adjustment.direction === 'charge'
        ? !review.data.adjustment.amount.startsWith('-')
        : review.data.adjustment.amount.startsWith('-')) &&
      BigInt(review.data.adjustment.absoluteAmount) ===
        (BigInt(review.data.adjustment.amount) < 0n
          ? -BigInt(review.data.adjustment.amount)
          : BigInt(review.data.adjustment.amount))
  );

export function parseInvoiceAdjustmentReview(value: unknown): InvoiceAdjustmentReview | null {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
